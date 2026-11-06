import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * First-party activity events.
 *
 * These are the raw events the analytics dashboards are derived from.
 * There is no seeded data here and no pre-computed metrics collection:
 * an empty collection produces an empty dashboard, which is the truth.
 *
 * ## One collection, two kinds of row
 *
 * A page view (product, category, search) and a tap (`interaction`) are the
 * same fact at different resolutions, so they share a collection and an
 * index set. Splitting them would mean every report has to merge two
 * pipelines and two date ranges, and the merge would drift.
 *
 * ## Privacy rules enforced by this schema and the recording service
 *  - no raw IP address is stored (only a coarse, rotating session id);
 *  - no user-agent string is stored (only a coarse device class);
 *  - `customerId` is attached only when the visitor is signed in;
 *  - search terms are truncated and stripped of anything that looks like
 *    contact data;
 *  - a recorded path has its query string removed by the contract schema,
 *    so a search box cannot smuggle a term into the path column.
 *
 * ## Why the category is copied onto the row
 *
 * `categorySlug` / `categoryName` are denormalised at write time rather than
 * resolved by a `$lookup` at read time. A category can be renamed or retired;
 * the report must say what the category was *when the tap happened*. A join
 * would quietly rewrite history every time merchandising edited a label.
 */
const activityEventSchema = new Schema(
  {
    /** The event name. A closed set defined in `@ajooba/contracts`. */
    event: {
      type: String,
      required: true,
      enum: [
        'product_view',
        'category_view',
        'interaction',
        'search',
        'add_to_cart',
        'remove_from_cart',
        'checkout_started',
        'order_completed',
        'order_cancelled',
        'return_requested',
        'wishlist_added',
        'coupon_applied',
      ],
      index: true,
    },
    /** A pseudonymous, rotating per-session identifier. */
    sessionId: { type: String, required: true, index: true },
    /** Present only when the visitor is a known, signed-in customer. */
    customerId: { type: Schema.Types.ObjectId, default: null, index: true },
    productId: { type: Schema.Types.ObjectId, default: null, index: true },
    variantId: { type: Schema.Types.ObjectId, default: null },
    /** The search term, for a `search` event. */
    searchTerm: { type: String, default: '' },
    /** The SKU, for cart and order events. */
    sku: { type: String, default: '' },
    quantity: { type: Number, default: null },
    /** The order, for `order_completed`. */
    orderId: { type: Schema.Types.ObjectId, default: null },
    /** The order total, for `order_completed`. */
    value: { type: Number, default: null },

    /* --- interaction detail ------------------------------------------------ */
    /**
     * Where on the storefront the control was. One of `INTERACTION_SURFACES`.
     *
     * Not an enum in the schema: the contract enum is the authority, and a
     * schema enum would have to be edited in two places for every new
     * surface, during which the two would disagree. The route validates.
     */
    surface: { type: String, default: null },
    /** Which control. One of `INTERACTION_ACTIONS`. */
    action: { type: String, default: null },
    /** The catalogue category in play, copied at write time. */
    categorySlug: { type: String, default: null },
    categoryName: { type: String, default: null },
    /** The storefront path, query string already stripped. */
    path: { type: String, default: null },

    /** A coarse device class. Never a full user-agent string. */
    device: {
      type: String,
      required: true,
      enum: ['mobile', 'tablet', 'desktop', 'unknown'],
      default: 'unknown',
    },
    occurredAt: { type: Date, required: true, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'activity_events',
  },
);

// The funnel query: events of one kind within a window.
activityEventSchema.index({ event: 1, occurredAt: -1 });
// The "top viewed products" query, and every per-product roll-up.
activityEventSchema.index({ event: 1, productId: 1, occurredAt: -1 });
// The "top search terms" query.
activityEventSchema.index({ event: 1, searchTerm: 1, occurredAt: -1 });
// The per-customer activity history.
activityEventSchema.index({ customerId: 1, occurredAt: -1 });
// The per-category roll-up, which groups by a denormalised slug.
activityEventSchema.index({ categorySlug: 1, occurredAt: -1 });
// The surface and action breakdowns.
activityEventSchema.index({ surface: 1, occurredAt: -1 });
/*
 * The action breakdown. A tap is now defined by having an `action` rather than
 * by being a generic `interaction` event, so this is the index the busiest
 * pillar of the report actually uses.
 */
activityEventSchema.index({ action: 1, occurredAt: -1 });
// The visitor list: distinct customers with activity, newest first.
activityEventSchema.index({ customerId: 1, event: 1, occurredAt: -1 });
// Counting distinct sessions per group — the denominator of every rate.
activityEventSchema.index({ occurredAt: -1, sessionId: 1 });

export type ActivityEventDocument = InferSchemaType<typeof activityEventSchema>;
export const ActivityEventModel = mongoose.model('ActivityEvent', activityEventSchema);
