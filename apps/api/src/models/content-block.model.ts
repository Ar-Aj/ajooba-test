import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Editable storefront content.
 *
 * A named, editable block of copy. The storefront looks the block up by
 * `key`; the business edits `value` from the admin panel. This keeps
 * marketing copy out of the component tree without requiring a deployment
 * to change a headline.
 *
 * The document is a singleton per key — `key` is unique.
 */
const contentBlockSchema = new Schema(
  {
    /** The stable identifier the storefront looks up, e.g. `home.hero.title`. */
    key: { type: String, required: true, unique: true, trim: true, index: true },
    /** The editable text. */
    value: { type: String, required: true, default: '' },
    /** What this block is for, shown in the admin panel. */
    description: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'content_blocks',
  },
);

export type ContentBlockDocument = InferSchemaType<typeof contentBlockSchema>;
export const ContentBlockModel = mongoose.model('ContentBlock', contentBlockSchema);
