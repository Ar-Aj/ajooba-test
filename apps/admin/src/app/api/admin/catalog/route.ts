import { cookies } from 'next/headers';
import { apiUrl } from '@/lib/env';
import { resolveProxiedPath } from '@/lib/proxy-path';

/**
 * Authenticated proxy for the catalogue administration API.
 *
 * The browser never holds the access token: it calls this route, and the
 * route attaches the httpOnly session cookie as a bearer token when talking
 * to `/v1/admin/catalog/*` upstream.
 *
 * ## Why the path allow-list matters
 *
 * This route forwards an attacker-influenced path segment. Forwarding
 * blindly would turn the admin panel into an open proxy into the API's
 * internal network — `path=../../auth/login`, or a path that escapes the
 * intended prefix entirely. The segment is therefore validated against a
 * fixed grammar and the result is re-checked for traversal after
 * normalisation. Anything that is not a literal catalogue-admin endpoint is
 * refused here, before a request is made.
 *
 * The API remains the authority: every forwarded call still passes through
 * `requireAdmin` and `requirePermission`. This proxy is a transport
 * convenience, never a security boundary.
 */

/** The API prefix this proxy is allowed to reach. */
const CATALOG_PREFIX = '/v1/admin/catalog';

/** Build the upstream request, or `null` when the path is not permitted. */
function upstreamUrl(request: Request, method: string): URL | null {
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get('path') ?? '';

  const resolved = resolveProxiedPath(CATALOG_PREFIX, target);
  if (!resolved) return null;

  if (method === 'GET' || method === 'HEAD') {
    const url = new URL(apiUrl(resolved.pathname));
    // Forward the query verbatim so the API's own Zod validation decides
    // what is acceptable, rather than a second filter here that could
    // silently disagree with the contract.
    url.search = incoming.searchParams.get('query') ?? '';
    return url;
  }

  return new URL(apiUrl(resolved.pathname));
}

/** Send the browser's method and body through, unchanged. */
async function forward(request: Request): Promise<Response> {
  const token = (await cookies()).get('ajooba_admin_token')?.value;
  if (!token) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const url = upstreamUrl(request, request.method.toUpperCase());
  if (!url) {
    return Response.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'That is not a valid catalogue administration endpoint.',
        },
      },
      { status: 400 },
    );
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const upstream = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: await request.text() } : {}),
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
