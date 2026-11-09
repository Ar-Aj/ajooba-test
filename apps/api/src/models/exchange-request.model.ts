import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const exchangeOrderItemSchema = new Schema(
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

const replacementItemSchema = new Schema(
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
  },
  { _id: false },
);

const exchangeRequestSchema = new Schema(
  {
    exchangeNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, required: true, index: true },
    originalItem: { type: exchangeOrderItemSchema, required: true },
    replacementItem: { type: replacementItemSchema, required: true },
    /** Positive means the new size currently costs more; no money moves here. */
    priceDifference: { type: Number, required: true, default: 0 },
    reasonNote: { type: String, default: '' },
    status: {
      type: String,
      required: true,
      enum: ['requested', 'approved', 'rejected', 'received', 'replacement-shipped', 'completed'],
      default: 'requested',
      index: true,
    },
    resolutionNote: { type: String, default: '' },
    requestedAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date },
  },
  { timestamps: true, collection: 'exchanges' },
);

exchangeRequestSchema.index({ customerId: 1, createdAt: -1 });
exchangeRequestSchema.index({ status: 1, createdAt: -1 });

export type ExchangeRequestDocument = InferSchemaType<typeof exchangeRequestSchema>;
export const ExchangeRequestModel = mongoose.model('ExchangeRequest', exchangeRequestSchema);
