import rateLimit, { type Options } from 'express-rate-limit';
import { ApiErrorCode } from '@ajooba/contracts';
import { env } from '../config/env.js';
/**
 * Rate limiting.
 *
 * A coarse global limit is mounted at `/v1` in `app.ts`. This module
 * provides the **route-specific** limits, which are deliberately much
 * tighter on the routes where abuse is actually dangerous:
 *
 *  - sign-in and registration, because they are the credential-stuffing
 *    surface;
 *  - password change and token refresh, because they are the account
 *    takeover surface;
 *  - checkout, because each request can place a real order;
 *  - coupon validation, because it is a cheap way to enumerate discounts.
 *
 * Every limiter returns the standard `RateLimit-*` headers and a body in
 * the platform's error envelope, so a client sees the same shape it sees
 * everywhere else.
 *
 * The budgets come from validated environment variables (see
 * `RATE_LIMIT_*` in `@ajooba/contracts`), not from constants, so a
 * deployment behind a shared NAT can raise a limit deliberately and the
 * test suite can run unthrottled without weakening production.
 */

/**
 * The failure body a limiter sends.
 *
 * It matches the API error envelope exactly, so the client-side error
 * handling does not need a special case. The type is declared here
 * because `express-rate-limit` types its `message` option as `any`.
 */
interface RateLimitedBody {
  readonly ok: false;
  readonly error: {
    readonly code: typeof ApiErrorCode.RATE_LIMITED;
    readonly message: string;
  };
}

/**
 * Build the failure body. It matches the API error envelope exactly, so
 * the client-side error handling does not need a special case.
 */
function rateLimitedBody(message: string): RateLimitedBody {
  return {
    ok: false,
    error: {
      code: ApiErrorCode.RATE_LIMITED,
      message,
    },
  };
}

/**
 * The shared options every limiter uses.
 *
 * `Partial<Options>` is used deliberately: `Options` declares `windowMs`
 * and `limit` as required, but each limiter supplies them alongside these
 * shared values. Typing the shared block as the full `Options` would make
 * every limiter object fail to satisfy it.
 */
const baseOptions = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
} satisfies Partial<Options>;

/**
 * Sign-in: 10 attempts per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_AUTH_MAX,
  message: rateLimitedBody('Too many sign-in attempts. Please try again later.'),
});

/**
 * Registration: 5 accounts per hour per IP.
 */
export const registerLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: env.RATE_LIMIT_REGISTER_MAX,
  message: rateLimitedBody('Too many accounts created from this address. Please try again later.'),
});

/**
 * Token refresh: 30 per 15 minutes per IP.
 */
export const refreshLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_REFRESH_MAX,
  message: rateLimitedBody('Too many token refresh requests. Please try again later.'),
});

/**
 * Checkout: 20 per 10 minutes per IP.
 */
export const checkoutLimiter = rateLimit({
  ...baseOptions,
  windowMs: 10 * 60 * 1000,
  limit: env.RATE_LIMIT_CHECKOUT_MAX,
  message: rateLimitedBody('Too many checkout attempts. Please try again shortly.'),
});

/**
 * Coupon validation: 30 per 5 minutes per IP.
 */
export const couponLimiter = rateLimit({
  ...baseOptions,
  windowMs: 5 * 60 * 1000,
  limit: env.RATE_LIMIT_COUPON_MAX,
  message: rateLimitedBody('Too many coupon checks. Please try again shortly.'),
});

/**
 * Password change: 10 per 15 minutes per IP.
 */
export const passwordLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_PASSWORD_MAX,
  message: rateLimitedBody('Too many password change attempts. Please try again later.'),
});

/**
 * Analytics event recording: 120 per minute per IP.
 *
 * Generous enough that a normal browsing session never hits it, tight
 * enough to stop an event-flood.
 */
export const analyticsLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: env.RATE_LIMIT_ANALYTICS_MAX,
  message: rateLimitedBody('Too many analytics events. Please slow down.'),
});

/**
 * Admin write operations: 120 per minute per IP.
 */
export const adminWriteLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: env.RATE_LIMIT_ADMIN_WRITE_MAX,
  message: rateLimitedBody('Too many administrative changes. Please slow down.'),
});
