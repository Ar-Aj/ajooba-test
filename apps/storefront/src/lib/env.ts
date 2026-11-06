import { storefrontEnvSchema, type StorefrontEnv } from '@ajooba/contracts';

/**
 * Central, validated environment configuration for the storefront.
 *
 * SERVER-ONLY. Importing this module from a Client Component will, at the
 * very least, leak server config into the bundle; at worst it will throw at
 * module load because the browser is missing server-only variables. Client
 * Components should use:
 *
 *   - `mediaUrl` from `@/lib/media`  (depends on `NEXT_PUBLIC_MEDIA_BASE_URL`)
 *
 * This module is imported only by server components, route handlers and
 * server actions.
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
 * Server-only. See file docstring.
 */
export const storefrontEnv: Readonly<StorefrontEnv> = Object.freeze(parseEnv());

/** Build an absolute URL to an API endpoint. Server-only. */
export function apiUrl(path: string): string {
  return new URL(path, storefrontEnv.API_INTERNAL_URL).toString();
}

/** ISR revalidation window for catalogue pages, in seconds. Server-only. */
export const revalidateSeconds = storefrontEnv.CATALOG_REVALIDATE_SECONDS;
