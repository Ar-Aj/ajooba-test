import { cookies } from 'next/headers';
import { apiUrl } from '@/lib/env';
import { resolveProxiedPath } from '@/lib/proxy-path';

/**
 * Authenticated proxy for the promotions API.
 *
 * Same shape and same reasoning as the catalogue proxy: the browser sends an
 * endpoint-relative path, the route attaches the httpOnly session cookie as a
 * bearer token, and the path is validated against a fixed prefix so this cannot
 * become an open proxy into the rest of the administrator API.
 *
 * The API remains the authority on every forwarded call — this route adds no
 * permission logic of its own, because there is exactly one place where
 * authorisation can be enforced and it is not here.
 */

/** The API prefix this proxy is allowed to reach. */
const PROMOTIONS_PREFIX = '/v1/admin/coupons';

function buildUrl(request: Request, method: string): URL | null {
  const incoming = new URL(request.url);
  const target = incoming.searchParams.get('path') ?? '';

  const resolved = resolveProxiedPath(PROMOTIONS_PREFIX, target);
  if (!resolved) return null;

  if (method === 'GET' || method === 'HEAD') {
    const url = new URL(apiUrl(resolved.pathname));
    // Forward the query verbatim: the API's own Zod validation decides what is
    // acceptable, rather than a second filter here that could disagree with it.
    url.search = incoming.searchParams.get('query') ?? '';
    return url;
  }

  return new URL(apiUrl(resolved.pathname));
}

async function forward(request: Request): Promise<Response> {
  const token = (await cookies()).get('ajooba_admin_token')?.value;
  if (!token) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const method = request.method.toUpperCase();
  const url = buildUrl(request, method);
  if (!url) {
    return Response.json(
      {
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'That is not a valid promotions endpoint.' },
      },
      { status: 400 },
    );
  }

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
export const DELETE = forward;
