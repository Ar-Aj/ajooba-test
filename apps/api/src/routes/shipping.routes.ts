import { Router } from 'express';
import { z } from 'zod';
import {
  SHIPMENT_STATUSES,
  cancelShipmentRequestSchema,
  createShipmentRequestSchema,
} from '@ajooba/contracts';
import { NotFoundError, UnauthorizedError } from '../core/errors.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requireCustomer, requirePermission } from '../middleware/auth.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { validateBody, validateQuery, validated, validatedBody } from '../middleware/validate.js';
import { paginationQuerySchema } from '@ajooba/contracts';
import {
  assignAwbAndGenerateLabel,
  cancelShipment,
  createShipment,
  getShipment,
  getShipmentForCustomer,
  getShipmentForOrder,
  listShipments,
  refreshShipmentTracking,
  requestPickup,
  shippingConfiguration,
} from '../services/shipping.service.js';

/**
 * Shipping routes.
 *
 * Split in two, because the two audiences have different rights:
 *
 *  - `orderShippingRouter` (customer) — read **only** their own shipment, and
 *    only through an order they own. There is no customer write route:
 *    dispatching a parcel is a fulfilment action with a real cost.
 *  - `adminShipmentsRouter` — read for `support`, write for
 *    `owner`/`admin`/`manager`.
 *
 * The permission split is enforced by `requireAdmin`, server-side. Hiding a
 * button in the admin UI is not authorisation.
 */

export const orderShippingRouter: Router = Router();
export const adminShipmentsRouter: Router = Router();

/* -------------------------------------------------------------------------- */
/* Query schema                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The admin shipment list query.
 *
 * Validated rather than read straight off `req.query`, so an unknown `status`
 * is a `422` instead of a silently empty list — which would read as "no
 * shipments" when it actually means "you typed the filter wrong".
 */
const shipmentListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(SHIPMENT_STATUSES).optional(),
  orderId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'orderId must be a MongoDB ObjectId')
    .optional(),
});

type ShipmentListQuery = z.infer<typeof shipmentListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Customer                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The shipment for one of the signed-in customer's own orders.
 *
 * Ownership is checked in the service, which queries by (order, customer)
 * rather than the shipment alone — so another customer's parcel is a `404`,
 * not a `403`, and a valid id is never confirmed.
 */
orderShippingRouter.get('/orders/:orderId/shipment', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      next(new UnauthorizedError('Authentication required.'));
      return;
    }

    const shipment = await getShipmentForCustomer(routeParam(req, 'orderId'), principal.id);

    if (!shipment) {
      /*
       * Either the order is not theirs, or it has no shipment. Both answer
       * `404`, deliberately indistinguishable, so the endpoint cannot be used
       * to discover which order ids exist.
       */
      throw new NotFoundError('Shipment');
    }

    sendSuccess(res, shipment, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Admin — read                                                               */
/* -------------------------------------------------------------------------- */

/** What the shipping integration can do, and what is still missing. */
adminShipmentsRouter.get(
  '/configuration',
  requireAdmin,
  requirePermission('shipping:read'),
  (_req, res) => {
    sendSuccess(res, shippingConfiguration(), 'system');
  },
);

/** List shipments. */
adminShipmentsRouter.get(
  '/',
  requireAdmin,
  requirePermission('shipping:read'),
  validateQuery(shipmentListQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', ShipmentListQuery>(req, 'query');
      const result = await listShipments(
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

/** The shipment for one order. */
adminShipmentsRouter.get(
  '/order/:orderId',
  requireAdmin,
  requirePermission('shipping:read'),
  async (req, res, next) => {
    try {
      const shipment = await getShipmentForOrder(routeParam(req, 'orderId'));
      if (!shipment) {
        throw new NotFoundError('Shipment');
      }
      sendSuccess(res, shipment, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** One shipment. */
adminShipmentsRouter.get(
  '/:shipmentId',
  requireAdmin,
  requirePermission('shipping:read'),
  async (req, res, next) => {
    try {
      const shipment = await getShipment(routeParam(req, 'shipmentId'));
      if (!shipment) {
        throw new NotFoundError('Shipment');
      }
      sendSuccess(res, shipment, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Admin — write                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Create a shipment for an order.
 *
 * `shipping:write`, so `support` cannot dispatch — creating a shipment
 * commits the business to a courier pickup and a real cost.
 */
adminShipmentsRouter.post(
  '/orders/:orderId',
  requireAdmin,
  requirePermission('shipping:write'),
  validateBody(createShipmentRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<{ courierId?: number; note?: string }>(req);

      const shipment = await createShipment({
        orderId: routeParam(req, 'orderId'),
        courierId: body.courierId ?? null,
        ...(body.note ? { note: body.note } : {}),
        actorEmail: principal?.email ?? 'system',
        actorId: principal?.id ?? null,
      });

      sendSuccess(res, shipment, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/** Assign an AWB and generate the label. */
adminShipmentsRouter.post(
  '/:shipmentId/awb',
  requireAdmin,
  requirePermission('shipping:write'),
  validateBody(createShipmentRequestSchema.partial()),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<{ courierId?: number }>(req);

      const shipment = await assignAwbAndGenerateLabel({
        shipmentId: routeParam(req, 'shipmentId'),
        courierId: body.courierId ?? null,
        actorEmail: principal?.email ?? 'system',
        actorId: principal?.id ?? null,
      });

      sendSuccess(res, shipment, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Request a courier pickup.
 *
 * Deliberately does **not** mark the order as shipped. A pickup request is a
 * request; the parcel is in transit only once the courier scans it, which
 * arrives through the tracking webhook.
 */
adminShipmentsRouter.post(
  '/:shipmentId/pickup',
  requireAdmin,
  requirePermission('shipping:write'),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const shipment = await requestPickup({
        shipmentId: routeParam(req, 'shipmentId'),
        actorEmail: principal?.email ?? 'system',
        actorId: principal?.id ?? null,
      });
      sendSuccess(res, shipment, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Cancel a shipment, through the carrier. */
adminShipmentsRouter.post(
  '/:shipmentId/cancel',
  requireAdmin,
  requirePermission('shipping:write'),
  validateBody(cancelShipmentRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<{ reason: string }>(req);

      const shipment = await cancelShipment({
        shipmentId: routeParam(req, 'shipmentId'),
        reason: body.reason,
        actorEmail: principal?.email ?? 'system',
        actorId: principal?.id ?? null,
      });

      sendSuccess(res, shipment, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Pull the latest tracking state from the carrier. */
adminShipmentsRouter.post(
  '/:shipmentId/refresh',
  requireAdmin,
  requirePermission('shipping:write'),
  async (req, res, next) => {
    try {
      const shipment = await refreshShipmentTracking(routeParam(req, 'shipmentId'));
      if (!shipment) {
        throw new NotFoundError('Shipment');
      }
      sendSuccess(res, shipment, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
