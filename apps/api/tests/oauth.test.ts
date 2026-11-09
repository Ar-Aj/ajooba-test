import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, failure, success, useApi } from './helpers/api.js';
import { UserModel } from '../src/models/user.model.js';
import { verifyAccessToken } from '../src/services/token.service.js';

/**
 * Social sign-in.
 *
 * No test reaches Google or Facebook: `fetch` is stubbed, which is the only way
 * to assert what happens when a provider answers badly — and the bad answers are
 * the ones that matter. The security properties under test are:
 *
 *  - an unconfigured provider is **absent**, not broken;
 *  - a callback whose `state` was not minted by us is refused;
 *  - a state minted for one provider cannot be replayed at the other;
 *  - a `next` that is not a relative path never reaches a redirect;
 *  - an unverified email is never silently linked to a password account;
 *  - a link to an existing account keeps that account's identity;
 *  - an OAuth customer has no usable password.
 */

useApi();

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const SAVED_ENV: Record<string, string | undefined> = {};
const PROVIDER_KEYS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'FACEBOOK_OAUTH_APP_ID',
  'FACEBOOK_OAUTH_APP_SECRET',
];

/**
 * Configure the OAuth clients.
 *
 * `env` is frozen at boot, but the OAuth adapters read their credentials at call
 * time (see `readProviderSetting`) precisely so a deployment — and this test
 * file — can exercise both the configured and unconfigured states in one
 * process.
 */
function withProviders(values: Record<string, string | undefined>): void {
  for (const key of PROVIDER_KEYS) {
    if (!(key in SAVED_ENV)) SAVED_ENV[key] = process.env[key];
  }
  const resolved: Record<string, string | undefined> = {
    GOOGLE_OAUTH_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
    FACEBOOK_OAUTH_APP_ID: 'facebook-app-id',
    FACEBOOK_OAUTH_APP_SECRET: 'facebook-app-secret',
    ...values,
  };
  for (const [key, value] of Object.entries(resolved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function restoreProviders(): void {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  restoreProviders();
});

/** A stand-in for the provider's token endpoint and userinfo call. */
function stubProvider(profile: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (
        url.includes('oauth2.googleapis.com/token') ||
        url.includes('graph.facebook.com/v19.0/oauth')
      ) {
        return new Response(JSON.stringify({ access_token: 'provider-access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

/** Pull `state` out of the start URL's redirect. */
function stateFrom(location: string): string {
  const url = new URL(location);
  const state = url.searchParams.get('state');
  if (!state) throw new Error(`No state in redirect: ${location}`);
  return state;
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

describe('GET /v1/auth/providers', () => {
  it('lists nothing when no client is configured', async () => {
    withProviders({
      GOOGLE_OAUTH_CLIENT_ID: undefined,
      GOOGLE_OAUTH_CLIENT_SECRET: undefined,
      FACEBOOK_OAUTH_APP_ID: undefined,
      FACEBOOK_OAUTH_APP_SECRET: undefined,
    });

    const response = await api().get('/v1/auth/providers').expect(200);
    expect(success<{ providers: unknown[] }>(response.body).providers).toEqual([]);
  });

  it('lists only the providers that have a full credential pair', async () => {
    withProviders({
      GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
      // Facebook deliberately half-configured: an id with no secret is not a door.
      FACEBOOK_OAUTH_APP_ID: 'facebook-app-id',
      FACEBOOK_OAUTH_APP_SECRET: undefined,
    });

    const response = await api().get('/v1/auth/providers').expect(200);
    const { providers } = success<{ providers: Array<{ id: string; label: string }> }>(
      response.body,
    );

    expect(providers).toEqual([{ id: 'google', label: 'Google' }]);
  });
});

/* -------------------------------------------------------------------------- */
/* Start                                                                      */
/* -------------------------------------------------------------------------- */

describe('GET /v1/auth/oauth/:provider/start', () => {
  it('refuses a provider that is not configured, with 503', async () => {
    withProviders({
      GOOGLE_OAUTH_CLIENT_ID: undefined,
      GOOGLE_OAUTH_CLIENT_SECRET: undefined,
    });

    const response = await api().get('/v1/auth/oauth/google/start').expect(503);
    expect(failure(response.body).message).toMatch(/email and password/i);
  });

  it('redirects to the consent screen with a signed state and the derived redirect URI', async () => {
    withProviders({});

    const response = await api().get('/v1/auth/oauth/google/start?next=/products/a11').expect(302);

    const location = response.headers.location as string;
    expect(location).toContain('accounts.google.com');
    const url = new URL(location);
    expect(url.searchParams.get('client_id')).toBe('google-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/v1\/auth\/oauth\/google\/callback$/);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('drops an absolute `next` rather than signing it into the state', async () => {
    withProviders({});

    const start = await api()
      .get('/v1/auth/oauth/google/start?next=https://evil.example/steal')
      .expect(302);
    const state = stateFrom(start.headers.location as string);

    stubProvider({ sub: 'g-1', email: 'next@example.test', email_verified: true });

    const callback = await api()
      .get(`/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .expect(302);

    const location = callback.headers.location as string;
    expect(location).not.toContain('evil.example');
    expect(location).toContain('/auth/callback#');
    expect(location).toContain('next=%2Faccount');
  });

  it('404s an unknown provider', async () => {
    await api().get('/v1/auth/oauth/myspace/start').expect(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Callback                                                                   */
/* -------------------------------------------------------------------------- */

describe('GET /v1/auth/oauth/:provider/callback', () => {
  it('refuses a state it did not mint', async () => {
    withProviders({});

    const callback = await api()
      .get('/v1/auth/oauth/google/callback?code=abc&state=not-a-real-state')
      .expect(302);

    expect(callback.headers.location).toContain('/login?error=oauth_expired');
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('refuses a Google state replayed at the Facebook callback', async () => {
    withProviders({});

    const start = await api().get('/v1/auth/oauth/google/start').expect(302);
    const state = stateFrom(start.headers.location as string);

    const callback = await api()
      .get(`/v1/auth/oauth/facebook/callback?code=abc&state=${encodeURIComponent(state)}`)
      .expect(302);

    expect(callback.headers.location).toContain('/login?error=oauth_expired');
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('sends a cancelled consent screen back as a decision, not a fault', async () => {
    withProviders({});

    const callback = await api()
      .get('/v1/auth/oauth/google/callback?error=access_denied')
      .expect(302);

    expect(callback.headers.location).toContain('/login?error=oauth_cancelled');
  });

  it('creates a password-less customer and hands back a session in the fragment', async () => {
    withProviders({});
    stubProvider({
      sub: 'google-sub-1',
      email: 'newcomer@example.test',
      email_verified: true,
      given_name: 'Noor',
      family_name: 'Sheikh',
    });

    const start = await api().get('/v1/auth/oauth/google/start?next=/account/orders').expect(302);
    const state = stateFrom(start.headers.location as string);

    const callback = await api()
      .get(`/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(state)}`)
      .expect(302);

    const location = callback.headers.location as string;
    expect(location).toContain('/auth/callback#');

    const fragment = new URLSearchParams(location.split('#')[1]);
    expect(fragment.get('created')).toBe('1');
    expect(fragment.get('next')).toBe('/account/orders');

    const token = fragment.get('accessToken')!;
    const principal = await verifyAccessToken(token);
    expect(principal.kind).toBe('customer');
    expect(principal.email).toBe('newcomer@example.test');

    const created = await UserModel.findOne({ email: 'newcomer@example.test' }).lean();
    expect(created).not.toBeNull();
    // No password: the account can only be entered through the provider.
    expect(created!.passwordHash).toBe('');
    expect(created!.firstName).toBe('Noor');
    expect(created!.lastName).toBe('Sheikh');
    expect(created!.oauthAccounts).toHaveLength(1);
    expect(created!.oauthAccounts[0]!.provider).toBe('google');
  });

  it('links by provider id on a second sign-in instead of creating a duplicate', async () => {
    withProviders({});
    stubProvider({
      sub: 'google-sub-returning',
      email: 'returning@example.test',
      email_verified: true,
      given_name: 'Aarav',
    });

    const startOne = await api().get('/v1/auth/oauth/google/start').expect(302);
    await api()
      .get(
        `/v1/auth/oauth/google/callback?code=a&state=${encodeURIComponent(stateFrom(startOne.headers.location as string))}`,
      )
      .expect(302);

    /*
     * The shopper changed their Google address between visits. The `sub` is the
     * same, so this must land in the same account — not create a second one.
     */
    stubProvider({
      sub: 'google-sub-returning',
      email: 'changed-address@example.test',
      email_verified: true,
      given_name: 'Aarav',
    });

    const startTwo = await api().get('/v1/auth/oauth/google/start').expect(302);
    const second = await api()
      .get(
        `/v1/auth/oauth/google/callback?code=b&state=${encodeURIComponent(stateFrom(startTwo.headers.location as string))}`,
      )
      .expect(302);

    expect(second.headers.location as string).toContain('created=0');
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('refuses to link an unverified email into an existing password account', async () => {
    withProviders({});
    /*
     * A password account exists. Facebook never vouches for an address, so a
     * Facebook profile carrying that address must not be allowed to take it
     * over — otherwise anybody who can claim an address at a provider gets the
     * account.
     */
    await UserModel.create({
      email: 'existing@example.test',
      phone: '+919876543210',
      passwordHash: '$2b$12$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvabcdefghijkl',
      firstName: 'Existing',
      lastName: 'Customer',
    });

    stubProvider({
      id: 'fb-1',
      email: 'existing@example.test',
      first_name: 'Impostor',
    });

    const start = await api().get('/v1/auth/oauth/facebook/start').expect(302);
    const callback = await api()
      .get(
        `/v1/auth/oauth/facebook/callback?code=abc&state=${encodeURIComponent(stateFrom(start.headers.location as string))}`,
      )
      .expect(302);

    expect(callback.headers.location).toContain('/login?error=oauth_failed');

    const customer = await UserModel.findOne({ email: 'existing@example.test' }).lean();
    expect(customer!.oauthAccounts).toHaveLength(0);
    expect(customer!.firstName).toBe('Existing');
  });

  it('links a verified Google address into an existing password account', async () => {
    withProviders({});
    await UserModel.create({
      email: 'verified@example.test',
      phone: '+919876543210',
      passwordHash: '$2b$12$abcdefghijklmnopqrstuvabcdefghijklmnopqrstuvabcdefghijkl',
      firstName: 'Riya',
      lastName: 'Kapoor',
    });

    stubProvider({
      sub: 'google-sub-verified',
      email: 'verified@example.test',
      email_verified: true,
      given_name: 'Riya',
    });

    const start = await api().get('/v1/auth/oauth/google/start').expect(302);
    const callback = await api()
      .get(
        `/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(stateFrom(start.headers.location as string))}`,
      )
      .expect(302);

    expect(callback.headers.location as string).toContain('created=0');

    const customer = await UserModel.findOne({ email: 'verified@example.test' }).lean();
    expect(customer!.oauthAccounts).toHaveLength(1);
    // The existing identity is preserved, not overwritten by the provider's.
    expect(customer!.firstName).toBe('Riya');
    expect(customer!.lastName).toBe('Kapoor');
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('refuses a provider account that shares no email address', async () => {
    withProviders({});
    stubProvider({ sub: 'google-sub-no-email', given_name: 'Anon' });

    const start = await api().get('/v1/auth/oauth/google/start').expect(302);
    const callback = await api()
      .get(
        `/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(stateFrom(start.headers.location as string))}`,
      )
      .expect(302);

    expect(callback.headers.location).toContain('/login?error=oauth_failed');
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('refuses an OAuth account with an empty password', async () => {
    withProviders({});
    await UserModel.create({
      email: 'nopassword@example.test',
      phone: 'unconfirmed',
      passwordHash: '',
      firstName: 'No',
      lastName: 'Password',
    });

    /*
     * The empty hash is the whole reason this test exists: if it ever compared
     * equal to an empty submission, this account would have no password at all.
     */
    await api()
      .post('/v1/auth/login')
      .send({ email: 'nopassword@example.test', password: '' })
      .expect(422);
    await api()
      .post('/v1/auth/login')
      .send({ email: 'nopassword@example.test', password: 'anything-at-all' })
      .expect(401);
  });
});
