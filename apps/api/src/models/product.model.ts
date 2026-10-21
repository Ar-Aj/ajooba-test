import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Mongoose models.
 *
 * The schema below mirrors the *real* structure of the source catalogue
 * workbook and the Flipkart listing templates. Fields that do not exist in
 * the source data are intentionally absent — no speculative schema fields.
 *
 * Source paths: the catalogue workbook lives at "public/products/products data.xlsx";
 * one Flipkart listing template sits in each "public/products/AJ-A<NN>/*.xls"
 * folder. See docs/catalog-audit.md and docs/DATA_MODEL.md.
 */

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    alt: { type: String, required: true },
    position: { type: Number, required: true },
    sourceFile: { type: String, required: true },
  },
  { _id: false },
);

/**
 * A product design. One document per `A<NN>` code (55 designs in the
 * real catalogue).
 */
const productSchema = new Schema(
  {
    /** The `A<NN>` design code parsed from the Seller SKU Id. */
    code: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, index: true },
    /** `Product Title` column. */
    title: { type: String, required: true },
    /** `Description` column. */
    description: { type: String, required: true },
    /** `Sub-category` column, verbatim. */
    subcategory: { type: String, required: true, index: true },
    /** Normalised sub-category slug for routing. */
    subcategorySlug: { type: String, required: true, index: true },
    brand: { type: String, required: true, default: 'Ajooba Footwear' },
    /** Distinct `Colour` values across this design's variants. */
    colours: { type: [String], required: true, default: [] },
    /** Catalogue images, ordered. */
    images: { type: [imageSchema], default: [] },
    /** Lowest MRP across variants. */
    mrp: { type: Number, required: true, min: 0 },
    /** Lowest selling price across variants. */
    sellingPrice: { type: Number, required: true, min: 0 },
    /** True when at least one variant has stock. */
    inStock: { type: Boolean, required: true, default: false, index: true },
    /** Flipkart `Main Image URL` + `Other Image URL 1..6` from the listing templates. */
    marketplaceImageUrls: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'products',
  },
);

// Supports the storefront's text search and filter combination.
productSchema.index({ title: 'text', description: 'text' });
productSchema.index({ subcategorySlug: 1, inStock: 1 });
productSchema.index({ sellingPrice: 1 });

export type ProductDocument = InferSchemaType<typeof productSchema>;
export const ProductModel = mongoose.model('Product', productSchema);
