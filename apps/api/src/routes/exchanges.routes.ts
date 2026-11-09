import { Router } from 'express';
import {
  adminExchangeQuerySchema,
  createExchangeRequestSchema,
  exchangeOptionsQuerySchema,
  resolveExchangeRequestSchema,
  type AdminExchangeQuery,
  type CreateExchangeRequest,
  type ExchangeOptionsQuery,
  type ExchangeRequest,
  type ResolveExchangeRequest,
} from '@ajooba/contracts';
import { NotFoundError, UnauthorizedError } from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requireCustomer, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery, validated, validatedBody } from '../middleware/validate.js';
import { writeAuditLog } from '../services/audit.service.js';
import {
  createExchangeRequest,
  getExchangeOptions,
  getExchangeForCustomer,
  listAdminExchanges,
  listCustomerExchanges,
  transitionExchange,
} from '../services/exchange.service.js';

export const exchangesRouter: Router = Router();
export const adminExchangesRouter: Router = Router();

exchangesRouter.post(
  '/',
  requireCustomer,
  validateBody(createExchangeRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) throw new UnauthorizedError('Authentication required.');
      const body = validatedBody<CreateExchangeRequest>(req);
      const request = await createExchangeRequest({ customerId: principal.id, ...body });
      sendSuccess(res, request, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

exchangesRouter.get('/', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) throw new UnauthorizedError('Authentication required.');
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 24);
    const result = await listCustomerExchanges(
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

exchangesRouter.get(
  '/options',
  requireCustomer,
  validateQuery(exchangeOptionsQuerySchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) throw new UnauthorizedError('Authentication required.');
      const query = validated<'query', ExchangeOptionsQuery>(req, 'query');
      const options = await getExchangeOptions({ customerId: principal.id, ...query });
      sendSuccess(res, { items: options }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

exchangesRouter.get('/:exchangeId', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) throw new UnauthorizedError('Authentication required.');
    const request = await getExchangeForCustomer(routeParam(req, 'exchangeId'), principal.id);
    if (!request) throw new NotFoundError('Exchange request');
    sendSuccess(res, request, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

adminExchangesRouter.get(
  '/',
  requireAdmin,
  requirePermission('orders:read'),
  validateQuery(adminExchangeQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', AdminExchangeQuery>(req, 'query');
      const result = await listAdminExchanges(
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

adminExchangesRouter.patch(
  '/:exchangeId',
  requireAdmin,
  requirePermission('orders:write'),
  validateBody(resolveExchangeRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<ResolveExchangeRequest>(req);
      const request: ExchangeRequest = await transitionExchange(
        routeParam(req, 'exchangeId'),
        body.status,
        body.note,
      );
      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'status-change',
        entity: 'exchange',
        entityId: request.id,
        summary: `Exchange ${request.exchangeNumber} moved to "${request.status}".`,
        changes: { status: request.status, note: body.note },
        ip: req.ip ?? null,
      });
      sendSuccess(res, request, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
