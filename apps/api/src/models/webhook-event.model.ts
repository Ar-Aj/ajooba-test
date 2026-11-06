import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Provider webhook events.
 *
 * Razorpay documents that `x-razorpay-event-id` is **unique per event**, and
 * that the same event may be delivered more than once. It is also documented
 * that events may arrive out of order. Both facts are handled here:
 *
 *  - **Duplicate suppression** is the unique index on `(provider, eventId)`.
 *    The insert is the claim: whichever worker inserts first owns the event,
 *    and every later delivery loses the race and is acknowledged without
 *    re-processing. That is a durable guarantee, not an in-memory guess.
 *  - **Out-of-order tolerance** is handled by the *state machine* in
 *    `payment.service.ts`, which refuses to move a terminal state backwards.
 *    The event row records what actually happened, so an operator can see
 *    that `payment.failed` arrived after `payment.captured`.
 *
 * Every row keeps the correlation id so a delivery can be traced from the
 * provider's dashboard to our log line to the order it touched.
 */
const webhookEventSchema = new Schema(
  {
    /** Always `razorpay` today; kept open for future providers. */
    provider: { type: String, required: true, default: 'razorpay' },
    /**
     * The `x-razorpay-event-id` header.
     *
     * Required. The docs guarantee uniqueness per event, which is exactly
     * what makes it usable as a dedup key. A delivery without one is
     * rejected at the route rather than stored with a synthetic id, because
     * a fabricated key cannot dedup anything.
     */
    eventId: { type: String, required: true },
    /** The `event` field of the payload, e.g. `payment.captured`. */
    eventType: { type: String, required: true },
    /**
     * How the delivery ended.
     *
     * `ignored` covers events we deliberately did not act on (an unknown
     * type, or a late failure that arrived after a capture). Keeping those
     * rows is what makes an out-of-order delivery diagnosable instead of
     * invisible.
     */
    outcome: {
      type: String,
      required: true,
      enum: ['processed', 'duplicate', 'ignored', 'failed', 'unsupported'],
      default: 'ignored',
    },
    /** A short, safe explanation. Never contains a signature or a secret. */
    detail: { type: String, default: '' },
    /** The internal order this event resolved to, when one was found. */
    orderId: { type: Schema.Types.ObjectId },
    /** The payment id the event referenced. */
    providerPaymentId: { type: String },
    /** The payment id we created for it. */
    paymentId: { type: Schema.Types.ObjectId },
    /** Our request/correlation id, so a log line and a row can be joined. */
    correlationId: { type: String },
  },
  {
    timestamps: true,
    collection: 'webhook_events',
  },
);

// The dedup guarantee. Compound so a future provider cannot collide.
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
// Diagnostics: what arrived, in arrival order, for a given order.
webhookEventSchema.index({ orderId: 1, createdAt: 1 });
// Operations: recent deliveries, newest first.
webhookEventSchema.index({ createdAt: -1 });
// Reclaim rows for events we failed on, so they can be retried by hand.
webhookEventSchema.index({ outcome: 1, createdAt: -1 });

export type WebhookEventDocument = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEventModel = mongoose.model('WebhookEvent', webhookEventSchema);
