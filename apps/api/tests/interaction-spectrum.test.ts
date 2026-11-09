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
import type {
  InteractionCustomerSpectrumRow,
  InteractionProductProfile,
  InteractionProductSpectrumRow,
} from '@ajooba/contracts';

/**
 * The two interaction spectrums.
 *
 * The store-wide report is covered in `analytics.test.ts`. This file pins the two
 * things that make the spectrums different from it, because they are the two
 * things a future edit is most likely to break:
 *
 *  1. **The product spectrum separates configured from added.** The whole
 *     merchandising value is in that distinction, and if the `configuredSessions`
 *     or `intentRate` figures ever collapse into the plain add rate, the screen
 *     still renders and quietly stops answering its question.
 *  2. **A customer's matrix names the design and the buttons.** A profile that
 *     reports totals but no per-design actions is not the screen this exists
 *     for.
 *
 * Every assertion here is against counts the pipeline computes, never against a
 * formatted string, so a copy change cannot make a test pass that should fail.
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

/** Record one event through the public write endpoint. */
async function record(
  sessionId: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<void> {
  const request = api().post('/v1/analytics/events');
  if (token) request.set(bearer(token));
  await request.send({ sessionId, ...body }).expect(202);
}

interface ProductSpectrumEnvelope {
  readonly designs: number;
  readonly viewers: number;
  readonly configurers: number;
  readonly carters: number;
  readonly items: readonly InteractionProductSpectrumRow[];
}

interface CustomerSpectrumEnvelope {
  readonly customers: number;
  readonly configured: number;
  readonly carters: number;
  readonly items: readonly InteractionCustomerSpectrumRow[];
}

describe('the product spectrum', () => {
  it('counts configuration separately from the cart, per design', async () => {
    const { product } = await createProductWithVariant();
    const token = await adminToken();

    /*
     * Two sessions on one design. Session A configures and buys; session B
     * configures and leaves. So: 2 configured, 1 added, and an intent rate of
     * exactly 50% — which is the number the screen exists to show.
     */
    await record('spectrum-session-aaaa', {
      event: 'product_view',
      productId: product.id,
      categorySlug: product.subcategorySlug,
      categoryName: product.subcategory,
      surface: 'pdp-gallery',
    });
    await record('spectrum-session-aaaa', {
      event: 'interaction',
      action: 'select-size',
      productId: product.id,
      surface: 'pdp-buy-box',
    });
    await record('spectrum-session-aaaa', {
      event: 'interaction',
      action: 'add-to-cart',
      productId: product.id,
      surface: 'pdp-buy-box',
    });

    await record('spectrum-session-bbbb', {
      event: 'product_view',
      productId: product.id,
      categorySlug: product.subcategorySlug,
      categoryName: product.subcategory,
      surface: 'pdp-gallery',
    });
    await record('spectrum-session-bbbb', {
      event: 'interaction',
      action: 'select-colour',
      productId: product.id,
      surface: 'pdp-buy-box',
    });

    const response = await api().get('/v1/admin/analytics/products').set(bearer(token)).expect(200);

    const envelope = success<ProductSpectrumEnvelope>(response.body);
    const row = envelope.items.find((item) => item.productId === product.id);

    expect(row).toBeDefined();
    expect(row?.views).toBe(2);
    expect(row?.addToCart).toBe(1);
    /* One session chose a colour, one chose a size — two distinct sessions. */
    expect(row?.configuredSessions).toBe(2);
    expect(row?.intentRate).toBeCloseTo(0.5, 5);
    /* Adds divided by the sessions that *viewed*, which is also two here. */
    expect(row?.addToCartRate).toBeCloseTo(0.5, 5);

    /* Both buttons are named, and the add is the one that carries the cart. */
    const keys = row?.actions.map((action) => action.key) ?? [];
    expect(keys).toContain('select-colour');
    expect(keys).toContain('select-size');
    expect(keys).toContain('add-to-cart');

    /* The shares inside a design's own action block sum to one. */
    const total = (row?.actions ?? []).reduce((sum, action) => sum + action.taps, 0);
    expect(total).toBe(row?.taps);
  });

  it('says a design was configured and not added, rather than leaving it blank', async () => {
    const { product } = await createProductWithVariant();
    const token = await adminToken();

    /* Three separate sessions configure it. All three leave. */
    for (const suffix of ['cccc', 'dddd', 'eeee']) {
      await record(`spectrum-session-${suffix}`, {
        event: 'interaction',
        action: 'select-size',
        productId: product.id,
        surface: 'pdp-buy-box',
      });
    }

    const response = await api().get('/v1/admin/analytics/products').set(bearer(token)).expect(200);

    const row = success<ProductSpectrumEnvelope>(response.body).items.find(
      (item) => item.productId === product.id,
    );

    expect(row?.configuredSessions).toBe(3);
    expect(row?.addToCart).toBe(0);
    expect(row?.intentRate).toBe(0);
    /* The distinction the screen reads: configured, but never converted. */
    expect(row?.views).toBe(0);
  });

  it('returns a full profile for one design, with its customers named', async () => {
    const { product } = await createProductWithVariant();
    const customer = await customerToken();
    const token = await adminToken();

    await record(
      'spectrum-session-ffff',
      {
        event: 'interaction',
        action: 'select-size',
        productId: product.id,
        surface: 'pdp-buy-box',
      },
      customer.token,
    );

    const response = await api()
      .get(`/v1/admin/analytics/products/${product.id}`)
      .set(bearer(token))
      .expect(200);

    const profile = success<InteractionProductProfile>(response.body);

    expect(profile.product?.id).toBe(product.id);
    expect(profile.funnel.configured).toBe(1);
    expect(profile.actions.map((action) => action.key)).toContain('select-size');
    /*
     * The customer appears on the design they touched. This is the block a
     * merchandiser works from, so an empty list here is a silent regression.
     */
    expect(profile.customers.map((row) => row.customerId)).toContain(customer.id);
    expect(profile.customers[0]?.configured).toBe(true);
  });

  it('answers an id that was never real with a 404, not an empty report', async () => {
    const token = await adminToken();
    const response = await api()
      .get(`/v1/admin/analytics/products/${new Types.ObjectId().toString()}`)
      .set(bearer(token));

    expect(response.status).toBe(404);
    expect(failure(response.body).message).toMatch(/not found/i);
  });

  it('requires analytics:read', async () => {
    const customer = await customerToken();
    await api().get('/v1/admin/analytics/products').set(bearer(customer.token)).expect(403);
  });
});

describe('the customer spectrum', () => {
  it('names the design a customer pressed the most buttons on', async () => {
    const { product: busier } = await createProductWithVariant();
    const { product: quieter } = await createProductWithVariant();
    const customer = await customerToken();
    const token = await adminToken();

    /* Four taps on one design, one on another. The first must be named. */
    for (let tap = 0; tap < 4; tap += 1) {
      await record(
        'spectrum-session-gggg',
        {
          event: 'interaction',
          action: 'select-size',
          productId: busier.id,
          surface: 'pdp-gallery',
        },
        customer.token,
      );
    }
    await record(
      'spectrum-session-gggg',
      {
        event: 'interaction',
        action: 'select-colour',
        productId: quieter.id,
        surface: 'pdp-gallery',
      },
      customer.token,
    );

    const response = await api()
      .get('/v1/admin/analytics/customer-spectrum')
      .set(bearer(token))
      .expect(200);

    const row = success<CustomerSpectrumEnvelope>(response.body).items.find(
      (item) => item.customerId === customer.id,
    );

    expect(row).toBeDefined();
    expect(row?.taps).toBe(5);
    expect(row?.designsViewed).toBe(2);
    expect(row?.configuredSessions).toBe(1);
    expect(row?.topProduct?.productId).toBe(busier.id);
  });

  it('gives a customer a per-design matrix of what they pressed', async () => {
    const { product } = await createProductWithVariant();
    const customer = await customerToken();
    const token = await adminToken();

    await record(
      'spectrum-session-hhhh',
      { event: 'product_view', productId: product.id, categorySlug: product.subcategorySlug },
      customer.token,
    );
    for (let tap = 0; tap < 3; tap += 1) {
      await record(
        'spectrum-session-hhhh',
        {
          event: 'interaction',
          action: 'select-size',
          productId: product.id,
          surface: 'pdp-gallery',
        },
        customer.token,
      );
    }

    const response = await api()
      .get(`/v1/admin/analytics/visitors/${customer.id}`)
      .set(bearer(token))
      .expect(200);

    const profile = success<{
      productActions: readonly {
        productId: string;
        actions: readonly { key: string; taps: number }[];
      }[];
    }>(response.body);

    const item = profile.productActions.find((entry) => entry.productId === product.id);
    expect(item).toBeDefined();
    /*
     * The view is counted but never appears as a button, and the size pick is
     * there three times. That sentence — "chose a size three times and did not
     * add it" — is the reason this block exists.
     */
    expect(item?.actions.map((action) => action.key)).toEqual(['select-size']);
    expect(item?.actions[0]?.taps).toBe(3);
  });

  it('ranks only identified customers, and never an anonymous session', async () => {
    const { product } = await createProductWithVariant();
    const token = await adminToken();

    await record('spectrum-session-iiii', {
      event: 'interaction',
      action: 'add-to-cart',
      productId: product.id,
      surface: 'pdp-gallery',
    });

    const response = await api()
      .get('/v1/admin/analytics/customer-spectrum')
      .set(bearer(token))
      .expect(200);

    /* There are events, but nobody to name — so the list is empty and correct. */
    expect(success<CustomerSpectrumEnvelope>(response.body).items).toEqual([]);
    expect(await ActivityEventModel.countDocuments()).toBe(1);
  });

  it('requires analytics:read', async () => {
    const customer = await customerToken();
    await api()
      .get('/v1/admin/analytics/customer-spectrum')
      .set(bearer(customer.token))
      .expect(403);
  });
});
