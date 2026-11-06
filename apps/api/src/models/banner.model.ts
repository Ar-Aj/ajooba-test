import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Homepage banners and editable content.
 *
 * Banners are the large hero images on the storefront. Their image URL
 * points at a CDN-hosted asset (Cloudinary) once the media pipeline has
 * run; the source photography in `public/banner/` is never served
 * directly in production.
 */
const bannerSchema = new Schema(
  {
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    /** The delivery URL of the banner image. */
    imageUrl: { type: String, required: true },
    /** An optional narrower image for small screens. */
    mobileImageUrl: { type: String, default: null },
    /** Where the banner links to. */
    linkUrl: { type: String, default: '' },
    placement: {
      type: String,
      required: true,
      enum: ['home-hero', 'home-mid', 'home-footer', 'category-top'],
      default: 'home-hero',
      index: true,
    },
    /** The order within a placement. Lower comes first. */
    position: { type: Number, required: true, min: 0, default: 0 },
    isActive: { type: Boolean, required: true, default: true, index: true },
    /** An optional scheduling window. */
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    /** The Cloudinary public id, for deleting the asset later. */
    publicId: { type: String },
  },
  {
    timestamps: true,
    collection: 'banners',
  },
);

// The storefront asks for "the active banners for this placement, in order".
bannerSchema.index({ placement: 1, isActive: 1, position: 1 });

export type BannerDocument = InferSchemaType<typeof bannerSchema>;
export const BannerModel = mongoose.model('Banner', bannerSchema);
