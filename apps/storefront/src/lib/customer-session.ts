'use client';

import { readJSON, remove, writeJSON } from './safe-storage';

/**
 * The customer's API session.
 *
 * ## Why this exists at all
 *
 * The storefront used to keep a name and an email in `localStorage` and call
 * that "signed in". That was honest about what it was — a demo — but it meant
 * nothing on the server knew who the shopper was. Two real features depend on
 * the server knowing:
 *
 *   - the customer's own account, orders and addresses;
 *   - **attributing an interaction to a person**, which is the whole point of
 *     the interaction ledger. "Somebody tapped add-to-cart" is a number;
 *     "this customer tapped add-to-cart on this design" is a person somebody
 *     can help.
 *
 * So this module is the client half of `/v1/auth/*`. It stores the token pair
 * the API issues and exposes the access token to the tracker.
 *
 * ## Why the token is in `localStorage` and not in a cookie
 *
 * The admin panel puts its session in an httpOnly cookie because the admin is
 * rendered on the server and never needs the token in the browser. The
 * storefront's interaction tracker *does* need the token in the browser: it
 * posts events from the page, after the server render is long finished. A
 * cookie would work for that too, but the API is on a different origin in
 * development and `credentials: 'include'` would then require a CORS
 * allowlist change and a SameSite story the shop does not need yet.
 *
 * This is a deliberate trade with a known cost: a token in `localStorage` is
 * readable by any script that manages to run on this origin. It is mitigated by
 * a short access-token lifetime (15 minutes, refreshed silently) and by the fact
 * that no credential — only a bearer token — lives here, but it is a trade, not
 * a free win, and it is written down so it can be revisited.
 *
 * ## Expiry is checked locally, but never trusted
 *
 * The expiry is stored so the client can avoid sending a token it knows is
 * dead. It is *not* an authorisation decision: the API verifies the signature
 * and the expiry on every request, and that is the only authority.
 */

const KEY = 'ajooba-session-v1';

/** The stored session. Mirrors `AuthSession` from the contracts, plus a clock. */
export interface CustomerSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds at which the access token stops being usable. */
  expiresAt: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * The current session, or `null`.
 *
 * An expired access token is still returned by `read()` — a caller may want to
 * know who is signed in even when the token needs refreshing — but
 * `accessToken()` is what the tracker calls, and that one refuses an expired
 * token so a request is never sent with credentials the API will reject.
 */
export const customerSession = {
  read(): CustomerSession | null {
    const stored = readJSON<CustomerSession | null>(KEY, null);
    if (!stored || typeof stored.accessToken !== 'string') return null;
    return stored;
  },

  /** The access token, but only while it is still valid. */
  accessToken(): string | null {
    const session = customerSession.read();
    if (!session) return null;
    // 30 seconds of slack, so a token is not used exactly as it expires.
    if (session.expiresAt - 30_000 <= Date.now()) return null;
    return session.accessToken;
  },

  /**
   * Store the pair the API returned.
   *
   * `expiresIn` is seconds, as the contract defines it. The absolute deadline is
   * computed once, here, rather than re-derived at every read.
   */
  save(input: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: CustomerSession['user'];
  }): void {
    writeJSON<CustomerSession>(KEY, {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: Date.now() + input.expiresIn * 1000,
      user: input.user,
    });
    notify();
  },

  clear(): void {
    remove(KEY);
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/** The browser-side API base. Public by definition. */
function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

let refreshInFlight: Promise<string | null> | null = null;

/** A failure from the customer auth surface, with the API's own message. */
export class CustomerAuthError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CustomerAuthError';
    this.code = code;
  }
}

/**
 * A request against `/v1/auth/*`.
 *
 * Deliberately tiny: the storefront has one auth surface and it needs three
 * calls. A generic API client here would duplicate `@/lib/api`, which is the
 * server's client and must stay server-only.
 */
async function post<T>(path: string, body: unknown): Promise<T> {
  const base = apiBase();
  if (!base) {
    throw new CustomerAuthError('The shop is not configured to reach its API.', 'NO_API');
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new CustomerAuthError(
      'We could not reach the shop just now. Please try again.',
      'UNREACHABLE',
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;

  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new CustomerAuthError(
      payload.error?.message ?? 'That did not work. Please try again.',
      payload.error?.code ?? 'UNKNOWN',
    );
  }

  return payload.data;
}

/** Rotate an expired access token once for all requests in this browser tab. */
async function refreshCustomerAccessToken(): Promise<string | null> {
  const session = customerSession.read();
  if (!session) return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    let response: Response;
    try {
      response = await fetch(`${apiBase()}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
        cache: 'no-store',
      });
    } catch {
      throw new CustomerAuthError(
        'We could not refresh your sign-in. Check your connection and try again.',
        'UNREACHABLE',
      );
    }

    const payload = (await response.json().catch(() => ({}))) as Envelope<{
      kind: 'customer' | 'admin';
      tokens: { accessToken: string; refreshToken: string; expiresIn: number };
    }>;

    if (!response.ok || !payload.ok || !payload.data || payload.data.kind !== 'customer') {
      customerSession.clear();
      return null;
    }

    customerSession.save({ ...payload.data.tokens, user: session.user });
    return payload.data.tokens.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Make an authenticated request to the customer-facing API. */
export async function customerApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = customerSession.read();
  if (!session) {
    throw new CustomerAuthError('Sign in to continue.', 'UNAUTHENTICATED');
  }

  let token = customerSession.accessToken();
  if (!token) token = await refreshCustomerAccessToken();
  if (!token) {
    throw new CustomerAuthError(
      'Your sign-in has expired. Please sign in again.',
      'UNAUTHENTICATED',
    );
  }

  const makeRequest = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(`${apiBase()}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
  };

  let response: Response;
  try {
    response = await makeRequest(token);
  } catch {
    throw new CustomerAuthError(
      'We could not reach the shop just now. Please try again.',
      'UNREACHABLE',
    );
  }

  if (response.status === 401) {
    token = await refreshCustomerAccessToken();
    if (!token) {
      throw new CustomerAuthError(
        'Your sign-in has expired. Please sign in again.',
        'UNAUTHENTICATED',
      );
    }
    try {
      response = await makeRequest(token);
    } catch {
      throw new CustomerAuthError(
        'We could not reach the shop just now. Please try again.',
        'UNREACHABLE',
      );
    }
  }

  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new CustomerAuthError(
      payload.error?.message ?? 'That request could not be completed. Please try again.',
      payload.error?.code ?? 'UNKNOWN',
    );
  }

  return payload.data;
}

/** The session shape the API returns. Typed locally to avoid a server import. */
interface ApiSession {
  user: CustomerSession['user'];
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}

/** Sign in against the real API and keep the session. */
export async function signIn(email: string, password: string): Promise<CustomerSession['user']> {
  const session = await post<ApiSession>('/v1/auth/login', { email, password });
  customerSession.save({ ...session.tokens, user: session.user });
  return session.user;
}

/* -------------------------------------------------------------------------- */
/* Social sign-in                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Where the API's OAuth flow begins.
 *
 * The browser leaves the storefront entirely: this URL responds with a redirect
 * to Google or Facebook, so a plain navigation is the only thing that can
 * follow it. That is why the buttons are anchors rather than fetches.
 */
export function oauthStartUrl(provider: 'google' | 'facebook', next?: string): string {
  const base = `${apiBase()}/v1/auth/oauth/${provider}/start`;
  if (!next) return base;
  return `${base}?next=${encodeURIComponent(next)}`;
}

/** Which providers this deployment can complete a sign-in for. */
export async function fetchOAuthProviders(): Promise<Array<{ id: string; label: string }>> {
  try {
    const response = await fetch(`${apiBase()}/v1/auth/providers`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    const body = (await response.json()) as Envelope<{
      providers: Array<{ id: string; label: string }>;
    }>;
    return body.data?.providers ?? [];
  } catch {
    /*
     * A storefront that cannot reach the API renders no social buttons at all.
     * That is the correct degradation: the email form still works, and a button
     * that leads nowhere is worse than an absent one.
     */
    return [];
  }
}

/** What arrives in the fragment of `/auth/callback`. */
export interface OAuthCallbackPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  next: string;
}

/**
 * Read and store a session handed back by the OAuth callback.
 *
 * The token pair arrives in the URL fragment. This parses it, keeps the session,
 * and returns where to go next. It is deliberately separate from a component so
 * the fragment never has to survive a React render: it is read once, stored, and
 * the caller navigates away immediately.
 *
 * Because the API has already signed the customer in and told us who they are
 * only by token, the profile is fetched afterwards with that token — the
 * fragment carries credentials, not personal data, so a screenshot of the
 * address bar is not a screenshot of somebody's account.
 */
export async function acceptOAuthSession(hash: string): Promise<{
  next: string;
  user: CustomerSession['user'];
} | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  const expiresIn = Number(params.get('expiresIn') ?? '0');
  const rawNext = params.get('next') ?? '/account';

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }

  /*
   * The fragment's `next` is signed into the state by the API and validated
   * there, but it is re-checked here anyway: this is the value handed to a
   * router, and a relative-path check costs one line.
   */
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account';

  const response = await fetch(`${apiBase()}/v1/auth/me`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });

  if (!response.ok) return null;

  const body = (await response.json()) as Envelope<CustomerSession['user']>;
  if (!body.data) return null;

  customerSession.save({ accessToken, refreshToken, expiresIn, user: body.data });
  return { next, user: body.data };
}

/** Register, which signs the customer in on the same response. */
export async function signUp(input: {
  email: string;
  password: string;
  /**
   * Optional. The API accepts a sign-up without one and the shopper is asked for
   * a real number at checkout, so omitting it is a supported path rather than a
   * hole. Sending `''` is not — an empty string fails the phone-shape check.
   */
  phone?: string;
  firstName: string;
  lastName: string;
}): Promise<CustomerSession['user']> {
  const session = await post<ApiSession>('/v1/auth/register', input);
  customerSession.save({ ...session.tokens, user: session.user });
  return session.user;
}

/**
 * Ask for a password reset link.
 *
 * The API answers identically whether or not the address has an account, and
 * this function does not attempt to distinguish the two — that is the point.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await post<{ sent: boolean }>('/v1/auth/password-reset/request', { email });
}

/** Sign out locally. The refresh token is revoked by the caller if it can be. */
export async function signOut(): Promise<void> {
  const session = customerSession.read();
  customerSession.clear();
  if (!session) return;
  try {
    await fetch(`${apiBase()}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
      cache: 'no-store',
    });
  } catch {
    /* A session we can no longer revoke is still a session we must forget. */
  }
}
