import { Router } from 'express';
import {
  adminReturnQuerySchema,
  createReturnRequestSchema,
  initiateRefundRequestSchema,
  resolveReturnRequestSchema,
  type AdminReturnQuery,
  type CreateReturnRequest,
  type InitiateRefundRequest,
  type ResolveReturnRequest,
  type ReturnRequest,
} from '@ajooba/contracts';
import { NotFoundError, UnauthorizedError } from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requireCustomer, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery, validated, validatedBody } from '../middleware/validate.js';
import { writeAuditLog } from '../services/audit.service.js';
import { issueRefundForReturn } from '../services/refund.service.js';
import {
  createReturnRequest,
  getReturnForCustomer,
  listAdminReturns,
  listCustomerReturns,
  resolveReturnRequest,
} from '../services/return.service.js';

/**
 * Return routes.
 *
 * A customer may only raise a return against an order they own, and only
 * for lines they actually bought. The ownership check lives in the
 * service, so it cannot be forgotten by a new route.
 */

export const returnsRouter: Router = Router();
export const adminReturnsRouter: Router = Router();

/**
 * Raise a return request.
 */
returnsRouter.post(
  '/',
  requireCustomer,
  validateBody(createReturnRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const body = validatedBody<CreateReturnRequest>(req);
      const created: ReturnRequest = await createReturnRequest({
        customerId: principal.id,
        orderId: body.orderId,
        items: body.items,
        reason: body.reason,
        reasonNote: body.reasonNote,
      });

      sendSuccess(res, created, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * List the signed-in customer's own returns.
 */
returnsRouter.get('/', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 24);

    const result = await listCustomerReturns(
      principal.id,
      Number.isFinite(page) && page > 0 ? page : 1,
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 24,
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
});

/**
 * Read one of the signed-in customer's own returns.
 */
returnsRouter.get('/:returnId', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const request = await getReturnForCustomer(routeParam(req, 'returnId'), principal.id);
    if (!request) {
      throw new NotFoundError('Return request');
    }

    sendSuccess(res, request, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * List every return request.
 */
adminReturnsRouter.get(
  '/',
  requireAdmin,
  requirePermission('returns:read'),
  validateQuery(adminReturnQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query`.
       *
       * `validateQuery` stores its parsed result separately and leaves
       * `req.query` untouched, so reading `req.query` here would bypass
       * the schema entirely — which is how an unrecognised `status` used
       * to reach the Mongo filter unchecked.
       */
      const query = validated<'query', AdminReturnQuery>(req, 'query');

      const result = await listAdminReturns(
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.orderId ? { orderId: query.orderId } : {}),
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
 * Approve or reject a return.
 *
 * Note what this route cannot do: mark a return `refunded`. `refunded` is not
 * in the accepted status enum, so it is a 422 before any code runs. Recording
 * a refund is a claim about money, and it may only be made once the payment
 * provider has confirmed it — see `POST /v1/admin/returns/:returnId/refund`
 * below, which is the only route that can move a return to `refunded`.
 */
adminReturnsRouter.patch(
  '/:returnId',
  requireAdmin,
  requirePermission('returns:write'),
  validateBody(resolveReturnRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<ResolveReturnRequest>(req);

      const request = await resolveReturnRequest(routeParam(req, 'returnId'), body.status, {
        ...(body.refundAmount !== undefined ? { refundAmount: body.refundAmount } : {}),
        ...(body.note ? { note: body.note } : {}),
      });

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'status-change',
        entity: 'return',
        entityId: request.id,
        summary: `Return ${request.returnNumber} moved to "${request.status}".`,
        changes: { status: request.status, refundAmount: request.refundAmount },
        ip: req.ip ?? null,
      });

      sendSuccess(res, request, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Issue a refund against an **approved** return.
 *
 * This is the only route in the platform that can move money backwards, and
 * it is deliberately separate from the PATCH above. Resolving a return to
 * `refunded` records a *decision*; this route *acts* on it and then waits for
 * the payment provider to confirm. The two are only ever connected by a real
 * provider response, so no amount of admin input can make the system claim a
 * refund happened when no money moved.
 *
 * Requires an administrator session and is audit-logged.
 */
adminReturnsRouter.post(
  '/:returnId/refund',
  requireAdmin,
  requirePermission('returns:write'),
  validateBody(initiateRefundRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<InitiateRefundRequest>(req);

      const outcome = await issueRefundForReturn(
        routeParam(req, 'returnId'),
        body.amount,
        getRequestId(req),
      );

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'refund',
        entity: 'return',
        entityId: outcome.returnId,
        summary:
          `Refund of ${outcome.amountRupees} INR for return ${outcome.returnNumber}: ` +
          `provider status "${outcome.providerStatus ?? 'unknown'}", settled=${outcome.settled}.`,
        changes: {
          amount: outcome.amountRupees,
          refundId: outcome.refundId,
          providerStatus: outcome.providerStatus,
          settled: outcome.settled,
          note: body.note ?? null,
        },
        ip: req.ip ?? null,
      });

      sendSuccess(res, outcome, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
