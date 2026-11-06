import { Types } from 'mongoose';
import type { OrderItem, ReturnReason, ReturnRequest, ReturnStatus } from '@ajooba/contracts';
import { ConflictError, NotFoundError } from '../core/errors.js';
import { OrderModel } from '../models/order.model.js';
import { ReturnRequestModel } from '../models/return-request.model.js';
import { buildReturnNumber } from './password.service.js';
import { recordActivityEvent } from './analytics.service.js';
import { logger } from '../config/logger.js';

/**
 * Returns.
 *
 * A return is only accepted against an order the customer actually owns,
 * only for lines that were actually bought, and only for a quantity that
 * does not exceed what was bought.
 *
 * The refund amount is computed from the order's **frozen** line items, so
 * a later price change cannot alter what a customer is owed.
 */

/** The legal transitions of a return request. */
export const RETURN_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> =
  Object.freeze({
    requested: ['approved', 'rejected'],
    approved: ['refunded'],
    rejected: [],
    refunded: [],
  });

interface ReturnDoc {
  _id: Types.ObjectId;
  returnNumber: string;
  orderId: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  items: OrderItem[];
  reason: ReturnReason;
  reasonNote: string;
  status: ReturnStatus;
  refundAmount: number;
  refundRef?: string;
  resolutionNote?: string;
  requestedAt: Date;
  resolvedAt?: Date;
}

/**
 * Project a return document.
 */
export function mapReturn(doc: ReturnDoc): ReturnRequest {
  return {
    id: doc._id.toString(),
    returnNumber: doc.returnNumber,
    orderId: doc.orderId.toString(),
    orderNumber: doc.orderNumber,
    customerId: doc.customerId.toString(),
    items: doc.items,
    reason: doc.reason,
    reasonNote: doc.reasonNote,
    status: doc.status,
    refundAmount: doc.refundAmount,
    refundRef: doc.refundRef ?? null,
    requestedAt: doc.requestedAt.toISOString(),
    resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
  };
}

export interface CreateReturnInput {
  readonly customerId: string;
  readonly orderId: string;
  readonly items: ReadonlyArray<{ variantId: string; quantity: number }>;
  readonly reason: ReturnReason;
  readonly reasonNote: string;
}

/**
 * Raise a return request.
 */
export async function createReturnRequest(input: CreateReturnInput): Promise<ReturnRequest> {
  if (!Types.ObjectId.isValid(input.orderId)) {
    throw new NotFoundError('Order');
  }

  /*
   * Ownership: the order must belong to the customer raising the return.
   * A 404 (not a 403) is returned so the endpoint cannot be used to
   * discover which order ids exist.
   */
  const order = await OrderModel.findOne({
    _id: new Types.ObjectId(input.orderId),
    customerId: new Types.ObjectId(input.customerId),
  }).lean<{
    _id: Types.ObjectId;
    orderNumber: string;
    customerId: Types.ObjectId;
    items: OrderItem[];
    status: string;
    placedAt: Date;
  } | null>();

  if (!order) {
    throw new NotFoundError('Order');
  }

  if (order.status === 'cancelled') {
    throw new ConflictError('A cancelled order cannot be returned.');
  }

  // Lines the customer has already returned cannot be returned again.
  const existing = await ReturnRequestModel.find({
    orderId: order._id,
    status: { $in: ['requested', 'approved', 'refunded'] },
  }).lean<Array<{ items: OrderItem[] }>>();

  /*
   * Normalise the identifiers to strings before comparing them.
   *
   * The schema declares `variantId` as an ObjectId, so a lean read returns
   * an ObjectId, while the request body supplies a hex string. Comparing the
   * two directly (`item.variantId === line.variantId`) is always false, which
   * made *every* return request fail with "One of the items was not part of
   * that order". Comparing the string forms fixes it and keeps the comparison
   * honest regardless of how the document was loaded.
   */
  const alreadyReturned = new Map<string, number>();
  for (const request of existing) {
    for (const item of request.items) {
      const key = String(item.variantId);
      alreadyReturned.set(key, (alreadyReturned.get(key) ?? 0) + item.quantity);
    }
  }

  const items: OrderItem[] = [];

  for (const line of input.items) {
    const lineVariantId = String(line.variantId);

    const ordered = order.items.find((item) => String(item.variantId) === lineVariantId);
    if (!ordered) {
      throw new ConflictError('One of the items was not part of that order.');
    }

    const remaining = ordered.quantity - (alreadyReturned.get(lineVariantId) ?? 0);
    if (line.quantity > remaining) {
      throw new ConflictError(
        remaining === 0
          ? `"${ordered.sku}" has already been returned.`
          : `Only ${remaining} unit(s) of "${ordered.sku}" can still be returned.`,
      );
    }

    items.push({
      ...ordered,
      variantId: lineVariantId,
      productId: String(ordered.productId),
      quantity: line.quantity,
      lineTotal: ordered.unitPrice * line.quantity,
    });
  }

  const refundAmount = items.reduce((total, item) => total + item.lineTotal, 0);

  const created = await ReturnRequestModel.create({
    returnNumber: buildReturnNumber(),
    orderId: order._id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    items,
    reason: input.reason,
    reasonNote: input.reasonNote,
    status: 'requested',
    refundAmount,
    requestedAt: new Date(),
  });

  await recordActivityEvent({
    event: 'return_requested',
    sessionId: `return:${created.returnNumber}`,
    customerId: input.customerId,
    orderId: order._id.toString(),
    value: refundAmount,
  });

  await notifyReturn(created as unknown as ReturnDoc, 'requested');

  return mapReturn(created as unknown as ReturnDoc);
}

/**
 * Record the customer-facing email for a return event.
 *
 * `requested` is acknowledged (the customer knows it arrived), `approved` and
 * `rejected` are the decisions. `refunded` is deliberately absent: a refund is
 * confirmed by the provider in `refund.service.ts`, and an email claiming
 * money was returned before Razorpay agrees would be a false statement.
 *
 * Best-effort by design. A return must still be recorded if email fails.
 */
async function notifyReturn(
  doc: ReturnDoc,
  event: 'requested' | 'approved' | 'rejected',
): Promise<void> {
  try {
    const templates = await import('./email-templates.js');
    const { notifyReturnEvent } = await import('./notification.service.js');

    const projected = mapReturn(doc);

    // The recipient is the customer who owns the order, resolved from the
    // order rather than trusted from the return document.
    const order = await OrderModel.findById(doc.orderId)
      .select('customerEmail')
      .lean<{ customerEmail: string } | null>();
    if (!order?.customerEmail) {
      return;
    }

    const template =
      event === 'requested'
        ? ('return-acknowledged' as const)
        : event === 'approved'
          ? ('return-approved' as const)
          : ('return-rejected' as const);

    const rendered =
      event === 'requested'
        ? templates.renderReturnAcknowledged(projected)
        : event === 'approved'
          ? templates.renderReturnApproved(projected)
          : templates.renderReturnRejected(projected, doc.resolutionNote);

    await notifyReturnEvent({
      template,
      returnId: doc._id,
      orderId: doc.orderId,
      orderNumber: projected.orderNumber,
      returnNumber: projected.returnNumber,
      to: order.customerEmail,
      rendered,
    });
  } catch (error) {
    logger.warn(
      {
        returnId: doc._id.toString(),
        event,
        err: error instanceof Error ? error.message : String(error),
      },
      'Return updated but the customer notification could not be recorded',
    );
  }
}

/**
 * Resolve a return request.
 *
 * `refunded` is **not** an accepted input. Moving a return to `refunded` is
 * a claim that money has gone back to the customer, and the only thing that
 * can establish that is a confirmed provider refund — see
 * `refund.service.ts`. This function therefore handles exactly two
 * decisions: approve, or reject.
 */
export async function resolveReturnRequest(
  returnId: string,
  status: Extract<ReturnStatus, 'approved' | 'rejected'>,
  options: { refundAmount?: number; note?: string },
): Promise<ReturnRequest> {
  if (!Types.ObjectId.isValid(returnId)) {
    throw new NotFoundError('Return request');
  }

  const doc = await ReturnRequestModel.findById(returnId).lean<ReturnDoc | null>();
  if (!doc) {
    throw new NotFoundError('Return request');
  }

  if (doc.status === status) {
    // Idempotent — a retried request must not fail.
    return mapReturn(doc);
  }

  if (!RETURN_TRANSITIONS[doc.status].includes(status)) {
    throw new ConflictError(`A return in "${doc.status}" cannot move to "${status}".`);
  }

  const update: Record<string, unknown> = { status, resolvedAt: new Date() };

  if (options.note) {
    update.resolutionNote = options.note;
  }

  /*
   * An administrator may set the amount that will be refunded, but the
   * refund itself is issued by `refund.service.ts` against the provider.
   * Recording the agreed amount here is a decision; moving money is not.
   */
  if (options.refundAmount !== undefined) {
    update.refundAmount = options.refundAmount;
  }

  const updated = await ReturnRequestModel.findByIdAndUpdate(
    returnId,
    { $set: update },
    {
      returnDocument: 'after',
    },
  ).lean<ReturnDoc | null>();

  if (!updated) {
    throw new NotFoundError('Return request');
  }

  await notifyReturn(updated, status);

  return mapReturn(updated);
}

/**
 * Fetch a return that belongs to a customer.
 */
export async function getReturnForCustomer(
  returnId: string,
  customerId: string,
): Promise<ReturnRequest | null> {
  if (!Types.ObjectId.isValid(returnId)) {
    return null;
  }
  const doc = await ReturnRequestModel.findOne({
    _id: new Types.ObjectId(returnId),
    customerId: new Types.ObjectId(customerId),
  }).lean<ReturnDoc | null>();

  return doc ? mapReturn(doc) : null;
}

/**
 * List a customer's returns, newest first.
 */
export async function listCustomerReturns(
  customerId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: ReturnRequest[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const filter = { customerId: new Types.ObjectId(customerId) };

  const [docs, totalItems] = await Promise.all([
    ReturnRequestModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ReturnDoc[]>(),
    ReturnRequestModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(mapReturn),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

/**
 * List every return, for the admin panel.
 */
export async function listAdminReturns(
  filter: { status?: ReturnStatus; orderId?: string },
  page: number,
  pageSize: number,
): Promise<{
  items: ReturnRequest[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.orderId && Types.ObjectId.isValid(filter.orderId)) {
    query.orderId = new Types.ObjectId(filter.orderId);
  }

  const [docs, totalItems] = await Promise.all([
    ReturnRequestModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ReturnDoc[]>(),
    ReturnRequestModel.countDocuments(query),
  ]);

  return {
    items: docs.map(mapReturn),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}
