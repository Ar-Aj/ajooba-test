/**
 * UX screenshot harness.
 *
 * Captures the real, running storefront and admin panel at three viewports so
 * a redesign can be compared honestly against what shipped before it.
 *
 *   node scripts/ux/capture.mjs before
 *   node scripts/ux/capture.mjs after
 *
 * It talks to the dev servers the developer already has running (storefront on
 * :3000, admin on :3001) and writes PNGs under `artifacts/ux/<phase>/`.
 *
 * Failure policy: a page that throws is recorded in `_report.json` and the run
 * continues, so one broken route never hides the state of the others.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const PHASE = process.argv[2] ?? 'before';
const OUT = path.resolve('artifacts/ux', PHASE);

const STOREFRONT = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Routes captured on the customer storefront. */
const STOREFRONT_ROUTES = [
  { id: 'home', path: '/' },
  { id: 'catalog', path: '/products' },
  { id: 'catalog-mojri', path: '/products?subcategory=mojri-jutti' },
  { id: 'search', path: '/search?q=jutti' },
  { id: 'cart', path: '/cart' },
  { id: 'login', path: '/login' },
];

/** Routes captured on the admin panel. Requires an authenticated session. */
const ADMIN_ROUTES = [
  { id: 'dashboard', path: '/' },
  { id: 'products', path: '/catalog/products' },
  { id: 'categories', path: '/catalog/categories' },
  { id: 'images', path: '/catalog/images' },
  { id: 'imports', path: '/catalog/imports' },
  { id: 'homepage', path: '/homepage' },
  { id: 'orders', path: '/orders' },
  { id: 'customers', path: '/customers' },
  { id: 'inventory', path: '/inventory' },
  { id: 'promotions', path: '/promotions' },
];

/**
 * Sign in to the admin panel.
 *
 * Preferred path: a real form sign-in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
 * which exercises the actual login route. Fallback: the session cookie is set
 * directly from a token minted by `apps/api/scripts/admin-token.ts`, which is
 * what lets verification run without the owner's password. Both produce the
 * same authenticated state — the API validates the token either way, so a
 * forged or under-privileged token would still be refused downstream.
 */
async function signInAdmin(context, page) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (email && password) {
    await page.goto(`${ADMIN}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 }),
      page.click('button[type="submit"]'),
    ]);
    return 'ok';
  }

  let token = process.env.ADMIN_TOKEN ?? null;
  if (!token) {
    try {
      token = (await readFile(path.resolve('artifacts/ux/.token'), 'utf8')).trim();
    } catch {
      token = null;
    }
  }
  if (!token) return 'skipped: no admin credentials and no minted token';

  await context.addCookies([
    {
      name: 'ajooba_admin_token',
      value: token,
      domain: new URL(ADMIN).hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  return 'ok (session cookie)';
}

async function capture(page, base, route, viewport, report) {
  const url = `${base}${route.path}`;
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    // Let entrance transitions settle so the frame is the resting state.
    await page.waitForTimeout(900);
    const file = path.join(OUT, `${route.id}--${viewport.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    report.push({ route: route.id, viewport: viewport.name, status: response?.status() ?? 0, file });
  } catch (error) {
    report.push({
      route: route.id,
      viewport: viewport.name,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    for (const route of STOREFRONT_ROUTES) {
      await capture(page, STOREFRONT, route, viewport, report);
    }
    await context.close();
  }

  // A real catalogue slug, read from the live API so the PDP capture is of an
  // actual design rather than a guessed URL.
  let slugForPdp = null;
  try {
    const response = await fetch(`${process.env.API_URL ?? 'http://localhost:4000'}/v1/catalog/products?pageSize=1`);
    const body = await response.json();
    slugForPdp = body?.data?.items?.[0]?.slug ?? null;
  } catch {
    slugForPdp = null;
  }

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    if (slugForPdp) {
      await capture(page, STOREFRONT, { id: 'pdp', path: `/products/${slugForPdp}` }, viewport, report);
    }

    // --- admin ---
    const session = await signInAdmin(context, page);
    report.push({
      route: 'admin-session',
      viewport: viewport.name,
      status: session.startsWith('ok') ? 200 : 0,
      note: session,
    });
    if (session.startsWith('ok')) {
      for (const route of ADMIN_ROUTES) {
        await capture(page, ADMIN, route, viewport, report);
      }
    }
    await context.close();
  }

  await browser.close();
  await writeFile(
    path.join(OUT, '_report.json'),
    `${JSON.stringify({ phase: PHASE, capturedAt: new Date().toISOString(), report }, null, 2)}\n`,
    'utf8',
  );
  const failed = report.filter((row) => (row.status === 0 || row.status >= 400) && !row.note);
  console.log(`captured ${report.length} frames into ${OUT}; ${failed.length} failed`);
}

await main();
