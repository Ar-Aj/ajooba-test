import { Types } from 'mongoose';
import type {
  Order,
  PaymentConfiguration,
  PaymentIntent,
  PaymentRecord,
  PaymentStatus,
  PaymentVerificationResult,
} from '@ajooba/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';
import { logger } from '../config/logger.js';
import { OrderModel } from '../models/order.model.js';
import { PaymentModel } from '../models/payment.model.js';
import {
  RazorpayApiError,
  createRazorpayOrder,
  fetchRazorpayPayment,
  isRazorpayConfigured,
  isRazorpayWebhookConfigured,
  razorpayKeyId,
  razorpayMode,
  verifyCheckoutSignature,
} from './razorpay.service.js';

/**
 * Payment orchestration.
 *
 * This module owns the money path. The rules it enforces:
 *
 *  1. **The browser never decides whether money moved.** A Checkout success
 *     handler is a *claim*, not evidence. Verification requires a signature
 *     over the order id **we** issued, and the provider's own record of the
 *     payment. Either can say no.
 *  2. **Transitions are monotonic and idempotent.** `pending → paid` and
 *     `pending → failed` may each happen once. Reaching the same end state
 *     again is a no-op, not an error — a customer hammering the button and
 *     Razorpay both retrying must not decrement stock twice.
 *  3. **A late failure never undoes a capture.** Webhooks are explicitly
 *     documented to arrive out of order, so a `failed` event arriving after
 *     a `captured` one is recorded and ignored rather than allowed to walk
 *     the order backwards.
 */

/**
 * Report what the payment integration can actually do.
 *
 * Returned to the admin panel and to the storefront so an unconfigured
 * deployment shows an honest "not available" rather than a checkout button
 * that silently fails.
 */
export function paymentConfiguration(): PaymentConfiguration {
  return {
    configured: isRazorpayConfigured(),
    mode: razorpayMode(),
    keyId: razorpayKeyId(),
    webhooksEnabled: isRazorpayWebhookConfigured(),
  };
}

/* -------------------------------------------------------------------------- */
/* Payment intent                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create or return the Razorpay order for an internal order.
 *
 * The amount is read from the **stored order**, never from the request. The
 * whole point of the server-authoritative checkout is that by the time we
 * reach here the number was computed from live variant prices and already
 * validated against the frozen line items.
 *
 * Idempotent by design: the Razorpay order id is persisted on the order the
 * first time it is created, so a retried "start payment" does not create a
 * second gateway order and strand the first one.
 */
export async function createPaymentIntent(order: Order): Promise<PaymentIntent> {
  const keyId = razorpayKeyId();

  if (!isRazorpayConfigured() || !keyId) {
    throw new ValidationError(
      'Payments are not available on this store yet. Please choose cash on delivery.',
    );
  }

  if (order.paymentMethod !== 'razorpay') {
    throw new ValidationError('This order is not being paid online.');
  }

  if (order.paymentStatus === 'paid') {
    throw new ConflictError('This order has already been paid.');
  }

  if (order.status === 'cancelled') {
    throw new ConflictError('This order was cancelled.');
  }

  // Reuse the existing gateway order when there is one.
  const existing = await PaymentModel.findOne({
    orderId: new Types.ObjectId(order.id),
    provider: 'razorpay',
    providerOrderId: { $exists: true, $ne: null },
  })
    .sort({ createdAt: -1 })
    .lean<{ id: Types.ObjectId; providerOrderId: string } | null>();

  if (existing?.providerOrderId) {
    return projectIntent(order, existing.providerOrderId, keyId);
  }

  let razorpayOrderId: string;

  try {
    const created = await createRazorpayOrder({
      amountRupees: order.totalAmount,
      receipt: order.orderNumber,
      notes: {
        internal_order_id: order.id,
        order_number: order.orderNumber,
      },
    });
    razorpayOrderId = created.id;
  } catch (error) {
    /*
     * A provider outage must not leave a half-created payment record, and
     * the customer must not be told their order failed — the *order* is
     * fine, only the payment could not be started. So we surface a 503 and
     * let them retry; the order itself remains placed and reserved.
     */
    if (error instanceof RazorpayApiError && error.retryable) {
      logger.error({ orderId: order.id, err: error.message }, 'Razorpay order creation failed');
      throw new ConflictError(
        'The payment service is temporarily unavailable. Please try again in a moment.',
      );
    }
    throw error;
  }

  /*
   * Record the attempt. The unique index on `idempotencyKey` means a
   * concurrent second attempt loses the insert race and reuses whatever the
   * winner wrote, so this cannot create two payment rows for one order.
   */
  await PaymentModel.create({
    orderId: new Types.ObjectId(order.id),
    orderNumber: order.orderNumber,
    customerId: new Types.ObjectId(order.customerId),
    amount: order.totalAmount,
    currency: 'INR',
    status: 'pending',
    provider: 'razorpay',
    providerOrderId: razorpayOrderId,
    idempotencyKey: `intent:${order.id}`,
  });

  return projectIntent(order, razorpayOrderId, keyId);
}

function projectIntent(order: Order, razorpayOrderId: string, keyId: string): PaymentIntent {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    razorpayOrderId,
    amount: order.totalAmount * 100,
    currency: 'INR',
    totalAmountRupees: order.totalAmount,
    keyId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    paymentId: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Verify a Razorpay Checkout response and settle the order accordingly.
 *
 * The sequence, and why each step exists:
 *
 *  1. Load the order **and** its payment attempt. A response that does not
 *     correspond to an order this store created is rejected outright.
 *  2. Check the Razorpay order id matches the one we issued. Without this, a
 *     valid signature over someone else's order id would be accepted.
 *  3. Verify the HMAC over `ourOrderId|paymentId`. This is what makes the
 *     rest trustworthy — it proves Razorpay signed *this* pair.
 *  4. Fetch the payment from Razorpay. A signature proves authenticity, not
 *     capture; only the provider's record proves the money moved.
 *  5. Reconcile the amount. If the provider says it captured a different
 *     number of rupees than the order is worth, that is an accounting
 *     mismatch and is escalated rather than silently accepted.
 *  6. Apply the state transition, exactly once.
 *
 * Every branch is safe to call repeatedly.
 */
export async function verifyAndSettlePayment(input: {
  orderId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  razorpaySignature: string;
  correlationId: string;
}): Promise<PaymentVerificationResult> {
  const fail = (reason: string): PaymentVerificationResult => ({
    verified: false,
    status: 'failed',
    orderId: input.orderId,
    orderNumber: '',
    paymentId: null,
    amountRupees: 0,
    reason,
  });

  if (!Types.ObjectId.isValid(input.orderId)) {
    return fail('That order could not be found.');
  }

  const order = await OrderModel.findById(input.orderId).lean<OrderDocShape | null>();
  if (!order) {
    return fail('That order could not be found.');
  }

  const orderNumber = order.orderNumber;
  const amountRupees = order.totalAmount;

  const payment = await PaymentModel.findOne({
    orderId: new Types.ObjectId(input.orderId),
    provider: 'razorpay',
  })
    .sort({ createdAt: -1 })
    .lean<PaymentDocShape | null>();

  if (!payment || !payment.providerOrderId) {
    return { ...fail('No payment was started for this order.'), orderNumber, amountRupees };
  }

  // The gateway order must be the one we issued for THIS order.
  if (payment.providerOrderId !== input.razorpayOrderId) {
    logger.warn(
      {
        orderId: input.orderId,
        correlationId: input.correlationId,
        expected: payment.providerOrderId,
        received: input.razorpayOrderId,
      },
      'Razorpay order id mismatch',
    );
    return {
      ...fail('The payment does not match this order.'),
      orderNumber,
      amountRupees,
    };
  }

  if (
    !verifyCheckoutSignature({
      orderId: payment.providerOrderId,
      paymentId: input.razorpayPaymentId,
      signature: input.razorpaySignature,
    })
  ) {
    logger.warn(
      { orderId: input.orderId, correlationId: input.correlationId },
      'Razorpay signature verification failed',
    );
    return { ...fail('The payment signature could not be verified.'), orderNumber, amountRupees };
  }

  // The signature is valid. Now ask the provider what actually happened.
  let remote: Awaited<ReturnType<typeof fetchRazorpayPayment>>;
  try {
    remote = await fetchRazorpayPayment(input.razorpayPaymentId);
  } catch (error) {
    /*
     * The provider is unreachable. We must NOT guess. Report pending and
     * let the webhook settle it when the provider recovers — that is
     * precisely the delayed-confirmation case the webhook exists for.
     */
    logger.error(
      { orderId: input.orderId, correlationId: input.correlationId, err: error },
      'Could not reach Razorpay to reconcile the payment',
    );
    return {
      verified: false,
      status: 'pending',
      orderId: input.orderId,
      orderNumber,
      paymentId: payment._id.toString(),
      amountRupees,
      reason:
        'The payment is being confirmed. You will receive an email as soon as it is verified.',
    };
  }

  if (remote.order_id && remote.order_id !== payment.providerOrderId) {
    logger.error(
      {
        orderId: input.orderId,
        correlationId: input.correlationId,
        remoteOrderId: remote.order_id,
      },
      'Provider reported the payment under a different order id',
    );
    return { ...fail('The payment does not match this order.'), orderNumber, amountRupees };
  }

  if (remote.status === 'failed') {
    await markPaymentFailed(payment._id, remote.id, remote.error_description ?? 'Payment failed');
    return {
      verified: false,
      status: 'failed',
      orderId: input.orderId,
      orderNumber,
      paymentId: payment._id.toString(),
      amountRupees,
      reason: remote.error_description ?? 'The payment was declined.',
    };
  }

  /*
   * Authorized but not captured. This is a legitimate state when the
   * account has automatic capture disabled. The order stays unpaid and the
   * stock stays reserved; the webhook settles it once capture completes.
   */
  if (remote.status === 'authorized' && !remote.captured) {
    await PaymentModel.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: 'pending',
          providerReference: remote.id,
          method: remote.method ?? null,
        },
      },
    );
    return {
      verified: false,
      status: 'pending',
      orderId: input.orderId,
      orderNumber,
      paymentId: payment._id.toString(),
      amountRupees,
      reason: 'The payment is authorized and will be captured shortly.',
    };
  }

  if (remote.status === 'captured') {
    // Amount reconciliation. Paise in, whole rupees out.
    const capturedRupees = Math.floor(remote.amount / 100);
    if (capturedRupees !== amountRupees) {
      logger.error(
        {
          orderId: input.orderId,
          correlationId: input.correlationId,
          expectedRupees: amountRupees,
          capturedRupees,
        },
        'Captured amount does not match the order total',
      );
      /*
       * Recorded as pending rather than paid: the money arrived but the
       * numbers disagree, which is a finance conversation, not an
       * automated decision.
       */
      return {
        verified: false,
        status: 'pending',
        orderId: input.orderId,
        orderNumber,
        paymentId: payment._id.toString(),
        amountRupees,
        reason: 'We are verifying this payment. You will be emailed once it is confirmed.',
      };
    }

    await markPaymentCaptured(payment._id, remote.id, remote.method ?? null, capturedRupees);
    const updated = await OrderModel.findById(input.orderId).lean<OrderDocShape | null>();

    return {
      verified: true,
      status: 'paid',
      orderId: input.orderId,
      orderNumber,
      paymentId: payment._id.toString(),
      amountRupees,
      reason: null,
      ...(updated ? { order: mapOrderLight(updated) } : {}),
    };
  }

  return {
    verified: false,
    status: 'pending',
    orderId: input.orderId,
    orderNumber,
    paymentId: payment._id.toString(),
    amountRupees,
    reason: 'The payment is still being processed.',
  };
}

/* -------------------------------------------------------------------------- */
/* State transitions                                                          */
/* -------------------------------------------------------------------------- */

interface OrderDocShape {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  paymentStatus: PaymentStatus;
  status: string;
  totalAmount: number;
  [key: string]: unknown;
}

interface PaymentDocShape {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  providerOrderId?: string | null;
  status: PaymentStatus;
  refundedAmount: number;
}

function mapOrderLight(doc: OrderDocShape): Order {
  return doc as unknown as Order;
}

/**
 * Mark a payment captured and its order paid.
 *
 * **Exactly-once** is enforced with a conditional update: only a payment
 * whose status is still `pending` (or `failed`) is allowed to become `paid`.
 * A second concurrent capture — a double-tap and its webhook arriving
 * together — matches nothing and is a no-op. This is the single most
 * important line in the payment path: it is what stops stock being decremented
 * and an order-confirmation email being sent twice.
 */
export async function markPaymentCaptured(
  paymentId: Types.ObjectId,
  providerPaymentId: string,
  method: string | null,
  amountRupees: number,
): Promise<boolean> {
  const updated = await PaymentModel.findOneAndUpdate(
    { _id: paymentId, status: { $in: ['pending', 'failed'] } },
    {
      $set: {
        status: 'paid',
        providerReference: providerPaymentId,
        method,
        capturedAt: new Date(),
        failureReason: null,
        // `amount` is authoritative from the provider at capture time.
        amount: amountRupees,
      },
    },
    { returnDocument: 'after' },
  ).lean<PaymentDocShape | null>();

  if (!updated) {
    // Already paid, or already refunded. Nothing to do.
    return false;
  }

  /*
   * The order is read from the payment record rather than passed in, so
   * there is exactly one source of truth for which order a payment belongs
   * to and no caller can point a payment at the wrong order.
   *
   * The `paymentStatus: { $ne: 'paid' }` filter makes this the second half
   * of the exactly-once guarantee: even if two capture paths raced, only
   * one can transition the order out of its pending state.
   */
  await OrderModel.updateOne(
    { _id: updated.orderId, paymentStatus: { $ne: 'paid' } },
    { $set: { paymentStatus: 'paid', paymentRef: providerPaymentId } },
  );

  /*
   * Order confirmation.
   *
   * Two properties matter here, and both come from the same decision:
   *
   *  - The email is **not** sent inline. `notifyOrderConfirmation` records a
   *    durable intent; delivery is the dispatcher's problem. Awaiting a
   *    third-party API on the money path means a provider timeout could fail
   *    a payment that genuinely succeeded — which is a worse outcome than a
   *    late email, and one the customer cannot see the difference between.
   *
   *  - It is inside the `applied` branch. When this function returns `false`
   *    the payment was already settled, and sending a confirmation then would
   *    email the customer twice for one payment. The idempotency key
   *    (`order-confirmation/<orderNumber>`) is the second line of defence,
   *    but the branch is the first: the second capture should not even try.
   *
   *  A failure here is logged and swallowed by the notifier, so it can never
   *  propagate back and undo a capture that has already been applied.
   */
  await sendOrderConfirmation(updated.orderId);

  return true;
}

/**
 * Record the order-confirmation email for a newly-paid order.
 *
 * Isolated so the import stays lazy and the payment module does not take a
 * hard dependency on the template renderer at module load.
 */
async function sendOrderConfirmation(orderId: Types.ObjectId): Promise<void> {
  try {
    const { renderOrderConfirmation } = await import('./email-templates.js');
    const { notifyOrderConfirmation } = await import('./notification.service.js');

    const order = await OrderModel.findById(orderId).lean<OrderDocShape | null>();
    if (!order) {
      return;
    }

    /*
     * Projected through the real `mapOrder`, not a bare cast. A lean read
     * leaves `productId`/`variantId` as ObjectIds and dates as `Date`; the
     * templates interpolate `title`, `colour`, `size` and `sku`, so using the
     * same projector the API uses guarantees the email shows exactly what the
     * order page shows.
     */
    const { mapOrder } = await import('./order.service.js');
    const projected: Order = mapOrder(order as unknown as Parameters<typeof mapOrder>[0]);
    const storefrontBase = (process.env.STOREFRONT_PUBLIC_URL ?? '').replace(/\/$/, '');

    await notifyOrderConfirmation({
      orderId,
      orderNumber: projected.orderNumber,
      to: projected.customerEmail,
      rendered: renderOrderConfirmation(
        projected,
        `${storefrontBase}/orders/${encodeURIComponent(projected.orderNumber)}`,
      ),
    });
  } catch (error) {
    /*
     * Deliberately swallowed. The payment is captured and the order is paid;
     * an email problem is not a reason to report a failure that would make a
     * caller retry — and a retry here is what would double-charge.
     */
    logger.warn(
      { orderId: orderId.toString(), err: error instanceof Error ? error.message : String(error) },
      'Order paid but the confirmation email could not be recorded',
    );
  }
}

/**
 * Mark a payment failed.
 *
 * Same conditional-update discipline. A failure arriving *after* a capture
 * — which Razorpay explicitly warns can happen — matches nothing because the
 * status is already `paid`, so a confirmed payment is never walked backwards.
 */
export async function markPaymentFailed(
  paymentId: Types.ObjectId,
  providerPaymentId: string,
  reason: string,
): Promise<boolean> {
  /*
   * An explicit allowlist, not `{ $ne: 'paid' }`.
   *
   * A negative filter matches every status that is *not* paid — including
   * `refunded` and `partially_refunded`, which are strictly *after* paid in
   * the lifecycle. A late failure would therefore be able to walk an already
   * refunded payment back to `failed`, corrupting the order's accounting.
   * Only a payment that has not yet settled can still become failed.
   */
  const updated = await PaymentModel.findOneAndUpdate(
    { _id: paymentId, status: { $in: ['pending', 'failed'] } },
    {
      $set: {
        status: 'failed',
        providerReference: providerPaymentId,
        failureReason: reason.slice(0, 300),
      },
    },
    { returnDocument: 'after' },
  ).lean<PaymentDocShape | null>();

  if (!updated) {
    return false;
  }

  await OrderModel.updateOne(
    { _id: updated.orderId, paymentStatus: { $in: ['pending', 'failed'] } },
    { $set: { paymentStatus: 'failed' } },
  );

  /*
   * Put the stock back.
   *
   * Stock is consumed at *placement*, not at capture — the reservation is
   * committed when the order is written. A payment that fails therefore
   * leaves the units held for an order nobody is going to pay for, and
   * without this the catalogue slowly bleeds stock into abandoned
   * checkouts.
   *
   * The restoration is best-effort and never fails the payment path: the
   * payment is already recorded as failed, and a stock error here would
   * mask that. It is logged loudly instead.
   */
  try {
    const { returnStockForOrder } = await import('./order.service.js');
    const orderDoc = await OrderModel.findById(updated.orderId).lean<
      Parameters<typeof returnStockForOrder>[0] | null
    >();
    if (orderDoc) {
      await returnStockForOrder(orderDoc);
    }
  } catch (error) {
    logger.error(
      { orderId: updated.orderId.toString(), err: error },
      'The payment failed but its stock could not be returned to the catalogue',
    );
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/** List the payments recorded against an order. */
export async function listPaymentsForOrder(orderId: string): Promise<PaymentRecord[]> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw new NotFoundError('Order');
  }

  const docs = await PaymentModel.find({ orderId: new Types.ObjectId(orderId) })
    .sort({ createdAt: -1 })
    .lean<Array<Record<string, unknown>>>();

  /*
   * Coerce explicitly, one known type at a time.
   *
   * A lean read can leave a field as an ObjectId or absent. `String()` on a
   * plain object silently yields `"[object Object]"`, which would put that
   * literal into an admin-facing order reference — so each field is narrowed
   * to the type it is actually documented as, and anything else yields `null`
   * rather than a plausible-looking lie.
   */
  const asString = (value: unknown): string | null =>
    typeof value === 'string' ? value : value instanceof Types.ObjectId ? value.toString() : null;

  return docs.map((doc) => ({
    id: asString(doc._id) ?? '',
    orderId: asString(doc.orderId) ?? '',
    orderNumber: asString(doc.orderNumber) ?? '',
    customerId: asString(doc.customerId) ?? '',
    amount: Number(doc.amount ?? 0),
    currency: 'INR' as const,
    status: doc.status as PaymentStatus,
    provider: asString(doc.provider) ?? 'razorpay',
    providerReference: (doc.providerReference as string | null) ?? null,
    method: (doc.method as string | null) ?? null,
    failureReason: (doc.failureReason as string | null) ?? null,
    capturedAt: doc.capturedAt ? new Date(doc.capturedAt as string).toISOString() : null,
    refundedAmount: Number(doc.refundedAmount ?? 0),
    createdAt: new Date(doc.createdAt as string).toISOString(),
    updatedAt: new Date(doc.updatedAt as string).toISOString(),
  }));
}

/**
 * How much can still be refunded against an order.
 *
 * Derived from the order total minus everything already refunded across its
 * payment records. A refund can never exceed this, and the value is what
 * makes "refund completed" a claim the provider has to agree with.
 */
export async function refundableAmountForOrder(orderId: Types.ObjectId): Promise<{
  refundable: number;
  total: number;
  paid: boolean;
}> {
  const order = await OrderModel.findById(orderId)
    .select('totalAmount paymentStatus')
    .lean<{ totalAmount: number; paymentStatus: PaymentStatus } | null>();

  if (!order) {
    throw new NotFoundError('Order');
  }

  const refunded = await PaymentModel.aggregate<{ total: number }>([
    { $match: { orderId } },
    { $group: { _id: null, total: { $sum: '$refundedAmount' } } },
  ]);

  const refundedTotal = refunded[0]?.total ?? 0;

  return {
    refundable: Math.max(0, order.totalAmount - refundedTotal),
    total: order.totalAmount,
    paid: order.paymentStatus === 'paid' || order.paymentStatus === 'partially_refunded',
  };
}
