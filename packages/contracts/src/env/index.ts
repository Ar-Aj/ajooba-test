import { z } from 'zod';

/**
 * Environment variable contracts.
 *
 * These schemas are the ONLY way environment variables are read in this
 * monorepo. Each application parses its own environment with the schema that
 * matches its role, so a missing or malformed variable fails at boot rather
 * than at the first request that needs it.
 *
 * Design rules:
 *  - No default values for secrets. A missing secret is a boot failure.
 *  - No production URLs are hardcoded. They come from platform env vars.
 *  - Only `NEXT_PUBLIC_*` variables are exposed to the browser bundle.
 *    See `docs/ARCHITECTURE.md` § Environment Strategy.
 */

/**
 * Treat a blank string as "not provided".
 *
 * Deployment templates commonly ship optional secrets as an empty
 * placeholder (`RAZORPAY_KEY_SECRET=`). Rejecting that with a cryptic
 * "Too small: expected string to have >=1 characters" error at boot is
 * unhelpful; treating it as absent matches what the operator meant.
 */
function blankToUndefined<T extends z.ZodType<string>>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, schema.optional());
}

/**
 * Variables required by the Express API (server-only).
 */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  /** HTTP port the API binds to. */
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /** MongoDB connection string (Atlas). */
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  /** Logical database name. Derived from the connection string when omitted. */
  MONGODB_DB: blankToUndefined(z.string().min(1)),

  /** Public base URL of the API, used to build absolute links. */
  API_PUBLIC_URL: z.string().url(),

  /** Allowed CORS origins. Comma separated. */
  CORS_ORIGINS: z.string().min(1),

  /** Comma separated list of allowed admin origins (subset of CORS_ORIGINS). */
  ADMIN_ORIGINS: blankToUndefined(z.string().min(1)),

  /** Public URL of the customer storefront. */
  STOREFRONT_PUBLIC_URL: z.string().url(),

  /** Public URL of the admin panel. */
  ADMIN_PUBLIC_URL: z.string().url(),

  /** Secret used to sign admin session tokens. Must be >= 32 chars. */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  /**
   * Razorpay key id — publishable, but still server-configured.
   *
   * A blank value is treated as "not configured" rather than as an error:
   * deployment templates routinely ship the key as an empty placeholder,
   * and payments are not enabled in this phase.
   */
  RAZORPAY_KEY_ID: blankToUndefined(z.string().min(1)),

  /**
   * Razorpay key secret — server only, never sent to the browser.
   * Blank means "not configured"; see `RAZORPAY_KEY_ID`.
   */
  RAZORPAY_KEY_SECRET: blankToUndefined(z.string().min(1)),

  /** Log level for pino. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/**
 * Variables required by the customer storefront (Next.js).
 *
 * Only `NEXT_PUBLIC_*` values reach the browser bundle. Everything else is
 * read in server components / route handlers and stays on the server.
 */
export const storefrontEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  /** Base URL of the REST API, called from the server. */
  API_INTERNAL_URL: z.string().url(),

  /** Base URL of the REST API, used by browser-side fetches. */
  NEXT_PUBLIC_API_URL: z.string().url(),

  /** Canonical public origin of this storefront, used for SEO/metadata. */
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  /** Public base path for catalogue images (served from `public/`). */
  NEXT_PUBLIC_MEDIA_BASE_URL: z.string().min(1).default('/'),

  /** Optional revalidation window for catalogue pages, in seconds. */
  CATALOG_REVALIDATE_SECONDS: z.coerce.number().int().min(0).default(300),
});

export type StorefrontEnv = z.infer<typeof storefrontEnvSchema>;

/**
 * Variables required by the admin panel (Next.js).
 */
export const adminEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  /** Base URL of the REST API, called from the server. */
  API_INTERNAL_URL: z.string().url(),

  /** Base URL of the REST API, used by browser-side fetches. */
  NEXT_PUBLIC_API_URL: z.string().url(),

  /** Canonical public origin of this admin panel. */
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  /** Public base path for catalogue images. */
  NEXT_PUBLIC_MEDIA_BASE_URL: z.string().min(1).default('/'),
});

export type AdminEnv = z.infer<typeof adminEnvSchema>;
