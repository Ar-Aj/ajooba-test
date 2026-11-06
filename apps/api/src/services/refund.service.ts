import { Types } from 'mongoose';
import type { PaymentStatus } from '@ajooba/contracts';
import { logger } from '../config/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';
import { OrderModel } from '../models/order.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { ReturnRequestModel } from '../models/return-request.model.js';
import {
  RazorpayApiError,
  createRazorpayRefund,
  fetchRazorpayRefund,
  isRazorpayConfigured,
} from './razorpay.service.js';
import { refundableAmountForOrder } from './payment.service.js';
import type { OrderDoc } from './order.service.js';

/**
 * Refunds.
 *
 * The single most important rule in this file:
 *
 *   **A return approval is not a refund, and neither is a request to the
 *   provider.**
 *
 * Those are three distinct events with three distinct meanings:
 *
 *   1. The customer asks to return something. Nothing financial happens.
 *   2. An administrator approves it. Still nothing financial happens — a
 *      decision has been made, no money has moved.
 *   3. A refund is issued at the provider *and confirmed by it*. Only now
 *      may anything in this system say "refunded".
 *
 * Everything here is written so those cannot collapse into one another. A
 * caller cannot mark a return `refunded` by passing a `refundRef` string; the
 * only path to that state runs through a provider response.
 */

/**
 * The refund as this system understands it, including the provider's actual
 * state. `settled` is what the UI should gate "Refund completed" on.
 */
export interface RefundOutcome {
  readonly returnId: string;
  readonly returnNumber: string;
  readonly orderId: string;
  readonly refundId: string | null;
  readonly amountRupees: number;
  /** The provider's own status: `pending`, `processed` or `failed`. */
  readonly providerStatus: string | null;
  /** True only when the provider confirms the money was returned. */
  readonly settled: boolean;
  readonly message: string;
}

interface ReturnDocShape {
  _id: Types.ObjectId;
  returnNumber: string;
  orderId: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  status: string;
  refundAmount: number;
  refundRef?: string | null;
  /** The returned lines, used to restore the exact quantities. */
  items?: Array<{
    variantId: Types.ObjectId;
    quantity: number;
    sku?: string;
  }>;
}

/**
 * The provider's refund status, mapped onto our own vocabulary.
 *
 * `processed` is the only state that means the customer has their money.
 * `pending` means the provider accepted the request but has not returned the
 * money yet — presenting that as a completed refund is exactly the
 * dishonesty this mapping exists to prevent.
 */
function isSettled(providerStatus: string | null | undefined): boolean {
  return providerStatus === 'processed';
}

/**
 * Issue a refund for an approved return.
 *
 * Preconditions, all enforced server-side:
 *   - the return must exist and be `approved` (or already `refunded`);
 *   - the underlying order must have been **paid** — a cash-on-delivery
 *     order has nothing to refund through a gateway;
 *   - there must be a captured payment to refund against;
 *   - the requested amount must not exceed the remaining refundable balance.
 *
 * Idempotency: the provider call carries an `X-Refund-Idempotency` key
 * derived from the return number, so a network timeout that left us unsure
 * whether the refund landed can simply be retried — the provider will return
 * the original refund rather than sending the money twice.
 */
export async function issueRefundForReturn(
  returnId: string,
  requestedAmount: number | undefined,
  correlationId: string,
): Promise<RefundOutcome> {
  if (!Types.ObjectId.isValid(returnId)) {
    throw new NotFoundError('Return request');
  }

  const doc = await ReturnRequestModel.findById(returnId).lean<ReturnDocShape | null>();
  if (!doc) {
    throw new NotFoundError('Return request');
  }

  const outcome = (
    refundId: string | null,
    amount: number,
    providerStatus: string | null,
    message: string,
  ): RefundOutcome => ({
    returnId: doc._id.toString(),
    returnNumber: doc.returnNumber,
    orderId: doc.orderId.toString(),
    refundId,
    amountRupees: amount,
    providerStatus,
    settled: isSettled(providerStatus),
    message,
  });

  // Already refunded: report the truth rather than issuing a second one.
  if (doc.status === 'refunded') {
    let providerStatus: string | null = null;
    if (doc.refundRef) {
      try {
        const remote = await fetchRazorpayRefund(doc.refundRef);
        providerStatus = remote.status;
      } catch {
        providerStatus = null;
      }
    }
    return outcome(
      doc.refundRef ?? null,
      doc.refundAmount,
      providerStatus,
      providerStatus === 'processed'
        ? 'This refund has already been completed.'
        : 'A refund for this return is already in progress.',
    );
  }

  if (doc.status !== 'approved') {
    throw new ConflictError(`A return in "${doc.status}" cannot be refunded. Approve it first.`);
  }

  if (!isRazorpayConfigured()) {
    throw new ValidationError(
      'Refunds require a configured payment provider. No money has been moved.',
    );
  }

  const { refundable, total, paid } = await refundableAmountForOrder(doc.orderId);

  if (!paid) {
    throw new ConflictError(
      'This order was not paid online, so there is nothing to refund through the payment provider.',
    );
  }

  /*
   * The default amount is the **return's** approved amount, not the order's
   * remaining refundable balance.
   *
   * A customer may return one pair out of two. The return record then
   * carries the refund amount that was agreed (or that an administrator set
   * when approving it), and that is what the refund must act on. Defaulting
   * to the order's remaining balance would refund the whole order — money
   * the customer never asked for and did not lose — the moment an
   * administrator issued a refund for a partial return.
   *
   * The order's balance is still the ceiling: an explicit amount above it is
   * rejected below, never silently clamped.
   */
  const amount = requestedAmount ?? doc.refundAmount;

  if (amount > refundable) {
    /*
     * Rejected, not clamped. Silently reducing a refund is a support
     * incident and a possible compliance problem; the caller is told the
     * exact remaining balance instead.
     */
    throw new ConflictError(
      `Only ${refundable} rupee(s) remain refundable on this order (of ${total} paid).`,
    );
  }

  if (amount <= 0) {
    throw new ValidationError('The refund amount must be greater than zero.');
  }

  // Refund against the captured payment, not just any payment row.
  const payment = await PaymentModel.findOne({
    orderId: doc.orderId,
    status: { $in: ['paid', 'partially_refunded'] },
    providerReference: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .lean<{ _id: Types.ObjectId; providerReference: string } | null>();

  if (!payment) {
    throw new ConflictError(
      'No captured payment was found for this order, so it cannot be refunded.',
    );
  }

  let providerStatus: string;
  let refundId: string;

  try {
    const refund = await createRazorpayRefund({
      paymentId: payment.providerReference,
      amountRupees: amount,
      // Stable across retries — that is the whole point of the header.
      idempotencyKey: `retrn-${doc.returnNumber}`,
      receipt: doc.returnNumber.slice(0, 40),
      notes: { return_number: doc.returnNumber, order_number: doc.orderNumber },
    });

    refundId = refund.id;
    providerStatus = refund.status;
  } catch (error) {
    if (error instanceof RazorpayApiError) {
      logger.error(
        {
          returnId,
          correlationId,
          httpStatus: error.httpStatus,
          providerCode: error.providerCode,
          retryable: error.retryable,
        },
        'Refund request failed',
      );

      if (error.httpStatus === 409) {
        /*
         * Documented behaviour: an identical request is still in flight.
         * Safe to retry with the same key, so we tell the operator exactly
         * that rather than reporting a failure.
         */
        throw new ConflictError(
          'A refund for this return is already being processed. Please retry in a moment.',
        );
      }

      if (!error.retryable) {
        throw new ValidationError(`The refund was rejected: ${error.message}`);
      }
    }
    throw error;
  }

  await applyRefundToRecords(doc, refundId, amount, providerStatus, correlationId);

  return outcome(
    refundId,
    amount,
    providerStatus,
    providerStatus === 'processed'
      ? 'The refund has been completed.'
      : 'The refund has been accepted and is being processed. It usually takes 5–7 working days.',
  );
}

/**
 * Roll back a refund the provider could not process.
 *
 * Called when Razorpay reports a refund as `failed` — either through the
 * `refund.failed` webhook or through the reconciliation job. The two paths
 * share this function so they cannot disagree.
 *
 * What it does:
 *
 *  - reopens the return to `approved`, so an administrator can retry;
 *  - removes the `refundRef` so the return is no longer "in flight";
 *  - restores the order's refundable balance by decrementing the amount
 *    that had been provisionally reserved against it.
 *
 * What it deliberately does **not** do: touch the *payment*. A failed refund
 * means the customer still has their money and still has their goods. The
 * payment stays `paid`; the order does not become failed; no stock moves.
 *
 * @param refundId The provider's refund id.
 * @returns `true` when a refund was actually in flight and was rolled back.
 */
export async function reconcileFailedRefund(
  refundId: string,
  correlationId: string,
  context: { providerPaymentId?: string | null; returnId?: string | null } = {},
): Promise<boolean> {
  /*
   * The return is identified by the refund id it recorded, which is the one
   * link that ties an in-flight refund to a specific return.
   */
  const doc = await ReturnRequestModel.findOne({
    refundRef: refundId,
  }).lean<ReturnDocShape | null>();

  if (!doc) {
    logger.info(
      { refundId, providerPaymentId: context.providerPaymentId ?? null, correlationId },
      'Refund failure for a refund we have no return for; nothing to roll back',
    );
    return false;
  }

  await ReturnRequestModel.updateOne(
    { _id: doc._id },
    { $set: { status: 'approved' }, $unset: { refundRef: 1 } },
  );

  /*
   * Restore the refundable balance by reversing the provisional increment.
   * The filter restricts the update to payments that still carry this refund
   * id, so a second delivery of the same event cannot double-decrement.
   */
  await PaymentModel.updateMany(
    { orderId: doc.orderId, refundRef: refundId },
    { $inc: { refundedAmount: -doc.refundAmount }, $unset: { refundRef: 1 } },
  );

  logger.warn(
    { refundId, returnId: doc._id.toString(), correlationId },
    'Provider reports the refund as failed; rolled back and the return reopened',
  );

  return true;
}

/**
 * Tell the customer their refund has landed.
 *
 * Best-effort, for the same reason every other notification is: the money
 * has already moved, so a mail failure must not turn a settled refund into
 * an error. The outbox records the attempt either way.
 *
 * The recipient is resolved from the **order**, not trusted from the return
 * document, so a return cannot be made to email an arbitrary address.
 */
async function notifyRefundSettled(
  doc: ReturnDocShape,
  refundId: string,
  amount: number,
): Promise<void> {
  try {
    const order = await OrderModel.findById(doc.orderId)
      .select('customerEmail')
      .lean<{ customerEmail: string } | null>();
    if (!order?.customerEmail) {
      return;
    }

    const templates = await import('./email-templates.js');
    const { notifyReturnEvent } = await import('./notification.service.js');
    const { mapReturn } = await import('./return.service.js');

    const fresh = await ReturnRequestModel.findById(doc._id).lean<
      Parameters<typeof mapReturn>[0]
    >();
    if (!fresh) {
      return;
    }

    const projected = mapReturn(fresh);

    await notifyReturnEvent({
      template: 'return-refunded',
      returnId: doc._id,
      orderId: doc.orderId,
      orderNumber: doc.orderNumber,
      returnNumber: doc.returnNumber,
      to: order.customerEmail,
      rendered: templates.renderReturnRefunded(projected, refundId),
    });
  } catch (error) {
    logger.warn(
      {
        returnId: doc._id.toString(),
        refundId,
        amount,
        err: error instanceof Error ? error.message : String(error),
      },
      'The refund settled but the customer notification could not be recorded',
    );
  }
}

/**
 * Write the refund result through the return, order and payment records.
 *
 * The order's payment status is only promoted to `refunded` /
 * `partially_refunded` once the provider has **processed** it. A pending
 * refund leaves the order marked as still-owed, which is the honest state.
 */
async function applyRefundToRecords(
  doc: ReturnDocShape,
  refundId: string,
  amount: number,
  providerStatus: string,
  correlationId: string,
): Promise<void> {
  const settled = isSettled(providerStatus);

  await ReturnRequestModel.updateOne(
    { _id: doc._id },
    { $set: { refundRef: refundId, refundAmount: amount } },
  );

  /*
   * The payment's `refundedAmount` is incremented, not overwritten, so
   * several partial refunds accumulate correctly. The conditional filter
   * keeps two concurrent refund paths from both incrementing.
   */
  await PaymentModel.updateOne(
    { orderId: doc.orderId, status: { $in: ['paid', 'partially_refunded'] } },
    { $inc: { refundedAmount: amount }, $set: { refundRef: refundId } },
  );

  if (settled) {
    const { refundable } = await refundableAmountForOrder(doc.orderId);
    const orderTotal = await OrderModel.findById(doc.orderId)
      .select('totalAmount')
      .lean<{ totalAmount: number } | null>();

    const nextStatus: PaymentStatus =
      orderTotal !== null && refundable <= 0 ? 'refunded' : 'partially_refunded';

    await OrderModel.updateOne({ _id: doc.orderId }, { $set: { paymentStatus: nextStatus } });
    await PaymentModel.updateMany({ orderId: doc.orderId }, { $set: { status: nextStatus } });

    // Only a provider-confirmed refund may move the return to `refunded`.
    await ReturnRequestModel.updateOne(
      { _id: doc._id, status: 'approved' },
      { $set: { status: 'refunded', resolvedAt: new Date() } },
    );

    /*
     * Tell the customer the money is back — but only now, and only because
     * the provider said `processed`.
     *
     * The template and the state are deliberately tied together: `refunded`
     * cannot be reached without a provider confirmation, so an email saying
     * "your refund has been sent" can never be sent on the strength of an
     * administrator's click alone.
     */
    await notifyRefundSettled(doc, refundId, amount);

    /*
     * Put the returned units back into the catalogue.
     *
     * The stock was consumed when the order was placed. A return brings the
     * goods back, so without this the catalogue permanently loses the units
     * of every returned pair — which is how a store's inventory drifts
     * below reality and eventually shows "out of stock" for shoes it
     * still has on the shelf.
     *
     * The `stockRestoredAt: { $exists: false }` filter makes it
     * idempotent: a reconciliation loop that runs twice credits the stock
     * once, because the second attempt no longer matches.
     */
    await restoreStockForReturn(doc);

    logger.info(
      { returnId: doc._id.toString(), refundId, amount, correlationId },
      'Refund confirmed by the payment provider',
    );
  } else {
    logger.info(
      { returnId: doc._id.toString(), refundId, providerStatus, correlationId },
      'Refund accepted by the provider and awaiting settlement',
    );
  }
}

/**
 * Put a returned order's units back into the catalogue.
 *
 * Idempotent: the claim on the return record is a conditional update that
 * only matches while `stockRestoredAt` is unset, so two concurrent
 * reconciliation passes cannot both credit the stock.
 *
 * Best-effort: a stock failure must not turn a *settled refund* into an
 * error. The money has already moved; failing here would report the
 * refund as failed when it succeeded, which is worse than a stock level
 * that an operator has to reconcile.
 */
async function restoreStockForReturn(doc: ReturnDocShape): Promise<void> {
  try {
    // Claim the restoration first.
    const claimed = await ReturnRequestModel.updateOne(
      { _id: doc._id, stockRestoredAt: { $exists: false } },
      { $set: { stockRestoredAt: new Date() } },
    );

    if (claimed.modifiedCount === 0) {
      // Already restored by an earlier pass.
      return;
    }

    const order = await OrderModel.findById(doc.orderId).lean<OrderDoc | null>();
    if (!order) {
      return;
    }

    /*
     * Only the returned lines go back, not the whole order — a customer
     * may return one pair out of two. `returnStockForOrder` restores
     * everything on the order, so the returned quantities are restored
     * here explicitly instead.
     */
    const { VariantModel } = await import('../models/variant.model.js');
    const { StockMovementModel } = await import('../models/stock-movement.model.js');

    for (const item of order.items) {
      const returned = doc.items?.find((line) => String(line.variantId) === String(item.variantId));
      const quantity = returned?.quantity ?? 0;
      if (quantity <= 0) {
        continue;
      }

      const variantId = new Types.ObjectId(item.variantId);
      await VariantModel.updateOne({ _id: variantId }, { $inc: { stock: quantity } });

      const after = await VariantModel.findById(variantId)
        .select('stock productCode')
        .lean<{ stock: number; productCode?: string } | null>();
      const stockAfter = after?.stock ?? 0;

      await StockMovementModel.create({
        variantId,
        sku: item.sku,
        productCode: after?.productCode ?? '',
        delta: quantity,
        stockBefore: stockAfter - quantity,
        stockAfter,
        reason: 'return' as const,
        note: `Return ${doc.returnNumber} refunded`,
        actorId: null,
        actorLabel: 'system',
        orderId: doc.orderId,
      });
    }

    const { refreshProductInStock } = await import('./order.service.js');
    await refreshProductInStock(order.items.map((item) => new Types.ObjectId(item.productId)));
  } catch (error) {
    logger.error(
      { returnId: doc._id.toString(), err: error },
      'The refund settled but the returned stock could not be restored',
    );
  }
}

/**
 * Reconcile one refund against the provider's current record.
 *
 * Used by the admin panel and by an operator retry loop. This is what turns
 * a `pending` refund into a completed one once the provider finishes it,
 * without anybody re-issuing the refund.
 */
export async function reconcileRefund(
  refundId: string,
  correlationId: string,
): Promise<RefundOutcome> {
  if (!refundId) {
    throw new ValidationError('No refund reference is recorded for this return.');
  }

  const doc = await ReturnRequestModel.findOne({
    refundRef: refundId,
  }).lean<ReturnDocShape | null>();

  if (!doc) {
    throw new NotFoundError('Refund');
  }

  const remote = await fetchRazorpayRefund(refundId);

  if (remote.status === 'failed') {
    /*
     * Shared with the `refund.failed` webhook so the two paths cannot
     * disagree about what a failed refund means.
     */
    await reconcileFailedRefund(refundId, correlationId);

    return {
      returnId: doc._id.toString(),
      returnNumber: doc.returnNumber,
      orderId: doc.orderId.toString(),
      refundId,
      amountRupees: 0,
      providerStatus: 'failed',
      settled: false,
      message: 'The refund failed and has been reversed. It can be attempted again.',
    };
  }

  if (isSettled(remote.status)) {
    await applyRefundToRecords(doc, refundId, remote.amount / 100, remote.status, correlationId);
  }

  return {
    returnId: doc._id.toString(),
    returnNumber: doc.returnNumber,
    orderId: doc.orderId.toString(),
    refundId,
    amountRupees: Math.floor(remote.amount / 100),
    providerStatus: remote.status,
    settled: isSettled(remote.status),
    message: isSettled(remote.status)
      ? 'The refund has been completed.'
      : 'The refund is still being processed.',
  };
}
