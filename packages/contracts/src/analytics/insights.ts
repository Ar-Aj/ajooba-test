import { z } from 'zod';
import { dashboardQuerySchema } from '../admin/types.js';
import {
  type InteractionAction,
  type InteractionDevice,
  type InteractionSurface,
} from './types.js';

/**
 * The interaction report's read model.
 *
 * One shape serves the overview, the product table and the category table,
 * because those are three readings of one dataset. A second shape would
 * eventually disagree with the first, and two screens that disagree about the
 * same number are worse than one screen that is merely incomplete.
 *
 * Everything here is derived by aggregation at request time. There is no
 * rollup collection and no nightly job: an empty event collection produces a
 * report of zeros, which is the truth about a shop nobody has visited yet.
 */

/* -------------------------------------------------------------------------- */
/* Query                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How many products or categories the report returns.
 *
 * Bounded here rather than at the call site so the aggregation can never be
 * asked for an unbounded result. Fifty is enough to fill a ranked table and
 * scroll; a report that needs more is a report that wants an export.
 */
export const insightsQuerySchema = dashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Restrict the report to one category, by slug. */
  categorySlug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
});

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

/**
 * The customer-profile query.
 *
 * The customer id is a Mongo ObjectId in the path, so it is validated as one:
 * an unvalidated id would reach the driver and produce an opaque cast error
 * rather than a clean 404.
 */
export const customerProfileQuerySchema = dashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CustomerProfileQuery = z.infer<typeof customerProfileQuerySchema>;

export const customerIdParamSchema = z.object({
  customerId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid customer id'),
});

/**
 * The product-spectrum list query.
 *
 * `sort` is a closed set rather than a free field name: an arbitrary sort key
 * handed to the aggregation is an injection point, and a sort the API does not
 * know about would silently return rows in an order nobody asked for.
 */
export const productSpectrumQuerySchema = dashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  categorySlug: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  sort: z.enum(['taps', 'views', 'addToCart', 'wishlist', 'rate']).default('taps'),
});

export type ProductSpectrumQuery = z.infer<typeof productSpectrumQuerySchema>;

/** The product drill-down query. */
export const productProfileQuerySchema = dashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export type ProductProfileQuery = z.infer<typeof productProfileQuerySchema>;

export const productIdParamSchema = z.object({
  productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid product id'),
});

/** The customer-spectrum list query. */
export const customerSpectrumQuerySchema = dashboardQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  /*
   * The signal the list is ranked by. All three are *intent*, not volume: a
   * customer who chose a size four times and never bought is a better call than
   * one who scrolled a category. `taps` stays available because it is the honest
   * denominator for everything else.
   */
  sort: z.enum(['taps', 'addToCart', 'wishlist', 'views']).default('taps'),
});

export type CustomerSpectrumQuery = z.infer<typeof customerSpectrumQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Read model                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The window a report covers, in both raw and human terms.
 *
 * `days` alone is ambiguous at a glance ("30 days from when?"), so the server
 * states the resolved boundaries and every screen prints them. A report whose
 * period has to be inferred from a URL is a report that gets misread.
 */
export interface InteractionWindow {
  readonly days: number;
  readonly since: string;
  readonly until: string;
}

/** The headline counts. Every one is derived by the aggregation, never typed. */
export interface InteractionTotals {
  readonly taps: number;
  /** Distinct pseudonymous sessions in the window. */
  readonly visitors: number;
  /** Distinct signed-in customers in the window. Always <= `visitors`. */
  readonly identifiedVisitors: number;
  readonly productViews: number;
  readonly categoryViews: number;
  readonly addToCart: number;
  readonly wishlistAdds: number;
  readonly searches: number;
  /** `order_completed` events — the far end of the funnel. */
  readonly ordersCompleted: number;
}

/** One row of the surface or action breakdown. */
export interface InteractionBucketRow {
  readonly key: string;
  /** A human label. The raw key when the server has no better name. */
  readonly label: string;
  readonly taps: number;
  /** Share of all taps in the window, 0–1. */
  readonly share: number;
}

/** One product's interaction record. */
export interface InteractionProductRow {
  readonly productId: string;
  readonly code: string;
  readonly title: string;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly views: number;
  readonly taps: number;
  readonly addToCart: number;
  readonly wishlistAdds: number;
  /** Distinct sessions that interacted with this product at all. */
  readonly visitors: number;
  /**
   * Added to cart at least once, as a share of the sessions that viewed it.
   *
   * A rate over *sessions*, not over views: a shopper who reloads the page
   * five times is one shopper, and dividing by views would report them as
   * five-fifths of a conversion.
   */
  readonly addToCartRate: number;
}

/** One category's interaction record, rolled up from its products. */
export interface InteractionCategoryRow {
  readonly slug: string;
  readonly name: string;
  readonly views: number;
  readonly taps: number;
  readonly addToCart: number;
  readonly wishlistAdds: number;
  readonly visitors: number;
  /** How many distinct products in this category were touched at all. */
  readonly productsTouched: number;
  /** Share of all taps in the window, 0–1. */
  readonly share: number;
}

/** How the plate was held. */
export interface InteractionDeviceRow {
  readonly device: InteractionDevice;
  readonly sessions: number;
  readonly taps: number;
  readonly share: number;
}

/** One day of the window. Dense: quiet days are rows of zeros, not gaps. */
export interface InteractionTrendPoint {
  readonly date: string;
  readonly taps: number;
  readonly productViews: number;
  readonly addToCart: number;
}

/**
 * The funnel, counted in **sessions** at every step.
 *
 * ## Why this cannot be built from `InteractionTotals`
 *
 * The totals mix units: `visitors` is a count of sessions, while
 * `productViews` and `addToCart` are counts of *events*. Reading one as a
 * drop-off from the other produced a funnel that reported a rise of several
 * hundred percent from "browsed" to "opened a design" and then a collapse into
 * the cart, and neither figure meant anything — a shopper who reads four
 * product pages is still one shopper.
 *
 * So each step here is `$addToSet` on the session id over the events that
 * qualify. That is what makes the drop-offs real, and it also stops one busy
 * session from standing in for a crowd.
 *
 * The steps are *not* a strict cohort: a shopper can add to cart in one visit
 * and open a design in another, so a step is not "the ones who survived". The
 * screen says "sessions that did X" for exactly that reason.
 */
export interface InteractionFunnel {
  /** Distinct sessions with any recorded event at all. */
  readonly browsed: number;
  /** Distinct sessions that opened a product page. */
  readonly viewedDesign: number;
  /** Distinct sessions that added something to the cart. */
  readonly addedToCart: number;
  /** Distinct sessions that started checkout. */
  readonly startedCheckout: number;
  /** Distinct sessions that completed an order. */
  readonly ordered: number;
}

/**
 * The interaction report.
 */
export interface InteractionInsights {
  readonly window: InteractionWindow;
  readonly totals: InteractionTotals;
  readonly funnel: InteractionFunnel;
  readonly surfaces: readonly InteractionBucketRow[];
  readonly actions: readonly InteractionBucketRow[];
  readonly products: readonly InteractionProductRow[];
  readonly categories: readonly InteractionCategoryRow[];
  readonly devices: readonly InteractionDeviceRow[];
  readonly trend: readonly InteractionTrendPoint[];
  readonly topSearchTerms: readonly { readonly term: string; readonly count: number }[];
  readonly generatedAt: string;
}

/**
 * One visitor's profile.
 *
 * `customer` is null when the id no longer resolves — an account can be
 * removed while its anonymous events remain, and the screen must say "a
 * visitor we no longer have an account for" rather than refusing to load.
 */
export interface CustomerInteractionProfile {
  readonly window: InteractionWindow;
  readonly customer: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly phone: string;
    readonly isActive: boolean;
    readonly createdAt: string;
    readonly lastLoginAt: string | null;
  } | null;
  readonly totals: InteractionTotals;
  readonly funnel: InteractionFunnel;
  readonly products: readonly InteractionProductRow[];
  readonly categories: readonly InteractionCategoryRow[];
  readonly surfaces: readonly InteractionBucketRow[];
  readonly actions: readonly InteractionBucketRow[];
  readonly devices: readonly InteractionDeviceRow[];
  readonly trend: readonly InteractionTrendPoint[];
  /**
   * Which design, and which buttons on it.
   *
   * The rolled-up `products` list says what they looked at; this says what they
   * *did* on each one — the colour they tried, the size they picked, the saves.
   * It is the difference between "viewed Mojri 02" and "picked a size on Mojri 02
   * three times and did not add it".
   */
  readonly productActions: readonly InteractionCustomerProductAction[];
  /** The most recent events, newest first. A reading aid, not an export. */
  readonly recent: readonly {
    readonly id: string;
    readonly event: string;
    readonly action: string | null;
    readonly surface: string | null;
    readonly productTitle: string | null;
    readonly categoryName: string | null;
    readonly path: string | null;
    readonly device: InteractionDevice;
    readonly occurredAt: string;
  }[];
  readonly generatedAt: string;
}

/**
 * One row of the visitor list: a signed-in customer with activity.
 *
 * The list is customers, not sessions, because the useful question is "who
 * is looking at the catalogue" and an anonymous session has no one to ring.
 * The session count still arrives, so a screen can say how many visits.
 */
export interface InteractionVisitorRow {
  readonly customerId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly taps: number;
  readonly productViews: number;
  readonly addToCart: number;
  readonly sessions: number;
  readonly lastSeenAt: string;
}

/* -------------------------------------------------------------------------- */
/* The two spectrums                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One row of a button breakdown.
 *
 * The same shape as `InteractionBucketRow`, named separately because it is read
 * at a different level: a bucket row is a whole-shop share, while an action row
 * is "how many times was *this* button pressed on *this* design". Sharing the
 * field names is deliberate — a component can render either.
 */
export interface InteractionActionRow {
  readonly key: string;
  readonly label: string;
  readonly taps: number;
  /** Share of the taps in the block this row belongs to, 0–1. */
  readonly share: number;
}

/**
 * A design, as merchandising sees it.
 *
 * Extends the shared product row with the two things a product *decision* needs
 * and a store-wide table cannot carry: the buttons the design earned, and how
 * many distinct people chose a colour or a size without adding it. A design with
 * ninety colour picks and four adds has a conversion problem; one with ninety
 * views and no colour picks has a photography problem. Same view count, opposite
 * fix.
 */
export interface InteractionProductSpectrumRow extends InteractionProductRow {
  /**
   * Sessions that chose a colour, a size, or both — intent short of the cart.
   *
   * This is the denominator the add rate is missing: `addToCartRate` divides by
   * everyone who *saw* the design, including the ones who never scrolled to the
   * buy box. `intentRate` divides by the ones who actually configured it, which
   * is the figure that tells an operator whether the buy box or the shelf is at
   * fault.
   */
  readonly configuredSessions: number;
  /** `addToCart` divided by `configuredSessions`. 0 when nobody configured it. */
  readonly intentRate: number;
  /** The buttons this design earned, ranked. Taps only — no page views. */
  readonly actions: readonly InteractionActionRow[];
  /** The single most-pressed control, so a list row can name it. */
  readonly topAction: InteractionActionRow | null;
  /** Where the taps on this design landed, by surface. */
  readonly surfaces: readonly InteractionActionRow[];
  /** The most recent tap on this design, for a "still live?" read. */
  readonly lastTappedAt: string | null;
}

/** One customer who engaged with a design, for a merchandising call list. */
export interface InteractionProductCustomerRow {
  readonly customerId: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly taps: number;
  readonly views: number;
  readonly addToCart: number;
  readonly wishlistAdds: number;
  readonly configured: boolean;
  readonly lastSeenAt: string;
}

/**
 * One design, read closely.
 *
 * The product-side counterpart of `CustomerInteractionProfile`. Every block is
 * scoped to this one product, so the numbers reconcile with the row that was
 * clicked through from.
 */
export interface InteractionProductProfile {
  readonly window: InteractionWindow;
  readonly product: {
    readonly id: string;
    readonly code: string;
    readonly title: string;
    readonly categorySlug: string;
    readonly categoryName: string;
    /** The first image URL, when the catalogue still holds one. */
    readonly imageUrl: string | null;
  } | null;
  /** Scoped to this design. `taps` here is the sum of the action rows. */
  readonly totals: InteractionTotals;
  /** Sessions that saw it, configured it, added it, checked out, ordered it. */
  readonly funnel: {
    readonly viewed: number;
    readonly configured: number;
    readonly addedToCart: number;
    readonly startedCheckout: number;
    readonly ordered: number;
  };
  readonly actions: readonly InteractionActionRow[];
  readonly surfaces: readonly InteractionActionRow[];
  /** Distinct sessions per day. */
  readonly trend: readonly { readonly date: string; readonly sessions: number }[];
  readonly customers: readonly InteractionProductCustomerRow[];
  /** Other designs the same sessions touched. Merchandising's cross-sell list. */
  readonly alsoViewed: readonly InteractionProductRow[];
  readonly generatedAt: string;
}

/**
 * One customer, as sales sees them.
 *
 * The customer-side counterpart. The list is ranked by an *intent* signal rather
 * than by traffic, because the question is "who is worth a phone call", and a
 * customer with forty page views and no configuration is browsing while one with
 * four colour picks and no purchase is deciding.
 */
export interface InteractionCustomerSpectrumRow extends InteractionVisitorRow {
  readonly wishlistAdds: number;
  /** How many distinct designs they opened. */
  readonly designsViewed: number;
  /** Sessions in which they chose a colour or a size. */
  readonly configuredSessions: number;
  /** Sessions that reached checkout. */
  readonly checkoutSessions: number;
  /** `addToCart` divided by `designsViewed`, guarded. */
  readonly addRate: number;
  /** The design they spent the most taps on, when there is one. */
  readonly topProduct: { readonly productId: string; readonly title: string } | null;
}

/**
 * One design, from one customer's point of view.
 *
 * "This customer opened *this* design, pressed *these* buttons, this many times,
 * and last looked at it on this date." That sentence is the whole point of the
 * customer spectrum: it is the note a salesperson writes before ringing someone.
 */
export interface InteractionCustomerProductAction {
  readonly productId: string;
  readonly code: string;
  readonly title: string;
  readonly categoryName: string;
  readonly views: number;
  readonly taps: number;
  readonly addToCart: number;
  readonly wishlistAdds: number;
  /** The buttons, per design, for this customer. */
  readonly actions: readonly InteractionActionRow[];
  /** The last event of any kind against this design by this customer. */
  readonly lastSeenAt: string;
}

/* -------------------------------------------------------------------------- */
/* Human labels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The English for a surface key.
 *
 * Kept beside the enum so a new surface cannot be added without a label — the
 * `Record` type makes that a compile error rather than a report row that
 * reads `pdp-buy-box`.
 */
export const SURFACE_LABELS: Readonly<Record<InteractionSurface, string>> = {
  'home-hero': 'Homepage hero',
  'home-rail': 'Homepage rail',
  'home-category-index': 'Homepage categories',
  'home-shelf': 'Homepage specimen shelf (retired)',
  'home-fit': 'Homepage fit guide (retired)',
  'home-finish': 'Homepage finishing strip (retired)',
  header: 'Header',
  footer: 'Footer',
  'catalog-grid': 'Catalogue grid',
  'catalog-toolbar': 'Catalogue toolbar',
  'catalog-filter': 'Catalogue filters',
  'catalog-pagination': 'Catalogue pages',
  'pdp-gallery': 'Product gallery',
  'pdp-buy-box': 'Product buy box',
  'pdp-attributes': 'Product details',
  'pdp-related': 'Product recommendations',
  'search-results': 'Search results',
  cart: 'Cart',
  checkout: 'Checkout',
  account: 'Account',
  other: 'Elsewhere',
};

/** The English for an action key. */
export const ACTION_LABELS: Readonly<Record<InteractionAction, string>> = {
  'select-colour': 'Chose a colour',
  'select-size': 'Chose a size',
  'quantity-increase': 'Raised quantity',
  'quantity-decrease': 'Lowered quantity',
  'add-to-cart': 'Added to cart',
  'remove-from-cart': 'Removed from cart',
  'wishlist-toggle': 'Saved or unsaved',
  'open-filter': 'Opened filters',
  'apply-filter': 'Applied a filter',
  'clear-filter': 'Cleared filters',
  'sort-change': 'Changed the sort',
  'page-next': 'Next page',
  'page-prev': 'Previous page',
  'search-submit': 'Searched',
  'product-open': 'Opened a design',
  'category-open': 'Opened a category',
  'banner-open': 'Opened a banner',
  'nav-open': 'Opened navigation',
  'size-guide-open': 'Opened the size guide',
  /* Retired with the fit instrument; retained so old rows still group. */
  'fit-answer': 'Answered the fit guide (retired)',
  'ask-about-design': 'Asked about a design',
  'checkout-start': 'Started checkout',
  'coupon-apply': 'Applied a coupon',
  'install-app': 'Installed the app',
  other: 'Other',
};

/** The English for a device class. */
export const DEVICE_LABELS: Readonly<Record<InteractionDevice, string>> = {
  mobile: 'Phone',
  tablet: 'Tablet',
  desktop: 'Laptop or desktop',
  unknown: 'Unknown',
};
