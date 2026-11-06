import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import {
  adminOrderQuerySchema,
  checkoutRequestSchema,
  orderStatusUpdateRequestSchema,
  verifyPaymentRequestSchema,
  type AddressInput,
  type AdminOrderQuery,
  type CheckoutRequest,
  type OrderAddress,
  type OrderStatusUpdateRequest,
  type VerifyPaymentRequest,
} from '@ajooba/contracts';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requireCustomer, requirePermission } from '../middleware/auth.js';
import { checkoutLimiter } from '../middleware/rate-limit.js';
import { validateBody, validateQuery, validated, validatedBody } from '../middleware/validate.js';
import { idempotent } from '../middleware/idempotency.js';
import { buildCart, deleteCart } from '../services/cart.service.js';
import {
  getOrderById,
  getOrderByNumber,
  getOrderForCustomer,
  listAdminOrders,
  listCustomerOrders,
  placeOrder,
  updateOrderStatus,
} from '../services/order.service.js';
import {
  createPaymentIntent,
  listPaymentsForOrder,
  paymentConfiguration,
  verifyAndSettlePayment,
} from '../services/payment.service.js';
import { UserModel } from '../models/user.model.js';
import { writeAuditLog } from '../services/audit.service.js';

/**
 * Checkout and order routes.
 *
 * The checkout endpoint is the only place in the platform where money
 * becomes an obligation, so it is defended on several fronts at once:
 *
 *  - it is **idempotent** — a repeated request with the same key returns
 *    the original order instead of creating a second one;
 *  - it is **rate limited**;
 *  - it takes **no prices from the client** — the server reads them from
 *    the live variants;
 *  - it **reserves stock atomically**, so two customers cannot both buy
 *    the last pair.
 */

export const checkoutRouter: Router = Router();
export const ordersRouter: Router = Router();
export const adminOrdersRouter: Router = Router();
export const paymentsRouter: Router = Router();
export const adminPaymentsRouter: Router = Router();

/**
 * The payment-intent route takes no body.
 *
 * Declared explicitly rather than skipping validation, so the route still
 * goes through the same validation middleware as every other write and a
 * future stray field is rejected rather than silently ignored.
 */
const emptyBodySchema = z.object({}).strict();

/**
 * A saved address, as it comes back from the customer record.
 */
interface SavedAddress {
  _id: Types.ObjectId;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Resolve an address from either a saved address id or an inline address.
 */
async function resolveAddress(
  customerId: string,
  savedId: string | undefined,
  inline: AddressInput | undefined,
  label: string,
): Promise<OrderAddress> {
  if (savedId) {
    const customer = await UserModel.findById(customerId)
      .select('addresses')
      .lean<{ addresses: SavedAddress[] } | null>();

    const address = customer?.addresses.find((entry) => entry._id.toString() === savedId);

    if (!address) {
      throw new NotFoundError(`${label} address`);
    }

    return {
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
    };
  }

  if (!inline) {
    throw new ValidationError(`A ${label} address is required.`);
  }

  return {
    fullName: inline.fullName,
    phone: inline.phone,
    line1: inline.line1,
    line2: inline.line2,
    city: inline.city,
    state: inline.state,
    postalCode: inline.postalCode,
    country: inline.country,
  };
}

/**
 * Place an order.
 */
checkoutRouter.post(
  '/orders',
  requireCustomer,
  checkoutLimiter,
  idempotent({ required: true }),
  validateBody(checkoutRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      /*
       * The lines come from the server-side cart, not from the request
       * body. A client that tampers with the body cannot change what is
       * bought — it can only change the address and the coupon.
       */
      const cart = await buildCart({ customerId: principal.id });
      if (cart.items.length === 0) {
        throw new ConflictError('Your cart is empty.');
      }

      const unavailable = cart.items.filter((item) => !item.isAvailable);
      if (unavailable.length > 0) {
        throw new ConflictError(
          `Some items are no longer available: ${unavailable
            .map((item) => `${item.sku} (size ${item.size})`)
            .join(', ')}.`,
        );
      }

      const customer = await UserModel.findById(principal.id).lean<{
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
      } | null>();

      if (!customer) {
        throw new UnauthorizedError('Your session is invalid or has expired.');
      }

      const body = validatedBody<CheckoutRequest>(req);

      const shippingAddress = await resolveAddress(
        principal.id,
        body.shippingAddressId,
        body.shippingAddress,
        'shipping',
      );
      const billingAddress =
        body.billingAddressId || body.billingAddress
          ? await resolveAddress(
              principal.id,
              body.billingAddressId,
              body.billingAddress,
              'billing',
            )
          : shippingAddress;

      /*
       * The order's idempotency key is the **header** value, not the body
       * value.
       *
       * The `Idempotency-Key` header is what the idempotency middleware
       * requires and what a retrying client resends. Deriving the stored
       * key from the same source keeps the two in step: two clients
       * sending the same header produce the same order, even if their body
       * keys differ.
       */
      const idempotencyKey = req.header('idempotency-key')?.trim() ?? body.idempotencyKey ?? '';

      const order = await placeOrder({
        customerId: principal.id,
        customerName: `${customer.firstName} ${customer.lastName}`.trim(),
        customerEmail: customer.email,
        customerPhone: customer.phone,
        shippingAddress,
        billingAddress,
        ...(body.couponCode ? { couponCode: body.couponCode } : {}),
        paymentMethod: body.paymentMethod,
        idempotencyKey,
        lines: cart.items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      });

      // The cart is emptied only after the order exists.
      await deleteCart({ customerId: principal.id });

      sendSuccess(res, order, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * List the signed-in customer's own orders.
 */
ordersRouter.get('/', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 24);

    const result = await listCustomerOrders(
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
 * Read one of the signed-in customer's own orders.
 *
 * The lookup is scoped to the customer, so an order belonging to someone
 * else is a 404 rather than a 403.
 */
ordersRouter.get('/:orderNumber', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const { orderNumber } = req.params as { orderNumber: string };

    const order =
      (await getOrderByNumber(orderNumber)) ??
      (await getOrderForCustomer(orderNumber, principal.id));

    if (!order || order.customerId !== principal.id) {
      throw new NotFoundError('Order');
    }

    sendSuccess(res, order, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Report whether payments can actually be taken.
 *
 * Public by design: the storefront needs it to decide whether to offer a
 * card option or cash on delivery. It exposes only *whether* the integration
 * is configured and the publishable key id — never a secret, never an
 * endpoint that performs an action.
 */
paymentsRouter.get('/configuration', (_req, res) => {
  sendSuccess(res, paymentConfiguration(), getRequestId(res.req));
});

/**
 * Start (or resume) an online payment for an existing order.
 *
 * Returns only what Razorpay Checkout needs. The amount comes from the
 * stored order, so a tampered client cannot choose what it pays.
 *
 * Idempotent: the Razorpay order is created once and reused, so a customer
 * who closes the modal and comes back gets the same gateway order rather than
 * a second one.
 */
paymentsRouter.post(
  '/:orderId/intent',
  requireCustomer,
  checkoutLimiter,
  validateBody(emptyBodySchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const orderId = routeParam(req, 'orderId');

      // Ownership: a customer may only pay for their own order.
      const order = await getOrderForCustomer(orderId, principal.id);
      if (!order) {
        throw new NotFoundError('Order');
      }

      const intent = await createPaymentIntent(order);
      sendSuccess(res, intent, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Verify a Razorpay Checkout response.
 *
 * The browser's success handler is a claim. This endpoint checks the
 * signature against our own order id and then asks Razorpay what actually
 * happened. A `verified: true` response means the provider confirmed a
 * capture for exactly the order total.
 */
paymentsRouter.post(
  '/:orderId/verify',
  requireCustomer,
  checkoutLimiter,
  validateBody(verifyPaymentRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const orderId = routeParam(req, 'orderId');
      const body = validatedBody<VerifyPaymentRequest>(req);

      // Ownership first: never leak whether another customer's order exists.
      const order = await getOrderForCustomer(orderId, principal.id);
      if (!order) {
        throw new NotFoundError('Order');
      }

      const result = await verifyAndSettlePayment({
        orderId,
        razorpayPaymentId: body.razorpay_payment_id,
        razorpayOrderId: body.razorpay_order_id,
        razorpaySignature: body.razorpay_signature,
        correlationId: getRequestId(req),
      });

      /*
       * A verification failure is a normal, expected outcome (a decline, a
       * mismatch, a provider blip), not an HTTP error. Returning 200 with
       * `verified: false` keeps the client from treating an unconfirmed
       * payment as a server fault, while still refusing to mark the order
       * paid. Only a genuinely unauthenticated or unknown caller gets a 4xx.
       */
      sendSuccess(res, result, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The payments recorded against one of the customer's own orders.
 */
paymentsRouter.get('/:orderId', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const orderId = routeParam(req, 'orderId');
    const order = await getOrderForCustomer(orderId, principal.id);
    if (!order) {
      throw new NotFoundError('Order');
    }

    const payments = await listPaymentsForOrder(orderId);
    sendSuccess(res, payments, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * List every order, for the admin panel.
 */
adminOrdersRouter.get(
  '/',
  requireAdmin,
  requirePermission('orders:read'),
  validateQuery(adminOrderQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query`. `validateQuery`
       * stores its parsed result separately and leaves `req.query`
       * untouched, so reading `req.query` here would bypass the schema —
       * which is how an unrecognised `status` used to reach the Mongo
       * filter unchecked.
       */
      const query = validated<'query', AdminOrderQuery>(req, 'query');

      const result = await listAdminOrders(
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
          ...(query.customerId ? { customerId: query.customerId } : {}),
          ...(query.orderNumber ? { orderNumber: query.orderNumber } : {}),
          ...(query.from ? { from: new Date(query.from) } : {}),
          ...(query.to ? { to: new Date(query.to) } : {}),
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
 * Read any order.
 */
adminOrdersRouter.get(
  '/:orderId',
  requireAdmin,
  requirePermission('orders:read'),
  async (req, res, next) => {
    try {
      const order = await getOrderById(routeParam(req, 'orderId'));
      if (!order) {
        throw new NotFoundError('Order');
      }
      sendSuccess(res, order, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Move an order to a new status.
 */
adminOrdersRouter.patch(
  '/:orderId/status',
  requireAdmin,
  requirePermission('orders:write'),
  validateBody(orderStatusUpdateRequestSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<OrderStatusUpdateRequest>(req);
      const order = await updateOrderStatus(routeParam(req, 'orderId'), body.status, body.note);

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'status-change',
        entity: 'order',
        entityId: order.id,
        summary: `Order ${order.orderNumber} moved to "${order.status}".`,
        changes: { status: order.status },
        ip: req.ip ?? null,
      });

      sendSuccess(res, order, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The payments recorded against any order, for the admin panel.
 */
adminPaymentsRouter.get(
  '/:orderId',
  requireAdmin,
  requirePermission('orders:read'),
  async (req, res, next) => {
    try {
      const payments = await listPaymentsForOrder(routeParam(req, 'orderId'));
      sendSuccess(res, payments, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
