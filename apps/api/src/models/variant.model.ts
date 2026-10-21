import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * A purchasable unit: one design, one colour, one size.
 *
 * Backing columns: `Seller SKU Id`, `Size`, `Colour`, `MRP`,
 * `Your Selling Price` (workbook) and `Stock`, `UK/India Size`,
 * `Euro Size`, `EAN/UPC`, `Article Number` (listing templates).
 */
const variantSchema = new Schema(
  {
    /** `Seller SKU Id` — the merchant's own identifier. */
    sku: { type: String, required: true, unique: true, index: true },
    /** Reference to the owning product document. */
    productId: { type: Schema.Types.ObjectId, required: true, index: true },
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
    /** `Stock` column from the listing templates. */
    stock: { type: Number, required: true, min: 0, default: 0 },
    inStock: { type: Boolean, required: true, default: false, index: true },
    /** `EAN/UPC` — empty across the entire source catalogue. */
    ean: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'variants',
  },
);

variantSchema.index({ productId: 1, colour: 1, size: 1 });

export type VariantDocument = InferSchemaType<typeof variantSchema>;
export const VariantModel = mongoose.model('Variant', variantSchema);
