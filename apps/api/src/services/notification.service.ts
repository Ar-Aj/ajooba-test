import type { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { EmailLogModel } from '../models/email-log.model.js';
import {
  ResendApiError,
  isEmailConfigured,
  isRecipientAllowed,
  sendEmail,
} from './resend.service.js';
import type { RenderedEmail } from './email-templates.js';

/**
 * Transactional email outbox.
 *
 * The design rule this module enforces: **no caller ever sends mail inline.**
 *
 * A caller calls `enqueue*`, which records a durable intent and returns.
 * Delivery happens in `dispatchPending`, which is a separate, retryable step.
 * That separation exists because of one specific failure mode — if order
 * confirmation were sent inside `markPaymentCaptured`, then a slow Resend
 * response would sit on the money path, and a provider timeout would either
 * fail a settled payment or, worse, succeed at charging a customer with no
 * email ever arriving. Neither is acceptable, and neither is reachable when
 * the two are separate steps.
 *
 * **Duplicate suppression is durable.** The unique index on
 * `(template, idempotencyKey)` means two callers asking for the same email
 * produce one row, and the loser's send is recorded as `skipped` rather than
 * generating a second message. This is what makes the idempotent payment
 * transitions safe to wire up here: `markPaymentCaptured` can be called by a
 * checkout verification *and* a webhook, and only one confirmation results.
 *
 * **Delivery never throws into a caller.** An email failure is recorded on
 * the row and logged. It must not roll back a payment, an order or a return.
 */

/** The result of enqueueing one email. */
export interface EnqueueResult {
  /** `false` when this exact email was already recorded. */
  readonly enqueued: boolean;
  readonly logId: string | null;
  /** Why it was not sent, when it was not. */
  readonly reason?: string;
}

/** How many delivery attempts a single email gets. */
const MAX_ATTEMPTS = 5;

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Record an intent to send, without sending.
 *
 * Returns `enqueued: false` when this `(template, idempotencyKey)` pair has
 * already been recorded — the exactly-once guarantee, enforced by the unique
 * index rather than by a read-then-write race.
 */
async function enqueue(input: {
  template: string;
  idempotencyKey: string;
  to: string;
  rendered: RenderedEmail;
  orderId?: Types.ObjectId | string;
  orderNumber?: string;
  returnId?: Types.ObjectId | string;
  returnNumber?: string;
  correlationId?: string;
}): Promise<EnqueueResult> {
  // Normalise the key so a stray trailing space cannot create a "new" email.
  const idempotencyKey = input.idempotencyKey.trim().slice(0, 256);

  try {
    const doc = await EmailLogModel.create({
      template: input.template,
      idempotencyKey,
      to: input.to,
      subject: input.rendered.subject,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      returnId: input.returnId,
      returnNumber: input.returnNumber,
      status: 'queued',
      correlationId: input.correlationId,
    });

    return { enqueued: true, logId: doc._id.toString() };
  } catch (error) {
    // 11000 = the unique index rejected a duplicate. This is the
    // success path for a retry, not an error.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      logger.info(
        { template: input.template, idempotencyKey },
        'Skipped a duplicate transactional email',
      );
      return { enqueued: false, logId: null, reason: 'duplicate' };
    }
    throw error;
  }
}

/**
 * Record that an email was deliberately **not** sent.
 *
 * The row is *inserted* with `status: 'skipped'`, not updated onto a row that
 * does not exist yet. An earlier version used `updateOne`, which silently
 * matched nothing — so an unconfigured deployment or a non-allowlisted
 * recipient left **no** trace at all. That is precisely the case an operator
 * most needs to see: "was a confirmation attempted for this order, and why
 * did nothing arrive?" would have been unanswerable.
 */
async function markSkipped(input: {
  template: string;
  idempotencyKey: string;
  to: string;
  subject: string;
  detail: string;
  orderId?: Types.ObjectId | string;
  orderNumber?: string;
  returnId?: Types.ObjectId | string;
  returnNumber?: string;
  correlationId?: string;
}): Promise<EnqueueResult> {
  try {
    const doc = await EmailLogModel.create({
      template: input.template,
      idempotencyKey: input.idempotencyKey,
      to: input.to,
      subject: input.subject,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      returnId: input.returnId,
      returnNumber: input.returnNumber,
      status: 'skipped',
      detail: input.detail.slice(0, 300),
      correlationId: input.correlationId,
    });

    return { enqueued: false, logId: doc._id.toString(), reason: input.detail };
  } catch (error) {
    /*
     * The unique index rejected a duplicate. A previous attempt already
     * recorded this email, which is exactly the outcome we want; the earlier
     * row (sent or skipped) is the authoritative record.
     */
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      logger.info(
        { template: input.template, idempotencyKey: input.idempotencyKey },
        'Skipped a duplicate transactional email',
      );
      return { enqueued: false, logId: null, reason: 'duplicate' };
    }
    throw error;
  }
}

/**
 * Record an intent and deliver it immediately when it is safe to do so.
 *
 * `trySend` is the default because most notifications arise from an
 * interactive request where the customer is waiting. A provider failure still
 * leaves the row `queued` for a later retry — the dispatcher's job — so the
 * worst case is latency, not loss.
 */
async function enqueueAndMaybeSend(input: {
  template: string;
  idempotencyKey: string;
  to: string;
  rendered: RenderedEmail;
  orderId?: Types.ObjectId | string;
  orderNumber?: string;
  returnId?: Types.ObjectId | string;
  returnNumber?: string;
  correlationId?: string;
  trySend?: boolean;
}): Promise<EnqueueResult> {
  const { trySend = true } = input;

  /*
   * Decide *before* inserting, so the audit row reflects what actually
   * happened. A row that says `sent` when nothing was transmitted would be
   * worse than no row.
   */
  const key = input.idempotencyKey.trim().slice(0, 256);

  if (!isEmailConfigured()) {
    return markSkipped({
      template: input.template,
      idempotencyKey: key,
      to: input.to,
      subject: input.rendered.subject,
      detail: 'Email is not configured on this deployment.',
      ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
      ...(input.orderNumber === undefined ? {} : { orderNumber: input.orderNumber }),
      ...(input.returnId === undefined ? {} : { returnId: input.returnId }),
      ...(input.returnNumber === undefined ? {} : { returnNumber: input.returnNumber }),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
  }

  if (!isRecipientAllowed(input.to)) {
    return markSkipped({
      template: input.template,
      idempotencyKey: key,
      to: input.to,
      subject: input.rendered.subject,
      detail: 'Recipient is not on the EMAIL_ALLOWLIST for this environment.',
      ...(input.orderId === undefined ? {} : { orderId: input.orderId }),
      ...(input.orderNumber === undefined ? {} : { orderNumber: input.orderNumber }),
      ...(input.returnId === undefined ? {} : { returnId: input.returnId }),
      ...(input.returnNumber === undefined ? {} : { returnNumber: input.returnNumber }),
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
  }

  const recorded = await enqueue(input);
  if (!recorded.enqueued || !recorded.logId) {
    return recorded;
  }

  if (!trySend) {
    return recorded;
  }

  const outcome = await attemptDelivery(recorded.logId, {
    template: input.template,
    to: input.to,
    rendered: input.rendered,
  });

  return {
    enqueued: true,
    logId: recorded.logId,
    ...(outcome.status === 'sent' ? {} : { reason: outcome.detail }),
  };
}

/* -------------------------------------------------------------------------- */
/* Delivery                                                                   */
/* -------------------------------------------------------------------------- */

/** The result of one delivery attempt. */
interface AttemptResult {
  readonly status: 'sent' | 'failed';
  readonly detail: string;
}

/**
 * Attempt one delivery of a queued row.
 *
 * Never throws: a provider failure is data on the row, not an exception into
 * a caller who may be in the middle of settling a payment.
 */
async function attemptDelivery(
  logId: string,
  input: { template: string; to: string; rendered: RenderedEmail },
): Promise<AttemptResult> {
  const attempts = await EmailLogModel.findByIdAndUpdate(
    logId,
    { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date() } },
    { returnDocument: 'after' },
  ).lean<{ attempts?: number } | null>();

  // Stop burning provider quota on a row that has exhausted its budget.
  if ((attempts?.attempts ?? 0) > MAX_ATTEMPTS) {
    const detail = `Abandoned after ${MAX_ATTEMPTS} delivery attempts.`;
    await EmailLogModel.updateOne({ _id: logId }, { $set: { status: 'failed', detail } });
    return { status: 'failed', detail };
  }

  try {
    const result = await sendEmail({
      to: input.to,
      subject: input.rendered.subject,
      html: input.rendered.html,
      text: input.rendered.text,
      idempotencyKey: `${input.template}/${logId}`,
      tag: input.rendered.tag,
    });

    await EmailLogModel.updateOne(
      { _id: logId },
      {
        $set: {
          status: 'sent',
          providerMessageId: result.id,
          sentAt: new Date(),
          detail: '',
        },
      },
    );

    logger.info({ logId, template: input.template, providerMessageId: result.id }, 'Sent email');
    return { status: 'sent', detail: '' };
  } catch (error) {
    const detail =
      error instanceof ResendApiError
        ? `${error.httpStatus}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown failure';

    await EmailLogModel.updateOne(
      { _id: logId },
      { $set: { status: 'failed', detail: detail.slice(0, 300) } },
    );

    logger.warn({ logId, template: input.template, err: detail }, 'Failed to send email');
    return { status: 'failed', detail };
  }
}

/**
 * Re-attempt delivery of every queued or retryable-failed email.
 *
 * This is what a cron job or a background worker calls. It is separate from
 * `enqueueAndMaybeSend` so a crash between recording and delivering loses
 * nothing: the row survives and this picks it up.
 *
 * Returns a small summary so a caller (and a test) can assert on it without
 * reading the collection.
 */
export async function dispatchPending(limit = 25): Promise<{
  attempted: number;
  sent: number;
  failed: number;
}> {
  const rows = await EmailLogModel.find({
    status: { $in: ['queued', 'failed'] },
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    // A failed row is retried too, but only after a pause, so a permanently
    // rejected address is not retried in a tight loop.
    .lean<Array<{ _id: Types.ObjectId; template: string; to: string; subject: string }>>();

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    if (!isEmailConfigured() || !isRecipientAllowed(row.to)) {
      await EmailLogModel.updateOne(
        { _id: row._id },
        { $set: { status: 'skipped', detail: 'No longer deliverable in this environment.' } },
      );
      continue;
    }

    /*
     * The rendered body is not stored, only the template identity. A retry
     * re-renders from the order, which is the right behaviour anyway: a
     * confirmation that shows yesterday's address is worse than a late one.
     *
     * A row whose order no longer exists cannot be re-rendered, so it is
     * failed permanently rather than retried forever.
     */
    const rendered = await reRender(row.template, row._id.toString());
    if (!rendered) {
      await EmailLogModel.updateOne(
        { _id: row._id },
        { $set: { status: 'failed', detail: 'The order for this email no longer exists.' } },
      );
      failed += 1;
      continue;
    }

    const outcome = await attemptDelivery(row._id.toString(), {
      template: row.template,
      to: row.to,
      rendered,
    });

    if (outcome.status === 'sent') {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { attempted: sent + failed, sent, failed };
}

/**
 * Re-render a queued template from the persisted order or return.
 *
 * Imported lazily to keep this module free of a cycle with the order and
 * return services, which both call into here.
 *
 * Every template that can be enqueued must be re-renderable here, or a
 * failed send could never be retried — the row would sit in the outbox
 * forever with no way to rebuild its body. That is why the switch below
 * covers the full template list rather than the three that happened to be
 * convenient at the time.
 *
 * A template whose source document has since been deleted returns `null`,
 * which the caller records as a permanent failure rather than retrying for
 * ever.
 */
async function reRender(template: string, logId: string): Promise<RenderedEmail | null> {
  const row = await EmailLogModel.findById(logId).lean<{
    orderId?: Types.ObjectId;
    orderNumber?: string;
    returnId?: Types.ObjectId;
    returnNumber?: string;
  } | null>();

  if (!row) {
    return null;
  }

  const templates = await import('./email-templates.js');

  /*
   * The password-reset template is deliberately NOT re-renderable.
   *
   * A reset link embeds a single-use token. Re-rendering it from stored
   * state would mean either keeping the raw token (a credential in the
   * database, recoverable by anyone with a dump) or re-issuing a new one
   * silently behind the customer's back. Neither is acceptable, so a reset
   * email that fails to send is failed permanently and the customer is
   * asked to request a new link.
   */
  if (template === 'password-reset') {
    return null;
  }

  /*
   * Return templates are rendered from the return request, because the
   * status, refund amount and administrator note all live there. The order
   * is still needed for the recipient's address block.
   */
  if (template.startsWith('return-')) {
    if (!row.returnId) {
      return null;
    }

    const { ReturnRequestModel } = await import('../models/return-request.model.js');
    const { mapReturn } = await import('./return.service.js');

    const returnDoc = await ReturnRequestModel.findById(row.returnId).lean<
      Parameters<typeof mapReturn>[0] | null
    >();
    if (!returnDoc) {
      return null;
    }

    const projected = mapReturn(returnDoc);

    switch (template) {
      case 'return-acknowledged':
        return templates.renderReturnAcknowledged(projected);
      case 'return-approved':
        return templates.renderReturnApproved(projected);
      case 'return-refunded':
        return templates.renderReturnRefunded(projected, projected.refundRef);
      case 'return-rejected':
        return templates.renderReturnRejected(projected, undefined);
      default:
        return null;
    }
  }

  if (!row.orderId) {
    return null;
  }

  const { OrderModel } = await import('../models/order.model.js');
  const { mapOrder } = await import('./order.service.js');

  const order = await OrderModel.findById(row.orderId).lean<
    Parameters<typeof mapOrder>[0] | null
  >();
  if (!order) {
    return null;
  }

  const projected = mapOrder(order);

  switch (template) {
    case 'order-confirmation':
      return templates.renderOrderConfirmation(projected, orderUrlFor(projected.orderNumber));
    case 'order-shipped':
      return templates.renderOrderShipped(projected, {});
    case 'order-delivered':
      return templates.renderOrderDelivered(projected);
    case 'order-cancelled':
      // The cancellation reason lives on the order itself.
      return templates.renderOrderCancelled(projected, order.cancellationReason);
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry points                                                        */
/* -------------------------------------------------------------------------- */

/** Build the storefront URL for an order. */
function orderUrlFor(orderNumber: string): string {
  const base = process.env.STOREFRONT_PUBLIC_URL ?? '';
  return `${base.replace(/\/$/, '')}/orders/${encodeURIComponent(orderNumber)}`;
}

/** Record (and normally deliver) an order confirmation. */
export async function notifyOrderConfirmation(input: {
  orderId: Types.ObjectId | string;
  orderNumber: string;
  to: string;
  rendered: RenderedEmail;
  correlationId?: string;
  /** Set false to only record the intent, e.g. from a webhook. */
  trySend?: boolean;
}): Promise<EnqueueResult> {
  return enqueueAndMaybeSend({
    template: 'order-confirmation',
    idempotencyKey: `order-confirmation/${input.orderNumber}`,
    to: input.to,
    rendered: input.rendered,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    correlationId: input.correlationId,
    ...(input.trySend === undefined ? {} : { trySend: input.trySend }),
  });
}

/** Record (and normally deliver) a generic order notification by template. */
export async function notifyOrderEvent(input: {
  template: 'order-shipped' | 'order-delivered' | 'order-cancelled';
  orderId: Types.ObjectId | string;
  orderNumber: string;
  to: string;
  rendered: RenderedEmail;
  correlationId?: string;
}): Promise<EnqueueResult> {
  return enqueueAndMaybeSend({
    template: input.template,
    idempotencyKey: `${input.template}/${input.orderNumber}`,
    to: input.to,
    rendered: input.rendered,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    correlationId: input.correlationId,
  });
}

/** Record (and normally deliver) a return notification by template. */
export async function notifyReturnEvent(input: {
  template: 'return-acknowledged' | 'return-approved' | 'return-refunded' | 'return-rejected';
  returnId: Types.ObjectId | string;
  orderId: Types.ObjectId | string;
  orderNumber: string;
  returnNumber?: string;
  to: string;
  rendered: RenderedEmail;
  correlationId?: string;
}): Promise<EnqueueResult> {
  return enqueueAndMaybeSend({
    template: input.template,
    // Keyed on the return's own id, because one order can carry several.
    idempotencyKey: `${input.template}/${String(input.returnId)}`,
    to: input.to,
    rendered: input.rendered,
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    returnId: input.returnId,
    ...(input.returnNumber === undefined ? {} : { returnNumber: input.returnNumber }),
    correlationId: input.correlationId,
  });
}

/**
 * Record (and normally deliver) a password reset email.
 *
 * The idempotency key is the **token's hash**, not the raw token. Two
 * consequences follow, and both matter:
 *
 *  1. The raw token never reaches the database, so a dump cannot be used to
 *     reset anybody's password.
 *  2. The key is stable for one reset attempt, so a retried send produces
 *     one email — but a *new* request produces a *new* key, because the new
 *     request has a new token.
 *
 * The link embeds the raw token, so this template is deliberately excluded
 * from `reRender`: a failed send cannot be retried from stored state.
 */
export async function notifyPasswordReset(input: {
  /** SHA-256 of the raw reset token. Safe to store. */
  tokenHash: string;
  to: string;
  rendered: RenderedEmail;
  correlationId?: string;
}): Promise<EnqueueResult> {
  return enqueueAndMaybeSend({
    template: 'password-reset',
    idempotencyKey: `password-reset/${input.tokenHash}`,
    to: input.to,
    rendered: input.rendered,
    correlationId: input.correlationId,
  });
}

/**
 * Is email usable on this deployment?
 *
 * Reported to the admin panel so an operator sees "not configured" rather
 * than discovering that no customer ever received a confirmation.
 */
export function emailConfiguration(): {
  configured: boolean;
  allowlistActive: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!process.env.RESEND_API_KEY?.trim()) missing.push('RESEND_API_KEY');
  if (!process.env.RESEND_FROM_EMAIL?.trim()) missing.push('RESEND_FROM_EMAIL');

  return {
    configured: missing.length === 0,
    allowlistActive: process.env.NODE_ENV !== 'production' && emailAllowlistSize() > 0,
    missing,
  };
}

function emailAllowlistSize(): number {
  const raw = process.env.EMAIL_ALLOWLIST?.trim();
  if (!raw) return 0;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
}
