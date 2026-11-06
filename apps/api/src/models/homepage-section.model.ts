import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Homepage merchandising sections.
 *
 * A section is a **reference**, never a copy. It stores ids of products,
 * categories and banners that already exist in their own collections; the
 * storefront resolves them through the catalogue service at render time.
 * That is what keeps merchandising from drifting out of sync with the
 * catalogue, and why adding a product to a section is an id append.
 *
 * The per-type configuration is validated by the Zod contract
 * (`homepageSectionSchema`) *before* it reaches this model, so the `config`
 * subdocument is stored as a mixed object: its shape depends on `type`, and
 * duplicating eight schemas in Mongoose would only create a second source of
 * truth that could disagree with the contract.
 */
const homepageSectionSchema = new Schema(
  {
    /**
     * The section kind. Must be one of the `HOMEPAGE_SECTION_TYPES` in the
     * contracts package; the service enforces that on write.
     */
    type: { type: String, required: true, index: true },
    /** Lower comes first. */
    position: { type: Number, required: true, min: 0, default: 0, index: true },
    isVisible: { type: Boolean, required: true, default: true, index: true },
    /** Optional scheduling window for the section itself. */
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    /** The type-specific configuration, already validated by Zod. */
    config: { type: Schema.Types.Mixed, required: true },
    /** The admin who last saved this section, for the audit trail. */
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,
    collection: 'homepage_sections',
  },
);

/** The storefront's query: visible sections for a placement, in order. */
homepageSectionSchema.index({ isVisible: 1, position: 1 });

export type HomepageSectionDocument = InferSchemaType<typeof homepageSectionSchema>;
export const HomepageSectionModel = mongoose.model('HomepageSection', homepageSectionSchema);
