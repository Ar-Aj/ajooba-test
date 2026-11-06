import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Transactional email outbox.
 *
 * Sending order confirmation inside the payment-capture path would couple a
 * money-moving operation to a third-party API's availability. If Resend is
 * slow or down, a settled payment must not be reported as failed — and if
 * the process dies between the two, the customer must still get the email.
 *
 * So nothing here sends mail inline. Callers record an *intent* and the
 * dispatcher delivers it. Three properties fall out of that:
 *
 *  - **The money path never awaits the mail provider.** `markPaymentCaptured`
 *    records the intent and returns; the email is a separate concern.
 *  - **A crash cannot lose the email.** The row is already durable before
 *    anything is attempted.
 *  - **Retries are safe and bounded.** The unique index on
 *    `(template, idempotencyKey)` makes a duplicate send impossible even if
 *    two dispatchers race, and `attempts` caps how often we try.
 *
 * The row is also the audit record: an operator can answer "did this customer
 * get their confirmation?" from the database alone, without trusting the
 * provider's dashboard.
 */
const emailLogSchema = new Schema(
  {
    /**
     * Which template this is. Free-form rather than an enum so a new
     * transactional email is a data addition, not a migration.
     */
    template: {
      type: String,
      required: true,
      index: true,
    },

    /**
     * Provider-side deduplication key.
     *
     * Derived from the event that caused the email (`order-confirmation/
     * <orderId>`), exactly as Resend documents for `Idempotency-Key`. It is
     * also the second half of the unique index below, so the same logical
     * email can never be enqueued twice even by different code paths.
     */
    idempotencyKey: { type: String, required: true },

    /** The order this concerns, when it concerns one. */
    orderId: { type: Schema.Types.ObjectId, index: true },
    orderNumber: { type: String },

    /**
     * The return request this concerns, when it concerns one.
     *
     * A return email cannot be re-rendered from the order alone — it needs
     * the return's own status, refund amount and resolution note. Without
     * this field a failed return email could never be retried, because there
     * would be nothing to re-render it from.
     */
    returnId: { type: Schema.Types.ObjectId, index: true },
    /** The return's human-readable number, for operator diagnostics. */
    returnNumber: { type: String },

    /**
     * The recipient, stored verbatim.
     *
     * Recorded so a failed or skipped send is still explainable after the
     * fact. This is a transactional address the customer supplied at
     * checkout, not a marketing list.
     */
    to: { type: String, required: true },

    subject: { type: String, default: '' },

    /**
     * How the delivery ended.
     *
     * - `queued`  — recorded, not yet attempted
     * - `sent`    — the provider accepted it (async, not yet delivered)
     * - `skipped` — deliberately not sent (allowlist, unconfigured, duplicate)
     * - `failed`  — the provider rejected it or was unreachable
     */
    status: {
      type: String,
      required: true,
      enum: ['queued', 'sent', 'skipped', 'failed'],
      default: 'queued',
      index: true,
    },

    /** The provider's message id, once we have one. */
    providerMessageId: { type: String },

    /** Why it was skipped or how it failed. Safe to log; never an API key. */
    detail: { type: String, default: '' },

    /** How many delivery attempts have been made. */
    attempts: { type: Number, default: 0 },

    /** When each attempt happened, for diagnosing a stuck row. */
    lastAttemptAt: { type: Date },
    /** Set once the provider accepted it. */
    sentAt: { type: Date },

    /** The request id of the action that caused this email, for tracing. */
    correlationId: { type: String },
  },
  {
    timestamps: true,
    collection: 'email_logs',
  },
);

/*
 * The exactly-once guarantee.
 *
 * Two dispatchers — or one dispatcher that crashed and restarted — must not
 * produce two copies of the same logical email. Losing the insert race is how
 * the duplicate is recognised, and the caller then records a `skipped`
 * duplicate instead of sending again.
 */
emailLogSchema.index({ template: 1, idempotencyKey: 1 }, { unique: true });

/* Operations: the dispatcher claims the oldest unsent work. */
emailLogSchema.index({ status: 1, createdAt: 1 });
/* Diagnostics: everything we ever sent a customer about an order. */
emailLogSchema.index({ orderId: 1, createdAt: -1 });
/* Operations: retry a specific failure. */
emailLogSchema.index({ status: 1, lastAttemptAt: 1 });

export type EmailLogDocument = InferSchemaType<typeof emailLogSchema>;
export const EmailLogModel = mongoose.model('EmailLog', emailLogSchema);
