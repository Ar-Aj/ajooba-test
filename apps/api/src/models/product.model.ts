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
    /**
     * The public path. For a locally-served image this is the root-relative
     * path under `public/`; for a Cloudinary-hosted image it is the
     * delivery URL.
     */
    url: { type: String, required: true },
    alt: { type: String, required: true },
    position: { type: Number, required: true },
    sourceFile: { type: String, required: true },
    /**
     * The colour this image was verified as belonging to, derived at import time
     * from the filename token joined against the design's own variant tokens.
     * Absent means the image is quarantined: retained, reviewed later, and not
     * shown in any storefront colour gallery.
     */
    colour: { type: String },
    colourToken: { type: String },
    /**
     * Where the image bytes live. `local` = the `public/` tree served by the
     * API's static mount; `cloudinary` = the CDN. The binary is never
     * embedded in this document.
     */
    storage: { type: String, enum: ['local', 'cloudinary'], default: 'local' },
    /** Cloudinary public id. Present only for `storage: 'cloudinary'`. */
    publicId: { type: String },
    /** Cloudinary delivery URL. Present only for `storage: 'cloudinary'`. */
    cloudinaryUrl: { type: String },
    width: { type: Number },
    height: { type: Number },
    bytes: { type: Number },
    /**
     * SHA-256 of the source file. Used to detect a byte-identical duplicate
     * and to skip a re-upload that has already succeeded.
     */
    checksum: { type: String },
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
    /** Catalogue images, ordered. Quarantined images are excluded. */
    images: { type: [imageSchema], default: [] },
    /**
     * Source filenames whose colour could not be verified against a colour this
     * design sells. The files remain on disk and in this list — the review queue
     * — and are deliberately not rendered in any colour gallery.
     */
    quarantinedImages: { type: [String], default: [] },
    /** Lowest MRP across variants. */
    mrp: { type: Number, required: true, min: 0 },
    /** Lowest selling price across variants. */
    sellingPrice: { type: Number, required: true, min: 0 },
    /** True when at least one variant has stock. */
    inStock: { type: Boolean, required: true, default: false, index: true },
    /** Flipkart `Main Image URL` + `Other Image URL 1..6` from the listing templates. */
    marketplaceImageUrls: { type: [String], default: [] },
    /**
     * The source asset folder this design's images came from, recorded
     * verbatim (`Aj-A48` keeps its lower-case `j`). Useful for auditing.
     */
    sourceFolder: { type: String },

    /**
     * Publication lifecycle.
     *
     * Defaults to `published` because every one of the 55 imported designs
     * is already live on the storefront; defaulting to `draft` would take
     * the whole catalogue offline the moment this field was added.
     *
     *  - `published` — visible in the public catalogue.
     *  - `draft`     — admin-only, resolvable by reference, never listed.
     *  - `archived`  — retired. Hidden from the storefront, but orders and
     *                  stock movements still resolve against it.
     *
     * There is no hard delete: designs are referenced by historical orders,
     * the stock ledger and the audit log.
     */
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'published',
      index: true,
    },

    /**
     * Per-design SEO overrides.
     *
     * Optional on purpose: a design without them falls back to the title and
     * description, which is the behaviour the storefront already had.
     */
    seoTitle: { type: String },
    seoDescription: { type: String },
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
// Backs the storefront's "newest arrivals" and the admin catalogue list.
productSchema.index({ createdAt: -1 });

export type ProductDocument = InferSchemaType<typeof productSchema>;
export const ProductModel = mongoose.model('Product', productSchema);
