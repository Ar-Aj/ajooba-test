import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_ORIGIN, ADMIN_PASSWORD, API_ORIGIN } from './constants.js';

/**
 * End-to-end tests: the admin panel.
 *
 * These drive the **real** admin panel (production build) against the **real**
 * API and a throwaway MongoDB, with a real administrator account seeded by
 * the global setup.
 *
 * The administrator session token is held in an httpOnly cookie, so the
 * browser never exposes it to client JavaScript. These tests verify that the
 * panel is genuinely gated server-side — not merely hidden in the UI — which
 * is the property that actually matters.
 */

test.describe('admin authentication', () => {
  test('an unauthenticated visitor is redirected to the sign-in screen', async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/homepage`);

    await expect(page).toHaveURL(/\/login/);
    // The sign-in screen's own heading, not a generic one: the redirect must land
    // on a page that is unmistakably the administrator sign-in.
    await expect(
      page.getByRole('heading', { name: 'The shop, from the back of the house.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('the admin surface refuses an unauthenticated API read', async ({ request }) => {
    // The API is the authority. Even if the panel were bypassed entirely, the
    // API must refuse. This is the check that matters.
    const response = await request.get(`${API_ORIGIN}/v1/admin/content/homepage/sections`);

    expect(response.status()).toBe(401);
  });

  test('a wrong password is rejected and the error is shown', async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/login`);

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill('WrongPassword!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Email or password' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a valid administrator can sign in and reach the panel', async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/login`);

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Sign-in lands on the dashboard, which is the panel's front door.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // The sidebar is the panel's navigation and must be present on every screen.
    const nav = page.getByRole('navigation', { name: 'Admin navigation' });
    await expect(nav).toBeVisible();

    // The merchandising screen is reachable from it.
    await nav.getByRole('link', { name: 'Homepage' }).click();
    await expect(page).toHaveURL(/\/homepage/);
    await expect(page.getByRole('heading', { name: 'Homepage merchandising' })).toBeVisible();

    // The session token must be in an httpOnly cookie, never readable from
    // client JavaScript.
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === 'ajooba_admin_token');

    expect(session).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Strict');
  });

  test('the session token is never exposed to client JavaScript', async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/login`);

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // The token lives in an httpOnly cookie, so it must not be readable from
    // `document.cookie`, nor present in `localStorage`.
    const exposed = await page.evaluate(() => ({
      cookie: document.cookie,
      localStorage: JSON.stringify(Object.entries(window.localStorage)),
    }));

    expect(exposed.cookie).not.toContain('ajooba_admin_token');
    expect(exposed.localStorage).not.toContain('ajooba_admin_token');
  });

  test('the admin proxy refuses a path that tries to escape its prefix', async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/login`);
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // A relative segment that would escape `/v1/admin/content` must be
    // refused by the proxy, not forwarded.
    const status = await page.evaluate(async () => {
      const response = await fetch(
        `/api/admin/proxy?path=${encodeURIComponent('../../../../v1/admin/users')}`,
      );
      return response.status;
    });

    expect(status).toBe(400);
  });

  test('the admin proxy refuses an unauthenticated call', async ({ page }) => {
    /*
     * No sign-in, and the page must be loaded first: a relative `fetch()`
     * needs a document to resolve against, so an `about:blank` page would
     * fail with a URL-parse error rather than exercising the proxy's own
     * authorisation check.
     */
    await page.goto(`${ADMIN_ORIGIN}/login`);

    const status = await page.evaluate(async () => {
      const response = await fetch('/api/admin/proxy?path=/homepage/sections');
      return response.status;
    });

    expect(status).toBe(401);
  });
});

test.describe('admin session lifecycle', () => {
  test('signing in with the wrong email is refused by the API', async ({ request }) => {
    const response = await request.post(`${API_ORIGIN}/v1/admin/auth/login`, {
      data: { email: 'nobody@example.test', password: 'Whatever!2026' },
    });

    expect(response.status()).toBe(401);
  });

  test('the admin sign-in proxy reports a failure without setting a session cookie', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_ORIGIN}/login`);

    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill('WrongPassword!2026');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Email or password' })).toBeVisible();

    // A failed sign-in must never leave a session behind.
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'ajooba_admin_token')).toBeUndefined();
  });
});
