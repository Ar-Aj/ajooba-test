import { NextResponse } from 'next/server';
import { adminPath } from '@/lib/public-path';

/**
 * Administrator sign-out.
 *
 * A `POST`, deliberately, and not a `GET`: a link that ends a session can be
 * triggered by any image tag on any page, so signing out must require a form
 * submission. The sidebar's sign-out control is a real `<form>` for this reason.
 *
 * The cookie is cleared and the browser is sent to the sign-in screen. No API
 * call is required for the panel's own session — the access token is stateless
 * and expires on its own — but the route is the single place that knows how the
 * session is stored, so if that ever changes (a refresh token, a server-side
 * session), it changes here and nowhere else.
 */
export async function POST(request: Request) {
  const url = new URL(adminPath('/login'), request.url);
  const response = NextResponse.redirect(url, { status: 303 });

  response.cookies.set('ajooba_admin_token', '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    path: '/',
    maxAge: 0,
  });

  return response;
}
