import { apiEnvSchema, type ApiEnv } from '@ajooba/contracts';
import { config as loadDotenv } from 'dotenv';

/**
 * Central, validated environment configuration for the API.
 *
 * The environment is loaded exactly once, validated through the Zod schema in
 * `@ajooba/contracts`, and exposed as a frozen object. Every other module
 * imports `env` from here and never touches `process.env` directly.
 *
 * There is deliberately NO `mode: 'dev' | 'pro'` switch. Each deployment
 * target supplies its own variables through its platform (e.g. Vercel, Render,
 * Railway, Atlas). Validation fails fast at boot if something is missing.
 */

/*
 * Load the environment file.
 *
 * Convention (matching Next.js): in development, `.env.local` wins over
 * `.env`; in every other environment only `.env` is read, because the
 * platform supplies the real variables there and a stray local file must
 * never shadow them.
 */
const NODE_ENV = process.env.NODE_ENV ?? 'development';
loadDotenv({ path: NODE_ENV === 'development' ? '.env.local' : '.env' });
loadDotenv();

const parsed = apiEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Invalid environment configuration for @ajooba/api:\n${issues}\n\n` +
      'Copy .env.example to .env and fill in the required values. ' +
      'See docs/ARCHITECTURE.md section Environment Strategy.',
  );
}

export const env: Readonly<ApiEnv> = Object.freeze(parsed.data);

/**
 * Comma separated origin lists parsed into arrays.
 */
export const corsOrigins: readonly string[] = env.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

/**
 * The admin panel's origins.
 *
 * These are kept **separate** from `corsOrigins`, not unioned with them.
 * The storefront origin may call the customer API; the admin origin may
 * additionally call the administrator API. `ADMIN_ORIGINS` therefore
 * **overrides** `CORS_ORIGINS` for the `/v1/admin` and `/webhooks`
 * surfaces — it does not add to them.
 *
 * When it is not configured, `CORS_ORIGINS` is used for both surfaces, so
 * a deployment that has not separated them still works. Separating them is
 * a hardening step, not a prerequisite.
 */
export const adminOrigins: readonly string[] = (env.ADMIN_ORIGINS ?? env.CORS_ORIGINS)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

/**
 * Read an optional provider credential at call time.
 *
 * The validated `env` object is frozen at boot, which is exactly right for
 * *required* configuration: a missing secret must fail at startup, not at the
 * first request that needs it.
 *
 * Provider credentials are a different case. A deployment legitimately starts
 * with payments switched off and is switched on by setting the variables and
 * restarting; and the test suite must be able to exercise both the
 * "configured" and the "unconfigured" code paths against the same process.
 * Reading these at call time makes both possible without weakening the
 * startup validation, which still decides whether the deployment is
 * *allowed* to have them.
 *
 * The semantics match the schema's `blankToUndefined`: a blank or
 * whitespace-only value means "not configured", exactly as an operator
 * intends when a deployment template ships an empty placeholder.
 */
export function readProviderSetting(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Startup-time environment summary. Safe to log: it contains no secret
 * values, only names of the variables that are set.
 */
export function describeEnv(): Record<string, string | number | boolean> {
  return {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    API_PUBLIC_URL: env.API_PUBLIC_URL,
    STOREFRONT_PUBLIC_URL: env.STOREFRONT_PUBLIC_URL,
    ADMIN_PUBLIC_URL: env.ADMIN_PUBLIC_URL,
    CORS_ORIGINS: corsOrigins.length,
    ADMIN_ORIGINS: adminOrigins.length,
    MONGODB_DB: env.MONGODB_DB ?? '(derived from URI)',
    MEDIA_STATIC_DIR: env.MEDIA_STATIC_DIR ?? '(disabled)',
    RAZORPAY_CONFIGURED: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    LOG_LEVEL: env.LOG_LEVEL,
  };
}
