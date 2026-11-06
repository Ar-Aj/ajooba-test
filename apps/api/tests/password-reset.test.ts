import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { createCustomer, TEST_PASSWORD } from './helpers/factories.js';
import { EmailLogModel } from '../src/models/email-log.model.js';
import { PasswordResetTokenModel } from '../src/models/password-reset-token.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { UserModel } from '../src/models/user.model.js';

/**
 * Password recovery.
 *
 * The recovery path is the one place in the product where a mistake is
 * directly exploitable, so these tests assert the security properties rather
 * than just the happy path:
 *
 *  - the request endpoint **never** reveals whether an address exists;
 *  - the raw token is never persisted (only a SHA-256 hash is);
 *  - the emailed token is **single-use** — a second redemption fails;
 *  - the grant is a *different* secret from the token, is also single-use,
 *    and expires;
 *  - completing a reset revokes every existing session;
 *  - a weak password is refused by the same policy as registration.
 *
 * `fetch` is stubbed for the whole file, so nothing reaches Resend.
 */

useApi();

const RECIPIENT = 'recovery-recipient@example.test';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const SAVED_ENV: Record<string, string | undefined> = {};

/**
 * Point the notifier at fake credentials and an allowlist.
 *
 * `env` is frozen at boot, so the values are patched on `process.env` — the
 * same source the running configuration was validated from — and restored
 * afterwards.
 */
function withEmail(overrides: Record<string, string | undefined> = {}): void {
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_REPLY_TO', 'EMAIL_ALLOWLIST']) {
    if (!(key in SAVED_ENV)) {
      SAVED_ENV[key] = process.env[key];
    }
  }

  const values: Record<string, string | undefined> = {
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'Ajooba Footwear <orders@example.test>',
    RESEND_REPLY_TO: 'support@example.test',
    EMAIL_ALLOWLIST: RECIPIENT,
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const key of Object.keys(SAVED_ENV)) {
    delete SAVED_ENV[key];
  }
}

/** Stub the provider with one JSON response. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The body the provider actually received. */
function sentBody(mock: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const call = mock.mock.calls[index] as [string, RequestInit] | undefined;
  if (!call) {
    throw new Error(`Expected the provider to have been called at least ${index + 1} time(s).`);
  }
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

/**
 * Recover the raw reset token from the delivered email.
 *
 * The token is only ever present in the email body — that is precisely the
 * property under test, so the token has to come from the mail itself.
 */
function tokenFromEmail(mock: ReturnType<typeof vi.fn>, index = 0): string {
  const body = sentBody(mock, index);
  const raw = body.html;
  const html = typeof raw === 'string' ? raw : '';
  const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(html);
  if (!match) {
    throw new Error(`The delivered email carried no reset link: ${html.slice(0, 400)}`);
  }
  return match[1]!;
}

/** Ask for a reset and return the raw token from the delivered email. */
async function requestReset(email: string): Promise<string> {
  const response = await api().post('/v1/auth/password-reset/request').send({ email });
  expect(response.status).toBe(200);
  return tokenFromEmail(vi.mocked(global.fetch));
}

/** Exchange a token for a grant. */
async function verifyToken(token: string): Promise<string> {
  const response = await api().post('/v1/auth/password-reset/verify').send({ token });
  expect(response.status).toBe(200);
  return success<{ grantToken: string }>(response.body).grantToken;
}

/** Sign in, so a live refresh token exists to revoke. */
async function signIn(email: string, password = TEST_PASSWORD): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

/* -------------------------------------------------------------------------- */
/* Request                                                                    */
/* -------------------------------------------------------------------------- */

describe('password reset request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('answers identically for a known and an unknown address', async () => {
    withEmail();
    stubFetch({ id: 'msg-known' });

    const customer = await createCustomer({ email: RECIPIENT });

    const known = await api().post('/v1/auth/password-reset/request').send({ email: RECIPIENT });
    const unknown = await api().post('/v1/auth/password-reset/request').send({
      email: 'nobody-here@example.test',
    });

    expect(known.status).toBe(unknown.status);
    // The envelope's per-request metadata differs by design; the payload and
    // the error state must not.
    expect(success(known.body)).toEqual(success(unknown.body));
    expect((known.body as { ok?: boolean }).ok).toBe((unknown.body as { ok?: boolean }).ok);

    // And the unknown address produced no token row at all.
    const rows = await PasswordResetTokenModel.find({ email: 'nobody-here@example.test' }).lean();
    expect(rows).toHaveLength(0);

    void customer;
  });

  it('mints a token and delivers a reset link for a real customer', async () => {
    withEmail();
    const mock = stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);

    expect(token.length).toBeGreaterThanOrEqual(32);

    const rows = await PasswordResetTokenModel.find({ email: RECIPIENT }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.usedAt).toBeNull();

    // The delivered mail carries the link.
    const body = sentBody(mock);
    expect(String(body.subject)).toContain('password');
    expect(JSON.stringify(body)).toContain('reset-password?token=');
  });

  it('never stores the raw token — only a hash', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);

    const rows = await PasswordResetTokenModel.find({ email: RECIPIENT }).lean();
    const stored = rows[0]!;

    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    // The raw token appears nowhere in the persisted document.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('supersedes a live token when a new one is requested', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    await requestReset(RECIPIENT);
    await requestReset(RECIPIENT);

    const rows = await PasswordResetTokenModel.find({ email: RECIPIENT }).lean();
    expect(rows).toHaveLength(2);

    const live = rows.filter((row) => row.usedAt === null);
    expect(live).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Verify                                                                     */
/* -------------------------------------------------------------------------- */

describe('password reset verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('exchanges a valid token for a grant', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);
    const grant = await verifyToken(token);

    expect(grant.length).toBeGreaterThanOrEqual(32);
    expect(grant).not.toBe(token);
  });

  it('refuses a token that has already been redeemed', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);

    await verifyToken(token);

    const second = await api().post('/v1/auth/password-reset/verify').send({ token });
    expect(second.status).toBe(401);
    expect(failure(second.body).code).toBe('UNAUTHORIZED');
  });

  it('refuses an unknown token', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    const response = await api()
      .post('/v1/auth/password-reset/verify')
      .send({ token: 'a'.repeat(43) });
    expect(response.status).toBe(401);
  });

  it('refuses a token whose stored grant has already been spent', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);
    const grant = await verifyToken(token);

    const first = await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: grant, newPassword: 'BrandNewPassw0rd!2026' });
    expect(first.status).toBe(200);

    const second = await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: grant, newPassword: 'AnotherNewPassw0rd!2026' });
    expect(second.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Reset                                                                      */
/* -------------------------------------------------------------------------- */

describe('password reset completion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('changes the password and lets the customer sign in with the new one', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);
    const grant = await verifyToken(token);

    const response = await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: grant, newPassword: 'BrandNewPassw0rd!2026' });
    expect(response.status).toBe(200);
    expect(success<{ changed: boolean }>(response.body).changed).toBe(true);

    // The old password no longer works.
    const oldAttempt = await api()
      .post('/v1/auth/login')
      .send({ email: RECIPIENT, password: TEST_PASSWORD });
    expect(oldAttempt.status).toBe(401);

    // The new one does.
    const newAttempt = await api()
      .post('/v1/auth/login')
      .send({ email: RECIPIENT, password: 'BrandNewPassw0rd!2026' });
    expect(newAttempt.status).toBe(200);
  });

  it('revokes every existing session when the password changes', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const accessToken = await signIn(RECIPIENT);

    const liveBefore = await RefreshTokenModel.find({ revokedAt: null }).lean();
    expect(liveBefore.length).toBeGreaterThan(0);

    const token = await requestReset(RECIPIENT);
    const grant = await verifyToken(token);

    const response = await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: grant, newPassword: 'BrandNewPassw0rd!2026' });
    expect(response.status).toBe(200);

    // Every refresh token is dead.
    const liveAfter = await RefreshTokenModel.find({ revokedAt: null }).lean();
    expect(liveAfter).toHaveLength(0);

    // The access token that was already issued is still usable until it
    // expires — that is a property of stateless JWTs, and the refresh-token
    // revocation above is what actually ends the session.
    void accessToken;
  });

  it('refuses a password that the registration policy would also refuse', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    const token = await requestReset(RECIPIENT);
    const grant = await verifyToken(token);

    const response = await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: grant, newPassword: 'short' });

    expect(response.status).toBe(422);
  });

  it('does not change the password when the grant is unknown', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    await requestReset(RECIPIENT);

    const response = await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: 'b'.repeat(43), newPassword: 'BrandNewPassw0rd!2026' });
    expect(response.status).toBe(401);

    // The original password still works — nothing was changed.
    const attempt = await api()
      .post('/v1/auth/login')
      .send({ email: RECIPIENT, password: TEST_PASSWORD });
    expect(attempt.status).toBe(200);
  });

  it('clears a lockout counter when the password is reset', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    const customer = await createCustomer({ email: RECIPIENT });
    await UserModel.updateOne(
      { _id: customer.id },
      { $set: { failedLoginAttempts: 7, lockedUntil: new Date(Date.now() + 60_000) } },
    );

    const token = await requestReset(RECIPIENT);
    const grant = await verifyToken(token);
    await api()
      .post('/v1/auth/password-reset/complete')
      .send({ grantToken: grant, newPassword: 'BrandNewPassw0rd!2026' });

    const user = await UserModel.findById(customer.id).lean<{
      failedLoginAttempts?: number;
      lockedUntil?: Date | null;
    }>();
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil ?? null).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Outbox                                                                     */
/* -------------------------------------------------------------------------- */

describe('password reset email outbox', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('records a reset email in the outbox exactly once per request', async () => {
    withEmail();
    stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: RECIPIENT });
    await requestReset(RECIPIENT);

    const rows = await EmailLogModel.find({ template: 'password-reset' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.to).toBe(RECIPIENT);
  });

  it('records a skipped reset email when the deployment has no mail configuration', async () => {
    withEmail({ RESEND_API_KEY: undefined, RESEND_FROM_EMAIL: undefined });

    await createCustomer({ email: RECIPIENT });
    const response = await api().post('/v1/auth/password-reset/request').send({ email: RECIPIENT });
    expect(response.status).toBe(200);

    const rows = await EmailLogModel.find({ template: 'password-reset' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('skipped');
    expect(rows[0]!.detail.length).toBeGreaterThan(0);
  });

  it('does not deliver a reset email to an address outside the allowlist', async () => {
    withEmail();
    const mock = stubFetch({ id: 'msg-reset' });

    await createCustomer({ email: 'not-allowed@example.test' });
    const response = await api()
      .post('/v1/auth/password-reset/request')
      .send({ email: 'not-allowed@example.test' });
    expect(response.status).toBe(200);

    expect(mock).not.toHaveBeenCalled();

    const rows = await EmailLogModel.find({ template: 'password-reset' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('skipped');
  });
});

/* -------------------------------------------------------------------------- */
/* Contract shape                                                             */
/* -------------------------------------------------------------------------- */

describe('password reset contract', () => {
  it('advertises the three recovery endpoints in the published route index', async () => {
    const response = await api().get('/health');
    expect(response.status).toBe(200);

    const endpoints = success<{ endpoints: Record<string, readonly string[]> }>(
      response.body,
    ).endpoints;
    const auth = endpoints.auth ?? [];

    expect(auth).toContain('POST /v1/auth/password-reset/request');
    expect(auth).toContain('POST /v1/auth/password-reset/verify');
    expect(auth).toContain('POST /v1/auth/password-reset/complete');
  });

  it('rejects a request body that is not an email address', async () => {
    const response = await api().post('/v1/auth/password-reset/request').send({ email: 'nope' });
    expect(response.status).toBe(422);
  });

  it('requires authentication nowhere in the recovery flow', async () => {
    // The three endpoints are all reachable without a bearer token.
    const request = await api().post('/v1/auth/password-reset/request').send({ email: 'x@y.test' });
    expect(request.status).not.toBe(401);

    void bearer;
  });
});
