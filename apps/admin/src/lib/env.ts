import { adminEnvSchema, type AdminEnv } from '@ajooba/contracts';

/**
 * Central, validated environment configuration for the admin panel.
 *
 * Only `NEXT_PUBLIC_*` variables reach the browser bundle. Admin credentials
 * and session secrets live in the API process, never here.
 */

function readServerEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: process.env.NODE_ENV,
    API_INTERNAL_URL: process.env.API_SERVICE_URL ?? process.env.API_INTERNAL_URL,
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ?? (process.env.VERCEL ? '/api' : undefined),
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : undefined),
    NEXT_PUBLIC_MEDIA_BASE_URL: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
  };
}

function parseEnv(): AdminEnv {
  const parsed = adminEnvSchema.safeParse(readServerEnv());

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration for @ajooba/admin:\n${issues}\n\n` +
        'Copy .env.example to .env.local and fill in the required values.',
    );
  }

  return parsed.data;
}

export const adminEnv: Readonly<AdminEnv> = Object.freeze(parseEnv());

/** Build an absolute URL to an API endpoint. */
export function apiUrl(path: string): string {
  const baseUrl = adminEnv.API_INTERNAL_URL;
  if (!baseUrl) {
    throw new Error('API service binding is missing. Configure the admin-to-api binding.');
  }
  return new URL(path, baseUrl).toString();
}

/** Build an absolute URL to a public asset served from `public/`. */
export function mediaUrl(path: string): string {
  const base = adminEnv.NEXT_PUBLIC_MEDIA_BASE_URL.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
