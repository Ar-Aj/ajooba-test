import { Types } from 'mongoose';
import {
  ACTION_LABELS,
  DEVICE_LABELS,
  SURFACE_LABELS,
  type CustomerInteractionProfile,
  type InteractionBucketRow,
  type InteractionCategoryRow,
  type InteractionDeviceRow,
  type InteractionDevice,
  type InteractionFunnel,
  type InteractionInsights,
  type InteractionProductRow,
  type InteractionTotals,
  type InteractionTrendPoint,
  type InteractionVisitorRow,
  type InteractionWindow,
} from '@ajooba/contracts';
import { ActivityEventModel } from '../models/activity-event.model.js';
import { CategoryModel } from '../models/category.model.js';
import { ProductModel } from '../models/product.model.js';
import { UserModel } from '../models/user.model.js';
import { customerProductActions } from './interaction-spectrum.service.js';

/**
 * Interaction insights.
 *
 * ## Derived, always
 *
 * Every number here is aggregated from `activity_events` at request time.
 * There is no rollup collection and no nightly job, for the same reason the
 * dashboard has none: a rollup is a second copy of the truth, and the moment
 * the two disagree nobody can say which is right. The cost is that a report
 * over a very large window is slower than reading a summary. The benefit is
 * that a report can never be stale, and that a shop with no visitors shows a
 * report full of honest zeros.
 *
 * ## One pass per question, not one pass per screen
 *
 * Each grouping below is a separate pipeline because each answers a
 * different question. They run concurrently, so the wall-clock cost is one
 * round trip rather than seven.
 *
 * ## Distinct visitors are counted per group, not summed
 *
 * `$addToSet` on the session id gives a group its true visitor count. Adding
 * up per-product visitor counts would count one shopper who looked at four
 * products as four shoppers — the single most common way a product report
 * lies, and the reason the product table's totals do not add up to the
 * headline.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window, resolved to concrete boundaries.
 *
 * `until` is "now" and `since` is exactly `days` before it, so a report read
 * twice in the same minute reports the same boundaries.
 */
function resolveWindow(days: number): InteractionWindow {
  const until = new Date();
  const since = new Date(until.getTime() - days * DAY_MS);
  return { days, since: since.toISOString(), until: until.toISOString() };
}

/** `YYYY-MM-DD`, in UTC, matching the dashboard's day keys. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Every day in the window, oldest first. Dense, so a chart cannot lie. */
function denseTrend(
  rows: ReadonlyMap<string, InteractionTrendPoint>,
  days: number,
): InteractionTrendPoint[] {
  const out: InteractionTrendPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(Date.now() - offset * DAY_MS));
    out.push(rows.get(key) ?? { date: key, taps: 0, productViews: 0, addToCart: 0 });
  }
  return out;
}

/** The share of a total, guarded against a zero denominator. */
function share(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}

/**
 * The totals pipeline.
 *
 * One `$group` over the whole window, with conditional sums for each event
 * kind. Doing it in one pass means the eight figures are computed from
 * exactly the same document set — eight separate counts could straddle a
 * write and describe two different moments.
 *
 * ## What counts as a tap
 *
 * Any event that carries an `action` — which is every event a control produced,
 * whether it was recorded as a generic `interaction`, as an `add_to_cart`, or as
 * a `wishlist_added`. Counting only the generic ones was the bug this fixes: the
 * single most important tap in the shop, the one on the add-to-cart button, is
 * recorded under its own event name and was therefore invisible to every "taps"
 * figure and every share computed from it.
 *
 * `$ifNull` rather than `$ne: null`, because a missing field and a null field
 * have to behave the same here and `$ifNull` is the operator that says so.
 */
async function totalsFor(match: Record<string, unknown>): Promise<InteractionTotals> {
  const [row] = await ActivityEventModel.aggregate<{
    taps: number;
    productViews: number;
    categoryViews: number;
    addToCart: number;
    wishlistAdds: number;
    searches: number;
    ordersCompleted: number;
    sessions: unknown[];
    customers: unknown[];
  }>([
    { $match: match },
    {
      $group: {
        _id: null,
        taps: { $sum: { $cond: [{ $ifNull: ['$action', false] }, 1, 0] } },
        productViews: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        categoryViews: { $sum: { $cond: [{ $eq: ['$event', 'category_view'] }, 1, 0] } },
        addToCart: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              1,
              0,
            ],
          },
        },
        wishlistAdds: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$event', 'wishlist_added'] },
                  { $eq: ['$action', 'wishlist-toggle'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        searches: { $sum: { $cond: [{ $eq: ['$event', 'search'] }, 1, 0] } },
        ordersCompleted: { $sum: { $cond: [{ $eq: ['$event', 'order_completed'] }, 1, 0] } },
        sessions: { $addToSet: '$sessionId' },
        customers: { $addToSet: '$customerId' },
      },
    },
  ]);

  if (!row) {
    return {
      taps: 0,
      visitors: 0,
      identifiedVisitors: 0,
      productViews: 0,
      categoryViews: 0,
      addToCart: 0,
      wishlistAdds: 0,
      searches: 0,
      ordersCompleted: 0,
    };
  }

  return {
    taps: row.taps,
    visitors: row.sessions.length,
    // `$addToSet` on a null field produces a null member; a signed-out
    // visitor is not an identified one, so it does not count.
    identifiedVisitors: row.customers.filter((id) => id !== null).length,
    productViews: row.productViews,
    categoryViews: row.categoryViews,
    addToCart: row.addToCart,
    wishlistAdds: row.wishlistAdds,
    searches: row.searches,
    ordersCompleted: row.ordersCompleted,
  };
}

/** The trend pipeline: one row per day that has events, densified by the caller. */
async function trendFor(match: Record<string, unknown>): Promise<InteractionTrendPoint[]> {
  const rows = await ActivityEventModel.aggregate<InteractionTrendPoint>([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
        taps: { $sum: { $cond: [{ $ifNull: ['$action', false] }, 1, 0] } },
        productViews: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        addToCart: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows;
}

/**
 * The funnel, counted in sessions.
 *
 * One `$group` over the window with a conditional `$addToSet` per step, so the
 * five figures come from the same document set. Counting events instead — which
 * is what reading `totals.productViews` next to `totals.visitors` amounts to —
 * produced a funnel whose later steps exceeded its earlier ones and whose
 * percentages were therefore nonsense.
 *
 * The same "what counts as an add" rule the totals use is repeated here: the
 * dedicated `add_to_cart` event *or* an `add-to-cart` action. Anywhere those two
 * definitions drift apart, the headline and the funnel start disagreeing.
 */
async function funnelFor(match: Record<string, unknown>): Promise<InteractionFunnel> {
  const [row] = await ActivityEventModel.aggregate<{
    browsed: unknown[];
    viewedDesign: unknown[];
    addedToCart: unknown[];
    startedCheckout: unknown[];
    ordered: unknown[];
  }>([
    { $match: match },
    {
      $group: {
        _id: null,
        browsed: { $addToSet: '$sessionId' },
        viewedDesign: {
          $addToSet: {
            $cond: [{ $eq: ['$event', 'product_view'] }, '$sessionId', '$$REMOVE'],
          },
        },
        addedToCart: {
          $addToSet: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              '$sessionId',
              '$$REMOVE',
            ],
          },
        },
        startedCheckout: {
          $addToSet: {
            $cond: [
              {
                $or: [
                  { $eq: ['$event', 'checkout_started'] },
                  { $eq: ['$action', 'checkout-start'] },
                ],
              },
              '$sessionId',
              '$$REMOVE',
            ],
          },
        },
        ordered: {
          $addToSet: {
            $cond: [{ $eq: ['$event', 'order_completed'] }, '$sessionId', '$$REMOVE'],
          },
        },
      },
    },
  ]);

  if (!row) {
    return { browsed: 0, viewedDesign: 0, addedToCart: 0, startedCheckout: 0, ordered: 0 };
  }

  return {
    browsed: row.browsed.length,
    viewedDesign: row.viewedDesign.length,
    addedToCart: row.addedToCart.length,
    startedCheckout: row.startedCheckout.length,
    ordered: row.ordered.length,
  };
}

/**
 * A breakdown by one field, with labels resolved from the contracts.
 *
 * `field` is a literal chosen by this module, never a caller's string, so it
 * cannot become an injection point. The label map is passed in rather than
 * guessed, because a report row reading `pdp-buy-box` is not a report.
 *
 * ## Why a tap is required here, not just a non-null field
 *
 * A page view carries a `surface` too — the grid a product was opened from is
 * genuinely useful context — so grouping on `surface: { $ne: null }` counted
 * every view as a tap on that surface. The breakdown then overstated itself and
 * its shares summed past 1. A surface row answers "where were controls
 * touched", so the row must carry an `action`; that is the same definition of a
 * tap the totals use, and using anything else here would let the parts disagree
 * with the whole.
 */
async function bucketFor(
  match: Record<string, unknown>,
  field: 'surface' | 'action',
  labels: Readonly<Record<string, string>>,
  total: number,
): Promise<InteractionBucketRow[]> {
  /*
   * `action: { $ne: null }` rather than `event: 'interaction'`. A tap on the
   * add-to-cart button is stored as an `add_to_cart` event with an `action`, and
   * filtering on the generic event name would drop the most interesting row from
   * both breakdowns — the action list would have no "Added to cart" in it at
   * all, which is exactly the line an operator is looking for.
   */
  const rows = await ActivityEventModel.aggregate<{ _id: string; taps: number }>([
    { $match: { ...match, action: { $ne: null }, [field]: { $ne: null } } },
    { $group: { _id: `$${field}`, taps: { $sum: 1 } } },
    { $sort: { taps: -1 } },
  ]);

  return rows.map((row) => ({
    key: row._id,
    label: labels[row._id] ?? row._id,
    taps: row.taps,
    share: share(row.taps, total),
  }));
}

/**
 * How the plate was held.
 *
 * Counted over *sessions*, not events: three taps on a phone is still one
 * phone, and a device row reporting three "phones" would overstate the mobile
 * share by exactly the number of controls the screen has.
 */
async function devicesFor(match: Record<string, unknown>): Promise<InteractionDeviceRow[]> {
  const rows = await ActivityEventModel.aggregate<{
    _id: InteractionDevice;
    sessions: unknown[];
    taps: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: '$device',
        sessions: { $addToSet: '$sessionId' },
        taps: { $sum: { $cond: [{ $ifNull: ['$action', false] }, 1, 0] } },
      },
    },
    { $sort: { taps: -1 } },
  ]);

  const sessionsTotal = rows.reduce((sum, row) => sum + row.sessions.length, 0);

  return rows.map((row) => ({
    device: row._id,
    sessions: row.sessions.length,
    taps: row.taps,
    share: share(row.sessions.length, sessionsTotal),
  }));
}

/**
 * The per-product roll-up.
 *
 * The one pipeline both the report's product table and a visitor's profile
 * share, so a product can never read differently depending on who is looking
 * at it. `productId` may be null for a category tap; those rows are dropped
 * because a product table has nothing to say about them.
 */
async function productRowsFor(
  match: Record<string, unknown>,
  limit: number,
): Promise<InteractionProductRow[]> {
  const rows = await ActivityEventModel.aggregate<{
    _id: Types.ObjectId;
    views: number;
    taps: number;
    addToCart: number;
    wishlistAdds: number;
    categorySlug: string | null;
    categoryName: string | null;
    viewers: unknown[];
    carters: unknown[];
  }>([
    { $match: { ...match, productId: { $ne: null } } },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$productId',
        views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        taps: { $sum: { $cond: [{ $ifNull: ['$action', false] }, 1, 0] } },
        addToCart: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              1,
              0,
            ],
          },
        },
        wishlistAdds: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$event', 'wishlist_added'] },
                  { $eq: ['$action', 'wishlist-toggle'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        // The category is copied at write time; `$first` after a descending
        // sort gives the most recent one, which is the row a human would
        // have seen on the product page that produced the tap.
        categorySlug: { $first: '$categorySlug' },
        categoryName: { $first: '$categoryName' },
        viewers: { $addToSet: '$sessionId' },
        carters: {
          $addToSet: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              '$sessionId',
              '$$REMOVE',
            ],
          },
        },
      },
    },
    { $sort: { views: -1, taps: -1 } },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  /*
   * Resolve the catalogued products in one query. A product that has been
   * hard-deleted leaves its events behind (the platform has no cascade
   * delete for analytics), so a missing product is rendered from what the
   * event remembered rather than dropped from the table — losing the row
   * would silently deflate a category's total.
   */
  const products = await ProductModel.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('code title subcategory subcategorySlug')
    .lean<
      Array<{
        _id: Types.ObjectId;
        code: string;
        title: string;
        subcategory: string;
        subcategorySlug: string;
      }>
    >();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  return rows.map((row) => {
    const product = byId.get(row._id.toString());
    const viewers = row.viewers.length;
    // `carters` contains at most one null (from sessions that never added),
    // so the true count filters it out rather than counting the placeholder.
    const carters = row.carters.filter((id) => id !== null && id !== undefined).length;
    return {
      productId: row._id.toString(),
      code: product?.code ?? '',
      title: product?.title ?? 'A design no longer in the catalogue',
      categorySlug: product?.subcategorySlug ?? row.categorySlug ?? '',
      categoryName: product?.subcategory ?? row.categoryName ?? 'Uncatalogued',
      views: row.views,
      taps: row.taps,
      addToCart: row.addToCart,
      wishlistAdds: row.wishlistAdds,
      visitors: viewers,
      addToCartRate: viewers === 0 ? 0 : carters / viewers,
    };
  });
}

/**
 * The per-category roll-up.
 *
 * Grouped on the slug copied at write time, then named from the live
 * category collection when it still exists. A retired category keeps its
 * events and its historical name, which is why the event's own copy is the
 * fallback rather than the primary.
 */
async function categoryRowsFor(
  match: Record<string, unknown>,
  limit: number,
): Promise<InteractionCategoryRow[]> {
  const rows = await ActivityEventModel.aggregate<{
    _id: string;
    views: number;
    taps: number;
    addToCart: number;
    wishlistAdds: number;
    sessions: unknown[];
    products: unknown[];
    categoryName: string | null;
  }>([
    { $match: { ...match, categorySlug: { $ne: null } } },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$categorySlug',
        views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        taps: { $sum: { $cond: [{ $ifNull: ['$action', false] }, 1, 0] } },
        addToCart: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              1,
              0,
            ],
          },
        },
        wishlistAdds: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$event', 'wishlist_added'] },
                  { $eq: ['$action', 'wishlist-toggle'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        sessions: { $addToSet: '$sessionId' },
        products: { $addToSet: '$productId' },
        categoryName: { $first: '$categoryName' },
      },
    },
    { $sort: { taps: -1, views: -1 } },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  const categories = await CategoryModel.find({ slug: { $in: rows.map((row) => row._id) } })
    .select('slug displayName')
    .lean<Array<{ slug: string; displayName: string }>>();
  const bySlug = new Map(categories.map((category) => [category.slug, category.displayName]));

  const totalTaps = rows.reduce((sum, row) => sum + row.taps, 0);

  return rows.map((row) => ({
    slug: row._id,
    name: bySlug.get(row._id) ?? row.categoryName ?? row._id,
    views: row.views,
    taps: row.taps,
    addToCart: row.addToCart,
    wishlistAdds: row.wishlistAdds,
    visitors: row.sessions.length,
    productsTouched: row.products.filter((id) => id !== null && id !== undefined).length,
    share: share(row.taps, totalTaps),
  }));
}

/** The top search terms. Kept here so it shares the window's match clause. */
async function topSearchTermsFor(
  match: Record<string, unknown>,
  limit: number,
): Promise<Array<{ term: string; count: number }>> {
  const rows = await ActivityEventModel.aggregate<{ _id: string; count: number }>([
    { $match: { ...match, event: 'search', searchTerm: { $ne: '' } } },
    { $group: { _id: '$searchTerm', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({ term: row._id, count: row.count }));
}

/* -------------------------------------------------------------------------- */
/* The public reads                                                           */
/* -------------------------------------------------------------------------- */

export interface InsightsOptions {
  readonly days: number;
  readonly limit?: number;
  readonly categorySlug?: string;
}

/**
 * The full interaction report.
 *
 * `categorySlug` narrows every block together, not just the product table: a
 * report scoped to `mojris` that still showed storewide surface shares would
 * be two reports on one screen, and the reader would have no way to tell
 * which rows were scoped and which were not.
 */
export async function getInteractionInsights(
  options: InsightsOptions,
): Promise<InteractionInsights> {
  const window = resolveWindow(options.days);
  const since = new Date(window.since);
  const limit = options.limit ?? 20;

  const match: Record<string, unknown> = { occurredAt: { $gte: since } };
  if (options.categorySlug) match.categorySlug = options.categorySlug;

  const [
    totals,
    funnel,
    trendRows,
    surfaces,
    actions,
    products,
    categories,
    devices,
    topSearchTerms,
  ] = await Promise.all([
    totalsFor(match),
    funnelFor(match),
    trendFor(match),
    bucketFor(match, 'surface', SURFACE_LABELS, 0),
    bucketFor(match, 'action', ACTION_LABELS, 0),
    productRowsFor(match, limit),
    categoryRowsFor(match, limit),
    devicesFor(match),
    topSearchTermsFor(match, 10),
  ]);

  /*
   * The surface and action shares are resolved here rather than inside their
   * pipelines: `totals` runs concurrently with them, so the denominator is
   * not known until all of it lands. Recomputing the share from the final
   * total is what keeps the bars summing to 1.
   */
  const withShare = (rows: InteractionBucketRow[]): InteractionBucketRow[] =>
    rows.map((row) => ({ ...row, share: share(row.taps, totals.taps) }));

  return {
    window,
    totals,
    funnel,
    surfaces: withShare(surfaces),
    actions: withShare(actions),
    products,
    categories,
    devices,
    trend: denseTrend(new Map(trendRows.map((row) => [row.date, row])), options.days),
    topSearchTerms,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * One visitor's profile.
 *
 * Returns `customer: null` when the id no longer resolves rather than
 * throwing: an account can be deleted while its anonymous events remain, and
 * an operator looking at a broken link deserves to see the events and the
 * explanation.
 */
export async function getCustomerInteractionProfile(
  customerId: string,
  options: { days: number; limit?: number },
): Promise<CustomerInteractionProfile> {
  const window = resolveWindow(options.days);
  const since = new Date(window.since);
  const limit = options.limit ?? 20;

  /*
   * A malformed id is answered as "no such customer" rather than allowed to
   * reach the driver, where a cast error would surface as a 500. The route
   * validates the shape; this is the belt to that braces, because this
   * function is also called from scripts.
   */
  const objectId = Types.ObjectId.isValid(customerId) ? new Types.ObjectId(customerId) : null;

  if (!objectId) {
    return emptyProfile(window, null, options.days);
  }

  const match: Record<string, unknown> = { customerId: objectId, occurredAt: { $gte: since } };

  const [
    customer,
    totals,
    funnel,
    trendRows,
    products,
    categories,
    surfaces,
    actions,
    devices,
    recent,
    productActions,
  ] = await Promise.all([
    UserModel.findById(objectId)
      .select('email phone firstName lastName isActive createdAt lastLoginAt')
      .lean<{
        _id: Types.ObjectId;
        email: string;
        phone: string;
        firstName: string;
        lastName: string;
        isActive: boolean;
        createdAt: Date;
        lastLoginAt: Date | null;
      } | null>(),
    totalsFor(match),
    funnelFor(match),
    trendFor(match),
    productRowsFor(match, limit),
    categoryRowsFor(match, limit),
    bucketFor(match, 'surface', SURFACE_LABELS, 0),
    bucketFor(match, 'action', ACTION_LABELS, 0),
    devicesFor(match),
    recentEventsFor(objectId, since, 40),
    /*
     * Which design, and which buttons on it. This is the block that turns a
     * profile from a list of visits into a note somebody can act on: the counts
     * above say they engaged, this says they picked a size on Mojri 12 twice.
     */
    customerProductActions(objectId, since, limit),
  ]);

  if (!customer) {
    return {
      ...emptyProfile(window, null, options.days),
      totals,
      funnel,
      products,
      categories,
      trend: denseTrend(new Map(trendRows.map((row) => [row.date, row])), options.days),
      recent,
      productActions,
    };
  }

  const withShare = (rows: InteractionBucketRow[]): InteractionBucketRow[] =>
    rows.map((row) => ({ ...row, share: share(row.taps, totals.taps) }));

  return {
    window,
    customer: {
      id: customer._id.toString(),
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      isActive: customer.isActive,
      createdAt: customer.createdAt.toISOString(),
      lastLoginAt: customer.lastLoginAt ? customer.lastLoginAt.toISOString() : null,
    },
    totals,
    funnel,
    products,
    categories,
    surfaces: withShare(surfaces),
    actions: withShare(actions),
    devices,
    trend: denseTrend(new Map(trendRows.map((row) => [row.date, row])), options.days),
    recent,
    productActions,
    generatedAt: new Date().toISOString(),
  };
}

/** A profile with no activity, so an unknown customer still renders a frame. */
function emptyProfile(
  window: InteractionWindow,
  customer: null,
  days: number,
): CustomerInteractionProfile {
  return {
    window,
    customer,
    totals: {
      taps: 0,
      visitors: 0,
      identifiedVisitors: 0,
      productViews: 0,
      categoryViews: 0,
      addToCart: 0,
      wishlistAdds: 0,
      searches: 0,
      ordersCompleted: 0,
    },
    funnel: { browsed: 0, viewedDesign: 0, addedToCart: 0, startedCheckout: 0, ordered: 0 },
    products: [],
    categories: [],
    surfaces: [],
    actions: [],
    devices: [],
    trend: denseTrend(new Map(), days),
    recent: [],
    productActions: [],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The most recent events for one visitor, with the product title resolved.
 *
 * Capped and read-only. This is a reading aid for the profile screen — "what
 * did they actually touch?" — not an export, and a screen that streams every
 * event a customer ever made is a screen nobody scrolls to the bottom of.
 */
async function recentEventsFor(
  customerId: Types.ObjectId,
  since: Date,
  limit: number,
): Promise<CustomerInteractionProfile['recent']> {
  const docs = await ActivityEventModel.find({ customerId, occurredAt: { $gte: since } })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .lean<
      Array<{
        _id: Types.ObjectId;
        event: string;
        action: string | null;
        surface: string | null;
        productId: Types.ObjectId | null;
        categoryName: string | null;
        path: string | null;
        device: InteractionDevice;
        occurredAt: Date;
      }>
    >();

  const productIds = docs
    .map((doc) => doc.productId)
    .filter((id): id is Types.ObjectId => id !== null);
  const products =
    productIds.length === 0
      ? []
      : await ProductModel.find({ _id: { $in: productIds } })
          .select('title')
          .lean<Array<{ _id: Types.ObjectId; title: string }>>();
  const byId = new Map(products.map((product) => [product._id.toString(), product.title]));

  return docs.map((doc) => ({
    id: doc._id.toString(),
    event: doc.event,
    action: doc.action,
    surface: doc.surface,
    productTitle: doc.productId ? (byId.get(doc.productId.toString()) ?? null) : null,
    categoryName: doc.categoryName,
    path: doc.path,
    device: doc.device,
    occurredAt: doc.occurredAt.toISOString(),
  }));
}

/**
 * The visitors list: signed-in customers with activity in the window.
 *
 * Customers, not sessions. "Which sessions tapped a button" answers nothing an
 * operator can act on; "which customers are circling the catalogue without
 * buying" is a list somebody can ring.
 *
 * The aggregation groups by `customerId` and drops the anonymous rows, then
 * resolves names in one user query. Sorting by taps rather than by recency
 * because the report's question is engagement, and a list ordered by "last
 * seen" would put a one-tap visitor who happened to be here a minute ago at
 * the top.
 */
export async function listInteractionVisitors(options: {
  days: number;
  limit?: number;
}): Promise<InteractionVisitorRow[]> {
  const since = new Date(Date.now() - options.days * DAY_MS);
  const limit = options.limit ?? 25;

  const rows = await ActivityEventModel.aggregate<{
    _id: Types.ObjectId;
    taps: number;
    productViews: number;
    addToCart: number;
    sessions: unknown[];
    lastSeenAt: Date;
  }>([
    { $match: { customerId: { $ne: null }, occurredAt: { $gte: since } } },
    {
      $group: {
        _id: '$customerId',
        taps: { $sum: { $cond: [{ $ifNull: ['$action', false] }, 1, 0] } },
        productViews: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        addToCart: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }] },
              1,
              0,
            ],
          },
        },
        sessions: { $addToSet: '$sessionId' },
        lastSeenAt: { $max: '$occurredAt' },
      },
    },
    { $sort: { taps: -1, lastSeenAt: -1 } },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  const customers = await UserModel.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('email firstName lastName')
    .lean<Array<{ _id: Types.ObjectId; email: string; firstName: string; lastName: string }>>();
  const byId = new Map(customers.map((customer) => [customer._id.toString(), customer]));

  return rows.map((row) => {
    const customer = byId.get(row._id.toString());
    return {
      customerId: row._id.toString(),
      email: customer?.email ?? 'A customer we no longer hold',
      firstName: customer?.firstName ?? '',
      lastName: customer?.lastName ?? '',
      taps: row.taps,
      productViews: row.productViews,
      addToCart: row.addToCart,
      sessions: row.sessions.length,
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  });
}

/** The device label, for a screen that wants the English rather than the key. */
export function deviceLabel(device: InteractionDevice): string {
  return DEVICE_LABELS[device];
}
