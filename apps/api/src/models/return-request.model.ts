import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Return requests.
 *
 * A return references an order and carries its own copy of the returned
 * line items, so the return record stays readable even if the order
 * document is later archived.
 */
const returnItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    title: { type: String, required: true },
    imageUrl: { type: String },
    colour: { type: String, required: true },
    size: { type: Number, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const returnRequestSchema = new Schema(
  {
    /** Human-readable, unique. */
    returnNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true, index: true },
    items: { type: [returnItemSchema], required: true },
    reason: {
      type: String,
      required: true,
      enum: [
        'size-too-small',
        'size-too-large',
        'not-as-described',
        'damaged',
        'wrong-item',
        'changed-mind',
        'other',
      ],
    },
    reasonNote: { type: String, default: '' },
    status: {
      type: String,
      required: true,
      enum: ['requested', 'approved', 'rejected', 'refunded'],
      default: 'requested',
      index: true,
    },
    /** The amount the customer will get back, in whole rupees. */
    refundAmount: { type: Number, required: true, min: 0, default: 0 },
    /** The gateway reference for the refund. */
    refundRef: { type: String },
    /** The staff note explaining an approval or a rejection. */
    resolutionNote: { type: String },
    /**
     * When the returned units were put back into the catalogue.
     *
     * Set exactly once, by the provider-confirmed refund path. Its presence
     * is what makes the restoration idempotent: a reconciliation loop that
     * runs twice must not credit the stock twice.
     */
    stockRestoredAt: { type: Date },
    requestedAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'returns',
  },
);

returnRequestSchema.index({ customerId: 1, createdAt: -1 });
returnRequestSchema.index({ status: 1, createdAt: -1 });

export type ReturnRequestDocument = InferSchemaType<typeof returnRequestSchema>;
export const ReturnRequestModel = mongoose.model('ReturnRequest', returnRequestSchema);
