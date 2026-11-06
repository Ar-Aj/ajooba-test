import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  customerIdParamSchema,
  customerProfileQuerySchema,
  customerSpectrumQuerySchema,
  dashboardQuerySchema,
  insightsQuerySchema,
  productIdParamSchema,
  productProfileQuerySchema,
  productSpectrumQuerySchema,
  recordEventBatchSchema,
  recordEventRequestSchema,
} from '@ajooba/contracts';
import type {
  CustomerProfileQuery,
  CustomerSpectrumQuery,
  DashboardQuery,
  InsightsQuery,
  ProductProfileQuery,
  ProductSpectrumQuery,
  RecordEventBatch,
  RecordEventRequest,
} from '@ajooba/contracts';
import { sendSuccess } from '../core/http.js';
import { NotFoundError } from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { getRequestId } from '../middleware/error-handler.js';
import { optionalAuth, requireAdmin, requirePermission } from '../middleware/auth.js';
import { analyticsLimiter } from '../middleware/rate-limit.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  validated,
  validatedBody,
} from '../middleware/validate.js';
import {
  classifyDevice,
  recordActivityEvents,
  recordActivityEvent,
} from '../services/analytics.service.js';
import {
  getCustomerInteractionProfile,
  getInteractionInsights,
  listInteractionVisitors,
} from '../services/insights.service.js';
import {
  customerSpectrumSummary,
  getProductInteractionProfile,
  listCustomerSpectrum,
  listProductSpectrum,
  productSpectrumSummary,
} from '../services/interaction-spectrum.service.js';
import { ActivityEventModel } from '../models/activity-event.model.js';
import type { ActivityEvent } from '@ajooba/contracts';

/**
 * Analytics routes.
 *
 * ## The write side is public, the read side is not
 *
 * `POST /v1/analytics/events` and its batch sibling are public, because the
 * storefront records events from the browser for signed-out visitors too. The
 * body is validated, the customer id is taken from the *token* and never from
 * the body, and the response echoes nothing that could identify anyone.
 *
 * Every read route sits behind `requireAdmin` plus `analytics:read`.
 *
 * ## Why the write routes are `optionalAuth` rather than anonymous
 *
 * An event is worth much more when it can be attributed to a customer:
 * "somebody tapped add-to-cart" is a number, "this customer tapped add-to-cart
 * on this design three times this week" is a person somebody can help. So the
 * route reads the token when one is present and attaches the principal, and
 * works identically when there is none. A malformed token is treated as
 * signed out rather than rejected — the customer's browsing must not break
 * because a stale cookie is still in the jar.
 */

export const analyticsRouter: Router = Router();

/**
 * An activity-event row, as it comes back from the database.
 */
interface ActivityEventDoc {
  _id: Types.ObjectId;
  event: ActivityEvent;
  sessionId: string;
  customerId: Types.ObjectId | null;
  productId: Types.ObjectId | null;
  searchTerm: string;
  sku: string;
  quantity: number | null;
  value: number | null;
  device: string;
  surface: string | null;
  action: string | null;
  categorySlug: string | null;
  categoryName: string | null;
  path: string | null;
  occurredAt: Date;
}

/**
 * Record a single activity event.
 *
 * Kept alongside the batch route because it is the honest fallback: a browser
 * that cannot batch (an old client, a `fetch` that must report a result) still
 * needs a way to record one event. The response is always `202 Accepted` with
 * a trivial body.
 */
analyticsRouter.post(
  '/events',
  analyticsLimiter,
  optionalAuth,
  validateBody(recordEventRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<RecordEventRequest>(req);

      await recordActivityEvent({
        event: body.event,
        sessionId: body.sessionId,
        customerId: principal?.kind === 'customer' ? principal.id : null,
        productId: body.productId ?? null,
        variantId: body.variantId ?? null,
        searchTerm: body.searchTerm ?? null,
        sku: body.sku ?? null,
        quantity: body.quantity ?? null,
        value: body.value ?? null,
        surface: body.surface ?? null,
        action: body.action ?? null,
        categorySlug: body.categorySlug ?? null,
        categoryName: body.categoryName ?? null,
        path: body.path ?? null,
        device: classifyDevice(req.header('user-agent')),
      });

      sendSuccess(res, { recorded: 1 }, getRequestId(req), 202);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Record a batch of events from one page.
 *
 * ## Why the response reports a count it computed
 *
 * `recorded` is how many documents actually landed, not how many were sent.
 * A batch is written with `ordered: false` so one malformed row cannot
 * discard its neighbours; reporting the input length as if it were the
 * written length would make a partial write indistinguishable from a complete
 * one, and the caller would drop the queue it should have retried.
 */
analyticsRouter.post(
  '/events/batch',
  analyticsLimiter,
  optionalAuth,
  validateBody(recordEventBatchSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<RecordEventBatch>(req);

      const recorded = await recordActivityEvents(body.sessionId, body.events, {
        customerId: principal?.kind === 'customer' ? principal.id : null,
        device: classifyDevice(req.header('user-agent')),
      });

      sendSuccess(res, { recorded, received: body.events.length }, getRequestId(req), 202);
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Administrator reads                                                        */
/* -------------------------------------------------------------------------- */

export const adminAnalyticsRouter: Router = Router();

adminAnalyticsRouter.get(
  '/search-terms',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(dashboardQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query`. `validateQuery`
       * stores its parsed result separately and leaves `req.query`
       * untouched, so reading `req.query` here would bypass the schema
       * entirely — including the `days` clamp.
       */
      const query = validated<'query', DashboardQuery>(req, 'query');
      const insights = await getInteractionInsights({ days: query.days, limit: 20 });
      const terms = insights.topSearchTerms;
      sendSuccess(res, { items: terms, count: terms.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The most-viewed products over a window.
 *
 * Reads through the insights service rather than a second pipeline of its own,
 * so the number here and the number on the product report are the same read.
 */
adminAnalyticsRouter.get(
  '/top-viewed',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(insightsQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', InsightsQuery>(req, 'query');
      const insights = await getInteractionInsights({
        days: query.days,
        limit: query.limit,
        ...(query.categorySlug ? { categorySlug: query.categorySlug } : {}),
      });
      const products = insights.products.map((product) => ({
        productId: product.productId,
        views: product.views,
      }));
      sendSuccess(res, { items: products, count: products.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The interaction report.
 *
 * One document, every block. The overview, the product table and the category
 * table are three readings of it, which is why they cannot disagree.
 */
adminAnalyticsRouter.get(
  '/insights',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(insightsQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', InsightsQuery>(req, 'query');
      const insights = await getInteractionInsights({
        days: query.days,
        limit: query.limit,
        ...(query.categorySlug ? { categorySlug: query.categorySlug } : {}),
      });
      sendSuccess(res, insights, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Signed-in visitors with activity in the window.
 */
adminAnalyticsRouter.get(
  '/visitors',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(insightsQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', InsightsQuery>(req, 'query');
      const visitors = await listInteractionVisitors({ days: query.days, limit: query.limit });
      sendSuccess(res, { items: visitors, count: visitors.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * One visitor's profile.
 *
 * Path-validated so a malformed id produces a clean 404 rather than a cast
 * error from the driver.
 */
adminAnalyticsRouter.get(
  '/visitors/:customerId',
  requireAdmin,
  requirePermission('analytics:read'),
  validateParams(customerIdParamSchema),
  validateQuery(customerProfileQuerySchema),
  async (req, res, next) => {
    try {
      const customerId = routeParam(req, 'customerId');
      const query = validated<'query', CustomerProfileQuery>(req, 'query');
      const profile = await getCustomerInteractionProfile(customerId, {
        days: query.days,
        limit: query.limit,
      });

      /*
       * Two different absences, and the caller needs to tell them apart.
       *
       *  - No account **and** no events: the id was never real. That is a 404,
       *    so a mistyped or stale link says so instead of rendering an empty
       *    profile that looks like a customer who did nothing.
       *  - No account **but** events exist: a real visitor whose account has
       *    since been removed. That is a 200, because those visits happened and
       *    discarding them would be losing history the report is meant to keep.
       */
      if (!profile.customer && profile.recent.length === 0) {
        throw new NotFoundError('Visitor');
      }

      sendSuccess(res, profile, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* The two spectrums                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The product spectrum: designs ranked by the buttons they earn.
 *
 * Separate from `/insights` because it answers a different question. The
 * store-wide report says how the shop is doing; this says which design's buy box
 * works and which one's does not — a merchandising decision, not a trading one.
 */
adminAnalyticsRouter.get(
  '/products',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(productSpectrumQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', ProductSpectrumQuery>(req, 'query');
      const [summary, items] = await Promise.all([
        productSpectrumSummary(query.days),
        listProductSpectrum({
          days: query.days,
          limit: query.limit,
          ...(query.categorySlug ? { categorySlug: query.categorySlug } : {}),
          sort: query.sort,
        }),
      ]);
      sendSuccess(res, { ...summary, items }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * One design, read closely.
 *
 * Path-validated so a malformed id produces a clean 404 rather than a cast error
 * from the driver.
 */
adminAnalyticsRouter.get(
  '/products/:productId',
  requireAdmin,
  requirePermission('analytics:read'),
  validateParams(productIdParamSchema),
  validateQuery(productProfileQuerySchema),
  async (req, res, next) => {
    try {
      const productId = routeParam(req, 'productId');
      const query = validated<'query', ProductProfileQuery>(req, 'query');
      const profile = await getProductInteractionProfile(productId, {
        days: query.days,
        limit: query.limit,
      });

      /*
       * No product **and** no events means the id was never real — a mistyped or
       * stale link. A retired product whose events remain is a 200, because those
       * visits happened and the report exists to keep them.
       */
      if (!profile.product && profile.totals.taps === 0 && profile.totals.productViews === 0) {
        throw new NotFoundError('Design');
      }

      sendSuccess(res, profile, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The customer spectrum: customers ranked by intent rather than traffic.
 */
adminAnalyticsRouter.get(
  '/customer-spectrum',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(customerSpectrumQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', CustomerSpectrumQuery>(req, 'query');
      const [summary, items] = await Promise.all([
        customerSpectrumSummary(query.days),
        listCustomerSpectrum({ days: query.days, limit: query.limit, sort: query.sort }),
      ]);
      sendSuccess(res, { ...summary, items }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The raw event feed, for a deeper investigation.
 */
adminAnalyticsRouter.get(
  '/events',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(dashboardQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', DashboardQuery>(req, 'query');
      const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

      const [docs, totalItems] = await Promise.all([
        ActivityEventModel.find({ occurredAt: { $gte: since } })
          .sort({ occurredAt: -1 })
          .limit(200)
          .lean<ActivityEventDoc[]>(),
        ActivityEventModel.countDocuments({ occurredAt: { $gte: since } }),
      ]);

      const items = docs.map((doc) => ({
        id: doc._id.toString(),
        event: doc.event,
        sessionId: doc.sessionId,
        customerId: doc.customerId ? doc.customerId.toString() : null,
        productId: doc.productId ? doc.productId.toString() : null,
        searchTerm: doc.searchTerm,
        sku: doc.sku,
        quantity: doc.quantity,
        value: doc.value,
        device: doc.device,
        surface: doc.surface,
        action: doc.action,
        categorySlug: doc.categorySlug,
        categoryName: doc.categoryName,
        path: doc.path,
        occurredAt: doc.occurredAt.toISOString(),
      }));

      sendSuccess(res, { items, totalItems }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
