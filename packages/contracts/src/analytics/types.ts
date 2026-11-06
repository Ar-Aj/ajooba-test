import type { ACTIVITY_EVENTS } from '../admin/types.js';

/**
 * First-party analytics contracts.
 *
 * The platform records its own activity events rather than relying on a
 * third-party tracker. Two rules govern this package:
 *
 *  1. **Nothing is fabricated.** There is no seeded event collection and no
 *     pre-computed metrics document. A dashboard on an empty database shows
 *     zeros, and that is the truth.
 *  2. **Privacy-aware.** An event carries a pseudonymous session id and an
 *     optional customer id — never a raw IP address, never a full user
 *     agent, never anything that identifies a person directly. The customer
 *     id is only attached once the visitor is known to be signed in.
 */

/* -------------------------------------------------------------------------- */
/* The interaction vocabulary                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where on the storefront a control was touched.
 *
 * The surface is what makes a tap readable years later. `add-to-cart` on its
 * own says a pair was added; `add-to-cart · pdp-buy-box` says it was added
 * from the product page, which is the fact that decides whether the buy box
 * is doing its job. Surfaces are coarse and stable on purpose: a surface that
 * changes every redesign produces a report full of dead ends.
 */
export const INTERACTION_SURFACES = [
  'home-hero',
  'home-rail',
  'home-category-index',
  /*
   * Retired, kept for the historical record.
   *
   * These three named the hand-built argument sections that used to sit below the
   * banner. Those sections have been removed from the homepage, so nothing emits
   * these surfaces any more — but events already recorded under them are still in
   * the ledger, and dropping the vocabulary would make those rows ungroupable.
   * A report is a description of what happened, not a description of the current
   * page.
   */
  'home-shelf',
  'home-fit',
  'home-finish',
  'header',
  'footer',
  'catalog-grid',
  'catalog-toolbar',
  'catalog-filter',
  'catalog-pagination',
  'pdp-gallery',
  'pdp-buy-box',
  'pdp-attributes',
  'pdp-related',
  'search-results',
  'cart',
  'checkout',
  'account',
  'other',
] as const;
export type InteractionSurface = (typeof INTERACTION_SURFACES)[number];

/**
 * The control that was touched.
 *
 * Deliberately a closed list of controls that actually exist in the shop.
 * A free-text action name would drift within a week (`add_to_cart`,
 * `addToCart`, `add-cart`), and a report whose rows do not group is worse
 * than no report. Adding a control means adding a member here, which is a
 * compile error at the call site until it is wired — the drift is caught
 * rather than discovered later.
 *
 * Note what is absent: page views. Those are their own events
 * (`product_view`, `category_view`), because they are not taps and are not
 * blocked by a control that happens to be absent.
 */
export const INTERACTION_ACTIONS = [
  'select-colour',
  'select-size',
  'quantity-increase',
  'quantity-decrease',
  'add-to-cart',
  'remove-from-cart',
  'wishlist-toggle',
  'open-filter',
  'apply-filter',
  'clear-filter',
  'sort-change',
  'page-next',
  'page-prev',
  'search-submit',
  'product-open',
  'category-open',
  'banner-open',
  'nav-open',
  'size-guide-open',
  /*
   * Retired with the homepage fit instrument. Kept so historical rows group.
   */
  'fit-answer',
  'ask-about-design',
  'checkout-start',
  'coupon-apply',
  'install-app',
  'other',
] as const;
export type InteractionAction = (typeof INTERACTION_ACTIONS)[number];

/**
 * The device classes an event may carry.
 *
 * Coarse by design: a device *class* answers "is the phone layout being
 * used?", which is a real design question. A model number answers nothing
 * that justifies storing it.
 */
export const INTERACTION_DEVICES = ['mobile', 'tablet', 'desktop', 'unknown'] as const;
export type InteractionDevice = (typeof INTERACTION_DEVICES)[number];

/* -------------------------------------------------------------------------- */
/* A recorded event                                                           */
/* -------------------------------------------------------------------------- */

/** A recorded activity event. */
export interface ActivityEventRecord {
  readonly id: string;
  readonly event: (typeof ACTIVITY_EVENTS)[number];
  /** Pseudonymous, per-session, rotating identifier. */
  readonly sessionId: string;
  /** Present only when the visitor is a known, signed-in customer. */
  readonly customerId: string | null;
  /** The product the event relates to, when it relates to one. */
  readonly productId: string | null;
  readonly variantId: string | null;
  /** The search term for a `search` event. */
  readonly searchTerm: string | null;
  /** The SKU for `add_to_cart` / `order_completed`. */
  readonly sku: string | null;
  readonly quantity: number | null;
  /** The order, for `order_completed`. */
  readonly orderId: string | null;
  /** The order total, for `order_completed`. */
  readonly value: number | null;
  /** Coarse device class, never a full user agent string. */
  readonly device: InteractionDevice;
  /**
   * Where the interaction happened. Present on taps.
   *
   * Denormalised rather than joined: a product's category can be renamed or
   * retired, and the report must say what the category was *at the moment of
   * the tap*, not what it is now.
   */
  readonly surface: string | null;
  readonly action: string | null;
  /** The catalogue category in play, denormalised at record time. */
  readonly categorySlug: string | null;
  readonly categoryName: string | null;
  /** The storefront path the event happened on. Query string stripped. */
  readonly path: string | null;
  readonly occurredAt: string;
}
