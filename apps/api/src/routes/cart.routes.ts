import { Router } from 'express';
import {
  addCartItemRequestSchema,
  applyCouponRequestSchema,
  updateCartItemRequestSchema,
  validateCouponRequestSchema,
  type AddCartItemRequest,
  type ApplyCouponRequest,
  type UpdateCartItemRequest,
  type ValidateCouponRequest,
} from '@ajooba/contracts';
import { NotFoundError } from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireCustomer, optionalAuth } from '../middleware/auth.js';
import { couponLimiter } from '../middleware/rate-limit.js';
import { validateBody, validatedBody } from '../middleware/validate.js';
import {
  addCartItem,
  applyCouponToCart,
  buildCart,
  cartProductCodes,
  clearCart,
  removeCartItem,
  removeCouponFromCart,
  resolveCoupon,
  updateCartItem,
  type CartScope,
} from '../services/cart.service.js';
import { computeDiscount, toDiscountRule } from '../services/pricing.service.js';

/**
 * Cart routes.
 *
 * The cart belongs to the signed-in customer. A guest cart is keyed by a
 * session id, which the storefront supplies as the `x-cart-session` header;
 * the customer routes here always operate on the customer-scoped cart, so
 * a guest cart can never be used to reach another customer's cart.
 *
 * Every price in a cart response is computed server-side from the live
 * variant. The client never supplies one.
 */

export const cartRouter: Router = Router();

/**
 * The cart scope for the signed-in customer.
 */
function customerScope(req: Parameters<typeof getRequestId>[0]): CartScope {
  const principal = (req as { principal?: { id: string } }).principal;
  if (!principal) {
    throw new NotFoundError('Cart');
  }
  return { customerId: principal.id };
}

/**
 * Read the cart.
 */
cartRouter.get('/', requireCustomer, async (req, res, next) => {
  try {
    const cart = await buildCart(customerScope(req));
    sendSuccess(res, cart, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Add a line to the cart.
 */
cartRouter.post(
  '/items',
  requireCustomer,
  validateBody(addCartItemRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<AddCartItemRequest>(req);
      const cart = await addCartItem(customerScope(req), body.variantId, body.quantity);
      sendSuccess(res, cart, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Set the quantity of a line. A quantity of zero removes it.
 */
cartRouter.patch(
  '/items/:variantId',
  requireCustomer,
  validateBody(updateCartItemRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<UpdateCartItemRequest>(req);
      const cart = await updateCartItem(
        customerScope(req),
        routeParam(req, 'variantId'),
        body.quantity,
      );
      sendSuccess(res, cart, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Remove a line from the cart.
 */
cartRouter.delete('/items/:variantId', requireCustomer, async (req, res, next) => {
  try {
    const cart = await removeCartItem(customerScope(req), routeParam(req, 'variantId'));
    sendSuccess(res, cart, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Empty the cart.
 */
cartRouter.delete('/', requireCustomer, async (req, res, next) => {
  try {
    const cart = await clearCart(customerScope(req));
    sendSuccess(res, cart, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Apply a coupon to the cart.
 */
cartRouter.post(
  '/coupon',
  requireCustomer,
  couponLimiter,
  validateBody(applyCouponRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<ApplyCouponRequest>(req);
      const cart = await applyCouponToCart(customerScope(req), body.code);
      sendSuccess(res, cart, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Remove the coupon from the cart.
 */
cartRouter.delete('/coupon', requireCustomer, async (req, res, next) => {
  try {
    const cart = await removeCouponFromCart(customerScope(req));
    sendSuccess(res, cart, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Check whether a coupon would apply, without changing the cart.
 *
 * This is a public endpoint because the storefront checks a code in the
 * cart drawer before the customer commits to it.
 *
 * **The subtotal is never taken from the client when the caller is
 * signed in.** The discount preview is computed against the server's own
 * view of the customer's cart — the same cart the checkout will use — so a
 * caller cannot ask "what would this coupon be worth on a ₹500,000
 * basket?" and use the answer to shop for a coupon that does not exist.
 *
 * For an **unauthenticated** caller there is no server-side cart, so no
 * discount amount is disclosed: the endpoint reports only whether the
 * coupon is real, active and within its window, and tells the client to
 * sign in or add to the cart for a value. Coupon *existence* is not
 * sensitive; a coupon's *value* is.
 */
export const couponValidationRouter: Router = Router();

couponValidationRouter.post(
  '/validate',
  optionalAuth,
  couponLimiter,
  validateBody(validateCouponRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<ValidateCouponRequest>(req);
      const principal = req.principal;

      let subtotal = body.subtotal;
      let basketProductCodes: string[] = [];

      if (principal) {
        /*
         * The signed-in customer's own cart is the only basket that means
         * anything. A client-supplied subtotal for a signed-in caller is
         * ignored entirely.
         */
        const cart = await buildCart(customerScope(req));
        subtotal = cart.subtotal;
        basketProductCodes = await cartProductCodes(customerScope(req));
      }

      const resolved = await resolveCoupon(body.code, subtotal, basketProductCodes);
      if ('error' in resolved) {
        sendSuccess(
          res,
          {
            valid: false,
            reason: resolved.error,
            discountAmount: 0,
            code: body.code.toUpperCase(),
          },
          getRequestId(req),
        );
        return;
      }

      /*
       * An unauthenticated caller gets no value disclosure. The coupon's
       * type and percentage would let someone enumerate what the business
       * is willing to give away on a basket they do not have.
       */
      if (!principal) {
        sendSuccess(
          res,
          {
            valid: true,
            reason: null,
            discountAmount: 0,
            code: resolved.coupon.code,
            type: resolved.coupon.type,
            value: resolved.coupon.value,
            requiresCart: true,
          },
          getRequestId(req),
        );
        return;
      }

      sendSuccess(
        res,
        {
          valid: true,
          reason: null,
          code: resolved.coupon.code,
          type: resolved.coupon.type,
          value: resolved.coupon.value,
          discountAmount: computeDiscount(toDiscountRule(resolved.coupon), subtotal),
        },
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);
