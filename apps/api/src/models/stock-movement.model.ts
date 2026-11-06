import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * The stock ledger.
 *
 * Stock is never edited in place. Every change appends a movement that
 * records the delta, the resulting level, who made the change and why.
 * That makes a stock discrepancy always explainable, and it makes the
 * `stock` field on a variant reconstructable from history.
 *
 * The ledger is append-only: nothing in the API updates or deletes a
 * movement.
 */
const stockMovementSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, required: true, index: true },
    sku: { type: String, required: true },
    /** Denormalised for reporting without a join. */
    productCode: { type: String, required: true, index: true },
    /** The signed change in units. */
    delta: { type: Number, required: true },
    /** The level before the adjustment. */
    stockBefore: { type: Number, required: true, min: 0 },
    /** The level after the adjustment. */
    stockAfter: { type: Number, required: true, min: 0 },
    reason: {
      type: String,
      required: true,
      enum: ['initial-set', 'correction', 'restock', 'sale', 'return', 'damage', 'audit'],
    },
    /** A human explanation. */
    note: { type: String, default: '' },
    /** The administrator who made the change. Null for a system movement. */
    actorId: { type: Schema.Types.ObjectId, default: null },
    /** A human-readable label for the actor, kept for the audit trail. */
    actorLabel: { type: String, default: 'system' },
    /** The order this movement was caused by, when there was one. */
    orderId: { type: Schema.Types.ObjectId },
  },
  {
    timestamps: true,
    collection: 'stock_movements',
  },
);

// The per-variant history, newest first.
stockMovementSchema.index({ variantId: 1, createdAt: -1 });
// The store-wide movement feed.
stockMovementSchema.index({ createdAt: -1 });
// Backs the low-stock report.
stockMovementSchema.index({ productCode: 1, createdAt: -1 });

export type StockMovementDocument = InferSchemaType<typeof stockMovementSchema>;
export const StockMovementModel = mongoose.model('StockMovement', stockMovementSchema);
