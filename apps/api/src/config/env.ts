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

export const adminOrigins: readonly string[] = (env.ADMIN_ORIGINS ?? env.CORS_ORIGINS)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

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
    RAZORPAY_CONFIGURED: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    LOG_LEVEL: env.LOG_LEVEL,
  };
}
