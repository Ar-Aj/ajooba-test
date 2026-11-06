import { cookies } from 'next/headers';
import { apiUrl } from '@/lib/env';
import { resolveProxiedPath } from '@/lib/proxy-path';

/**
 * Authenticated proxy for the admin's own API calls.
 *
 * The browser calls this route; the route attaches the httpOnly session
 * cookie as a bearer token when talking to the API. That keeps the token out
 * of the client bundle while letting the panel use ordinary `fetch`.
 *
 * ## Why the path is validated
 *
 * `path` is browser-supplied. Forwarding it without validation would let a
 * caller escape the intended `/v1/admin/content/…` prefix with a relative
 * segment, turning this route into an open proxy into the rest of the
 * administrator API. The path is therefore resolved against the fixed
 * prefix and refused if it lands outside it — see `lib/proxy-path.ts`.
 */

/** The API prefix this proxy is allowed to reach. */
const CONTENT_PREFIX = '/v1/admin/content';

/** The failure body for a refused request. */
function badPath(): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'That is not a valid administration endpoint.',
      },
    },
    { status: 400 },
  );
}

/** Read the administrator's session token from the httpOnly cookie. */
async function readToken(): Promise<string | null> {
  return (await cookies()).get('ajooba_admin_token')?.value ?? null;
}

export async function GET(request: Request) {
  const token = await readToken();
  if (!token) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const incoming = new URL(request.url);
  const target = incoming.searchParams.get('path') ?? '';
  const params = incoming.searchParams.get('params') ?? '';

  const resolved = resolveProxiedPath(CONTENT_PREFIX, target);
  if (!resolved) {
    return badPath();
  }

  /*
   * The resolved path is already absolute and inside the prefix. It is
   * re-based onto the real API origin, and the query string is forwarded
   * verbatim so the API's own Zod validation decides what is acceptable.
   */
  const upstreamUrl = new URL(apiUrl(resolved.pathname + resolved.search));
  if (params) {
    upstreamUrl.search = params;
  }

  const upstream = await fetch(upstreamUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Persist the homepage. */
export async function PUT(request: Request) {
  const token = await readToken();
  if (!token) {
    return Response.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const body = await request.text();

  const upstream = await fetch(apiUrl('/v1/admin/content/homepage/sections'), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
