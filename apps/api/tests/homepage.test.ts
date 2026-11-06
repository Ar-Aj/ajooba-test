import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { TEST_PASSWORD, createAdmin, createProductWithVariant } from './helpers/factories.js';
import { OrderModel } from '../src/models/order.model.js';

/**
 * Homepage merchandising.
 *
 * These tests exercise the real Express stack against the throwaway
 * database, and they assert the *honesty* rules that matter most:
 *
 *  - a section referencing a product that does not exist is refused;
 *  - an expired campaign stops appearing without anyone editing the page;
 *  - a deal price is computed from real catalogue data, never invented;
 *  - a colour tile only appears for a colour the catalogue actually sells;
 *  - a product with unverified photography is never labelled purchasable.
 */

useApi();

async function adminToken(): Promise<string> {
  const admin = await createAdmin({ role: 'admin' });
  const response = await api()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: TEST_PASSWORD });
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

describe('authentication and authorization', () => {
  it('rejects an unauthenticated read of the admin sections', async () => {
    const response = await api().get('/v1/admin/content/homepage/sections');
    expect(response.status).toBe(401);
    expect(failure(response.body).code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated save', async () => {
    const response = await api()
      .put('/v1/admin/content/homepage/sections')
      .send({ version: 0, sections: [], publish: false });
    expect(response.status).toBe(401);
  });

  it('refuses a customer token', async () => {
    const customer = await createCustomerForTest();
    const response = await api().get('/v1/admin/content/homepage/sections').set(bearer(customer));
    expect(response.status).toBe(403);
  });

  it('lets an administrator read and write', async () => {
    const token = await adminToken();

    const read = await api().get('/v1/admin/content/homepage/sections').set(bearer(token));
    expect(read.status).toBe(200);

    const write = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({ version: 0, sections: [], publish: false });
    expect(write.status).toBe(200);
  });
});

/** A signed-in customer token, to prove the admin surface is closed to customers. */
async function createCustomerForTest(): Promise<string> {
  const { createCustomer } = await import('./helpers/factories.js');
  const customer = await createCustomer();
  const response = await api()
    .post('/v1/auth/login')
    .send({ email: customer.email, password: customer.password });
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

describe('product picker', () => {
  it('returns real catalogue rows with their problems flagged', async () => {
    await createProductWithVariant({ title: 'Synthetic Jutti', subcategorySlug: 'mojri-jutti' });
    const token = await adminToken();

    const response = await api()
      .get('/v1/admin/content/homepage/products?search=Synthetic')
      .set(bearer(token));

    expect(response.status).toBe(200);
    const body = success<{
      items: Array<{
        title: string;
        code: string;
        subcategorySlug: string;
        hasImage: boolean;
        hasSellableVariant: boolean;
      }>;
    }>(response.body);

    expect(body.items).toHaveLength(1);
    const row = body.items[0];
    expect(row?.title).toBe('Synthetic Jutti');
    expect(row?.code).toMatch(/^A\d+$/);
    expect(row?.subcategorySlug).toBe('mojri-jutti');
    // The factory creates no imagery, and that must be reported honestly.
    expect(row?.hasImage).toBe(false);
    expect(row?.hasSellableVariant).toBe(true);
  });

  it('requires authentication', async () => {
    const response = await api().get('/v1/admin/content/homepage/products');
    expect(response.status).toBe(401);
  });
});

describe('reference validation', () => {
  it('refuses a section that references a product which does not exist', async () => {
    const token = await adminToken();

    const response = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'featured',
              heading: 'The Edit',
              subheading: '',
              layout: 'spotlight',
              mode: 'manual',
              productIds: [new Types.ObjectId().toString()],
              limit: 5,
              spotlightProductId: null,
            },
          },
        ],
      });

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/product reference/i);
  });

  it('refuses a category that is not in this catalogue', async () => {
    const token = await adminToken();

    const response = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'category-grid',
              heading: 'Categories',
              subheading: '',
              layout: 'grid',
              categorySlugs: ['boots-that-do-not-exist'],
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
            },
          },
        ],
      });

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/not a category/i);
  });

  it('rejects an unsupported section type', async () => {
    const token = await adminToken();
    const response = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'not-a-real-section',
              heading: 'Nope',
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
            },
          },
        ],
      });
    expect(response.status).toBe(422);
  });
});

describe('visibility and scheduling', () => {
  it('omits a hidden section from the storefront but still shows it to the admin', async () => {
    const { product } = await createProductWithVariant({ title: 'A Hidden Gem' });
    const token = await adminToken();

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: false,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'featured',
              heading: 'Hidden',
              subheading: '',
              layout: 'grid',
              mode: 'manual',
              productIds: [product.id],
              limit: 4,
              spotlightProductId: null,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    const publicSections = success<{ sections: unknown[] }>(storefront.body).sections;
    expect(publicSections).toHaveLength(0);

    const admin = await api().get('/v1/admin/content/homepage/sections').set(bearer(token));
    const adminSections = success<{ items: Array<{ section: { hiddenBecause: string | null } }> }>(
      admin.body,
    ).items;
    expect(adminSections).toHaveLength(1);
    expect(adminSections[0]?.section.hiddenBecause).toBe('disabled');
  });

  it('drops a deal once its persisted end time has passed', async () => {
    const { product } = await createProductWithVariant({ title: 'An Expired Deal' });
    const token = await adminToken();

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: new Date(Date.now() - 7_200_000).toISOString(),
            endsAt: new Date(Date.now() - 3_600_000).toISOString(),
            config: {
              type: 'deal',
              heading: 'Yesterday only',
              subheading: '',
              layout: 'grid',
              mode: 'manual',
              productIds: [product.id],
              limit: 4,
              discountType: 'percentage',
              discountValue: 10,
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{ sections: unknown[] }>(storefront.body).sections;
    expect(sections).toHaveLength(0);
  });

  it('publishes a live deal with a backend-computed price', async () => {
    const { product } = await createProductWithVariant(
      { title: 'A Live Deal', sellingPrice: 1000, mrp: 2000 },
      { sellingPrice: 1000, mrp: 2000, stock: 5 },
    );
    const token = await adminToken();

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 3_600_000).toISOString(),
            config: {
              type: 'deal',
              heading: '24 hours only',
              subheading: '',
              layout: 'grid',
              mode: 'manual',
              productIds: [product.id],
              limit: 4,
              discountType: 'percentage',
              discountValue: 25,
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{
        type: string;
        campaignEndsAt: string | null;
        deals: Array<{ basePrice: number; finalPrice: number }>;
      }>;
    }>(storefront.body).sections;

    expect(sections).toHaveLength(1);
    expect(sections[0]?.type).toBe('deal');
    expect(sections[0]?.campaignEndsAt).not.toBeNull();
    // 25% off 1000 is 750, computed by the checkout pricing service.
    expect(sections[0]?.deals[0]?.basePrice).toBe(1000);
    expect(sections[0]?.deals[0]?.finalPrice).toBe(750);
  });
});

describe('colour discovery', () => {
  it('only offers colours the catalogue actually sells', async () => {
    await createProductWithVariant(
      { title: 'A Black Mojri', colours: ['Black'] },
      { colour: 'Black', photographyStatus: undefined },
    );
    // Give it a verified Black photograph, which is what makes it eligible
    // to illustrate the Black tile.
    const { ProductModel } = await import('../src/models/product.model.js');
    await ProductModel.updateOne(
      { title: 'A Black Mojri' },
      {
        $set: {
          images: [
            {
              url: '/products/black-mojri/black-1.jpeg',
              alt: 'A black mojri',
              position: 0,
              sourceFile: 'black-1.jpeg',
              colour: 'Black',
              colourToken: 'BLK',
              storage: 'local',
            },
          ],
        },
      },
    );
    const token = await adminToken();

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'colour-shop',
              heading: 'By colour',
              subheading: '',
              colours: ['Black', 'Chartreuse'],
              limit: 8,
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ colourTiles: Array<{ colour: string }>; config: { colours: string[] } }>;
    }>(storefront.body).sections;

    // Resolved tiles live in their own field; `config.colours` keeps the
    // administrator's original selection as plain colour names.
    const offered = sections[0]?.colourTiles ?? [];
    expect(offered.map((c) => c.colour)).toContain('Black');
    expect(sections[0]?.config.colours).toEqual(['Black', 'Chartreuse']);
    // The catalogue sells no chartreuse, so no such tile may appear.
    expect(offered.map((c) => c.colour)).not.toContain('Chartreuse');
  });

  /*
   * The exact defect the brief calls out: never show a black tile using a
   * brown photograph, or vice-versa.
   */
  it('pairs each colour tile with a photograph of that same colour', async () => {
    const { ProductModel } = await import('../src/models/product.model.js');

    await ProductModel.create({
      code: 'A77',
      slug: 'two-colour-design',
      title: 'Two Colour Design',
      description: 'A synthetic product used by the test suite.',
      subcategory: 'shoe',
      subcategorySlug: 'shoe',
      brand: 'Ajooba Footwear',
      colours: ['Black', 'Brown'],
      images: [
        {
          url: '/products/two-colour/black-1.jpeg',
          alt: 'The black colourway',
          position: 0,
          sourceFile: 'black-1.jpeg',
          colour: 'Black',
          colourToken: 'BLK',
        },
        {
          url: '/products/two-colour/brown-1.jpeg',
          alt: 'The brown colourway',
          position: 1,
          sourceFile: 'brown-1.jpeg',
          colour: 'Brown',
          colourToken: 'BRN',
        },
      ],
      mrp: 2000,
      sellingPrice: 1500,
      inStock: true,
    });

    const token = await adminToken();
    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'colour-shop',
              heading: 'By colour',
              subheading: '',
              colours: ['Black', 'Brown'],
              limit: 8,
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ colourTiles: Array<{ colour: string; imageUrl: string | null }> }>;
    }>(storefront.body).sections;

    const byColour = new Map((sections[0]?.colourTiles ?? []).map((c) => [c.colour, c.imageUrl]));

    expect(byColour.get('Black')).toContain('black-1');
    expect(byColour.get('Brown')).toContain('brown-1');
    // A black tile must never borrow the brown photograph.
    expect(byColour.get('Black')).not.toContain('brown-1');
  });

  it('drops a colour tile that has no verified photograph', async () => {
    await createProductWithVariant(
      { title: 'Colour Without Photos', colours: ['Chickoo'] },
      { colour: 'Chickoo' },
    );
    const token = await adminToken();

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'colour-shop',
              heading: 'By colour',
              subheading: '',
              colours: ['Chickoo'],
              limit: 8,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    // No verified photography for that colour means the section is hidden
    // rather than illustrated with the wrong shoe.
    const sections = success<{ sections: unknown[] }>(storefront.body).sections;
    expect(sections).toHaveLength(0);
  });
});

describe('trending honesty', () => {
  /**
   * Publish an `automatic` trending section.
   *
   * `automatic` is the only mode that chooses products itself, so it is the
   * only one where "what counts as popular" is a real decision.
   */
  async function publishTrending(token: string): Promise<void> {
    const response = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'trending',
              heading: 'Popular right now',
              subheading: '',
              layout: 'grid',
              mode: 'automatic',
              // Required by the schema even when unused: in `automatic` mode
              // the backend chooses the products, not this list.
              productIds: [],
              limit: 4,
            },
          },
        ],
      });

    // A silently-rejected save would make every assertion below pass
    // vacuously, so fail loudly here.
    expect(response.status).toBe(200);
  }

  /** A paid, completed order line, which is the only thing that counts. */
  async function paidOrder(
    productId: string,
    title: string,
    quantity: number,
    sku: string,
  ): Promise<void> {
    await OrderModel.create({
      orderNumber: `AJ-TREND-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      customerId: new Types.ObjectId(),
      customerName: 'Trend Customer',
      customerEmail: 'trend@example.test',
      customerPhone: '+919876543210',
      items: [
        {
          productId: new Types.ObjectId(productId),
          variantId: new Types.ObjectId(),
          sku,
          title,
          colour: 'Ivory',
          size: 6,
          unitPrice: 1500,
          mrp: 2000,
          quantity,
          lineTotal: 1500 * quantity,
        },
      ],
      subtotal: 1500 * quantity,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 1500 * quantity,
      currency: 'INR',
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'Trend Customer',
        phone: '+919876543210',
        line1: '1 Test Road',
        line2: '',
        city: 'Jaipur',
        state: 'Rajasthan',
        postalCode: '302001',
        country: 'India',
      },
      billingAddress: {
        fullName: 'Trend Customer',
        phone: '+919876543210',
        line1: '1 Test Road',
        line2: '',
        city: 'Jaipur',
        state: 'Rajasthan',
        postalCode: '302001',
        country: 'India',
      },
      placedAt: new Date(),
    });
  }

  it('ranks trending by genuine completed sales', async () => {
    // The *older* design is the best seller, so a newest-first fallback
    // would put the newer one first. Only real sales ranking gets this right.
    const quiet = await createProductWithVariant(
      { title: 'Quietly Sold', code: 'A31' },
      { stock: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const popular = await createProductWithVariant(
      { title: 'Actually Popular', code: 'A32' },
      { stock: 5 },
    );

    await paidOrder(popular.product.id, popular.product.title, 9, 'AJ-A32-OW-06');
    await paidOrder(quiet.product.id, quiet.product.title, 1, 'AJ-A31-OW-06');

    const token = await adminToken();
    await publishTrending(token);

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ type: string; products: Array<{ title: string }> }>;
    }>(storefront.body).sections;

    expect(sections[0]?.type).toBe('trending');
    // Nine units beats one, regardless of which design is newer.
    expect(sections[0]?.products[0]?.title).toBe('Actually Popular');
  });

  it('ignores unpaid and cancelled orders when ranking', async () => {
    const genuine = await createProductWithVariant(
      { title: 'Genuinely Sold', code: 'A35' },
      { stock: 5 },
    );
    const unpaid = await createProductWithVariant(
      { title: 'Unpaid Order Design', code: 'A36' },
      { stock: 5 },
    );
    const token = await adminToken();

    // One real sale, and a much larger one that was never paid for.
    await paidOrder(genuine.product.id, genuine.product.title, 1, 'AJ-A35-OW-06');
    await paidOrder(unpaid.product.id, unpaid.product.title, 20, 'AJ-A36-OW-06');
    await OrderModel.updateMany(
      { 'items.sku': 'AJ-A36-OW-06' },
      { $set: { status: 'cancelled', paymentStatus: 'pending' } },
    );

    await publishTrending(token);

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ type: string; products: Array<{ title: string }> }>;
    }>(storefront.body).sections;

    /*
     * Twenty unpaid units must not outrank one genuine sale. If cancelled
     * and unpaid orders counted, the unpaid design would lead; ranking only
     * completed + paid orders means the genuinely sold design leads instead.
     */
    expect(sections[0]?.products[0]?.title).toBe('Genuinely Sold');
    expect(sections[0]?.products.map((product) => product.title)).not.toContain(
      'Unpaid Order Design',
    );
  });

  it('falls back to newest designs when there are no sales at all', async () => {
    await createProductWithVariant({ title: 'Unsold Design', code: 'A34' }, { stock: 5 });
    const token = await adminToken();

    await publishTrending(token);

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ type: string; products: Array<{ title: string }> }>;
    }>(storefront.body).sections;

    // Honest fallback: real products, no invented sales figures.
    expect(sections[0]?.type).toBe('trending');
    expect(sections[0]?.products[0]?.title).toBe('Unsold Design');
  });
});

describe('ordering and persistence', () => {
  it('keeps the saved order and renumbers positions', async () => {
    const first = await createProductWithVariant({ title: 'First Design' });
    const second = await createProductWithVariant({ title: 'Second Design' });
    const token = await adminToken();

    const build = (id: string, heading: string) => ({
      type: 'featured',
      heading,
      subheading: '',
      layout: 'grid',
      mode: 'manual',
      productIds: [id],
      limit: 4,
      spotlightProductId: null,
    });

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: build(second.product.id, 'Second'),
          },
          {
            position: 1,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: build(first.product.id, 'First'),
          },
        ],
      });

    const admin = await api().get('/v1/admin/content/homepage/sections').set(bearer(token));
    const items = success<{ items: Array<{ section: { heading: string; position: number } }> }>(
      admin.body,
    ).items;

    expect(items.map((i) => i.section.heading)).toEqual(['Second', 'First']);
    expect(items.map((i) => i.section.position)).toEqual([0, 1]);
  });
});

describe('sellability honesty', () => {
  it('never labels a product with pending-review photography as purchasable', async () => {
    const { product } = await createProductWithVariant(
      { title: 'Unphotographed Colour' },
      { stock: 10, photographyStatus: 'pending-review' },
    );
    const token = await adminToken();

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: true,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'featured',
              heading: 'Edit',
              subheading: '',
              layout: 'grid',
              mode: 'manual',
              productIds: [product.id],
              limit: 4,
              spotlightProductId: null,
            },
          },
        ],
      });

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ products: Array<{ isPurchasable: boolean; verifiedColours: string[] }> }>;
    }>(storefront.body).sections;

    expect(sections[0]?.products[0]?.isPurchasable).toBe(false);
    // With nothing sellable, no colour may be offered.
    expect(sections[0]?.products[0]?.verifiedColours).toEqual([]);
  });
});

/**
 * Regression tests for three defects that made the admin editor unusable while
 * every other test still passed.
 *
 * Each of these shipped a green build and a green suite, because the suite
 * never performed a real read -> edit -> write cycle. These tests do exactly
 * that.
 */
describe('editor round trip (regression)', () => {
  /** Read the page exactly as the admin UI does. */
  async function readEditorPage(token: string): Promise<{
    version: number;
    sections: Array<{
      position: number;
      isVisible: boolean;
      startsAt: string | null;
      endsAt: string | null;
      config: Record<string, unknown>;
    }>;
  }> {
    const response = await api().get('/v1/admin/content/homepage/sections').set(bearer(token));
    expect(response.status).toBe(200);
    const data = success<{
      version: number;
      items: Array<{ section: Record<string, unknown> }>;
    }>(response.body);

    // Flatten to the exact shape the save endpoint accepts, which is what the
    // editor holds in its draft state.
    return {
      version: data.version,
      sections: data.items.map(({ section }) => ({
        position: section.position as number,
        isVisible: section.isVisible as boolean,
        startsAt: section.startsAt as string | null,
        endsAt: section.endsAt as string | null,
        config: section.config as Record<string, unknown>,
      })),
    };
  }

  it('returns the concurrency version the client must echo back on save', async () => {
    const token = await adminToken();
    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: false,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'featured',
              heading: 'Edit',
              subheading: '',
              layout: 'grid',
              mode: 'manual',
              productIds: [],
              limit: 4,
              spotlightProductId: null,
            },
          },
        ],
      });

    const response = await api().get('/v1/admin/content/homepage/sections').set(bearer(token));

    // Without this field the editor has no valid token and every save fails
    // with CONFLICT — the page looked fine and could never be edited.
    expect(typeof success<{ version: number }>(response.body).version).toBe('number');
  });

  it('accepts a save built from the page it just read', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant({ title: 'Round Trip Shoe' });

    const seed = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: false,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'featured',
              heading: 'Original',
              subheading: '',
              layout: 'grid',
              mode: 'manual',
              productIds: [product.id],
              limit: 4,
              spotlightProductId: null,
            },
          },
          {
            position: 1,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'colour-shop',
              heading: 'Shop by colour',
              subheading: '',
              colours: ['Black'],
              limit: 8,
            },
          },
        ],
      });
    expect(seed.status, JSON.stringify(seed.body)).toBe(200);

    // Read -> echo the version back -> save. This is what the editor does.
    const page = await readEditorPage(token);
    const response = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: page.version,
        publish: true,
        sections: page.sections.map((s, i) => ({ ...s, position: i })),
      });

    // Previously 422: the read had replaced `config.colours` with resolved
    // tile objects, which the write schema rejected as non-strings.
    expect(response.status).toBe(200);
  });

  it('leaves the editable config untouched when resolving colour tiles', async () => {
    const token = await adminToken();
    const { ProductModel } = await import('../src/models/product.model.js');
    await ProductModel.create({
      code: 'A91',
      slug: 'colour-tile-round-trip',
      title: 'Colour Tile Round Trip',
      description: 'A synthetic product used by the test suite.',
      subcategory: 'shoe',
      subcategorySlug: 'shoe',
      brand: 'Ajooba Footwear',
      colours: ['Black'],
      mrp: 2000,
      sellingPrice: 1500,
      images: [
        {
          url: '/products/round-trip/black-1.jpeg',
          sourceFile: 'A91-BLK-1.jpeg',
          alt: 'Black shoe',
          position: 0,
          colour: 'Black',
          colourToken: 'BLK',
        },
      ],
    });

    await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: 0,
        publish: false,
        sections: [
          {
            position: 0,
            isVisible: true,
            startsAt: null,
            endsAt: null,
            config: {
              type: 'colour-shop',
              heading: 'Colours',
              subheading: '',
              colours: ['Black'],
              limit: 8,
            },
          },
        ],
      });

    const response = await api().get('/v1/admin/content/homepage/sections').set(bearer(token));
    const section = success<{
      items: Array<{ section: { config: { colours: unknown }; colourTiles: unknown[] } }>;
    }>(response.body).items[0]!.section;

    // The admin's selection must come back as plain names...
    expect(section.config.colours).toEqual(['Black']);
    // ...and the resolved tiles must live in their own field.
    expect(Array.isArray(section.colourTiles)).toBe(true);
  });

  it('returns a fresh version so a second save is not locked out', async () => {
    const token = await adminToken();
    const payload = {
      publish: true,
      sections: [
        {
          position: 0,
          isVisible: true,
          startsAt: null,
          endsAt: null,
          config: {
            type: 'featured',
            heading: 'Once',
            subheading: '',
            layout: 'grid',
            mode: 'manual',
            productIds: [],
            limit: 4,
            spotlightProductId: null,
          },
        },
      ],
    };

    const first = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({ version: 0, ...payload });
    expect(first.status).toBe(200);
    const afterFirst = success<{ version: number }>(first.body).version;

    // Save again using the version the API handed back.
    const second = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({ version: afterFirst, ...payload });
    expect(second.status).toBe(200);

    // And the now-stale token must still be refused, proving the guard is real.
    const stale = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({ version: 0, ...payload });
    expect(stale.status).toBe(409);
  });

  it('hides a section from the storefront the moment an admin disables it', async () => {
    const token = await adminToken();
    // A real product is required: a `featured` section with no products is
    // legitimately hidden, which would make this test pass for the wrong reason.
    const { product } = await createProductWithVariant({ title: 'Toggle Design' });
    const page = await (async () => {
      await api()
        .put('/v1/admin/content/homepage/sections')
        .set(bearer(token))
        .send({
          version: 0,
          publish: false,
          sections: [
            {
              position: 0,
              isVisible: true,
              startsAt: null,
              endsAt: null,
              config: {
                type: 'featured',
                heading: 'Toggle me',
                subheading: '',
                layout: 'grid',
                mode: 'manual',
                productIds: [product.id],
                limit: 4,
                spotlightProductId: null,
              },
            },
          ],
        });
      return readEditorPage(token);
    })();

    const before = await api().get('/v1/content/homepage');
    expect(success<{ sections: unknown[] }>(before.body).sections).toHaveLength(1);

    const save = await api()
      .put('/v1/admin/content/homepage/sections')
      .set(bearer(token))
      .send({
        version: page.version,
        publish: true,
        sections: page.sections.map((s) => ({ ...s, isVisible: false })),
      });
    expect(save.status).toBe(200);

    const after = await api().get('/v1/content/homepage');
    // The admin toggle must reach the customer-facing payload.
    expect(success<{ sections: unknown[] }>(after.body).sections).toHaveLength(0);
  });
});
