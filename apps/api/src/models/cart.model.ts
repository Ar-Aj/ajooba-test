import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Carts.
 *
 * A cart is stored server-side so it survives a device change. A cart
 * belongs either to a signed-in customer or to a guest session, never both
 * — the `customerId` index is sparse so the uniqueness constraint only
 * applies to signed-in carts.
 *
 * The cart stores **quantities**, not prices. Every price in a cart
 * response is read live from the variant at request time, so a stale cart
 * can never show or charge a price the catalogue no longer holds.
 */

const cartItemSchema = new Schema(
  {
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    /** The unit price when the item was added. Advisory only. */
    addedUnitPrice: { type: Number, required: true, min: 0 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    /**
     * Set for a signed-in customer's cart.
     *
     * The unique/sparse index for this field is declared on the schema
     * below. It must NOT also be declared with `index: true` here:
     * Mongoose resolves a duplicated index declaration in favour of the
     * plain one, which silently DROPS the `unique` constraint. The result
     * would be two carts for one customer — and a customer whose cart
     * totals disagree with themselves.
     */
    customerId: { type: Schema.Types.ObjectId, ref: 'User' },
    /**
     * Set for a guest cart. See the note on `customerId` — the unique
     * index is declared on the schema, not on the field.
     */
    sessionId: { type: String },
    items: { type: [cartItemSchema], default: [] },
    /** The applied coupon code, uppercased. Validated against the coupon collection. */
    couponCode: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'carts',
  },
);

// One cart per signed-in customer. Sparse, so guest carts (which have no
// customerId) are unaffected by the unique constraint.
cartSchema.index({ customerId: 1 }, { unique: true, sparse: true });
// One cart per guest session.
cartSchema.index({ sessionId: 1 }, { unique: true, sparse: true });
// Supports "delete a guest cart that has not been touched in 30 days".
cartSchema.index({ updatedAt: 1 });

export type CartDocument = InferSchemaType<typeof cartSchema>;
export const CartModel = mongoose.model('Cart', cartSchema);
