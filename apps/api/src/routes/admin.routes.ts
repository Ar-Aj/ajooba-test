import { Router } from 'express';
import type { Types } from 'mongoose';
import {
  adminCustomerQuerySchema,
  adminInventoryQuerySchema,
  adminPaginationQuerySchema,
  auditLogQuerySchema,
  couponInputSchema,
  couponPreviewRequestSchema,
  dashboardQuerySchema,
  stockAdjustmentBatchSchema,
  updateCouponRequestSchema,
  type AdminCustomerQuery,
  type AdminInventoryQuery,
  type AdminPaginationQuery,
  type AuditLogQuery,
  type Coupon,
  type CouponInput,
  type DashboardQuery,
  type StockAdjustmentBatch,
  type UpdateCouponRequest,
} from '@ajooba/contracts';
import { ConflictError, NotFoundError, UnauthorizedError } from '../core/errors.js';
import { routeParam, queryParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requirePermission } from '../middleware/auth.js';
import { adminWriteLimiter } from '../middleware/rate-limit.js';
import { validateBody, validateQuery, validated, validatedBody } from '../middleware/validate.js';
import { idempotent } from '../middleware/idempotency.js';
import { CouponModel } from '../models/coupon.model.js';
import { UserModel } from '../models/user.model.js';
import { writeAuditLog } from '../services/audit.service.js';
import { listAuditLogs } from '../services/audit.service.js';
import { getDashboardMetrics } from '../services/dashboard.service.js';
import {
  adjustStockBatch,
  listInventory,
  listStockMovements,
} from '../services/inventory.service.js';
import { computeDiscount, toDiscountRule } from '../services/pricing.service.js';

/**
 * Administrative routes.
 *
 * Every route here is behind `requireAdmin`, and every mutating route
 * additionally declares the **specific permission** it needs. The check is
 * server-side: the admin panel's own visibility rules are a convenience,
 * never the authority.
 *
 * The permission each route requires is named in its comment so the
 * mapping stays reviewable.
 */

export const adminRouter: Router = Router();

/* -------------------------------------------------------------------------- */
/* Dashboard — requires `analytics:read`                                       */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/dashboard',
  requireAdmin,
  requirePermission('analytics:read'),
  validateQuery(dashboardQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used. `validateQuery` stores its parsed
       * result separately and leaves `req.query` untouched, so reading
       * `req.query` directly would bypass the schema — including the `days`
       * clamp that keeps the dashboard window sane.
       */
      const query = validated<'query', DashboardQuery>(req, 'query');
      const metrics = await getDashboardMetrics(query.days);
      sendSuccess(res, metrics, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Inventory — `inventory:write` / `catalog:read`                             */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/inventory',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(adminInventoryQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used. `validateQuery` stores its parsed
       * result separately and leaves `req.query` untouched, so reading
       * `req.query` directly would bypass the schema — which is how an
       * unbounded `search` used to reach the `$regex` builder.
       */
      const query = validated<'query', AdminInventoryQuery>(req, 'query');

      const result = await listInventory(
        {
          ...(query.productCode ? { productCode: query.productCode } : {}),
          ...(query.search ? { search: query.search } : {}),
          ...(query.inStock === 'true' ? { inStock: true } : {}),
          ...(query.inStock === 'false' ? { inStock: false } : {}),
        },
        query.page,
        query.pageSize,
      );

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Adjust stock.
 *
 * The operation is idempotent: a retried request with the same key
 * returns the original result rather than applying the adjustment twice.
 */
adminRouter.post(
  '/inventory/adjustments',
  requireAdmin,
  requirePermission('inventory:write'),
  adminWriteLimiter,
  idempotent({ required: true }),
  validateBody(stockAdjustmentBatchSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const body = req.body as StockAdjustmentBatch;

      const result = await adjustStockBatch(
        body.adjustments.map((adjustment) => ({
          variantId: adjustment.variantId,
          delta: adjustment.delta,
          reason: adjustment.reason,
          note: adjustment.note || body.note,
          actorId: principal.id,
          actorLabel: principal.email,
        })),
        principal.id,
        principal.email,
      );

      await writeAuditLog({
        actorId: principal.id,
        actorEmail: principal.email,
        actorRole: principal.role ?? 'system',
        action: 'stock-adjust',
        entity: 'variant',
        entityId: result.applied.map((entry) => entry.variant.id).join(','),
        summary: `${result.applied.length} stock adjustment(s) applied, ${result.failed.length} failed.`,
        changes: { applied: result.applied.length, failed: result.failed },
        ip: req.ip ?? null,
      });

      sendSuccess(res, result, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The stock ledger.
 */
adminRouter.get(
  '/inventory/movements',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(adminPaginationQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query` — see the note on
       * the inventory route above.
       */
      const query = validated<'query', AdminPaginationQuery>(req, 'query');
      const variantId = queryParam(req, 'variantId');
      const productCode = queryParam(req, 'productCode');

      const result = await listStockMovements(
        {
          ...(variantId ? { variantId } : {}),
          ...(productCode ? { productCode } : {}),
        },
        query.page,
        query.pageSize,
      );

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Coupons — `coupons:read` / `coupons:write`                                 */
/* -------------------------------------------------------------------------- */

interface CouponDoc {
  _id: Types.ObjectId;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  description: string;
  /** Restrict the coupon to specific products. Empty means all products. */
  productCodes: string[];
  createdAt: Date;
  updatedAt: Date;
}

function mapCoupon(doc: CouponDoc): Coupon {
  return {
    id: doc._id.toString(),
    code: doc.code,
    type: doc.type,
    value: doc.value,
    minOrderAmount: doc.minOrderAmount,
    maxDiscountAmount: doc.maxDiscountAmount ?? null,
    startsAt: doc.startsAt.toISOString(),
    endsAt: doc.endsAt ? doc.endsAt.toISOString() : null,
    usageLimit: doc.usageLimit ?? null,
    usedCount: doc.usedCount,
    isActive: doc.isActive,
    description: doc.description ?? '',
    productCodes: doc.productCodes ?? [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

adminRouter.get(
  '/coupons',
  requireAdmin,
  requirePermission('coupons:read'),
  validateQuery(adminPaginationQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query` — see the note on
       * the inventory route above.
       */
      const query = validated<'query', AdminPaginationQuery>(req, 'query');

      const [docs, totalItems] = await Promise.all([
        CouponModel.find({})
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize)
          .lean<CouponDoc[]>(),
        CouponModel.countDocuments({}),
      ]);

      const result = {
        items: docs.map(mapCoupon),
        totalItems,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      };

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  '/coupons',
  requireAdmin,
  requirePermission('coupons:write'),
  adminWriteLimiter,
  validateBody(couponInputSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<CouponInput>(req);

      const existing = await CouponModel.findOne({ code: body.code }).select('_id').lean();
      if (existing) {
        throw new ConflictError('A coupon with that code already exists.');
      }

      const created = await CouponModel.create(body);

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'create',
        entity: 'coupon',
        entityId: created._id.toString(),
        summary: `Coupon "${created.code}" created.`,
        changes: body,
        ip: req.ip ?? null,
      });

      sendSuccess(res, mapCoupon(created as unknown as CouponDoc), getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  '/coupons/:couponId',
  requireAdmin,
  requirePermission('coupons:write'),
  adminWriteLimiter,
  validateBody(updateCouponRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<UpdateCouponRequest>(req);
      const couponId = routeParam(req, 'couponId');

      const existing = await CouponModel.findById(couponId).lean<CouponDoc | null>();
      if (!existing) {
        throw new NotFoundError('Coupon');
      }

      const updated = await CouponModel.findByIdAndUpdate(
        couponId,
        { $set: body },
        { returnDocument: 'after' },
      ).lean<CouponDoc | null>();

      if (!updated) {
        throw new NotFoundError('Coupon');
      }

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'update',
        entity: 'coupon',
        entityId: routeParam(req, 'couponId'),
        summary: `Coupon "${updated.code}" updated.`,
        changes: body,
        ip: req.ip ?? null,
      });

      sendSuccess(res, mapCoupon(updated), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.delete(
  '/coupons/:couponId',
  requireAdmin,
  requirePermission('coupons:write'),
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      const principal = req.principal;

      const deleted = await CouponModel.findByIdAndDelete(
        routeParam(req, 'couponId'),
      ).lean<CouponDoc | null>();
      if (!deleted) {
        throw new NotFoundError('Coupon');
      }

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'delete',
        entity: 'coupon',
        entityId: routeParam(req, 'couponId'),
        summary: `Coupon "${deleted.code}" deleted.`,
        ip: req.ip ?? null,
      });

      sendSuccess(res, { deleted: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Preview a coupon's effect on a subtotal, without applying it.
 */
adminRouter.post(
  '/coupons/:couponId/preview',
  requireAdmin,
  requirePermission('coupons:read'),
  validateBody(couponPreviewRequestSchema),
  async (req, res, next) => {
    try {
      const doc = await CouponModel.findById(routeParam(req, 'couponId')).lean<CouponDoc | null>();
      if (!doc) {
        throw new NotFoundError('Coupon');
      }

      const body = validatedBody<{ subtotal: number }>(req);
      const subtotal = body.subtotal;
      const discount = computeDiscount(toDiscountRule(mapCoupon(doc)), subtotal);

      sendSuccess(
        res,
        {
          code: doc.code,
          subtotal,
          discountAmount: discount,
          totalAfterDiscount: subtotal - discount,
        },
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Customers — `customers:read`                                               */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/customers',
  requireAdmin,
  requirePermission('customers:read'),
  validateQuery(adminCustomerQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', AdminCustomerQuery>(req, 'query');
      const search = query.search;

      const filter: Record<string, unknown> = {};
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          { email: { $regex: escaped, $options: 'i' } },
          { phone: { $regex: escaped, $options: 'i' } },
          { firstName: { $regex: escaped, $options: 'i' } },
          { lastName: { $regex: escaped, $options: 'i' } },
        ];
      }

      const [docs, totalItems] = await Promise.all([
        UserModel.find(filter)
          .select('email phone firstName lastName isActive createdAt lastLoginAt')
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize)
          .lean<Array<Record<string, unknown>>>(),
        UserModel.countDocuments(filter),
      ]);

      const result = {
        items: docs.map((doc) => ({
          id: String(doc._id),
          email: String(doc.email),
          phone: String(doc.phone),
          firstName: String(doc.firstName),
          lastName: String(doc.lastName),
          isActive: Boolean(doc.isActive),
          createdAt: (doc.createdAt as Date).toISOString(),
          lastLoginAt: doc.lastLoginAt ? (doc.lastLoginAt as Date).toISOString() : null,
        })),
        totalItems,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      };

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Audit log — `audit:read`                                                   */
/* -------------------------------------------------------------------------- */

adminRouter.get(
  '/audit-logs',
  requireAdmin,
  requirePermission('audit:read'),
  validateQuery(auditLogQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query` — see the note on
       * the inventory route above.
       */
      const query = validated<'query', AuditLogQuery>(req, 'query');

      const result = await listAuditLogs(
        {
          ...(query.action ? { action: query.action } : {}),
          ...(query.entity ? { entity: query.entity } : {}),
          ...(query.actorId ? { actorId: query.actorId } : {}),
        },
        query.page,
        query.pageSize,
      );

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);
