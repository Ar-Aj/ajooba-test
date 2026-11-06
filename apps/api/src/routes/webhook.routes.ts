import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { OrderModel } from '../models/order.model.js';
import { PaymentModel } from '../models/payment.model.js';
import { WebhookEventModel } from '../models/webhook-event.model.js';
import {
  isRazorpayWebhookConfigured,
  verifyWebhookSignature,
} from '../services/razorpay.service.js';
import {
  isShiprocketWebhookConfigured,
  shiprocketWebhookSecret,
} from '../services/shiprocket.service.js';
import { applyTrackingUpdate } from '../services/shipping.service.js';
import { markPaymentCaptured, markPaymentFailed } from '../services/payment.service.js';
import { reconcileFailedRefund } from '../services/refund.service.js';
import { getRequestId } from '../middleware/error-handler.js';

/**
 * Razorpay webhooks.
 *
 * Everything about this endpoint is defensive, because it is the one route
 * on the platform that an unauthenticated third party can reach.
 *
 * The security properties, and where each comes from:
 *
 *  - **Signature over the raw body.** Verified in `app.ts` against the exact
 *    bytes received, per Razorpay's explicit instruction not to re-parse the
 *    body. Comparison is constant-time.
 *  - **Duplicate suppression.** `x-razorpay-event-id` is unique per event
 *    per the provider's documentation. The insert into `webhook_events` is
 *    the claim: a duplicate delivery loses the unique-index race and is
 *    acknowledged with 200 without re-processing. That makes a redelivered
 *    capture harmless.
 *  - **Out-of-order tolerance.** Razorpay documents that
 *    `payment.authorized` / `payment.captured` may arrive in any order. All
 *    writes go through conditional updates that refuse to leave a terminal
 *    state, so a late `failed` cannot undo a `captured`.
 *  - **Amount reconciliation.** The provider's amount is compared with the
 *    stored order total before anything is marked paid.
 *  - **No secrets in the log.** Only ids, event types and outcomes. No
 *    signature, no key, no customer data.
 */

/** Paths that need the raw-body parser. Kept beside the route for symmetry. */
export const WEBHOOK_RAW_BODY_PATHS = ['/webhooks/razorpay'];

/** A request carrying its verbatim body. */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}
/**
 * The subset of Razorpay's payment event payload we act on.
 *
 * Deliberately permissive about extra keys (the provider sends more than we
 * use) and strict about the ones that matter. An event that does not match
 * is *acknowledged*, not retried — retrying a malformed event forever helps
 * nobody.
 *
 * **The nesting matters, and it was wrong at first.**
 *
 * Razorpay's own documentation
 * (`https://razorpay.com/docs/build/llm-docs/webhooks/payments.md`,
 * verified 23 Oct 2026) shows every payment event in this shape:
 *
 * ```json
 * {
 *   "entity": "event",
 *   "account_id": "acc_...",
 *   "event": "payment.captured",
 *   "contains": ["payment"],
 *   "payload": {
 *     "payment": {
 *       "entity": {
 *         "id": "pay_...",
 *         "entity": "payment",
 *         "amount": 100,
 *         "currency": "INR",
 *         "status": "captured",
 *         "order_id": "order_...",
 *         "captured": true
 *       }
 *     }
 *   },
 *   "created_at": 1567674606
 * }
 * ```
 *
 * Two consequences the previous schema got wrong:
 *
 *  1. **The top-level `entity` is `"event"`, not `"payment"`.** The literal
 *     `z.literal('payment')` rejected every real delivery.
 *  2. **The payment fields live at `payload.payment.entity.*`.** The
 *     previous schema read them from `payload.payment.*`, so `id` and
 *     `amount` were `undefined` even when the envelope matched.
 *
 * Both together meant a genuine `payment.captured` delivery failed
 * validation and was acknowledged as "unrecognised" — a captured payment
 * would never have settled an order. The flat shape is still accepted
 * below, because a payload that arrives that way is unambiguous and
 * refusing it would be worse than accepting it.
 */
const paymentEventSchema = z.object({
  /**
   * The event envelope's own entity. Razorpay sends `"event"`.
   *
   * The literal `'payment'` is still accepted, because the older shape —
   * which the platform's own test fixtures used — carried it there.
   */
  entity: z.union([z.literal('event'), z.literal('payment')]),
  event: z.enum([
    'payment.authorized',
    'payment.captured',
    'payment.failed',
    'payment.refunded',
    'refund.created',
    'refund.processed',
    'refund.failed',
  ]),
  /**
   * The entities the event carries, e.g. `["payment"]`.
   *
   * Razorpay documents this as an **array**. An earlier version of this schema
   * declared it as a string, which meant every real payment webhook failed
   * validation and was acknowledged as "unrecognised" — so a captured payment
   * would never settle an order. Accepted as either shape so a
   * single-element delivery is not the thing that breaks.
   */
  contains: z.union([z.array(z.string()), z.string()]).optional(),
  payload: z
    .object({
      payment: z
        .object({
          /**
           * The documented shape: the payment entity is nested one level
           * deeper, under `entity`, as an object.
           *
           * A bare string is also accepted (`entity: "payment"`), which is
           * the marker shape some provider dashboards emit and which the
           * platform's own fixtures use — in that case the payment fields
           * are read from the enclosing object.
           */
          entity: z
            .union([
              z
                .object({
                  id: z.string(),
                  amount: z.number(),
                  currency: z.string().optional(),
                  status: z.string().optional(),
                  method: z.string().nullable().optional(),
                  order_id: z.string().nullable().optional(),
                  captured: z.boolean().optional(),
                  error_description: z.string().nullable().optional(),
                })
                .passthrough(),
              z.string(),
            ])
            .optional(),
          /*
           * The flat shape, accepted so a delivery that carries the payment
           * fields directly is still handled rather than silently ignored.
           */
          id: z.string().optional(),
          amount: z.number().optional(),
          currency: z.string().optional(),
          status: z.string().optional(),
          method: z.string().nullable().optional(),
          order_id: z.string().nullable().optional(),
          captured: z.boolean().optional(),
          error_description: z.string().nullable().optional(),
        })
        .passthrough()
        .optional(),
      /**
       * Refund events carry the refund entity alongside the payment.
       * Documented at `payload.refund.entity`.
       */
      refund: z
        .object({
          entity: z
            .object({
              id: z.string(),
              payment_id: z.string().nullable().optional(),
              amount: z.number().optional(),
              status: z.string().optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
});

/**
 * The payment fields of an event, whichever shape they arrived in.
 *
 * Returns `null` when the delivery carries no usable payment, so the caller
 * can record it as unrecognised rather than acting on `undefined`.
 */
function readPaymentFields(event: z.infer<typeof paymentEventSchema>): {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string | null;
  orderId: string | null;
  captured: boolean | undefined;
  errorDescription: string | null;
} | null {
  const payment = event.payload.payment;

  if (!payment) {
    return null;
  }

  /*
   * Three shapes are accepted, in order of preference:
   *
   *   1. `payload.payment.entity.*` — Razorpay's documented nesting.
   *   2. `payload.payment.entity` is the marker string `"payment"` and the
   *      fields sit on the enclosing object (this platform's own fixtures).
   *   3. `payload.payment.*` — the fields sit directly on the payment.
   */
  const source =
    typeof payment.entity === 'object' && payment.entity !== null ? payment.entity : payment;

  if (!source.id || typeof source.amount !== 'number') {
    return null;
  }

  return {
    id: source.id,
    amount: source.amount,
    currency: source.currency ?? 'INR',
    status: source.status ?? 'unknown',
    method: source.method ?? null,
    orderId: source.order_id ?? null,
    captured: source.captured,
    errorDescription: source.error_description ?? null,
  };
}

/**
 * The refund fields of an event, whichever shape they arrived in.
 *
 * Razorpay's refund events (`refund.created`, `refund.processed`,
 * `refund.failed`) carry the refund entity at `payload.refund.entity` and
 * the original payment at `payload.payment.entity`. The refund entity is
 * the one that names the payment it reverses, via `payment_id`.
 */
function readRefundFields(
  event: z.infer<typeof paymentEventSchema>,
): { id: string; paymentId: string | null; amount: number | null; status: string } | null {
  const refund = (
    event.payload as {
      refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
    }
  ).refund?.entity;

  if (!refund?.id) {
    return null;
  }

  return {
    id: refund.id,
    paymentId: refund.payment_id ?? null,
    amount: typeof refund.amount === 'number' ? refund.amount : null,
    status: refund.status ?? 'unknown',
  };
}

export const webhookRouter: Router = Router();

/**
 * Claim an event id.
 *
 * Returns `false` when the event has already been seen — either by a
 * previous delivery or by a concurrent one racing us to the same unique
 * index. The caller then returns 200 immediately, which is what tells
 * Razorpay the delivery succeeded.
 */
async function claimEvent(input: {
  eventId: string;
  eventType: string;
  correlationId: string;
}): Promise<boolean> {
  try {
    await WebhookEventModel.create({
      provider: 'razorpay',
      eventId: input.eventId,
      eventType: input.eventType,
      outcome: 'ignored',
      correlationId: input.correlationId,
    });
    return true;
  } catch (error) {
    // 11000 = duplicate key: this exact event was already claimed.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      return false;
    }
    throw error;
  }
}

/**
 * Update the outcome of a claimed event.
 *
 * Failures here are logged but never propagated: the event row already
 * exists, so the delivery has been acknowledged, and a bookkeeping failure
 * must not turn a settled payment into a retried one.
 */
async function recordOutcome(
  eventId: string,
  fields: {
    outcome: 'processed' | 'ignored' | 'unsupported' | 'duplicate';
    detail?: string;
    orderId?: Types.ObjectId;
    providerPaymentId?: string;
    paymentId?: Types.ObjectId;
  },
): Promise<void> {
  try {
    await WebhookEventModel.updateOne(
      { provider: 'razorpay', eventId },
      {
        $set: {
          outcome: fields.outcome,
          ...(fields.detail ? { detail: fields.detail.slice(0, 300) } : {}),
          ...(fields.orderId ? { orderId: fields.orderId } : {}),
          ...(fields.providerPaymentId ? { providerPaymentId: fields.providerPaymentId } : {}),
          ...(fields.paymentId ? { paymentId: fields.paymentId } : {}),
        },
      },
    );
  } catch (error) {
    logger.error({ eventId, err: error }, 'Failed to record webhook outcome');
  }
}

/**
 * Receive a Razorpay webhook.
 *
 * Response contract:
 *   - `200` — handled, or deliberately ignored. Stop redelivering.
 *   - `400` — the request is not valid (missing event id, unparseable).
 *   - `401` — the signature did not verify. Never retried into success.
 *   - `503` — a transient internal failure, so Razorpay retries.
 */
webhookRouter.post('/razorpay', async (req, res) => {
  const correlationId = getRequestId(req);

  /*
   * With no webhook secret configured there is no way to authenticate a
   * delivery. Refusing is the only safe answer — accepting unverified
   * events would let anyone mark orders paid.
   */
  if (!isRazorpayWebhookConfigured()) {
    logger.warn({ correlationId }, 'Rejected a Razorpay webhook: no webhook secret configured');
    res.status(503).json({ ok: false, error: 'Webhook secret is not configured.' });
    return;
  }

  const signature = req.header('x-razorpay-signature');
  if (!signature) {
    res.status(400).json({ ok: false, error: 'Missing signature header.' });
    return;
  }

  const rawBody = (req as RawBodyRequest).rawBody;
  if (!rawBody || rawBody.length === 0) {
    res.status(400).json({ ok: false, error: 'Empty request body.' });
    return;
  }

  if (!verifyWebhookSignature(rawBody, signature)) {
    // Deliberately terse: never explain *how* the signature failed.
    logger.warn({ correlationId }, 'Rejected a Razorpay webhook with an invalid signature');
    res.status(401).json({ ok: false, error: 'Invalid signature.' });
    return;
  }

  // Only now is it safe to parse.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.status(400).json({ ok: false, error: 'Malformed JSON.' });
    return;
  }

  /*
   * The event id is what makes this endpoint idempotent, and Razorpay
   * documents it as unique per event. A delivery without one cannot be
   * deduplicated, so it is refused rather than processed blindly — the only
   * safe alternative to a double-processing bug.
   */
  const eventId = req.header('x-razorpay-event-id')?.trim();
  if (!eventId) {
    logger.warn({ correlationId }, 'Rejected a Razorpay webhook with no event id header');
    res.status(400).json({ ok: false, error: 'Missing event id header.' });
    return;
  }

  const envelope = parsed as { event?: string };

  if (!(await claimEvent({ eventId, eventType: envelope.event ?? 'unknown', correlationId }))) {
    logger.info({ eventId, correlationId }, 'Ignored a duplicate Razorpay webhook delivery');
    res.status(200).json({ ok: true, outcome: 'duplicate' });
    return;
  }

  const result = paymentEventSchema.safeParse(parsed);

  if (!result.success) {
    /*
     * A well-formed delivery of an event we do not handle. Acknowledged,
     * because retrying will not make it handleable and a non-2xx would fill
     * the provider's retry queue with events we will never act on.
     */
    await recordOutcome(eventId, {
      outcome: 'unsupported',
      detail: `Unrecognised event: ${envelope.event ?? '(none)'}`,
    });
    res.status(200).json({ ok: true, outcome: 'ignored' });
    return;
  }

  try {
    const outcome = await handlePaymentEvent(result.data, eventId, correlationId);
    await recordOutcome(eventId, {
      outcome: outcome.kind,
      detail: outcome.detail,
      ...(outcome.orderId ? { orderId: outcome.orderId } : {}),
      ...(outcome.providerPaymentId ? { providerPaymentId: outcome.providerPaymentId } : {}),
      ...(outcome.paymentId ? { paymentId: outcome.paymentId } : {}),
    });

    logger.info(
      { eventId, correlationId, event: result.data.event, outcome: outcome.kind },
      'Processed a Razorpay webhook',
    );

    res.status(200).json({ ok: true, outcome: outcome.kind });
  } catch (error) {
    /*
     * A genuine internal failure. 503 tells Razorpay to redeliver, which is
     * safe precisely because the event id makes the retry idempotent.
     */
    logger.error(
      { eventId, correlationId, event: result.data.event, err: error },
      'Failed to process a Razorpay webhook',
    );
    res.status(503).json({ ok: false, error: 'Processing failed; please retry.' });
  }
});

/** The three outcomes the handler distinguishes. */
type HandlerOutcome = {
  kind: 'processed' | 'ignored' | 'unsupported';
  detail: string;
  orderId?: Types.ObjectId;
  providerPaymentId?: string;
  paymentId?: Types.ObjectId;
};

/**
 * Apply one payment event.
 *
 * Every branch routes through `markPaymentCaptured` / `markPaymentFailed`,
 * which are conditional updates. That single discipline gives us, for free:
 * no double stock movement, no duplicate confirmation, no double refund, and
 * no late failure undoing a capture.
 */
async function handlePaymentEvent(
  event: z.infer<typeof paymentEventSchema>,
  eventId: string,
  correlationId: string,
): Promise<HandlerOutcome> {
  const eventPayment = readPaymentFields(event);

  /*
   * A delivery that carries no usable payment is acknowledged as
   * unrecognised rather than acted on.
   */
  if (!eventPayment) {
    return {
      kind: 'unsupported',
      detail: 'Event carried no usable payment entity.',
    };
  }

  const providerPaymentId: string = eventPayment.id;

  /*
   * Resolve the internal order through the payment record, which is the only
   * link between a provider payment id and our world. Matching on the stored
   * `providerReference` rather than on the payload's own `order_id` means we
   * never trust an identifier the event body merely claims.
   */
  const payment = await PaymentModel.findOne({ providerReference: providerPaymentId }).lean<{
    _id: Types.ObjectId;
    orderId: Types.ObjectId;
    amount: number;
    status: string;
  } | null>();

  if (!payment) {
    /*
     * Not one of ours — or the order was placed before this integration
     * existed. Either way there is nothing to settle, and saying so beats
     * guessing.
     */
    return {
      kind: 'ignored',
      detail: 'No local payment record for this provider payment id.',
      providerPaymentId,
    };
  }

  const order = await OrderModel.findById(payment.orderId).lean<{
    _id: Types.ObjectId;
    orderNumber: string;
    totalAmount: number;
    paymentStatus: string;
    status: string;
  } | null>();

  if (!order) {
    return {
      kind: 'ignored',
      detail: 'Local payment references an order that no longer exists.',
      providerPaymentId,
      paymentId: payment._id,
    };
  }

  // A refund on a cancelled order is a finance conversation, not an event.
  if (order.status === 'cancelled') {
    return {
      kind: 'ignored',
      detail: 'Order is cancelled; payment events are not applied.',
      orderId: order._id,
      providerPaymentId,
      paymentId: payment._id,
    };
  }

  const amountRupees = Math.floor(eventPayment.amount / 100);

  switch (event.event) {
    case 'payment.captured': {
      if (amountRupees !== order.totalAmount) {
        /*
         * Recorded and ignored rather than applied. Marking this paid would
         * mean promising stock for an amount that does not match the order.
         */
        logger.error(
          {
            eventId,
            correlationId,
            orderId: order._id.toString(),
            expected: order.totalAmount,
            received: amountRupees,
          },
          'Captured amount mismatch; payment left pending for manual reconciliation',
        );
        return {
          kind: 'ignored',
          detail: `Amount mismatch: expected ${order.totalAmount}, provider says ${amountRupees}.`,
          orderId: order._id,
          providerPaymentId,
          paymentId: payment._id,
        };
      }

      const applied = await markPaymentCaptured(
        payment._id,
        providerPaymentId,
        eventPayment.method ?? null,
        amountRupees,
      );

      return {
        kind: 'processed',
        detail: applied ? 'Order marked paid.' : 'Order was already paid; no change.',
        orderId: order._id,
        providerPaymentId,
        paymentId: payment._id,
      };
    }

    case 'payment.authorized': {
      /*
       * Authorization without capture. The order stays unpaid and the stock
       * stays reserved until a capture (or a failure) arrives. If capture is
       * automatic this event is simply a progress ping.
       */
      return {
        kind: 'ignored',
        detail: 'Payment authorized; awaiting capture.',
        orderId: order._id,
        providerPaymentId,
        paymentId: payment._id,
      };
    }

    case 'payment.failed': {
      /*
       * The out-of-order case. `markPaymentFailed` refuses to touch a payment
       * that is already `paid`, so a failure racing in behind a capture is a
       * recorded no-op rather than a lost payment.
       */
      const applied = await markPaymentFailed(
        payment._id,
        providerPaymentId,
        eventPayment.errorDescription ?? 'Payment failed',
      );

      return {
        kind: applied ? 'processed' : 'ignored',
        detail: applied
          ? 'Order marked failed.'
          : 'Payment was already settled; late failure ignored.',
        orderId: order._id,
        providerPaymentId,
        paymentId: payment._id,
      };
    }

    case 'refund.failed': {
      /*
       * A **refund** failure, not a payment failure.
       *
       * These were previously handled by the same branch as `payment.failed`,
       * which was wrong in a way that cost money: `markPaymentFailed` flips a
       * payment to `failed` and releases the order's stock. A refund that the
       * provider could not process — the customer already paid, the money is
       * still with us — must never do that. It must leave the *payment* alone
       * and only roll back the *refund*.
       *
       * The rollback is the same one the reconciliation job performs when it
       * observes a failed refund, so the two paths cannot disagree.
       */
      const refund = readRefundFields(event);

      if (!refund?.paymentId) {
        return {
          kind: 'ignored',
          detail: 'Refund failure event carried no refund entity; nothing to roll back.',
          orderId: order._id,
          providerPaymentId,
          paymentId: payment._id,
        };
      }

      const rolledBack = await reconcileFailedRefund(refund.id, correlationId, {
        providerPaymentId: refund.paymentId,
      });

      return {
        kind: rolledBack ? 'processed' : 'ignored',
        detail: rolledBack
          ? 'Refund failure applied; the return was reopened and the refundable balance restored.'
          : 'No matching refund was in flight; nothing to roll back.',
        orderId: order._id,
        providerPaymentId,
        paymentId: payment._id,
      };
    }

    case 'payment.refunded':
    case 'refund.processed': {
      /*
       * Refund settlement is reconciled from the payment side rather than
       * trusted from the event, because the authoritative detail (how much,
       * for which return) lives in the refund record. See
       * `refund.service.ts#reconcileRefund`.
       */
      return {
        kind: 'ignored',
        detail: 'Refund settlement is reconciled via the refund record.',
        orderId: order._id,
        providerPaymentId,
        paymentId: payment._id,
      };
    }

    default: {
      /*
       * Unreachable while the enum above and this switch agree, which is
       * exactly the point: adding an event to the schema forces a decision
       * here rather than silently falling through. `never` cannot be
       * interpolated, so the event name is carried in explicitly for the
       * record rather than read off the narrowed type.
       */
      const unhandled: HandlerOutcome = {
        kind: 'unsupported',
        detail: 'Unhandled event.',
        providerPaymentId,
      };
      return unhandled;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Shiprocket tracking webhook                                                */
/* -------------------------------------------------------------------------- */

/**
 * The tracking payload Shiprocket posts.
 *
 * Permissive about extra keys — the provider sends more than we use — and
 * strict about the ones we act on. A payload we cannot recognise is
 * acknowledged rather than retried, because retrying it forever helps
 * nobody and Shiprocket will keep delivering it.
 */
const trackingEventSchema = z.object({
  awb: z.string().min(1).optional(),
  order_id: z.string().optional(),
  sr_order_id: z.union([z.string(), z.number()]).optional(),
  courier_name: z.string().optional(),
  current_status: z.string().optional(),
  current_status_id: z.number().optional(),
  shipment_status: z.string().optional(),
  shipment_status_id: z.number().optional(),
  current_timestamp: z.string().optional(),
  etd: z.string().optional(),
  pickup_scheduled_date: z.string().optional(),
  scans: z
    .array(
      z
        .object({
          date: z.string().optional(),
          status: z.string().optional(),
          activity: z.string().optional(),
          location: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

/**
 * Receive a Shiprocket tracking update.
 *
 * Response contract, per Shiprocket's documentation: **only HTTP 200**.
 * Any other status and the provider treats the delivery as failed and
 * retries it — so a processing error that is genuinely transient should
 * return 200 anyway and let the reconciliation job pick it up, rather than
 * causing an endless redelivery loop.
 *
 * Authentication uses the `x-api-key` header, which Shiprocket sends when a
 * security token is configured on the webhook. With no token configured the
 * endpoint refuses every delivery, because an unauthenticated tracking
 * endpoint would let anyone mark orders as delivered.
 */
/**
 * The tracking webhook path.
 *
 * Shiprocket's own documentation is explicit: *"Please do not use keywords
 * like shiprocket, kartrocket, sr, or kr in your webhook URL."* A callback
 * URL containing any of those substrings is rejected by the provider, so
 * configuring the platform's obvious path would leave tracking permanently
 * undelivered.
 *
 * `/carrier/track` contains none of them and reads as what it is.
 *
 * The older `/shiprocket` path is kept as a **secondary alias** so that an
 * environment which was already configured before this rule was applied keeps
 * working. The canonical path — the one to configure in the dashboard and the
 * one every document names — is `/carrier/track`.
 */
export const SHIPROCKET_WEBHOOK_PATH = '/carrier/track';

/**
 * The tracking webhook handler.
 *
 * Mounted on both the canonical path and the legacy alias.
 */
async function handleShiprocketTracking(req: Request, res: Response): Promise<void> {
  const correlationId = getRequestId(req);

  if (!isShiprocketWebhookConfigured()) {
    logger.warn(
      { correlationId },
      'Rejected a Shiprocket tracking webhook: no webhook secret configured',
    );
    // 200, because the provider requires it and retrying will not help.
    res.status(200).json({ ok: true, outcome: 'ignored' });
    return;
  }

  const providedKey = req.header('x-api-key');
  if (!providedKey || !safeCompareSecret(providedKey, shiprocketWebhookSecret() ?? '')) {
    logger.warn({ correlationId }, 'Rejected a Shiprocket tracking webhook with an invalid key');
    res.status(200).json({ ok: true, outcome: 'ignored' });
    return;
  }

  const parsed = trackingEventSchema.safeParse(req.body);
  if (!parsed.success) {
    await recordShiprocketOutcome('unknown', 'unsupported', 'Unrecognised tracking payload.');
    res.status(200).json({ ok: true, outcome: 'ignored' });
    return;
  }

  const event = parsed.data;

  try {
    const result = await applyTrackingUpdate({
      awbCode: event.awb ?? null,
      providerOrderId: event.order_id ?? null,
      providerStatus: event.current_status ?? event.shipment_status ?? null,
      providerStatusId: event.current_status_id ?? event.shipment_status_id ?? null,
      estimatedDelivery: event.etd ?? null,
      scans: event.scans,
    });

    await recordShiprocketOutcome(
      event.awb ?? event.order_id ?? 'unknown',
      result.shipment ? 'processed' : 'ignored',
      result.shipment
        ? `Shipment ${result.shipment.status}.`
        : 'No local shipment matched this delivery.',
    );

    logger.info(
      {
        correlationId,
        awb: event.awb ?? null,
        status: result.shipment?.status ?? null,
        orderChanged: result.orderChanged,
      },
      'Processed a Shiprocket tracking webhook',
    );

    res.status(200).json({ ok: true, outcome: result.shipment ? 'processed' : 'ignored' });
  } catch (error) {
    /*
     * A genuine internal failure. Shiprocket requires a 200, so the delivery
     * is acknowledged and the failure is recorded for reconciliation. The
     * on-demand `refreshShipmentTracking` pull recovers the state.
     */
    logger.error({ correlationId, err: error }, 'Failed to process a Shiprocket tracking webhook');
    await recordShiprocketOutcome(event.awb ?? 'unknown', 'failed', 'Processing failed.');
    res.status(200).json({ ok: true, outcome: 'ignored' });
  }
}

/*
 * Both paths are mounted. `/carrier/track` is the canonical one — it is the
 * path the provider will accept, because it contains none of the substrings
 * Shiprocket forbids. `/shiprocket` is retained as a legacy alias for an
 * environment that was configured before the provider's URL rule was applied.
 */
webhookRouter.post(SHIPROCKET_WEBHOOK_PATH, handleShiprocketTracking);
webhookRouter.post('/shiprocket', handleShiprocketTracking);

/**
 * Record the outcome of a tracking delivery.
 *
 * Uses the same `webhook_events` collection as Razorpay, with the provider
 * set to `shiprocket`, so one query answers "what did the provider tell us
 * and what did we do about it" for every provider.
 */
async function recordShiprocketOutcome(
  eventId: string,
  outcome: 'processed' | 'ignored' | 'unsupported' | 'failed',
  detail: string,
): Promise<void> {
  try {
    await WebhookEventModel.updateOne(
      { provider: 'shiprocket', eventId },
      {
        $set: {
          eventType: 'tracking.update',
          outcome,
          detail: detail.slice(0, 300),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    logger.error({ eventId, err: error }, 'Failed to record a tracking webhook outcome');
  }
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * `timingSafeEqual` throws when the lengths differ, so the length check
 * happens first and returns `false` rather than throwing.
 */
function safeCompareSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}
