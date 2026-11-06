import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Coupons and promotional rules.
 *
 * The discount rules live here rather than in code so the business can
 * change them without a deployment. The *evaluation* of a coupon — the
 * arithmetic and the eligibility checks — lives in the service layer, so
 * that a rule can never be bypassed by a client.
 */
const couponSchema = new Schema(
  {
    /** Uppercased. Unique. */
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    type: { type: String, required: true, enum: ['percentage', 'fixed'], index: true },
    /** Percentage points for `percentage`, whole rupees for `fixed`. */
    value: { type: Number, required: true, min: 0 },
    /** The subtotal below which the coupon does not apply. */
    minOrderAmount: { type: Number, required: true, min: 0, default: 0 },
    /** The cap on a percentage discount. Null means uncapped. */
    maxDiscountAmount: { type: Number, min: 0, default: null },
    /** The scheduling window. */
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    /** How many times the coupon may be used in total. Null means unlimited. */
    usageLimit: { type: Number, min: 1, default: null },
    /** How many times the coupon has been used. */
    usedCount: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, required: true, default: true, index: true },
    description: { type: String, default: '' },
    /** Restrict the coupon to specific products. Empty means it applies to all. */
    productCodes: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'coupons',
  },
);

// The admin coupon list, and the "currently usable" lookup.
couponSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });
couponSchema.index({ createdAt: -1 });

export type CouponDocument = InferSchemaType<typeof couponSchema>;
export const CouponModel = mongoose.model('Coupon', couponSchema);
