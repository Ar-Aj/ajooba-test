import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import {
  TEST_PASSWORD,
  createAdmin,
  createCustomer,
  createProductWithVariant,
} from './helpers/factories.js';
import { ActivityEventModel } from '../src/models/activity-event.model.js';

/**
 * The interaction ledger.
 *
 * These tests assert the rules the report depends on, not the shape of any one
 * screen:
 *
 *  - the write side is open to signed-out browsers but never trusts a body for
 *    identity — a customer id comes from the token and nowhere else;
 *  - the read side is closed to customers and requires `analytics:read`;
 *  - a tap is grouped by its surface and action, so a report can rank them;
 *  - an empty collection produces a report of zeros rather than an error.
 */

useApi();

async function adminToken(role: 'owner' | 'admin' | 'support' = 'admin'): Promise<string> {
  const admin = await createAdmin({ role });
  const response = await api()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: TEST_PASSWORD });
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

async function customerToken(): Promise<{ token: string; id: string }> {
  const customer = await createCustomer();
  const response = await api()
    .post('/v1/auth/login')
    .send({ email: customer.email, password: customer.password });
  const token = success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
  return { token, id: customer.id };
}

/* -------------------------------------------------------------------------- */
/* Write side                                                                 */
/* -------------------------------------------------------------------------- */

describe('recording events', () => {
  it('accepts an anonymous batch and stores one row per event', async () => {
    const response = await api()
      .post('/v1/analytics/events/batch')
      .send({
        sessionId: 'session-anonymous-0001',
        events: [
          { event: 'interaction', action: 'product-open', surface: 'catalog-grid' },
          { event: 'product_view', productId: new Types.ObjectId().toString() },
        ],
      });

    expect(response.status).toBe(202);
    expect(success<{ recorded: number }>(response.body).recorded).toBe(2);
    expect(await ActivityEventModel.countDocuments()).toBe(2);
  });

  it('attributes an event to the customer behind the token', async () => {
    const customer = await customerToken();

    await api()
      .post('/v1/analytics/events/batch')
      .set(bearer(customer.token))
      .send({
        sessionId: 'session-identified-0001',
        events: [{ event: 'interaction', action: 'add-to-cart', surface: 'pdp-buy-box' }],
      })
      .expect(202);

    const stored = await ActivityEventModel.findOne().lean<{ customerId: Types.ObjectId | null }>();
    expect(stored?.customerId?.toString()).toBe(customer.id);
  });

  it('ignores a customerId in the body', async () => {
    /*
     * The single most important rule on this surface. If the body could name a
     * customer, anyone could attribute their own browsing to another person.
     */
    const other = new Types.ObjectId().toString();
    await api()
      .post('/v1/analytics/events')
      .send({
        event: 'interaction',
        sessionId: 'session-spoof-attempt-01',
        action: 'add-to-cart',
        surface: 'pdp-buy-box',
        customerId: other,
      })
      .expect(202);

    const stored = await ActivityEventModel.findOne().lean<{ customerId: Types.ObjectId | null }>();
    expect(stored?.customerId).toBeNull();
  });

  it('rejects an action outside the taxonomy', async () => {
    const response = await api().post('/v1/analytics/events').send({
      event: 'interaction',
      sessionId: 'session-invalid-action-1',
      action: 'clicked-the-red-one',
      surface: 'pdp-buy-box',
    });

    expect(response.status).toBe(422);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects a batch with no session id', async () => {
    const response = await api()
      .post('/v1/analytics/events/batch')
      .send({ events: [{ event: 'product_view' }] });

    expect(response.status).toBe(422);
  });

  it('strips a query string from the recorded path', async () => {
    await api()
      .post('/v1/analytics/events')
      .send({
        event: 'search',
        sessionId: 'session-path-strip-0001',
        searchTerm: 'mojri',
        path: '/products?q=customer@example.test',
      })
      .expect(202);

    const stored = await ActivityEventModel.findOne().lean<{ path: string | null }>();
    expect(stored?.path).toBe('/products');
  });
});

/* -------------------------------------------------------------------------- */
/* Read side                                                                  */
/* -------------------------------------------------------------------------- */

describe('reading the report', () => {
  it('refuses an unauthenticated read', async () => {
    const response = await api().get('/v1/admin/analytics/insights');
    expect(response.status).toBe(401);
  });

  it('refuses a customer token', async () => {
    const customer = await customerToken();
    const response = await api().get('/v1/admin/analytics/insights').set(bearer(customer.token));
    expect(response.status).toBe(403);
  });

  it('refuses a role without analytics:read', async () => {
    // `support` handles orders and returns; the report is not theirs to read.
    const token = await adminToken('support');
    const response = await api().get('/v1/admin/analytics/insights').set(bearer(token));
    expect(response.status).toBe(403);
  });

  it('returns zeros on an empty collection rather than an error', async () => {
    const token = await adminToken();
    const response = await api().get('/v1/admin/analytics/insights').set(bearer(token));

    expect(response.status).toBe(200);
    const report = success<{
      totals: { taps: number; visitors: number };
      products: unknown[];
      categories: unknown[];
      trend: unknown[];
    }>(response.body);

    expect(report.totals.taps).toBe(0);
    expect(report.totals.visitors).toBe(0);
    expect(report.products).toEqual([]);
    expect(report.categories).toEqual([]);
    // A dense trend: the window is stated in days, so the rows are there.
    expect(report.trend.length).toBe(30);
  });

  it('groups taps by surface and action', async () => {
    const { product } = await createProductWithVariant({ title: 'Reported Jutti' });

    for (const surface of ['pdp-buy-box', 'pdp-buy-box', 'catalog-grid']) {
      await api()
        .post('/v1/analytics/events')
        .send({
          event: 'interaction',
          sessionId: 'session-grouping-0001',
          action: 'add-to-cart',
          surface,
          productId: product.id,
          categorySlug: 'mojri-jutti',
          categoryName: 'Mojri & Jutti',
        })
        .expect(202);
    }

    const token = await adminToken();
    const report = success<{
      surfaces: { key: string; taps: number; share: number }[];
      actions: { key: string; taps: number }[];
      totals: { taps: number };
    }>((await api().get('/v1/admin/analytics/insights').set(bearer(token))).body);

    expect(report.totals.taps).toBe(3);
    expect(report.surfaces.find((row) => row.key === 'pdp-buy-box')?.taps).toBe(2);
    expect(report.surfaces.find((row) => row.key === 'catalog-grid')?.taps).toBe(1);
    expect(report.actions.find((row) => row.key === 'add-to-cart')?.taps).toBe(3);
    // The shares are recomputed from the final total, so they sum to one.
    const sum = report.surfaces.reduce((total, row) => total + row.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('does not count a page view as a tap on its surface', async () => {
    /*
     * A page view carries the surface it happened on — the grid a product was
     * opened from is useful context — but it is not a tap. Counting it as one
     * inflated every surface row and pushed the shares past 100%, which is a
     * report that contradicts itself. The surface breakdown must filter on
     * `action`, exactly as the totals do.
     */
    const { product } = await createProductWithVariant({ title: 'Surfaced Jutti' });

    await api()
      .post('/v1/analytics/events')
      .send({
        event: 'interaction',
        sessionId: 'session-surface-0001',
        action: 'product-open',
        surface: 'catalog-grid',
        productId: product.id,
      })
      .expect(202);

    for (let index = 0; index < 4; index += 1) {
      await api()
        .post('/v1/analytics/events')
        .send({
          event: 'product_view',
          sessionId: `session-surface-view-000${index}`,
          surface: 'catalog-grid',
          productId: product.id,
        })
        .expect(202);
    }

    const token = await adminToken();
    const report = success<{
      surfaces: { key: string; taps: number; share: number }[];
      totals: { taps: number };
    }>((await api().get('/v1/admin/analytics/insights').set(bearer(token))).body);

    expect(report.totals.taps).toBe(1);
    expect(report.surfaces.find((row) => row.key === 'catalog-grid')?.taps).toBe(1);
    const sum = report.surfaces.reduce((total, row) => total + row.share, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('counts the funnel in sessions, so no step exceeds the one before it', async () => {
    /*
     * The bug this pins down: the funnel was built from `totals`, where
     * `visitors` is a count of sessions but `productViews` and `addToCart` are
     * counts of events. Comparing them reported a rise from "browsed" to
     * "opened a design" and a fake collapse into the cart. Four product reads by
     * one shopper is still one shopper.
     */
    const { product } = await createProductWithVariant({ title: 'Funnel Jutti' });

    // One session that reads four designs and adds one to the cart.
    for (let index = 0; index < 4; index += 1) {
      await api()
        .post('/v1/analytics/events')
        .send({ event: 'product_view', sessionId: 'session-funnel-0001', productId: product.id })
        .expect(202);
    }
    await api()
      .post('/v1/analytics/events')
      .send({
        event: 'add_to_cart',
        sessionId: 'session-funnel-0001',
        action: 'add-to-cart',
        productId: product.id,
      })
      .expect(202);

    // A second session that only browses.
    await api()
      .post('/v1/analytics/events')
      .send({ event: 'category_view', sessionId: 'session-funnel-0002', categorySlug: 'shoe' })
      .expect(202);

    const token = await adminToken();
    const report = success<{
      funnel: {
        browsed: number;
        viewedDesign: number;
        addedToCart: number;
        startedCheckout: number;
        ordered: number;
      };
      totals: { productViews: number };
    }>((await api().get('/v1/admin/analytics/insights').set(bearer(token))).body);

    // The event count is four; the session count is one. The funnel uses the
    // second, which is the only one a drop-off can be measured against.
    expect(report.totals.productViews).toBe(4);
    expect(report.funnel.browsed).toBe(2);
    expect(report.funnel.viewedDesign).toBe(1);
    expect(report.funnel.addedToCart).toBe(1);
    expect(report.funnel.startedCheckout).toBe(0);
    expect(report.funnel.ordered).toBe(0);

    const steps = [
      report.funnel.browsed,
      report.funnel.viewedDesign,
      report.funnel.addedToCart,
      report.funnel.startedCheckout,
      report.funnel.ordered,
    ];
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index]).toBeLessThanOrEqual(steps[index - 1]!);
    }
  });

  it('ranks a product by views and keeps its category', async () => {
    const { product } = await createProductWithVariant({
      title: 'Ranked Jutti',
      subcategorySlug: 'mojri-jutti',
    });

    for (let index = 0; index < 3; index += 1) {
      await api()
        .post('/v1/analytics/events')
        .send({
          event: 'product_view',
          sessionId: `session-ranked-000${index}`,
          productId: product.id,
          categorySlug: 'mojri-jutti',
          categoryName: 'Mojri & Jutti',
        })
        .expect(202);
    }

    const token = await adminToken();
    const report = success<{
      products: { productId: string; views: number; categorySlug: string }[];
    }>((await api().get('/v1/admin/analytics/insights').set(bearer(token))).body);

    const row = report.products.find((entry) => entry.productId === product.id);
    expect(row?.views).toBe(3);
    expect(row?.categorySlug).toBe('mojri-jutti');
  });

  it('narrows the report to one category', async () => {
    const { product: keep } = await createProductWithVariant({
      title: 'Mojri Kept',
      subcategorySlug: 'mojri-jutti',
    });
    const { product: drop } = await createProductWithVariant({
      title: 'Sneaker Dropped',
      subcategorySlug: 'sneakers',
    });

    for (const [product, slug, name] of [
      [keep, 'mojri-jutti', 'Mojri & Jutti'],
      [drop, 'sneakers', 'Sneakers'],
    ] as const) {
      await api()
        .post('/v1/analytics/events')
        .send({
          event: 'product_view',
          sessionId: 'session-category-filter-1',
          productId: product.id,
          categorySlug: slug,
          categoryName: name,
        })
        .expect(202);
    }

    const token = await adminToken();
    const report = success<{ products: { productId: string }[]; totals: { taps: number } }>(
      (await api().get('/v1/admin/analytics/insights?categorySlug=mojri-jutti').set(bearer(token)))
        .body,
    );

    const ids = report.products.map((row) => row.productId);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(drop.id);
  });
});

/* -------------------------------------------------------------------------- */
/* Visitors                                                                   */
/* -------------------------------------------------------------------------- */

describe('visitor reports', () => {
  it('lists only identified visitors', async () => {
    const customer = await customerToken();

    // One identified session and one anonymous one, in the same window.
    await api()
      .post('/v1/analytics/events')
      .set(bearer(customer.token))
      .send({
        event: 'interaction',
        sessionId: 'session-identified-0002',
        action: 'product-open',
        surface: 'catalog-grid',
      })
      .expect(202);

    await api()
      .post('/v1/analytics/events')
      .send({
        event: 'interaction',
        sessionId: 'session-anonymous-0002',
        action: 'product-open',
        surface: 'catalog-grid',
      })
      .expect(202);

    const token = await adminToken();
    const body = success<{ items: { customerId: string; taps: number }[] }>(
      (await api().get('/v1/admin/analytics/visitors').set(bearer(token))).body,
    );

    expect(body.items.length).toBe(1);
    expect(body.items[0]?.customerId).toBe(customer.id);
    expect(body.items[0]?.taps).toBe(1);
  });

  it('returns one visitor profile with their products and actions', async () => {
    const customer = await customerToken();
    const { product } = await createProductWithVariant({ title: 'Watched Jutti' });

    await api()
      .post('/v1/analytics/events/batch')
      .set(bearer(customer.token))
      .send({
        sessionId: 'session-profile-00001',
        events: [
          {
            event: 'product_view',
            productId: product.id,
            categorySlug: 'mojri-jutti',
            categoryName: 'Mojri & Jutti',
          },
          {
            event: 'interaction',
            action: 'add-to-cart',
            surface: 'pdp-buy-box',
            productId: product.id,
            categorySlug: 'mojri-jutti',
          },
        ],
      })
      .expect(202);

    const token = await adminToken();
    const profile = success<{
      customer: { id: string; email: string } | null;
      totals: { productViews: number; addToCart: number };
      products: { productId: string; views: number }[];
      actions: { key: string }[];
      recent: unknown[];
    }>((await api().get(`/v1/admin/analytics/visitors/${customer.id}`).set(bearer(token))).body);

    expect(profile.customer?.id).toBe(customer.id);
    expect(profile.totals.productViews).toBe(1);
    expect(profile.totals.addToCart).toBe(1);
    expect(profile.products[0]?.productId).toBe(product.id);
    expect(profile.actions.map((row) => row.key)).toContain('add-to-cart');
    expect(profile.recent.length).toBe(2);
  });

  it('answers 404 for an id that never recorded anything', async () => {
    const token = await adminToken();
    const response = await api()
      .get(`/v1/admin/analytics/visitors/${new Types.ObjectId().toString()}`)
      .set(bearer(token));

    expect(response.status).toBe(404);
  });

  it('rejects a malformed customer id with a clean validation error, not a 500', async () => {
    const token = await adminToken();
    const response = await api()
      .get('/v1/admin/analytics/visitors/not-an-object-id')
      .set(bearer(token));

    // 422 rather than 500: the path is validated before it can reach the
    // driver, where a cast failure would surface as an opaque server error.
    expect(response.status).toBe(422);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});
