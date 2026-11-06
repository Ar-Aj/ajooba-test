import { expect, test, type Page } from '@playwright/test';
import {
  DEAD_STOREFRONT_ORIGIN,
  STOREFRONT_ORIGIN,
} from './constants.js';

/**
 * End-to-end tests: the storefront as a customer sees it.
 *
 * These run against the **real** stack — the real Express API, a throwaway
 * MongoDB, and the real production build of the storefront — booted by
 * `tests/e2e/global-setup.ts`. Nothing is mocked and no request is
 * intercepted.
 *
 * The catalogue fixture is synthetic (`E2E Test Mojari`), seeded through the
 * application's own Mongoose models. The production catalogue's zero-stock
 * state is untouched.
 *
 * NOTE ON THE ERROR-RECOVERY INSTANCE
 * ------------------------------------
 * The catalogue is rendered by a **server component**: the Next.js server
 * fetches it from the API, not the browser. A Playwright `page.route()`
 * abort only intercepts browser requests, so it cannot make the API
 * "unreachable" for a catalogue page.
 *
 * The error-recovery state is therefore exercised against a second storefront
 * instance that was started with an `API_INTERNAL_URL` pointing at a dead
 * port (see `global-setup.ts`). It is the same production build; only the
 * runtime environment differs.
 */

test.describe('storefront catalogue', () => {
  test('the homepage opens on a real specimen, not a fabricated one', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);

    /*
     * The brand mark is a link in the site header (the logo image plus the
     * wordmark), not a heading — asserting on a heading here was simply
     * asserting against markup that does not exist.
     */
    await expect(page.getByRole('link', { name: /Ajooba Footwear/i }).first()).toBeVisible();

    /*
     * The first screen is the specimen index, which is built from the newest
     * *published* designs rather than from merchandising. That is deliberate:
     * the opening screen must show real product photography even on an
     * environment where nobody has configured a homepage yet.
     */
    const hero = page.locator('section[aria-labelledby="hero-heading"]');
    await expect(hero).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /Hand-finished footwear, made in Uttar Pradesh/i,
      }),
    ).toBeVisible();

    // The seeded design is the one the hero selected.
    await expect(hero.getByText('E2E Test Mojari').first()).toBeVisible();

    /*
     * The storefront must not fabricate products. Every product link on the
     * page must point at the single design that actually exists in this
     * database — no placeholder cards, no sample catalogue.
     *
     * This build has no homepage sections configured, so nothing below the
     * hero contributes product links either.
     */
    const productHrefs = await page
      .locator('a[href^="/products/"]')
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute('href') ?? ''))]);

    expect(productHrefs).toEqual(['/products/e2e-test-mojari']);
  });

  test('the catalogue listing shows the seeded product from the live API', async ({ page }) => {
    const response = await page.goto('/products');

    expect(response?.status()).toBe(200);

    // The one synthetic design seeded by the global setup.
    await expect(page.getByText('E2E Test Mojari').first()).toBeVisible();
  });

  test('a product detail page renders the seeded product with its real price', async ({ page }) => {
    const response = await page.goto('/products/e2e-test-mojari');

    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'E2E Test Mojari' })).toBeVisible();

    // Price comes from the variant in the database, not from a fixture file.
    await expect(page.getByText('₹1,500').first()).toBeVisible();

    // The structured data must carry the real product identity.
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(jsonLd).toContain('E2E Test Mojari');
    expect(jsonLd).toContain('"priceCurrency":"INR"');
  });

  test('a product that does not exist returns a genuine 404, not a fake page', async ({
    page,
  }) => {
    const response = await page.goto('/products/this-design-does-not-exist');

    expect(response?.status()).toBe(404);
  });

  test('the catalogue reports an outage honestly when the API is unreachable', async ({ page }) => {
    // The error-recovery instance: a real production build whose API origin
    // has nothing listening on it.
    const response = await page.goto(`${DEAD_STOREFRONT_ORIGIN}/products`);

    expect(response?.status()).toBe(200);

    /*
     * The storefront must report the catalogue as temporarily unavailable
     * rather than showing a 404, a placeholder product or an empty grid that
     * reads like "we have no stock".
     */
    await expect(page.getByText(/can't reach the catalogue right now/i).first()).toBeVisible();

    // It must not invent a product to fill the gap.
    await expect(page.getByText('E2E Test Mojari')).toHaveCount(0);
  });
});

test.describe('storefront cart', () => {
  test('a customer can select a size, add to cart, and see it in the cart', async ({ page }) => {
    await page.goto('/products/e2e-test-mojari');

    // Choose the colour, then the size. The size button is an explicit
    // "UK size N" label.
    await page.getByRole('button', { name: 'Black', exact: true }).click();
    await page.getByRole('button', { name: 'UK size 8' }).click();

    const addToCart = page.getByRole('button', { name: 'Add to cart' });
    await expect(addToCart).toBeEnabled();
    await addToCart.click();

    await expect(page.getByText('Added to your cart')).toBeVisible();

    // The cart page must show the same SKU.
    await page.goto('/cart');
    await expect(page.getByText('E2E Test Mojari').first()).toBeVisible();
    await expect(page.getByText(/Black/).first()).toBeVisible();
  });

  test('an empty cart shows an explicit empty state, not a fake order form', async ({ page }) => {
    await page.goto('/cart');

    await expect(page.getByText(/nothing in your cart|your cart is empty/i).first()).toBeVisible();
  });

  test('checkout refuses to proceed with an empty cart', async ({ page }) => {
    await page.goto('/checkout');

    await expect(page.getByText(/nothing to check out/i).first()).toBeVisible();
  });
});

test.describe('colour-image verification', () => {
  /**
   * The colour swatch button's accessible name includes the sr-only
   * qualifier the buy box appends ("not on sale yet — photography in
   * progress" for a colour the catalogue still owes photography for).
   *
   * Matching on the exact bare label would therefore never resolve for such
   * a colour, so the locator deliberately uses a prefix match.
   */
  const brownSwatch = (page: Page) => page.getByRole('button', { name: /^Brown/ });

  test('only the selected colour’s images are shown in the gallery', async ({ page }) => {
    await page.goto('/products/e2e-test-mojari');

    /*
     * The fixture has two colours: Black (verified photography) and Brown
     * (photography NOT verified, so its image is quarantined and absent from
     * the product entirely). Selecting Black must show only the Black
     * image — the gallery must never fall back to another colour's photo.
     */
    await page.getByRole('button', { name: 'Black', exact: true }).click();

    const gallery = page.locator('[data-testid="product-gallery"]');
    await expect(gallery).toBeVisible();

    /*
     * The gallery renders each image twice — once in the mobile scroll-snap
     * strip and once in the desktop frame — so the assertion is on the set of
     * distinct image URLs, not on the element count.
     */
    const sources = await gallery.locator('img').evaluateAll((images) =>
      [...new Set(images.map((image) => (image as HTMLImageElement).getAttribute('src') ?? ''))],
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain('AE2E - 1.jpg');

    // The quarantined Brown image must not appear anywhere on the page.
    await expect(page.locator('img[src*="AE2E - 2.jpg"]')).toHaveCount(0);
  });

  test('a colour without verified photography is not offered for sale', async ({ page }) => {
    await page.goto('/products/e2e-test-mojari');

    /*
     * The Brown variant has stock, but its photography is unverified. The API
     * must withhold it from sale, so the storefront must not offer it for
     * purchase.
     */
    await brownSwatch(page).click();

    // The swatch must say, in so many words, that it is not on sale yet.
    await expect(brownSwatch(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/not on sale yet/i).first()).toBeVisible();

    /*
     * The size is still *listed* — telling the shopper the size exists is
     * honest — but it must be marked as unavailable and must not be
     * purchasable.
     */
    const brownSize = page.getByRole('button', { name: /^UK size 8, out of stock$/ });
    await expect(brownSize).toHaveCount(1);

    // And the primary call to action must not offer to sell it.
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sold out' })).toBeDisabled();
  });

  test('a colour without photography says so plainly instead of showing another colour', async ({
    page,
  }) => {
    await page.goto('/products/e2e-test-mojari');

    await brownSwatch(page).click();

    const gallery = page.locator('[data-testid="product-gallery"]');
    await expect(gallery).toBeVisible();

    // The gallery must admit that it has no photo for this colour...
    await expect(gallery.getByText(/No Brown photography yet/i)).toBeVisible();
    // ...and must not be showing the Black photograph underneath it.
    await expect(gallery.locator('img')).toHaveCount(0);
  });
});

test.describe('storefront resilience', () => {
  test('the storefront still renders its brand furniture when the API is down', async ({
    page,
  }) => {
    const response = await page.goto(`${DEAD_STOREFRONT_ORIGIN}/`);

    // A catalogue outage must not take the whole shop offline.
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('link', { name: /Ajooba Footwear/i }).first()).toBeVisible();
  });

  test('the storefront reports its own health endpoint', async ({ request }) => {
    const response = await request.get(`${STOREFRONT_ORIGIN}/api/health`);

    expect(response.status()).toBe(200);
  });
});
