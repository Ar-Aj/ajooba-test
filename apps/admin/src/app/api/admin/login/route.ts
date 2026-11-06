import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/env';

/**
 * Administrator sign-in proxy.
 *
 * The API's access token is stored in an httpOnly, SameSite=strict cookie so
 * it is never readable from client JavaScript. The browser only ever posts
 * credentials to this route; the token stays on the server.
 */
export async function POST(request: Request) {
  let payload: { email?: string; password?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } },
      { status: 400 },
    );
  }

  if (!payload.email || !payload.password) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Email and password are required.' } },
      { status: 400 },
    );
  }

  const response = await fetch(apiUrl('/v1/admin/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: payload.email, password: payload.password }),
    cache: 'no-store',
  });

  const body = (await response.json().catch(() => ({}))) as {
    ok: boolean;
    data?: { admin?: unknown; tokens?: { accessToken?: string } };
    error?: { code: string; message: string };
  };

  /*
   * The API's login response is the standard envelope: the session sits under
   * `data`, and the access token sits under `data.tokens.accessToken`
   * (`AdminSession` in `@ajooba/contracts`, documented in
   * `docs/API_CONTRACT.md` § 1.5).
   *
   * This route used to read `body.data.accessToken` — one level too shallow.
   * That meant the token was never found, the route answered 401 "Sign-in
   * failed." for **every** sign-in, and no administrator could ever reach the
   * admin panel. The browser suite caught it; no unit test had, because the
   * route was never exercised against the real API shape.
   */
  const accessToken = body.data?.tokens?.accessToken;

  if (!response.ok || !body.ok || !accessToken) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: body.error?.code ?? 'UNAUTHORIZED',
          message: body.error?.message ?? 'Sign-in failed.',
        },
      },
      { status: response.status || 401 },
    );
  }

  const result = NextResponse.json({ ok: true, data: { authenticated: true } });
  result.cookies.set('ajooba_admin_token', accessToken, {
    httpOnly: true,
    sameSite: 'strict',
    /*
     * `secure: true` unconditionally.
     *
     * The previous value was `process.env.NODE_ENV === 'production'`, so a
     * **staging** deployment served over plain HTTP carried the session
     * token in cleartext. TLS is terminated by the platform in every
     * environment, so there is no case where the cookie should travel
     * over plain HTTP — and a browser that receives a `secure` cookie on
     * `http://localhost` simply drops it, which is the correct outcome
     * for a local session.
     */
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return result;
}
