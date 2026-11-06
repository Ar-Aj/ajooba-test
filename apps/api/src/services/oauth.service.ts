import type { Types } from 'mongoose';
import type { AuthSession, OAuthProvider } from '@ajooba/contracts';
import { readProviderSetting } from '../config/env.js';
import { AppError } from '../core/errors.js';
import { UserModel } from '../models/user.model.js';
import { writeAuditLog } from './audit.service.js';
import { issueCustomerSession, mapCustomer } from './auth.service.js';

/**
 * Social sign-in: Google and Facebook.
 *
 * ## The shape of the flow
 *
 *  1. The browser leaves for `GET /v1/auth/oauth/:provider/start`. The API
 *     mints a signed `state` token carrying the provider and the return path,
 *     and redirects to the provider's consent screen.
 *  2. The provider sends the shopper back to
 *     `GET /v1/auth/oauth/:provider/callback?code=…&state=…`.
 *  3. The API verifies the state, exchanges the code for an access token at the
 *     provider, reads the profile, finds or creates the customer, issues our own
 *     token pair, and redirects to the storefront with the pair in the fragment.
 *
 * ## Why the session comes back in the fragment, not in a cookie
 *
 * The API is on a different origin from the storefront in development, and the
 * storefront keeps its customer session in `localStorage` (see
 * `apps/storefront/src/lib/customer-session.ts` for that trade and its costs).
 * A cross-site cookie would need `SameSite=None`, an allowlisted origin, and a
 * consent story this shop does not have. The fragment is not sent to any server,
 * is not in the `Referer`, and is stripped from the address bar by the receiving
 * page immediately.
 *
 * ## Why an unverified-email collision is refused rather than merged
 *
 * If a shopper signs in with Google using an address that already has a
 * password account, the two are linked **only when Google says the address is
 * verified**. Otherwise anybody who can create an account at a provider for
 * someone else's address could take over the existing customer. When the
 * provider does not vouch for the address, the sign-in is refused with a message
 * that tells the shopper to sign in with their password instead.
 */

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A provider that has no client credentials configured.
 *
 * 503 rather than 500: the shop is working, this one door is not open yet, and
 * the message says which door. It is deliberately **exposed** — the shopper is
 * meant to read it and take the other route.
 */
export class ProviderNotConfiguredError extends AppError {
  constructor(provider: OAuthProvider) {
    super(
      'SERVICE_UNAVAILABLE',
      `${provider === 'google' ? 'Google' : 'Facebook'} sign-in is not available yet. Use your email and password.`,
      503,
      { expose: true },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Provider adapters                                                          */
/* -------------------------------------------------------------------------- */

/** What every provider adapter must produce, normalised. */
interface ProviderProfile {
  readonly providerId: string;
  readonly email: string;
  /**
   * Whether the provider vouches for the address. Only a verified address may
   * be linked to an existing password account.
   */
  readonly emailVerified: boolean;
  readonly firstName: string;
  readonly lastName: string;
}

interface ProviderAdapter {
  readonly id: OAuthProvider;
  readonly label: string;
  configured(): boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<ProviderProfile>;
}

/** Read a JSON response, turning a non-2xx into one honest error. */
async function readJson(response: Response, what: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `${what} refused the request. Please try again, or sign in with your email and password.`,
      502,
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      `${what} returned an unreadable response.`,
      502,
    );
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/* --- Google --------------------------------------------------------------- */

const google: ProviderAdapter = {
  id: 'google',
  label: 'Google',
  configured() {
    return Boolean(
      readProviderSetting('GOOGLE_OAUTH_CLIENT_ID') &&
        readProviderSetting('GOOGLE_OAUTH_CLIENT_SECRET'),
    );
  },
  authorizeUrl(state, redirectUri) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', readProviderSetting('GOOGLE_OAUTH_CLIENT_ID') ?? '');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    /*
     * `select_account` matters for a shared device: without it Google silently
     * reuses the last session, and the next person on the laptop signs in as
     * somebody else without ever seeing a chooser.
     */
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set('access_type', 'online');
    return url.toString();
  },
  async exchange(code, redirectUri) {
    const body = new URLSearchParams({
      code,
      client_id: readProviderSetting('GOOGLE_OAUTH_CLIENT_ID') ?? '',
      client_secret: readProviderSetting('GOOGLE_OAUTH_CLIENT_SECRET') ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const tokens = await readJson(tokenResponse, 'Google');
    const accessToken = str(tokens.access_token);
    if (!accessToken) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Google did not return an access token.',
        502,
      );
    }

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const profile = await readJson(profileResponse, 'Google');

    const email = str(profile.email).trim().toLowerCase();
    if (!email) {
      throw new AppError(
        'VALIDATION_FAILED',
        'That Google account does not share an email address, so we cannot open an account. Add one to Google, or sign up with your email here.',
        422,
      );
    }

    return {
      providerId: str(profile.sub),
      email,
      emailVerified: profile.email_verified === true,
      firstName: str(profile.given_name) || email.split('@')[0] || 'Friend',
      lastName: str(profile.family_name),
    };
  },
};

/* --- Facebook ------------------------------------------------------------- */

const facebook: ProviderAdapter = {
  id: 'facebook',
  label: 'Facebook',
  configured() {
    return Boolean(
      readProviderSetting('FACEBOOK_OAUTH_APP_ID') &&
        readProviderSetting('FACEBOOK_OAUTH_APP_SECRET'),
    );
  },
  authorizeUrl(state, redirectUri) {
    const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
    url.searchParams.set('client_id', readProviderSetting('FACEBOOK_OAUTH_APP_ID') ?? '');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'email,public_profile');
    url.searchParams.set('response_type', 'code');
    return url.toString();
  },
  async exchange(code, redirectUri) {
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', readProviderSetting('FACEBOOK_OAUTH_APP_ID') ?? '');
    tokenUrl.searchParams.set('client_secret', readProviderSetting('FACEBOOK_OAUTH_APP_SECRET') ?? '');
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokens = await readJson(await fetch(tokenUrl), 'Facebook');
    const accessToken = str(tokens.access_token);
    if (!accessToken) {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Facebook did not return an access token.',
        502,
      );
    }

    const profileUrl = new URL('https://graph.facebook.com/v19.0/me');
    profileUrl.searchParams.set('fields', 'id,email,first_name,last_name');
    profileUrl.searchParams.set('access_token', accessToken);
    const profile = await readJson(await fetch(profileUrl), 'Facebook');

    const email = str(profile.email).trim().toLowerCase();
    if (!email) {
      /*
       * Facebook omits the address when the person unchecked the email
       * permission, and older accounts sometimes have none at all. Without an
       * address we cannot create a record that could ever send an order
       * confirmation, so this is a refusal rather than a half-account.
       */
      throw new AppError(
        'VALIDATION_FAILED',
        'Facebook did not share an email address, so we cannot open an account. Sign up with your email here instead.',
        422,
      );
    }

    return {
      providerId: str(profile.id),
      email,
      /*
       * Facebook does not return an `email_verified` flag. An address that
       * Facebook hands back through the `email` permission is not vouched for in
       * the sense Google's flag means, so it is treated as unverified — which
       * means it cannot be silently linked to an existing password account.
       */
      emailVerified: false,
      firstName: str(profile.first_name) || email.split('@')[0] || 'Friend',
      lastName: str(profile.last_name),
    };
  },
};

const ADAPTERS: Record<OAuthProvider, ProviderAdapter> = { google, facebook };

export function getAdapter(provider: string): ProviderAdapter | null {
  return provider === 'google' || provider === 'facebook' ? ADAPTERS[provider] : null;
}

/** Which providers this deployment can actually complete a sign-in for. */
export function availableProviders(): Array<{ id: OAuthProvider; label: string }> {
  return Object.values(ADAPTERS)
    .filter((adapter) => adapter.configured())
    .map((adapter) => ({ id: adapter.id, label: adapter.label }));
}

/** The callback URL registered with the provider. Derived, never configured
 * separately — two sources for one URL is how OAuth redirect mismatches happen. */
export function redirectUriFor(provider: OAuthProvider, apiPublicUrl: string): string {
  return `${apiPublicUrl.replace(/\/+$/, '')}/v1/auth/oauth/${provider}/callback`;
}

/* -------------------------------------------------------------------------- */
/* Account resolution                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Find or create the customer behind a verified provider profile.
 *
 * Order matters and each step is written down because reversing any of them
 * would create an account-takeover path:
 *
 *  1. **By provider id first.** A returning shopper whose provider email changed
 *     is still the same person; matching on the id keeps their orders attached.
 *  2. **Then by email**, but only when the provider vouches for the address.
 *     Otherwise a provider that lets somebody claim an arbitrary address could
 *     link into an existing password account.
 *  3. **Otherwise create** a password-less customer.
 */
export async function resolveCustomerFromProfile(
  provider: OAuthProvider,
  profile: ProviderProfile,
): Promise<{ customerId: Types.ObjectId; created: boolean; linked: boolean }> {
  const byProviderId = await UserModel.findOne({
    oauthAccounts: { $elemMatch: { provider, providerId: profile.providerId } },
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();

  if (byProviderId) {
    return { customerId: byProviderId._id, created: false, linked: false };
  }

  const byEmail = await UserModel.findOne({ email: profile.email })
    .select('_id passwordHash')
    .lean<{ _id: Types.ObjectId; passwordHash: string } | null>();

  if (byEmail) {
    if (!profile.emailVerified && byEmail.passwordHash) {
      throw new AppError(
        'CONFLICT',
        `${provider === 'google' ? 'Google' : 'Facebook'} has not verified that address, and it already has an Ajooba account. Sign in with your password instead — it is the same account.`,
        409,
      );
    }

    await UserModel.updateOne(
      { _id: byEmail._id },
      { $push: { oauthAccounts: { provider, providerId: profile.providerId } } },
    );

    return { customerId: byEmail._id, created: false, linked: true };
  }

  const created = await UserModel.create({
    email: profile.email,
    /*
     * There is no password. `passwordHash` is stored as an empty string rather
     * than a hash of random bytes, and `loginCustomer` refuses an empty hash, so
     * this account can only be entered through a provider until the shopper sets
     * a password from the account page. Storing a random hash would look like a
     * working password that nobody knows.
     */
    passwordHash: '',
    phone: 'unconfirmed',
    firstName: profile.firstName,
    lastName: profile.lastName,
    oauthAccounts: [{ provider, providerId: profile.providerId }],
  });

  await writeAuditLog({
    action: 'create',
    entity: 'customer',
    entityId: created._id.toString(),
    summary: `Customer created through ${provider} sign-in`,
    changes: { provider, email: profile.email },
  });

  return { customerId: created._id, created: true, linked: false };
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                              */
/* -------------------------------------------------------------------------- */

export interface OAuthCompletion {
  readonly session: AuthSession;
  readonly next: string;
  readonly created: boolean;
}

/**
 * Complete a sign-in: exchange the code, resolve the customer, issue our tokens.
 *
 * `next` comes from the verified state token, so it is already a relative path
 * on this site.
 */
export async function completeOAuthSignIn(input: {
  provider: OAuthProvider;
  code: string;
  apiPublicUrl: string;
  context: { userAgent: string; ip: string };
  next: string;
}): Promise<OAuthCompletion> {
  const adapter = ADAPTERS[input.provider];
  if (!adapter.configured()) {
    throw new ProviderNotConfiguredError(input.provider);
  }

  const profile = await adapter.exchange(
    input.code,
    redirectUriFor(input.provider, input.apiPublicUrl),
  );

  const resolved = await resolveCustomerFromProfile(input.provider, profile);

  const session = await issueCustomerSession(resolved.customerId, input.context);

  return { session, next: input.next, created: resolved.created };
}

/** Re-exported so the route can describe a customer without importing the
 * auth service twice. */
export { mapCustomer };
