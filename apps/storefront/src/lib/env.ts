import { storefrontEnvSchema, type StorefrontEnv } from '@ajooba/contracts';

/**
 * Central, validated environment configuration for the storefront.
 *
 * The schema is imported from `@ajooba/contracts` so that the storefront and
 * the API agree on the exact variable names and validation rules.
 *
 * IMPORTANT — browser bundle safety:
 *   Only `NEXT_PUBLIC_*` variables are inlined into the client bundle by
 *   Next.js. Every other variable is read in this module, which is imported
 *   exclusively by server components, route handlers and server actions.
 *   Never add a secret to a `NEXT_PUBLIC_` variable.
 */

function readServerEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: process.env.NODE_ENV,
    API_INTERNAL_URL: process.env.API_INTERNAL_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_MEDIA_BASE_URL: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
    CATALOG_REVALIDATE_SECONDS: process.env.CATALOG_REVALIDATE_SECONDS,
  };
}

function parseEnv(): StorefrontEnv {
  const parsed = storefrontEnvSchema.safeParse(readServerEnv());

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration for @ajooba/storefront:\n${issues}\n\n` +
        'Copy .env.example to .env.local and fill in the required values.',
    );
  }

  return parsed.data;
}

/**
 * Validated environment for the storefront.
 *
 * This module is server-only. Importing it from a Client Component would be
 * a mistake — use `NEXT_PUBLIC_*` values directly in client code instead.
 */
export const storefrontEnv: Readonly<StorefrontEnv> = Object.freeze(parseEnv());

/** Build an absolute URL to an API endpoint. */
export function apiUrl(path: string): string {
  return new URL(path, storefrontEnv.API_INTERNAL_URL).toString();
}

/** Build an absolute URL to a public asset served from `public/`. */
export function mediaUrl(path: string): string {
  const base = storefrontEnv.NEXT_PUBLIC_MEDIA_BASE_URL.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** ISR revalidation window for catalogue pages, in seconds. */
export const revalidateSeconds = storefrontEnv.CATALOG_REVALIDATE_SECONDS;
