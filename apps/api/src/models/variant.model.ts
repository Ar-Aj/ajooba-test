import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * A purchasable unit: one design, one colour, one size.
 *
 * Backing columns: `Seller SKU Id`, `Size`, `Colour`, `MRP`,
 * `Your Selling Price` (workbook) and `Stock`, `UK/India Size`,
 * `Euro Size`, `EAN/UPC`, `Article Number` (listing templates).
 *
 * A variant owns its own SKU, size, stock and availability. Nothing about
 * "can this be bought" is derived from the product — it is enforced here
 * and on the server at checkout.
 */
const variantSchema = new Schema(
  {
    /** `Seller SKU Id` — the merchant's own identifier. */
    sku: { type: String, required: true, unique: true, index: true },
    /** Reference to the owning product document. */
    productId: { type: Schema.Types.ObjectId, required: true, index: true },
    /**
     * Denormalised `A<NN>` design code. Kept on the variant so stock and
     * order queries never need to join the product collection.
     */
    productCode: { type: String, required: true, index: true },
    /** `Article Number` / `Group ID` from the listing templates. */
    articleNumber: { type: String, required: true, index: true },
    /** `Size` column — UK/India size. */
    size: { type: Number, required: true, min: 1, max: 60 },
    /** `UK/India Size` column from the listing templates. */
    ukIndiaSize: { type: Number, min: 1, max: 60 },
    /** `Euro Size` column from the listing templates. */
    euroSize: { type: Number, min: 1, max: 60 },
    /** `Colour` column, verbatim. */
    colour: { type: String, required: true, index: true },
    /** Colour token from the Seller SKU Id. */
    colourToken: { type: String, required: true, index: true },
    /** `MRP` column. */
    mrp: { type: Number, required: true, min: 0 },
    /** `Your Selling Price` column. */
    sellingPrice: { type: Number, required: true, min: 0 },
    /** Derived from MRP and selling price. */
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    /**
     * Available units.
     *
     * Seeded at 0 by the importer: the listing templates are a marketplace
     * export, not a warehouse ledger (decision C-3). Only an authorised
     * stock source or an admin action raises it.
     */
    stock: { type: Number, required: true, min: 0, default: 0 },
    inStock: { type: Boolean, required: true, default: false, index: true },
    /**
     * Units reserved by carts that are mid-checkout but not yet ordered.
     * Tracked separately from `stock` so a pending checkout cannot
     * oversell a variant.
     */
    reservedStock: { type: Number, required: true, min: 0, default: 0 },
    /** Exchange reservations stay attached to the SKU so release/commit is idempotent. */
    exchangeReservations: { type: [String], required: true, default: [] },
    /** `EAN/UPC` — empty across the entire source catalogue. */
    ean: { type: String, default: '' },
    /**
     * Whether this colourway has verified photography.
     *
     * `verified` — at least one image was confirmed to belong to this colour.
     * `pending-review` — the design sells this colour but no image could be
     *   verified for it (missing, untokened, or tokenised as a colour the
     *   design does not sell).
     *
     * A `pending-review` variant can never be sold, whatever its stock says: the
     * storefront gallery would have nothing truthful to show, so listing it
     * would mean shipping a colour the customer never saw. The read layer
     * enforces this; this field is the record of why.
     */
    photographyStatus: {
      type: String,
      enum: ['verified', 'pending-review'],
      default: 'verified',
      index: true,
    },
    /**
     * The product title for this exact colour, when the workbook carries a
     * colour-keyed title. The design-level title lives on the product.
     */
    variantTitle: { type: String },
    /** The image that represents this variant, if one was resolved. */
    imageUrl: { type: String },
  },
  {
    timestamps: true,
    collection: 'variants',
  },
);

variantSchema.index({ productId: 1, colour: 1, size: 1 });
// Backs "which sizes are available for this product" and the storefront
// size filter without a collection scan.
variantSchema.index({ productId: 1, size: 1, inStock: 1 });
// Backs the admin inventory list and low-stock reporting.
variantSchema.index({ productCode: 1, inStock: 1 });

export type VariantDocument = InferSchemaType<typeof variantSchema>;
export const VariantModel = mongoose.model('Variant', variantSchema);
