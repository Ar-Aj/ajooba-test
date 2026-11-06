import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminPath } from '@/lib/public-path';

/**
 * Session gate for every panel screen.
 *
 * ## Presence check, not a permission check
 *
 * This only establishes that a session cookie exists, so an unauthenticated
 * visitor is sent to sign-in rather than being shown an empty panel. It is
 * **not** an authorisation check: the API validates the token and the
 * administrator's permissions on every request it serves, and that is the only
 * place authorisation can be enforced. A client-side or render-time check would
 * be decoration.
 *
 * The redirect carries the original path so sign-in can return the operator to
 * the screen they were trying to open — a small thing that a person notices
 * immediately when it is missing.
 */

/** The cookie the sign-in proxy sets. httpOnly; never read in the browser. */
export const ADMIN_COOKIE = 'ajooba_admin_token';

/** The administrator's raw access token, or `null`. Server-side only. */
export async function readToken(): Promise<string | null> {
  return (await cookies()).get(ADMIN_COOKIE)?.value ?? null;
}

/**
 * Send the visitor to sign-in, preserving where they were headed.
 *
 * `next` is validated by the login screen before it is used as a redirect
 * target, so a crafted value cannot bounce an authenticated administrator to an
 * external origin.
 */
export function redirectToLogin(from?: string): never {
  const target = from ? adminPath('/login?next=' + encodeURIComponent(from)) : adminPath('/login');
  redirect(target);
}

/** Require a session. Redirects to sign-in when there is none. */
export async function requireSession(from?: string): Promise<string> {
  const token = await readToken();
  if (!token) redirectToLogin(from);
  return token;
}
