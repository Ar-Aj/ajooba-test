import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Image review decisions (G-5).
 *
 * ## Why this collection is needed
 *
 * `products.images[].colour` records what the *automated* rule concluded, and
 * `products.quarantinedImages` lists filenames whose colour could not be
 * established. Neither can express "a human looked at this and decided X".
 *
 * Without a separate record there is nowhere to store who approved a mapping,
 * when, and why — and re-running the importer would recompute the automated
 * answer and silently discard the human one.
 *
 * ## The identifier
 *
 * Images are keyed by `imageId`, which is `<designCode>:<sourceFile>`. The
 * gap analysis named the bare filename as the reason a review API could not
 * exist: filenames are not unique across designs and are not safe in a URL.
 * Combining the design code with the exact asset filename gives an id that
 * is stable (the importer never renames an asset), unique per design, and
 * safe to pass as a path segment.
 *
 * `checksum` is recorded alongside so that if the *same bytes* ever turn up
 * under a different filename, the two can be recognised as one photograph
 * and the duplicate can be blocked from a second colour gallery.
 */

/** One human decision about one source image. */
const imageReviewSchema = new Schema(
  {
    /** `<designCode>:<sourceFile>`. Unique across the collection. */
    imageId: { type: String, required: true, unique: true, index: true },

    /** The design this image belongs to. */
    designCode: { type: String, required: true, index: true },
    productId: { type: Schema.Types.ObjectId, required: true, index: true },

    /** The asset filename exactly as it exists in the source tree. */
    sourceFile: { type: String, required: true },

    /** The administrator's decision. */
    status: {
      type: String,
      enum: ['pending', 'assigned', 'rejected'],
      required: true,
      default: 'pending',
      index: true,
    },

    /** The colour a human assigned. Present only when `status: 'assigned'`. */
    assignedColour: { type: String },
    assignedColourToken: { type: String },

    /**
     * Why the automated rule did not assign this image.
     * `untokened` | `token-not-sold` | `unparsable` | null when the
     * automated rule had already assigned it.
     */
    autoReason: { type: String, enum: ['untokened', 'token-not-sold', 'unparsable'] },

    /** The colour the automated rule proposed, when it proposed one. */
    proposedColour: { type: String },
    proposedColourToken: { type: String },

    /**
     * The administrator's justification. Mandatory on every decision —
     * an unexplained override is how a wrong-colour photograph reaches a
     * product page.
     */
    reviewReason: { type: String },

    /** Who made the decision. */
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    reviewedByEmail: { type: String },
    reviewedAt: { type: Date },

    /** Content hash of the source file, when known. */
    checksum: { type: String, index: true },

    /** The URL the image is served from. */
    url: { type: String },
  },
  {
    timestamps: true,
    collection: 'image_reviews',
  },
);

imageReviewSchema.index({ designCode: 1, status: 1 });
// Guards against the same bytes being assigned to two different galleries.
imageReviewSchema.index({ checksum: 1, assignedColour: 1 });

export type ImageReviewDocument = InferSchemaType<typeof imageReviewSchema>;
export const ImageReviewModel = mongoose.model('ImageReview', imageReviewSchema);
