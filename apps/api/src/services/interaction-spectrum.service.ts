import { Types } from 'mongoose';
import {
  ACTION_LABELS,
  SURFACE_LABELS,
  type InteractionActionRow,
  type InteractionCustomerProductAction,
  type InteractionCustomerSpectrumRow,
  type InteractionProductCustomerRow,
  type InteractionProductProfile,
  type InteractionProductRow,
  type InteractionProductSpectrumRow,
  type InteractionTotals,
  type InteractionWindow,
} from '@ajooba/contracts';
import { ActivityEventModel } from '../models/activity-event.model.js';
import { ProductModel } from '../models/product.model.js';
import { UserModel } from '../models/user.model.js';

/**
 * The two interaction spectrums.
 *
 * ## Why there are two, and not one wider report
 *
 * A store-wide report answers "how is the shop doing". It cannot answer the two
 * questions an operator actually acts on:
 *
 *   1. *Which buttons does this design earn?* — merchandising. A design with 400
 *      colour picks and 6 cart adds needs a different fix from one with 400 views
 *      and no colour picks. Same traffic, opposite decision.
 *   2. *What did this person try to buy?* — sales. "Asked about a size on Mojri 12
 *      twice last week" is a call worth making; "viewed 40 pages" is not.
 *
 * Both are the same events read at a different grain. Keeping them in one service
 * — sharing the conditions and the label resolvers — is what stops the two
 * screens from eventually disagreeing about what a tap is.
 *
 * ## The tap definition, stated once
 *
 * A **tap** is any event carrying an `action`: a control was touched. A page view
 * is not a tap even though it may carry a surface, and an add is only an add when
 * the event or the action says so. Every figure in this file uses the conditions
 * below, which are the same ones `insights.service.ts` uses.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A control was touched. The one definition of a tap in the platform. */
const TAP_CONDITION = { $ifNull: ['$action', false] };

/** A cart add, recorded either as its own event or as the buy-box action. */
const ADD_CONDITION = {
  $or: [{ $eq: ['$event', 'add_to_cart'] }, { $eq: ['$action', 'add-to-cart'] }],
};

/** A save. Wishlist writes arrive under two names for one customer action. */
const WISHLIST_CONDITION = {
  $or: [{ $eq: ['$event', 'wishlist_added'] }, { $eq: ['$action', 'wishlist-toggle'] }],
};

/**
 * A deliberate configuration step: a colour or a size was chosen.
 *
 * This is the intent signal that separates "looked at it" from "tried to buy it".
 * A quantity bump is excluded on purpose — it happens after the decision, not
 * instead of it.
 */
const CONFIGURE_CONDITION = {
  $or: [{ $eq: ['$action', 'select-colour'] }, { $eq: ['$action', 'select-size'] }],
};

const CHECKOUT_CONDITION = {
  $or: [{ $eq: ['$event', 'checkout_started'] }, { $eq: ['$action', 'checkout-start'] }],
};

function share(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}

/**
 * Keep the entries an `$addToSet` actually kept.
 *
 * `$cond` with `$$REMOVE` inside `$addToSet` leaves a hole rather than omitting
 * the element, so the array can carry `null` **and** `undefined` beside real ids.
 * A loose `!= null` is the correct predicate and trips the `eqeqeq` rule this
 * repo enforces, so the predicate names both cases instead of loosening the rule.
 * Every count of "distinct things that did X" in this file goes through here.
 */
function kept<T>(values: readonly (T | null | undefined)[]): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}

function resolveWindow(days: number): InteractionWindow {
  const until = new Date();
  const since = new Date(until.getTime() - days * DAY_MS);
  return { days, since: since.toISOString(), until: until.toISOString() };
}

/** Resolve an action key to its English, falling back to the key itself. */
function actionLabel(key: string): string {
  return ACTION_LABELS[key as keyof typeof ACTION_LABELS] ?? key;
}

function surfaceLabel(key: string): string {
  return SURFACE_LABELS[key as keyof typeof SURFACE_LABELS] ?? key;
}

/** Group a match into labelled action rows. */
async function actionRowsFor(
  match: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<InteractionActionRow[]> {
  const rows = await ActivityEventModel.aggregate<{ _id: string; taps: number }>([
    { $match: { ...match, ...extra, action: { $ne: null } } },
    { $group: { _id: '$action', taps: { $sum: 1 } } },
    { $sort: { taps: -1 } },
  ]);
  const total = rows.reduce((sum, row) => sum + row.taps, 0);
  return rows.map((row) => ({
    key: row._id,
    label: actionLabel(row._id),
    taps: row.taps,
    share: share(row.taps, total),
  }));
}

/** Group a match into labelled surface rows. Taps only, never page views. */
async function surfaceRowsFor(
  match: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<InteractionActionRow[]> {
  const rows = await ActivityEventModel.aggregate<{ _id: string; taps: number }>([
    { $match: { ...match, ...extra, action: { $ne: null }, surface: { $ne: null } } },
    { $group: { _id: '$surface', taps: { $sum: 1 } } },
    { $sort: { taps: -1 } },
  ]);
  const total = rows.reduce((sum, row) => sum + row.taps, 0);
  return rows.map((row) => ({
    key: row._id,
    label: surfaceLabel(row._id),
    taps: row.taps,
    share: share(row.taps, total),
  }));
}

/** Distinct sessions per day, densified so a quiet day is a zero rather than a gap. */
function denseSessionTrend(
  rows: ReadonlyMap<string, number>,
  days: number,
): Array<{ date: string; sessions: number }> {
  const out: Array<{ date: string; sessions: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10);
    out.push({ date: key, sessions: rows.get(key) ?? 0 });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The product spectrum                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Designs, ranked for merchandising.
 *
 * One aggregation gives the counts; a second gives each design its buttons. Doing
 * both in one `$group` is not possible without `$push`-ing every action and
 * unrolling it in memory, which would cap the window at however many events fit
 * in a BSON document. Two reads against one match is the cheaper and the honest
 * shape.
 */
export async function listProductSpectrum(options: {
  days: number;
  limit?: number;
  categorySlug?: string;
  sort?: 'taps' | 'views' | 'addToCart' | 'wishlist' | 'rate';
}): Promise<readonly InteractionProductSpectrumRow[]> {
  const window = resolveWindow(options.days);
  const since = new Date(window.since);
  const limit = options.limit ?? 25;

  const match: Record<string, unknown> = { occurredAt: { $gte: since } };
  if (options.categorySlug) match.categorySlug = options.categorySlug;

  const sortKey: Record<string, 1 | -1> =
    options.sort === 'views'
      ? { views: -1 }
      : options.sort === 'addToCart'
        ? { addToCart: -1 }
        : options.sort === 'wishlist'
          ? { wishlistAdds: -1 }
          : { taps: -1 };

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
    configurers: unknown[];
    lastTappedAt: Date | null;
  }>([
    { $match: { ...match, productId: { $ne: null } } },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$productId',
        views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        taps: { $sum: { $cond: [TAP_CONDITION, 1, 0] } },
        addToCart: { $sum: { $cond: [ADD_CONDITION, 1, 0] } },
        wishlistAdds: { $sum: { $cond: [WISHLIST_CONDITION, 1, 0] } },
        categorySlug: { $first: '$categorySlug' },
        categoryName: { $first: '$categoryName' },
        viewers: { $addToSet: '$sessionId' },
        carters: { $addToSet: { $cond: [ADD_CONDITION, '$sessionId', '$$REMOVE'] } },
        configurers: {
          $addToSet: { $cond: [CONFIGURE_CONDITION, '$sessionId', '$$REMOVE'] },
        },
        lastTappedAt: { $max: { $cond: [TAP_CONDITION, '$occurredAt', null] } },
      },
    },
    { $sort: sortKey },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  const [products, actionRows] = await Promise.all([
    ProductModel.find({ _id: { $in: rows.map((row) => row._id) } })
      .select('code title subcategory subcategorySlug')
      .lean<
        Array<{
          _id: Types.ObjectId;
          code: string;
          title: string;
          subcategory: string;
          subcategorySlug: string;
        }>
      >(),
    /*
     * Every design's buttons in one read, grouped by the pair. The match is the
     * same window and the same filter, so a row's actions sum to its taps by
     * construction rather than by coincidence.
     */
    ActivityEventModel.aggregate<{
      _id: { productId: Types.ObjectId; action: string };
      taps: number;
    }>([
      { $match: { ...match, productId: { $ne: null }, action: { $ne: null } } },
      { $group: { _id: { productId: '$productId', action: '$action' }, taps: { $sum: 1 } } },
    ]),
  ]);

  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  const actionsByProduct = new Map<string, InteractionActionRow[]>();
  for (const row of actionRows) {
    const key = row._id.productId.toString();
    const list = actionsByProduct.get(key) ?? [];
    list.push({
      key: row._id.action,
      label: actionLabel(row._id.action),
      taps: row.taps,
      share: 0,
    });
    actionsByProduct.set(key, list);
  }

  const mapped = rows.map((row) => {
    const id = row._id.toString();
    const product = byId.get(id);
    const viewers = row.viewers.length;
    const carters = kept(row.carters).length;
    const configurers = kept(row.configurers).length;

    const rawActions = (actionsByProduct.get(id) ?? []).sort((a, b) => b.taps - a.taps);
    const actionTotal = rawActions.reduce((sum, action) => sum + action.taps, 0);
    const actions = rawActions.map((action) => ({
      ...action,
      share: share(action.taps, actionTotal),
    }));

    return {
      productId: id,
      code: product?.code ?? '',
      title: product?.title ?? 'A design no longer in the catalogue',
      categorySlug: product?.subcategorySlug ?? row.categorySlug ?? '',
      categoryName: product?.subcategory ?? row.categoryName ?? 'Uncatalogued',
      views: row.views,
      taps: row.taps,
      addToCart: row.addToCart,
      wishlistAdds: row.wishlistAdds,
      visitors: viewers,
      addToCartRate: share(carters, viewers),
      configuredSessions: configurers,
      intentRate: share(carters, configurers),
      actions,
      topAction: actions[0] ?? null,
      surfaces: [],
      lastTappedAt: row.lastTappedAt ? row.lastTappedAt.toISOString() : null,
    } satisfies InteractionProductSpectrumRow;
  });

  // `rate` is a computed field, so it is sorted after the read rather than in
  // Mongo. The list is already capped at fifty, so this is a sort of a page.
  return options.sort === 'rate'
    ? [...mapped].sort((a, b) => b.intentRate - a.intentRate || b.taps - a.taps)
    : mapped;
}

/**
 * The product-side headline, so the list screen has a lead figure.
 *
 * Counted over sessions at every step, the same way the store-wide funnel is: a
 * shopper who opened six designs is one shopper who configured something, and
 * counting events would let them stand in for six.
 */
export async function productSpectrumSummary(days: number): Promise<{
  readonly window: InteractionWindow;
  readonly designs: number;
  readonly viewers: number;
  readonly configurers: number;
  readonly carters: number;
  readonly generatedAt: string;
}> {
  const window = resolveWindow(days);
  const since = new Date(window.since);

  const [row] = await ActivityEventModel.aggregate<{
    designs: unknown[];
    viewers: unknown[];
    configurers: unknown[];
    carters: unknown[];
  }>([
    { $match: { occurredAt: { $gte: since }, productId: { $ne: null } } },
    {
      $group: {
        _id: null,
        designs: { $addToSet: '$productId' },
        viewers: {
          $addToSet: { $cond: [{ $eq: ['$event', 'product_view'] }, '$sessionId', '$$REMOVE'] },
        },
        configurers: { $addToSet: { $cond: [CONFIGURE_CONDITION, '$sessionId', '$$REMOVE'] } },
        carters: { $addToSet: { $cond: [ADD_CONDITION, '$sessionId', '$$REMOVE'] } },
      },
    },
  ]);

  return {
    window,
    designs: row?.designs.length ?? 0,
    viewers: row?.viewers.length ?? 0,
    configurers: row?.configurers.length ?? 0,
    carters: row?.carters.length ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* One design, read closely                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Everything the product drill-down shows, scoped to one design.
 *
 * `alsoViewed` is the one block that is not scoped: it answers "what else did the
 * people who looked at this also look at", which is a question about the
 * sessions, not about this design.
 */
export async function getProductInteractionProfile(
  productId: string,
  options: { days: number; limit?: number },
): Promise<InteractionProductProfile> {
  const window = resolveWindow(options.days);
  const since = new Date(window.since);
  const limit = options.limit ?? 25;

  const objectId = Types.ObjectId.isValid(productId) ? new Types.ObjectId(productId) : null;
  if (!objectId) return emptyProductProfile(window);

  const match: Record<string, unknown> = { occurredAt: { $gte: since }, productId: objectId };

  const [product, totalsRows, actions, surfaces, trendRows, customers, alsoViewed] =
    await Promise.all([
      ProductModel.findById(objectId).select('code title subcategory subcategorySlug images').lean<{
        _id: Types.ObjectId;
        code: string;
        title: string;
        subcategory: string;
        subcategorySlug: string;
        images: Array<{ url: string }>;
      } | null>(),
      ActivityEventModel.aggregate<{
        views: number;
        taps: number;
        addToCart: number;
        wishlistAdds: number;
        searches: number;
        viewers: unknown[];
        configurers: unknown[];
        carters: unknown[];
        checkouts: unknown[];
        orderers: unknown[];
        customers: unknown[];
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
            taps: { $sum: { $cond: [TAP_CONDITION, 1, 0] } },
            addToCart: { $sum: { $cond: [ADD_CONDITION, 1, 0] } },
            wishlistAdds: { $sum: { $cond: [WISHLIST_CONDITION, 1, 0] } },
            searches: { $sum: { $cond: [{ $eq: ['$event', 'search'] }, 1, 0] } },
            viewers: {
              $addToSet: {
                $cond: [{ $eq: ['$event', 'product_view'] }, '$sessionId', '$$REMOVE'],
              },
            },
            configurers: {
              $addToSet: { $cond: [CONFIGURE_CONDITION, '$sessionId', '$$REMOVE'] },
            },
            carters: { $addToSet: { $cond: [ADD_CONDITION, '$sessionId', '$$REMOVE'] } },
            checkouts: { $addToSet: { $cond: [CHECKOUT_CONDITION, '$sessionId', '$$REMOVE'] } },
            orderers: {
              $addToSet: {
                $cond: [{ $eq: ['$event', 'order_completed'] }, '$sessionId', '$$REMOVE'],
              },
            },
            customers: { $addToSet: '$customerId' },
          },
        },
      ]),
      actionRowsFor(match),
      surfaceRowsFor(match),
      ActivityEventModel.aggregate<{ _id: string; sessions: unknown[] }>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
            sessions: { $addToSet: '$sessionId' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      productCustomersFor(match, limit),
      alsoViewedFor(objectId, since, limit),
    ]);

  const totals = totalsRows[0];

  const profileTotals: InteractionTotals = {
    taps: totals?.taps ?? 0,
    visitors: totals?.viewers.length ?? 0,
    identifiedVisitors: kept(totals?.customers ?? []).length,
    productViews: totals?.views ?? 0,
    categoryViews: 0,
    addToCart: totals?.addToCart ?? 0,
    wishlistAdds: totals?.wishlistAdds ?? 0,
    searches: totals?.searches ?? 0,
    ordersCompleted: totals?.orderers.length ?? 0,
  };

  return {
    window,
    product: product
      ? {
          id: product._id.toString(),
          code: product.code,
          title: product.title,
          categorySlug: product.subcategorySlug,
          categoryName: product.subcategory,
          imageUrl: product.images?.[0]?.url ?? null,
        }
      : null,
    totals: profileTotals,
    funnel: {
      viewed: totals?.viewers.length ?? 0,
      configured: totals?.configurers.length ?? 0,
      addedToCart: totals?.carters.length ?? 0,
      startedCheckout: totals?.checkouts.length ?? 0,
      ordered: totals?.orderers.length ?? 0,
    },
    actions,
    surfaces,
    trend: denseSessionTrend(
      new Map(trendRows.map((row) => [row._id, row.sessions.length])),
      options.days,
    ),
    customers,
    alsoViewed,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Who engaged with this design, for a call list.
 *
 * Named customers only, because the point of the block is somebody to contact.
 * `configured` is what makes a row actionable: a customer who chose a size or a
 * colour but did not add is the one to ring.
 */
async function productCustomersFor(
  match: Record<string, unknown>,
  limit: number,
): Promise<InteractionProductCustomerRow[]> {
  const rows = await ActivityEventModel.aggregate<{
    _id: Types.ObjectId;
    taps: number;
    views: number;
    addToCart: number;
    wishlistAdds: number;
    configurers: unknown[];
    lastSeenAt: Date;
  }>([
    { $match: { ...match, customerId: { $ne: null } } },
    {
      $group: {
        _id: '$customerId',
        taps: { $sum: { $cond: [TAP_CONDITION, 1, 0] } },
        views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        addToCart: { $sum: { $cond: [ADD_CONDITION, 1, 0] } },
        wishlistAdds: { $sum: { $cond: [WISHLIST_CONDITION, 1, 0] } },
        configurers: { $addToSet: { $cond: [CONFIGURE_CONDITION, '$sessionId', '$$REMOVE'] } },
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
      views: row.views,
      addToCart: row.addToCart,
      wishlistAdds: row.wishlistAdds,
      configured: kept(row.configurers).length > 0,
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  });
}

/**
 * What the people who looked at this design also looked at.
 *
 * Built from the *sessions* that touched this product, then re-run over the whole
 * window for those sessions. That is why it cannot be a `$lookup` on the product
 * row: the question is about the people, and this product is only the door they
 * came through.
 */
async function alsoViewedFor(
  productId: Types.ObjectId,
  since: Date,
  limit: number,
): Promise<InteractionProductRow[]> {
  const sessions = await ActivityEventModel.distinct('sessionId', {
    productId,
    occurredAt: { $gte: since },
  });

  if (sessions.length === 0) return [];

  const rows = await ActivityEventModel.aggregate<{
    _id: Types.ObjectId;
    views: number;
    taps: number;
    addToCart: number;
    wishlistAdds: number;
    viewers: unknown[];
    carters: unknown[];
    categorySlug: string | null;
    categoryName: string | null;
  }>([
    {
      $match: {
        sessionId: { $in: sessions },
        occurredAt: { $gte: since },
        productId: { $ne: null, $nin: [productId] },
      },
    },
    { $sort: { occurredAt: -1 } },
    {
      $group: {
        _id: '$productId',
        views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        taps: { $sum: { $cond: [TAP_CONDITION, 1, 0] } },
        addToCart: { $sum: { $cond: [ADD_CONDITION, 1, 0] } },
        wishlistAdds: { $sum: { $cond: [WISHLIST_CONDITION, 1, 0] } },
        viewers: { $addToSet: '$sessionId' },
        carters: { $addToSet: { $cond: [ADD_CONDITION, '$sessionId', '$$REMOVE'] } },
        categorySlug: { $first: '$categorySlug' },
        categoryName: { $first: '$categoryName' },
      },
    },
    { $sort: { viewers: -1 } },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

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
    const carters = kept(row.carters).length;
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
      addToCartRate: share(carters, viewers),
    };
  });
}

/** A profile with no activity, so an unknown product still renders a frame. */
function emptyProductProfile(window: InteractionWindow): InteractionProductProfile {
  return {
    window,
    product: null,
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
    funnel: { viewed: 0, configured: 0, addedToCart: 0, startedCheckout: 0, ordered: 0 },
    actions: [],
    surfaces: [],
    trend: denseSessionTrend(new Map(), window.days),
    customers: [],
    alsoViewed: [],
    generatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* The customer spectrum                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Customers, ranked by intent.
 *
 * Different from `listInteractionVisitors` in three ways that matter, and each is
 * the reason this exists rather than widening that one:
 *
 *  - It counts **configuration** sessions. Choosing a size is a commitment short
 *    of money, and it is invisible in a tap count.
 *  - It counts **distinct designs**, so a customer who opened one design nine
 *    times is not ranked above one who opened nine.
 *  - It names the design they spent the most taps on, because a call list with a
 *    product name in it is a call list somebody uses.
 */
export async function listCustomerSpectrum(options: {
  days: number;
  limit?: number;
  sort?: 'taps' | 'addToCart' | 'wishlist' | 'views';
}): Promise<readonly InteractionCustomerSpectrumRow[]> {
  const since = new Date(Date.now() - options.days * DAY_MS);
  const limit = options.limit ?? 25;

  const sortKey: Record<string, 1 | -1> =
    options.sort === 'addToCart'
      ? { addToCart: -1 }
      : options.sort === 'wishlist'
        ? { wishlistAdds: -1 }
        : options.sort === 'views'
          ? { productViews: -1 }
          : { taps: -1 };

  const rows = await ActivityEventModel.aggregate<{
    _id: Types.ObjectId;
    taps: number;
    productViews: number;
    addToCart: number;
    wishlistAdds: number;
    sessions: unknown[];
    configurers: unknown[];
    checkouts: unknown[];
    designs: unknown[];
    lastSeenAt: Date;
    topProduct: Array<{ productId: Types.ObjectId }>;
  }>([
    { $match: { customerId: { $ne: null }, occurredAt: { $gte: since } } },
    {
      $group: {
        _id: '$customerId',
        taps: { $sum: { $cond: [TAP_CONDITION, 1, 0] } },
        productViews: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        addToCart: { $sum: { $cond: [ADD_CONDITION, 1, 0] } },
        wishlistAdds: { $sum: { $cond: [WISHLIST_CONDITION, 1, 0] } },
        sessions: { $addToSet: '$sessionId' },
        configurers: { $addToSet: { $cond: [CONFIGURE_CONDITION, '$sessionId', '$$REMOVE'] } },
        checkouts: { $addToSet: { $cond: [CHECKOUT_CONDITION, '$sessionId', '$$REMOVE'] } },
        designs: { $addToSet: '$productId' },
        lastSeenAt: { $max: '$occurredAt' },
        /*
         * One entry per *tapped* product event, so the fold below can find the
         * design they pressed the most buttons on. A design they merely viewed
         * has no business naming the row, so views are left out of the push.
         */
        topProduct: {
          $push: {
            $cond: [
              { $and: [TAP_CONDITION, { $ne: ['$productId', null] }] },
              { productId: '$productId' },
              '$$REMOVE',
            ],
          },
        },
      },
    },
    { $sort: sortKey },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  const customerIds = rows.map((row) => row._id);
  const productIds = rows.flatMap((row) => row.topProduct.map((entry) => entry.productId));

  const [customers, products] = await Promise.all([
    UserModel.find({ _id: { $in: customerIds } })
      .select('email firstName lastName')
      .lean<Array<{ _id: Types.ObjectId; email: string; firstName: string; lastName: string }>>(),
    productIds.length === 0
      ? Promise.resolve([])
      : ProductModel.find({ _id: { $in: productIds } })
          .select('title')
          .lean<Array<{ _id: Types.ObjectId; title: string }>>(),
  ]);

  const customerById = new Map(customers.map((customer) => [customer._id.toString(), customer]));
  const titleById = new Map(products.map((product) => [product._id.toString(), product.title]));

  return rows.map((row) => {
    const customer = customerById.get(row._id.toString());
    const designsViewed = kept(row.designs).length;

    // Fold the pushed taps into a per-design count, then take the maximum.
    const tally = new Map<string, number>();
    for (const entry of row.topProduct) {
      const key = entry.productId.toString();
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      customerId: row._id.toString(),
      email: customer?.email ?? 'A customer we no longer hold',
      firstName: customer?.firstName ?? '',
      lastName: customer?.lastName ?? '',
      taps: row.taps,
      productViews: row.productViews,
      addToCart: row.addToCart,
      wishlistAdds: row.wishlistAdds,
      sessions: row.sessions.length,
      designsViewed,
      configuredSessions: kept(row.configurers).length,
      checkoutSessions: kept(row.checkouts).length,
      addRate: share(row.addToCart, designsViewed),
      topProduct: top
        ? { productId: top[0], title: titleById.get(top[0]) ?? 'A retired design' }
        : null,
      lastSeenAt: row.lastSeenAt.toISOString(),
    } satisfies InteractionCustomerSpectrumRow;
  });
}

/**
 * One customer's design-by-design action matrix.
 *
 * The block the whole customer spectrum exists for. Grouped by (design, action),
 * then folded into one row per design carrying its own buttons, so the screen can
 * say "on Mojri 12 they picked a colour twice and a size once" rather than "they
 * made fourteen taps".
 *
 * Rows are ordered by taps, so the design a customer is actually circling is the
 * first thing an operator reads.
 */
export async function customerProductActions(
  customerId: Types.ObjectId,
  since: Date,
  limit: number,
): Promise<readonly InteractionCustomerProductAction[]> {
  const match: Record<string, unknown> = { customerId, occurredAt: { $gte: since } };

  const rows = await ActivityEventModel.aggregate<{
    _id: { productId: Types.ObjectId; action: string | null };
    taps: number;
    views: number;
    addToCart: number;
    wishlistAdds: number;
    lastSeenAt: Date;
  }>([
    { $match: { ...match, productId: { $ne: null } } },
    {
      $group: {
        _id: { productId: '$productId', action: '$action' },
        taps: { $sum: { $cond: [TAP_CONDITION, 1, 0] } },
        views: { $sum: { $cond: [{ $eq: ['$event', 'product_view'] }, 1, 0] } },
        addToCart: { $sum: { $cond: [ADD_CONDITION, 1, 0] } },
        wishlistAdds: { $sum: { $cond: [WISHLIST_CONDITION, 1, 0] } },
        lastSeenAt: { $max: '$occurredAt' },
      },
    },
  ]);

  if (rows.length === 0) return [];

  /*
   * Fold (product, action) into a row per product. `action: null` buckets are the
   * page views, which contribute their counts but never their own action row �
   * a "viewed" row in a button list would be the same mistake the store-wide
   * surface breakdown already made once.
   */
  const byProduct = new Map<
    string,
    {
      taps: number;
      views: number;
      addToCart: number;
      wishlistAdds: number;
      lastSeenAt: Date;
      actions: InteractionActionRow[];
    }
  >();

  for (const row of rows) {
    const key = row._id.productId.toString();
    const entry = byProduct.get(key) ?? {
      taps: 0,
      views: 0,
      addToCart: 0,
      wishlistAdds: 0,
      lastSeenAt: row.lastSeenAt,
      actions: [],
    };
    entry.taps += row.taps;
    entry.views += row.views;
    entry.addToCart += row.addToCart;
    entry.wishlistAdds += row.wishlistAdds;
    if (row.lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = row.lastSeenAt;
    if (row._id.action && row.taps > 0) {
      entry.actions.push({
        key: row._id.action,
        label: actionLabel(row._id.action),
        taps: row.taps,
        share: 0,
      });
    }
    byProduct.set(key, entry);
  }

  const ranked = [...byProduct.entries()]
    .sort((a, b) => b[1].taps - a[1].taps || b[1].views - a[1].views)
    .slice(0, limit);

  const products = await ProductModel.find({
    _id: { $in: ranked.map(([id]) => new Types.ObjectId(id)) },
  })
    .select('code title subcategory')
    .lean<
      Array<{
        _id: Types.ObjectId;
        code: string;
        title: string;
        subcategory: string;
      }>
    >();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  return ranked.map(([id, entry]) => {
    const product = byId.get(id);
    const actionTotal = entry.actions.reduce((sum, action) => sum + action.taps, 0);
    return {
      productId: id,
      code: product?.code ?? '',
      title: product?.title ?? 'A design no longer in the catalogue',
      categoryName: product?.subcategory ?? 'Uncatalogued',
      views: entry.views,
      taps: entry.taps,
      addToCart: entry.addToCart,
      wishlistAdds: entry.wishlistAdds,
      actions: entry.actions
        .sort((a, b) => b.taps - a.taps)
        .map((action) => ({ ...action, share: share(action.taps, actionTotal) })),
      lastSeenAt: entry.lastSeenAt.toISOString(),
    } satisfies InteractionCustomerProductAction;
  });
}

/** The customer-side headline, so the list screen has a lead figure. */
export async function customerSpectrumSummary(days: number): Promise<{
  readonly window: InteractionWindow;
  readonly customers: number;
  readonly configured: number;
  readonly carters: number;
  readonly wishlisted: number;
  readonly generatedAt: string;
}> {
  const window = resolveWindow(days);
  const since = new Date(window.since);

  const [row] = await ActivityEventModel.aggregate<{
    customers: unknown[];
    configurers: unknown[];
    carters: unknown[];
    wishlisters: unknown[];
  }>([
    { $match: { customerId: { $ne: null }, occurredAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        customers: { $addToSet: '$customerId' },
        configurers: { $addToSet: { $cond: [CONFIGURE_CONDITION, '$customerId', '$$REMOVE'] } },
        carters: { $addToSet: { $cond: [ADD_CONDITION, '$customerId', '$$REMOVE'] } },
        wishlisters: { $addToSet: { $cond: [WISHLIST_CONDITION, '$customerId', '$$REMOVE'] } },
      },
    },
  ]);

  return {
    window,
    customers: row?.customers.length ?? 0,
    configured: row?.configurers.length ?? 0,
    carters: row?.carters.length ?? 0,
    wishlisted: row?.wishlisters.length ?? 0,
    generatedAt: new Date().toISOString(),
  };
}
