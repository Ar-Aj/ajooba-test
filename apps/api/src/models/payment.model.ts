import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Payment records.
 *
 * No card data ever reaches this platform — the gateway handles it. What
 * is stored is the *record* of a payment attempt against an order: the
 * amount, the status, and the gateway's own reference.
 *
 * One order may have several payment attempts (a failed attempt followed
 * by a successful one), so the order id is not unique here.
 */
const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** The amount attempted, in whole rupees. */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'INR' },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
      index: true,
    },
    /** The payment provider, e.g. `razorpay` or `cod`. */
    provider: { type: String, required: true, default: 'razorpay' },
    /** The gateway's own identifier for the payment. */
    providerReference: { type: String, index: true },
    /** The gateway's order identifier, for a payment created but not yet captured. */
    providerOrderId: { type: String },
    /** The method used, e.g. `card`, `upi`, `netbanking`, `cod`. */
    method: { type: String },
    /** Why the payment failed, when it did. */
    failureReason: { type: String },
    capturedAt: { type: Date },
    /** How much has been refunded against this payment, in whole rupees. */
    refundedAmount: { type: Number, required: true, min: 0, default: 0 },
    /** The gateway reference for a refund. */
    refundRef: { type: String },
    /**
     * The client's idempotency key. A repeated capture webhook with the
     * same key is acknowledged without creating a second record.
     *
     * The unique index is declared on the schema below. It must NOT also
     * be declared with `index: true` here: Mongoose resolves a duplicated
     * index declaration in favour of the plain one, which silently DROPS
     * the `unique` constraint — and a repeated payment capture would then
     * create a second payment record.
     */
    idempotencyKey: { type: String },
  },
  {
    timestamps: true,
    collection: 'payments',
  },
);

paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ customerId: 1, createdAt: -1 });
// One payment record per idempotency key.
paymentSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type PaymentDocument = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = mongoose.model('Payment', paymentSchema);
