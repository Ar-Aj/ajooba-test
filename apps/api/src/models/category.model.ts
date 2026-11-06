import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * The canonical category model (G-4).
 *
 * ## Why a collection at all
 *
 * Categories were previously only the denormalised pair
 * `products.subcategory` / `products.subcategorySlug`. That made the set of
 * categories fixed by whatever the workbook happened to contain, with no
 * ordering, no display name, no visibility and no way to edit one.
 *
 * `subcategorySlug` is **kept** on the product as a denormalised read copy
 * rather than being replaced by a reference, for the same reason
 * `productCode` is kept on the variant: it backs a live index
 * (`{ subcategorySlug, inStock }`) and a storefront filter, and a `$lookup`
 * would defeat both. The control that keeps the copy honest is the drift
 * check in `catalog-admin.service.ts`, not a join.
 *
 * ## Hierarchy
 *
 * Two levels are supported (`parentSlug`), which is all the real catalogue
 * needs. A parent may not be its own parent and may not be a descendant of
 * itself — that is enforced at write time by walking the chain.
 */

/** One canonical category. */
const categorySchema = new Schema(
  {
    /** URL segment and identity. Lowercase kebab-case. */
    slug: { type: String, required: true, unique: true, index: true },
    /** Human-facing name. */
    displayName: { type: String, required: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 500 },

    /**
     * Lower renders first; ties break on slug. Managed by the reorder
     * endpoint, which renumbers positions so they stay contiguous.
     */
    position: { type: Number, required: true, default: 0, index: true },

    /** Optional parent slug. Self-referencing by value, not by ObjectId. */
    parentSlug: { type: String, default: null, index: true },

    /** Hidden categories stay in the database and keep their products. */
    isVisible: { type: Boolean, required: true, default: true, index: true },

    /**
     * `retired` is the soft-delete. A retired category is never rendered and
     * is never assignable, but its products keep pointing at it so historical
     * data stays resolvable.
     */
    status: {
      type: String,
      enum: ['active', 'retired'],
      required: true,
      default: 'active',
      index: true,
    },

    seoTitle: { type: String },
    seoDescription: { type: String },

    /**
     * The verbatim workbook `Sub-category` value this category came from,
     * kept for audit: it is what `products.subcategory` holds.
     *
     * Absent for a category an administrator created that has no workbook
     * origin — which is exactly how a new category is distinguished from a
     * seeded one.
     */
    sourceSubcategory: { type: String },
  },
  {
    timestamps: true,
    collection: 'categories',
  },
);

export type CategoryDocument = InferSchemaType<typeof categorySchema>;
export const CategoryModel = mongoose.model('Category', categorySchema);
