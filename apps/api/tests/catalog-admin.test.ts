import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import type { AdminProductView, CategoryView, ImageReviewItem } from '@ajooba/contracts';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import {
  createAdmin,
  createProduct,
  createProductWithVariant,
  createVariant,
} from './helpers/factories.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { StockMovementModel } from '../src/models/stock-movement.model.js';
import { AuditLogModel } from '../src/models/audit-log.model.js';
import { ImageReviewModel } from '../src/models/image-review.model.js';
import { OrderModel } from '../src/models/order.model.js';

/**
 * Catalogue administration — the end-to-end contract for G-1 through G-5 and
 * Phase 7 inventory.
 *
 * These tests deliberately exercise the **full path** rather than the service
 * functions: an HTTP request in, a database write, and the response an admin
 * panel would actually render. The homepage round trip in `homepage.test.ts`
 * recorded three defects that a green build and a green suite both missed,
 * purely because nothing ever performed a read → edit → write cycle. Every
 * workflow below therefore asserts on what comes back **out** of the API
 * after a write, not just on the status code.
 */

useApi();

/** Sign an administrator in and return their access token. */
async function adminToken(
  overrides: { role?: 'owner' | 'admin' | 'manager' | 'support' | 'content-editor' } = {},
): Promise<string> {
  const admin = await createAdmin(overrides);
  const response = await api()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: admin.password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

/** Seed a category so product creation has somewhere to point. */
async function seedCategory(slug = 'shoe'): Promise<void> {
  await CategoryModel.create({
    slug,
    displayName: 'Shoes',
    position: 0,
    status: 'active',
    sourceSubcategory: 'shoe',
  });
}

/* ========================================================================== */
/* G-1 — Product CRUD                                                         */
/* ========================================================================== */

describe('G-1 product CRUD', () => {
  it('creates a design and reads it back by code', async () => {
    const token = await adminToken();
    await seedCategory();

    const created = await api()
      .post('/v1/admin/catalog/products')
      .set(bearer(token))
      .send({
        code: 'A58',
        title: 'AJOOBA Mojri Test Design',
        description: 'A synthetic design created by the test suite.',
        subcategory: 'shoe',
        subcategorySlug: 'shoe',
        colours: ['Black'],
        mrp: 2499,
        sellingPrice: 1749,
      });

    expect(created.status).toBe(201);
    const product = success<AdminProductView>(created.body);
    expect(product.code).toBe('A58');
    expect(product.status).toBe('draft');

    // Read back through the API, not the database.
    const read = await api().get('/v1/admin/catalog/products/A58').set(bearer(token));
    expect(read.status).toBe(200);
    const fetched = success<AdminProductView>(read.body);
    expect(fetched.title).toBe('AJOOBA Mojri Test Design');
    expect(fetched.slug).toBeTruthy();
  });

  it('refuses a duplicate design code with 409 rather than upserting', async () => {
    const token = await adminToken();
    await seedCategory();
    await createProduct({ code: 'A58' });

    const duplicate = await api()
      .post('/v1/admin/catalog/products')
      .set(bearer(token))
      .send({
        code: 'A58',
        title: 'A Different Title Entirely',
        description: 'Should not create a second parent.',
        subcategory: 'shoe',
        subcategorySlug: 'shoe',
        colours: ['Black'],
        mrp: 1000,
        sellingPrice: 900,
      });

    expect(duplicate.status).toBe(409);
    expect(failure(duplicate.body).code).toBe('CONFLICT');

    // Exactly one parent, unchanged.
    const count = await ProductModel.countDocuments({ code: 'A58' });
    expect(count).toBe(1);
  });

  it('edits a design in place without creating a second parent record', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A10', title: 'Original Title' });

    const updated = await api()
      .patch('/v1/admin/catalog/products/A10')
      .set(bearer(token))
      .send({ title: 'Corrected Title', description: 'Now with a description.' });

    expect(updated.status).toBe(200);
    const product = success<AdminProductView>(updated.body);
    expect(product.title).toBe('Corrected Title');
    expect(product.code).toBe('A10');

    // The critical assertion: an edit must not fork the catalogue.
    const all = await ProductModel.find({ code: 'A10' }).lean();
    expect(all).toHaveLength(1);
    expect(all[0]?.title).toBe('Corrected Title');
  });

  it('re-derives the slug when the title changes and keeps it unique', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A10', title: 'First Design' });
    await createProduct({ code: 'A11', title: 'First Design' });

    const first = await api()
      .patch('/v1/admin/catalog/products/A10')
      .set(bearer(token))
      .send({ title: 'Shared Name' });
    const second = await api()
      .patch('/v1/admin/catalog/products/A11')
      .set(bearer(token))
      .send({ title: 'Shared Name' });

    const firstSlug = success<AdminProductView>(first.body).slug;
    const secondSlug = success<AdminProductView>(second.body).slug;

    expect(firstSlug).toBe('shared-name');
    expect(secondSlug).toBe('shared-name-2');
    expect(firstSlug).not.toBe(secondSlug);
  });

  it('rejects an unknown category rather than inventing a taxonomy', async () => {
    const token = await adminToken();

    const response = await api()
      .post('/v1/admin/catalog/products')
      .set(bearer(token))
      .send({
        code: 'A60',
        title: 'Design With No Category',
        description: 'x',
        subcategory: 'Mystery',
        subcategorySlug: 'mystery-category',
        colours: ['Black'],
        mrp: 1000,
        sellingPrice: 900,
      });

    expect(response.status).toBe(422);
  });

  it('archives rather than deletes, and keeps the record readable', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A12' });

    const deleted = await api().delete('/v1/admin/catalog/products/A12').set(bearer(token));
    expect(deleted.status).toBe(200);
    expect(success<AdminProductView>(deleted.body).status).toBe('archived');

    // Still present — order history must keep resolving.
    const stillThere = await ProductModel.countDocuments({ code: 'A12' });
    expect(stillThere).toBe(1);

    const read = await api().get('/v1/admin/catalog/products/A12').set(bearer(token));
    expect(read.status).toBe(200);
  });

  it('writes an audit entry naming the administrator who made the change', async () => {
    const token = await adminToken();
    await seedCategory();

    await api()
      .post('/v1/admin/catalog/products')
      .set(bearer(token))
      .send({
        code: 'A61',
        title: 'Audited Design',
        description: 'x',
        subcategory: 'shoe',
        subcategorySlug: 'shoe',
        colours: ['Black'],
        mrp: 1000,
        sellingPrice: 900,
      });

    const entry = await AuditLogModel.findOne({ entity: 'product', entityId: 'A61' }).lean();
    expect(entry).not.toBeNull();
    expect(entry?.actorEmail).toContain('@');
    expect(entry?.action).toBe('create');
  });

  it('rejects a write without an admin token', async () => {
    await seedCategory();

    const response = await api()
      .post('/v1/admin/catalog/products')
      .send({
        code: 'A62',
        title: 'Unauthorised',
        description: 'x',
        subcategory: 'shoe',
        subcategorySlug: 'shoe',
        colours: ['Black'],
        mrp: 1000,
        sellingPrice: 900,
      });

    expect(response.status).toBe(401);
  });

  it('refuses a role without catalog:write', async () => {
    const token = await adminToken({ role: 'support' });

    const response = await api()
      .post('/v1/admin/catalog/products')
      .set(bearer(token))
      .send({
        code: 'A63',
        title: 'Support Should Not Write',
        description: 'x',
        subcategory: 'shoe',
        subcategorySlug: 'shoe',
        colours: ['Black'],
        mrp: 1000,
        sellingPrice: 900,
      });

    expect(response.status).toBe(403);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });
});

/* ========================================================================== */
/* G-2 / G-3 — Colour variants and SKUs                                       */
/* ========================================================================== */

describe('G-2 colour variants', () => {
  it('creates a colourway at stock zero with photography pending review', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A20', colours: ['Black'] });

    const response = await api()
      .post('/v1/admin/catalog/products/A20/variants')
      .set(bearer(token))
      .send({
        colour: 'Black',
        colourToken: 'BLK',
        size: 8,
        sku: 'AJ-A20-BLK-08',
        articleNumber: 'A20',
        mrp: 1999,
        sellingPrice: 1399,
      });

    expect(response.status).toBe(201);
    const body = success<{ variant: { sku: string; stock: number; sellable: boolean } }>(
      response.body,
    );
    expect(body.variant.sku).toBe('AJ-A20-BLK-08');
    // A new SKU must never be sellable because a form was filled in.
    expect(body.variant.stock).toBe(0);
    expect(body.variant.sellable).toBe(false);

    const stored = await VariantModel.findOne({ sku: 'AJ-A20-BLK-08' }).lean();
    expect(stored?.photographyStatus).toBe('pending-review');
  });

  it('ignores a stock value supplied on create — stock is not a create field', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A20', colours: ['Black'] });

    const response = await api()
      .post('/v1/admin/catalog/products/A20/variants')
      .set(bearer(token))
      .send({
        colour: 'Black',
        colourToken: 'BLK',
        size: 8,
        sku: 'AJ-A20-BLK-08',
        articleNumber: 'A20',
        mrp: 1999,
        sellingPrice: 1399,
        stock: 500,
      });

    expect(response.status).toBe(201);
    const stored = await VariantModel.findOne({ sku: 'AJ-A20-BLK-08' }).lean();
    expect(stored?.stock).toBe(0);
  });

  it('rejects a SKU whose design segment does not match the parent', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A20', colours: ['Black'] });

    const response = await api()
      .post('/v1/admin/catalog/products/A20/variants')
      .set(bearer(token))
      .send({
        colour: 'Black',
        colourToken: 'BLK',
        size: 8,
        sku: 'AJ-A99-BLK-08',
        articleNumber: 'A20',
        mrp: 1999,
        sellingPrice: 1399,
      });

    expect(response.status).toBe(422);
    expect(await VariantModel.countDocuments({ sku: 'AJ-A99-BLK-08' })).toBe(0);
  });

  it('rejects a duplicate SKU with 409', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant({ code: 'A21' }, { sku: 'AJ-A21-BLK-08' });

    const response = await api()
      .post(`/v1/admin/catalog/products/${product.code}/variants`)
      .set(bearer(token))
      .send({
        colour: 'Black',
        colourToken: 'BLK',
        size: 9,
        sku: 'AJ-A21-BLK-08',
        articleNumber: 'A21',
        mrp: 1999,
        sellingPrice: 1399,
      });

    expect(response.status).toBe(409);
  });

  it('rejects a duplicate colour-and-size on the same design', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant(
      { code: 'A22', colours: ['Black'] },
      { sku: 'AJ-A22-BLK-08', size: 8, colour: 'Black' },
    );

    const response = await api()
      .post(`/v1/admin/catalog/products/${product.code}/variants`)
      .set(bearer(token))
      .send({
        colour: 'Black',
        colourToken: 'BLK',
        size: 8,
        // A different but still valid Seller SKU Id, so the request reaches the
        // colour-and-size check rather than being rejected on its format.
        sku: 'AJ-A22-BLK-09',
        articleNumber: 'A22',
        mrp: 1999,
        sellingPrice: 1399,
      });

    expect(response.status).toBe(409);
  });

  it('registers a new colour on the parent so images can resolve against it', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A23', colours: ['Black'] });

    await api().post('/v1/admin/catalog/products/A23/variants').set(bearer(token)).send({
      colour: 'Brown',
      colourToken: 'BRN',
      size: 8,
      sku: 'AJ-A23-BRN-08',
      articleNumber: 'A23',
      mrp: 1999,
      sellingPrice: 1399,
    });

    const product = await ProductModel.findOne({ code: 'A23' }).lean();
    expect(product?.colours).toContain('Brown');
  });

  it('lists a colourway with its verified images and an honest empty state', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant(
      {
        code: 'A24',
        colours: ['Black', 'Brown'],
        images: [
          { url: '/products/A24/A24-BLK-1.jpg', alt: 'Black', position: 0, colour: 'Black' },
        ],
      },
      { sku: 'AJ-A24-BLK-08', colour: 'Black', colourToken: 'BLK', photographyStatus: 'verified' },
    );
    await createVariant({
      productId: product.id,
      productCode: 'A24',
      sku: 'AJ-A24-BRN-08',
      colour: 'Brown',
      colourToken: 'BRN',
      size: 8,
    });

    const response = await api().get('/v1/admin/catalog/products/A24/variants').set(bearer(token));

    expect(response.status).toBe(200);
    const body = success<{
      items: Array<{ sku: string; colour: string; images: string[] }>;
    }>(response.body);

    const black = body.items.find((item) => item.sku === 'AJ-A24-BLK-08');
    const brown = body.items.find((item) => item.sku === 'AJ-A24-BRN-08');

    // Black has a verified photograph; Brown must report "none", never Black's.
    expect(black?.images).toContain('/products/A24/A24-BLK-1.jpg');
    expect(brown?.images).toEqual([]);
  });

  it('rolls colourways up one row per colour, not per SKU', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant(
      { code: 'A25', colours: ['Black'] },
      { sku: 'AJ-A25-BLK-07', size: 7, colour: 'Black', colourToken: 'BLK' },
    );
    await createVariant({
      productId: product.id,
      productCode: 'A25',
      sku: 'AJ-A25-BLK-08',
      size: 8,
      colour: 'Black',
      colourToken: 'BLK',
    });

    const response = await api().get('/v1/admin/catalog/products/A25/colours').set(bearer(token));

    const body = success<{ items: Array<{ colour: string; sizes: number[]; skus: string[] }> }>(
      response.body,
    );

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.sizes).toEqual([7, 8]);
    expect(body.items[0]?.skus).toHaveLength(2);
  });

  it('updates a SKU without touching its identity or its stock', async () => {
    const token = await adminToken();
    const { product, variant } = await createProductWithVariant(
      { code: 'A26', colours: ['Black'] },
      { sku: 'AJ-A26-BLK-08', stock: 7, mrp: 2000, sellingPrice: 1500 },
    );

    const response = await api()
      .patch(`/v1/admin/catalog/skus/${variant.sku}`)
      .set(bearer(token))
      .send({ sellingPrice: 1400 });

    expect(response.status).toBe(200);
    const body = success<{ sku: string; sellingPrice: number; discountPercent: number }>(
      response.body,
    );
    expect(body.sku).toBe(variant.sku);
    expect(body.sellingPrice).toBe(1400);
    expect(body.discountPercent).toBe(30);

    const stored = await VariantModel.findOne({ sku: variant.sku }).lean();
    expect(stored?.stock).toBe(7);
    expect(stored?.productId.toString()).toBe(product.id);
  });

  it('retires a SKU without deleting it', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant({}, { sku: 'AJ-A27-BLK-08', stock: 5 });

    const response = await api()
      .delete(`/v1/admin/catalog/variants/${variant.sku}`)
      .set(bearer(token));

    expect(response.status).toBe(200);
    const stored = await VariantModel.findOne({ sku: variant.sku }).lean();
    expect(stored).not.toBeNull();
    expect(stored?.stock).toBe(0);
    expect(stored?.inStock).toBe(false);
  });
});

describe('G-3 SKU reads', () => {
  it('resolves a batch and separates missing from empty', async () => {
    const token = await adminToken();
    await createProductWithVariant({ code: 'A30' }, { sku: 'AJ-A30-BLK-08', stock: 0 });

    const response = await api()
      .post('/v1/admin/catalog/skus/lookup')
      .set(bearer(token))
      .send({ skus: ['AJ-A30-BLK-08', 'AJ-A99-BLK-08'] });

    expect(response.status).toBe(200);
    const body = success<{ found: Array<{ sku: string; stock: number }>; missing: string[] }>(
      response.body,
    );

    // Found-but-empty and not-found are different reconciliation problems.
    expect(body.found[0]?.sku).toBe('AJ-A30-BLK-08');
    expect(body.found[0]?.stock).toBe(0);
    expect(body.missing).toEqual(['AJ-A99-BLK-08']);
  });

  it('reads one SKU with its stock history', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant({}, { sku: 'AJ-A31-BLK-08', stock: 3 });

    const response = await api()
      .get(`/v1/admin/catalog/skus/${variant.sku}/stock`)
      .set(bearer(token));

    expect(response.status).toBe(200);
    const body = success<{ sku: string; variant: { stock: number }; movements: unknown[] }>(
      response.body,
    );
    expect(body.sku).toBe(variant.sku);
    expect(body.variant.stock).toBe(3);
    expect(Array.isArray(body.movements)).toBe(true);
  });

  it('finds a design by its SKU, not only by its title', async () => {
    const token = await adminToken();
    await createProductWithVariant(
      { code: 'A32', title: 'An Obscure Design' },
      { sku: 'AJ-A32-BRN-09' },
    );

    const response = await api()
      .get('/v1/admin/catalog/products?search=AJ-A32-BRN-09')
      .set(bearer(token));

    const body = success<{ items: AdminProductView[] }>(response.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.code).toBe('A32');
  });
});

/* ========================================================================== */
/* G-4 — Categories                                                           */
/* ========================================================================== */

describe('G-4 categories', () => {
  it('seeds categories from the slugs already in use, idempotently', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A40', subcategorySlug: 'shoe' });
    await createProduct({ code: 'A41', subcategorySlug: 'mojri-jutti' });

    const first = await api().post('/v1/admin/catalog/categories/seed').set(bearer(token));
    expect(first.status).toBe(200);

    const body = success<{ created: string[]; existing: string[] }>(first.body);
    expect(body.created).toContain('shoe');
    expect(body.created).toContain('mojri-jutti');

    const second = await api().post('/v1/admin/catalog/categories/seed').set(bearer(token));
    const secondBody = success<{ created: string[] }>(second.body);
    // Re-running must not duplicate or undo anything.
    expect(secondBody.created).toEqual([]);
    expect(await CategoryModel.countDocuments({})).toBe(2);
  });

  it('creates, edits and reads back a category', async () => {
    const token = await adminToken();

    const created = await api().post('/v1/admin/catalog/categories').set(bearer(token)).send({
      slug: 'ethnic-wear',
      displayName: 'Ethnic Wear',
      description: 'Traditional footwear',
    });

    expect(created.status).toBe(201);
    expect(success<CategoryView>(created.body).displayName).toBe('Ethnic Wear');

    const updated = await api()
      .patch('/v1/admin/catalog/categories/ethnic-wear')
      .set(bearer(token))
      .send({ displayName: 'Ethnic & Traditional' });

    expect(updated.status).toBe(200);
    expect(success<CategoryView>(updated.body).displayName).toBe('Ethnic & Traditional');
  });

  it('rejects a circular hierarchy', async () => {
    const token = await adminToken();
    await api()
      .post('/v1/admin/catalog/categories')
      .set(bearer(token))
      .send({ slug: 'parent-cat', displayName: 'Parent' });
    await api()
      .post('/v1/admin/catalog/categories')
      .set(bearer(token))
      .send({ slug: 'child-cat', displayName: 'Child', parentSlug: 'parent-cat' });

    const selfParent = await api()
      .patch('/v1/admin/catalog/categories/parent-cat')
      .set(bearer(token))
      .send({ parentSlug: 'parent-cat' });
    expect(selfParent.status).toBe(422);

    const cycle = await api()
      .patch('/v1/admin/catalog/categories/parent-cat')
      .set(bearer(token))
      .send({ parentSlug: 'child-cat' });
    expect(cycle.status).toBe(422);
  });

  it('refuses to retire a category that still has products', async () => {
    const token = await adminToken();
    await seedCategory('shoe');
    await createProduct({ code: 'A42', subcategorySlug: 'shoe' });

    const response = await api().delete('/v1/admin/catalog/categories/shoe').set(bearer(token));

    expect(response.status).toBe(409);
    expect(await CategoryModel.countDocuments({ slug: 'shoe', status: 'active' })).toBe(1);
  });

  it('reorders and renumbers positions contiguously', async () => {
    const token = await adminToken();
    for (const slug of ['one', 'two', 'three']) {
      await api()
        .post('/v1/admin/catalog/categories')
        .set(bearer(token))
        .send({ slug, displayName: slug });
    }

    const response = await api()
      .post('/v1/admin/catalog/categories/reorder')
      .set(bearer(token))
      .send({ orderedSlugs: ['three', 'one', 'two'] });

    expect(response.status).toBe(200);
    const body = success<{ items: CategoryView[] }>(response.body);
    expect(body.items.map((item) => item.slug)).toEqual(['three', 'one', 'two']);
    expect(body.items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it('reports real product counts from actual assignments', async () => {
    const token = await adminToken();
    await seedCategory('shoe');
    await createProduct({ code: 'A43', subcategorySlug: 'shoe' });
    await createProduct({ code: 'A44', subcategorySlug: 'shoe' });
    await createProduct({ code: 'A45', subcategorySlug: 'sandal' });

    const response = await api().get('/v1/admin/catalog/categories').set(bearer(token));
    const body = success<{ items: CategoryView[] }>(response.body);

    const shoe = body.items.find((item) => item.slug === 'shoe');
    expect(shoe?.productCount).toBe(2);
  });
});

/* ========================================================================== */
/* G-5 — Image review                                                         */
/* ========================================================================== */

describe('G-5 image review', () => {
  it('surfaces the queue with evidence a reviewer can act on', async () => {
    const token = await adminToken();
    await createProduct({
      code: 'A50',
      colours: ['Black', 'Brown'],
      images: [
        { url: '/p/A50/A50-BLK-1.jpg', alt: 'black', position: 0, colour: 'Black' },
        { url: '/p/A50/A50-TAN-1.jpg', alt: 'unverified', position: 1 },
      ],
    });

    const response = await api()
      .get('/v1/admin/catalog/images/review-queue?code=A50')
      .set(bearer(token));

    expect(response.status).toBe(200);
    const body = success<{ items: ImageReviewItem[] }>(response.body);

    const pending = body.items.find((item) => item.sourceFile === 'A50-TAN-1.jpg');
    expect(pending).toBeDefined();
    // A reviewer cannot act on "unverified" alone — the reason must be there.
    expect(pending?.reason).toBe('token-not-sold');
    expect(pending?.availableColours).toEqual(['Black', 'Brown']);
    expect(pending?.url).toBe('/p/A50/A50-TAN-1.jpg');
    expect(pending?.designCode).toBe('A50');
  });

  it('assigns a colour, persists it, and promotes the colourway in one operation', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant(
      {
        code: 'A51',
        colours: ['Black', 'Brown'],
        images: [{ url: '/p/A51/A51-TAN-1.jpg', alt: 'tan', position: 0 }],
      },
      {
        sku: 'AJ-A51-BRN-08',
        colour: 'Brown',
        colourToken: 'BRN',
        photographyStatus: 'pending-review',
      },
    );
    void product;

    const response = await api()
      .post('/v1/admin/catalog/images/A51:A51-TAN-1.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Brown', reason: 'Verified by eye; the filename token is wrong.' });

    expect(response.status).toBe(200);
    expect(success<ImageReviewItem>(response.body).status).toBe('assigned');

    // Persisted through the backend…
    const stored = await ImageReviewModel.findOne({ imageId: 'A51:A51-TAN-1.jpg' }).lean();
    expect(stored?.assignedColour).toBe('Brown');
    expect(stored?.reviewedByEmail).toContain('@');
    expect(stored?.reviewReason).toContain('filename token');

    // …visible on the gallery…
    const reread = await api().get('/v1/admin/catalog/products/A51/variants').set(bearer(token));
    const variant = success<{ items: Array<{ sku: string; images: string[] }> }>(reread.body)
      .items[0];
    expect(variant?.images).toContain('/p/A51/A51-TAN-1.jpg');

    // …and the colourway is no longer gated.
    const promoted = await VariantModel.findOne({ sku: 'AJ-A51-BRN-08' }).lean();
    expect(promoted?.photographyStatus).toBe('verified');
  });

  it('refuses an assignment to a colour the design does not sell', async () => {
    const token = await adminToken();
    await createProduct({
      code: 'A52',
      colours: ['Black'],
      images: [{ url: '/p/A52/A52-TAN-1.jpg', alt: 'tan', position: 0 }],
    });

    const response = await api()
      .post('/v1/admin/catalog/images/A52:A52-TAN-1.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Beige', reason: 'Attempting to invent a colourway.' });

    expect(response.status).toBe(422);
  });

  it('requires a substantive reason for every override', async () => {
    const token = await adminToken();
    await createProduct({
      code: 'A53',
      colours: ['Black'],
      images: [{ url: '/p/A53/A53-x.jpg', alt: 'x', position: 0 }],
    });
    await createVariant({
      productId: (await ProductModel.findOne({ code: 'A53' }).lean())!._id.toString(),
      productCode: 'A53',
      sku: 'AJ-A53-BLK-08',
      colour: 'Black',
      colourToken: 'BLK',
    });

    const response = await api()
      .post('/v1/admin/catalog/images/A53:A53-x.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Black', reason: 'ok' });

    expect(response.status).toBe(422);
  });

  it('blocks the same photograph being assigned to two colours', async () => {
    const token = await adminToken();
    const { product } = await createProductWithVariant(
      {
        code: 'A54',
        colours: ['Black', 'Brown'],
        images: [{ url: '/p/A54/dup.jpg', alt: 'dup', position: 0 }],
      },
      { sku: 'AJ-A54-BLK-08', colour: 'Black', colourToken: 'BLK' },
    );
    void product;
    await createVariant({
      productId: (await ProductModel.findOne({ code: 'A54' }).lean())!._id.toString(),
      productCode: 'A54',
      sku: 'AJ-A54-BRN-08',
      colour: 'Brown',
      colourToken: 'BRN',
    });

    // Give both images identical bytes, as a duplicated asset would.
    await ProductModel.updateOne(
      { code: 'A54' },
      {
        $set: {
          images: [
            {
              url: '/p/A54/dup.jpg',
              alt: 'dup',
              position: 0,
              sourceFile: 'dup.jpg',
              checksum: 'identical-checksum',
              storage: 'local',
            },
            {
              url: '/p/A54/dup2.jpg',
              alt: 'dup',
              position: 1,
              sourceFile: 'dup2.jpg',
              checksum: 'identical-checksum',
              storage: 'local',
            },
          ],
        },
      },
    );

    const first = await api()
      .post('/v1/admin/catalog/images/A54:dup.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Black', reason: 'First assignment of these bytes.' });
    expect(first.status).toBe(200);

    const second = await api()
      .post('/v1/admin/catalog/images/A54:dup2.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Brown', reason: 'Attempting to reuse the same bytes.' });

    expect(second.status).toBe(409);
  });

  /*
   * Regression test for a defect found during the G-1…G-6 audit.
   *
   * The guard above searches `image_reviews`. But 85 of the live catalogue's
   * images were coloured by `image-colour-migration.job.ts`, which never
   * wrote a review record — and until the checksum backfill ran, none of them
   * carried a checksum either, so the guard was inert across the whole
   * catalogue. A colour stamped by a migration must block the same bytes from
   * being reused, exactly as a colour set by a reviewer does.
   */
  it('blocks reuse of bytes already displayed under another colour by a prior migration', async () => {
    const token = await adminToken();
    await createProduct({
      code: 'A56',
      colours: ['Black', 'Brown'],
      images: [{ url: '/p/A56/mig.jpg', alt: 'mig', position: 0 }],
    });
    await createVariant({
      productId: (await ProductModel.findOne({ code: 'A56' }).lean())!._id.toString(),
      productCode: 'A56',
      sku: 'AJ-A56-BLK-08',
      colour: 'Black',
      colourToken: 'BLK',
    });
    await createVariant({
      productId: (await ProductModel.findOne({ code: 'A56' }).lean())!._id.toString(),
      productCode: 'A56',
      sku: 'AJ-A56-BRN-08',
      colour: 'Brown',
      colourToken: 'BRN',
    });

    // As the migration left them: coloured by rule, no review record at all.
    await ProductModel.updateOne(
      { code: 'A56' },
      {
        $set: {
          images: [
            {
              url: '/p/A56/mig.jpg',
              alt: 'mig',
              position: 0,
              sourceFile: 'mig.jpg',
              colour: 'Black',
              colourToken: 'BLK',
              checksum: 'migrated-checksum',
              storage: 'local',
            },
            {
              url: '/p/A56/mig-copy.jpg',
              alt: 'mig',
              position: 1,
              sourceFile: 'mig-copy.jpg',
              checksum: 'migrated-checksum',
              storage: 'local',
            },
          ],
        },
      },
    );
    expect(await ImageReviewModel.countDocuments({ designCode: 'A56' })).toBe(0);

    const response = await api()
      .post('/v1/admin/catalog/images/A56:mig-copy.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Brown', reason: 'Trying to reuse a migrated photograph.' });

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/Black/);
  });

  it('blocks cross-design reuse of identical bytes', async () => {
    const token = await adminToken();
    for (const code of ['A57', 'A58']) {
      await createProduct({
        code,
        colours: ['Black'],
        images: [{ url: `/p/${code}/x.jpg`, alt: 'x', position: 0 }],
      });
      await createVariant({
        productId: (await ProductModel.findOne({ code }).lean())!._id.toString(),
        productCode: code,
        sku: `AJ-${code}-BLK-08`,
        colour: 'Black',
        colourToken: 'BLK',
      });
      await ProductModel.updateOne(
        { code },
        {
          $set: {
            images: [
              {
                url: `/p/${code}/x.jpg`,
                alt: 'x',
                position: 0,
                sourceFile: 'x.jpg',
                colour: 'Black',
                colourToken: 'BLK',
                checksum: 'shared-across-designs',
                storage: 'local',
              },
            ],
          },
        },
      );
    }

    await ProductModel.updateOne(
      { code: 'A58' },
      {
        $push: {
          images: {
            url: '/p/A58/y.jpg',
            alt: 'y',
            position: 1,
            sourceFile: 'y.jpg',
            checksum: 'shared-across-designs',
            storage: 'local',
          },
        },
      },
    );

    const response = await api()
      .post('/v1/admin/catalog/images/A58:y.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Black', reason: 'Reusing a photograph from another design.' });

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/A57/);
  });

  it('allows a quarantined duplicate to be resolved, since it occupies no gallery', async () => {
    const token = await adminToken();
    await createProduct({
      code: 'A59',
      colours: ['Black'],
      images: [{ url: '/p/A59/q.jpg', alt: 'q', position: 0 }],
    });
    await createVariant({
      productId: (await ProductModel.findOne({ code: 'A59' }).lean())!._id.toString(),
      productCode: 'A59',
      sku: 'AJ-A59-BLK-08',
      colour: 'Black',
      colourToken: 'BLK',
    });

    // Two copies, neither displayed — resolving one is exactly the intent.
    await ProductModel.updateOne(
      { code: 'A59' },
      {
        $set: {
          images: [
            {
              url: '/p/A59/q.jpg',
              alt: 'q',
              position: 0,
              sourceFile: 'q.jpg',
              checksum: 'twins',
              storage: 'local',
            },
            {
              url: '/p/A59/q-copy.jpg',
              alt: 'q',
              position: 1,
              sourceFile: 'q-copy.jpg',
              checksum: 'twins',
              storage: 'local',
            },
          ],
        },
      },
    );

    const response = await api()
      .post('/v1/admin/catalog/images/A59:q.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Black', reason: 'Resolving the first of two identical quarantined files.' });

    expect(response.status).toBe(200);
    expect(success<ImageReviewItem>(response.body).assignedColour).toBe('Black');
  });

  it('keeps a rejected image quarantined and undisplayed', async () => {
    const token = await adminToken();
    await createProduct({
      code: 'A55',
      colours: ['Black'],
      images: [{ url: '/p/A55/bad.jpg', alt: 'bad', position: 0 }],
    });

    const response = await api()
      .post('/v1/admin/catalog/images/A55:bad.jpg/reject')
      .set(bearer(token))
      .send({ reason: 'This photograph is a detail shot, not the product.' });

    expect(response.status).toBe(200);
    expect(success<ImageReviewItem>(response.body).status).toBe('rejected');

    const product = await ProductModel.findOne({ code: 'A55' }).lean();
    expect(product?.quarantinedImages).toContain('bad.jpg');
    // And it still carries no colour, so no gallery can pick it up.
    expect(product?.images[0]?.colour).toBeUndefined();
  });

  it('reverting an assignment returns the image to quarantine and re-gates the colour', async () => {
    const token = await adminToken();
    await createProductWithVariant(
      {
        code: 'A56',
        colours: ['Brown'],
        images: [{ url: '/p/A56/a.jpg', alt: 'a', position: 0 }],
      },
      {
        sku: 'AJ-A56-BRN-08',
        colour: 'Brown',
        colourToken: 'BRN',
        photographyStatus: 'pending-review',
      },
    );

    await api()
      .post('/v1/admin/catalog/images/A56:a.jpg/assign')
      .set(bearer(token))
      .send({ colour: 'Brown', reason: 'Assigning for the first time.' });

    const reverted = await api()
      .post('/v1/admin/catalog/images/A56:a.jpg/revert')
      .set(bearer(token))
      .send({ reason: 'Reconsidering; the photo is ambiguous.' });

    expect(reverted.status).toBe(200);

    const product = await ProductModel.findOne({ code: 'A56' }).lean();
    expect(product?.images[0]?.colour).toBeUndefined();
    expect(product?.quarantinedImages).toContain('a.jpg');

    // The colour no longer has a photo, so it must not stay sellable.
    const variant = await VariantModel.findOne({ sku: 'AJ-A56-BRN-08' }).lean();
    expect(variant?.photographyStatus).toBe('pending-review');
  });

  it('refuses to mark a colour verified without a verified photograph', async () => {
    const token = await adminToken();
    await createProductWithVariant(
      { code: 'A57', colours: ['Brown'] },
      {
        sku: 'AJ-A57-BRN-08',
        colour: 'Brown',
        colourToken: 'BRN',
        photographyStatus: 'pending-review',
      },
    );

    const response = await api()
      .patch('/v1/admin/catalog/variants/AJ-A57-BRN-08/photography')
      .set(bearer(token))
      .send({ status: 'verified', reason: 'Attempting to bypass the gate.' });

    expect(response.status).toBe(409);
  });

  it('reports per-colour coverage and names the gaps', async () => {
    const token = await adminToken();
    await createProductWithVariant(
      {
        code: 'A58',
        colours: ['Black', 'Brown'],
        images: [{ url: '/p/A58/blk.jpg', alt: 'blk', position: 0, colour: 'Black' }],
      },
      { sku: 'AJ-A58-BLK-08', colour: 'Black', colourToken: 'BLK', photographyStatus: 'verified' },
    );

    const response = await api().get('/v1/admin/catalog/images/A58/coverage').set(bearer(token));

    const body = success<{
      colours: Array<{ colour: string; verifiedImageCount: number; hasVerifiedPhoto: boolean }>;
      gaps: string[];
    }>(response.body);

    expect(body.gaps).toContain('Brown');
    expect(body.colours.find((entry) => entry.colour === 'Black')?.verifiedImageCount).toBe(1);
  });

  it('a design whose photographs are all unverified stays unsellable', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A59', colours: ['Black'] },
      {
        sku: 'AJ-A59-BLK-08',
        colour: 'Black',
        colourToken: 'BLK',
        photographyStatus: 'pending-review',
        stock: 20,
      },
    );

    const response = await api().get(`/v1/admin/catalog/skus/${variant.sku}`).set(bearer(token));

    const body = success<{ stock: number; sellable: boolean }>(response.body);
    expect(body.stock).toBe(20);
    // Stock alone must not make a colour buyable.
    expect(body.sellable).toBe(false);
  });
});

/* ========================================================================== */
/* Phase 7 — Inventory                                                        */
/* ========================================================================== */

describe('Phase 7 inventory', () => {
  it('sets stock with a reason and writes a ledger row', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A70', colours: ['Black'] },
      { sku: 'AJ-A70-BLK-08', stock: 0, photographyStatus: 'verified' },
    );

    const response = await api()
      .put(`/v1/admin/catalog/skus/${variant.sku}/stock`)
      .set(bearer(token))
      .send({ quantity: 12, reason: 'audit', expectedCurrentStock: 0 });

    expect(response.status).toBe(200);
    const body = success<{ stockBefore: number; stockAfter: number; sellable: boolean }>(
      response.body,
    );
    expect(body.stockBefore).toBe(0);
    expect(body.stockAfter).toBe(12);
    expect(body.sellable).toBe(true);

    const movement = await StockMovementModel.findOne({ sku: variant.sku }).lean();
    expect(movement?.delta).toBe(12);
    expect(movement?.reason).toBe('audit');
  });

  it('rejects a stale write rather than overwriting a newer count', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A71' },
      { sku: 'AJ-A71-BLK-08', stock: 5, photographyStatus: 'verified' },
    );

    const response = await api()
      .put(`/v1/admin/catalog/skus/${variant.sku}/stock`)
      .set(bearer(token))
      .send({ quantity: 99, reason: 'audit', expectedCurrentStock: 0 });

    expect(response.status).toBe(409);
    const stored = await VariantModel.findOne({ sku: variant.sku }).lean();
    expect(stored?.stock).toBe(5);
  });

  it('refuses to set stock below what open carts have reserved', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A72' },
      { sku: 'AJ-A72-BLK-08', stock: 10, reservedStock: 4, photographyStatus: 'verified' },
    );

    const response = await api()
      .put(`/v1/admin/catalog/skus/${variant.sku}/stock`)
      .set(bearer(token))
      .send({ quantity: 2, reason: 'audit', expectedCurrentStock: 10 });

    expect(response.status).toBe(409);
    const stored = await VariantModel.findOne({ sku: variant.sku }).lean();
    expect(stored?.stock).toBe(10);
  });

  it('keeps a SKU unsellable when stock exists but photography is unverified', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A73', colours: ['Black'] },
      {
        sku: 'AJ-A73-BLK-08',
        stock: 0,
        photographyStatus: 'pending-review',
      },
    );

    const response = await api()
      .put(`/v1/admin/catalog/skus/${variant.sku}/stock`)
      .set(bearer(token))
      .send({ quantity: 50, reason: 'audit', expectedCurrentStock: 0 });

    expect(response.status).toBe(200);
    expect(success<{ sellable: boolean }>(response.body).sellable).toBe(false);
  });

  it('bulk stock set defaults to a dry run that writes nothing', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A74' },
      { sku: 'AJ-A74-BLK-08', stock: 0, photographyStatus: 'verified' },
    );

    const response = await api()
      .post('/v1/admin/catalog/inventory/stock-set')
      .set(bearer(token))
      .send({ rows: [{ sku: variant.sku, quantity: 8 }], reason: 'audit' });

    expect(response.status).toBe(200);
    const body = success<{ dryRun: boolean; totals: { changed: number } }>(response.body);
    expect(body.dryRun).toBe(true);
    expect(body.totals.changed).toBe(1);

    const stored = await VariantModel.findOne({ sku: variant.sku }).lean();
    // A dry run must not write.
    expect(stored?.stock).toBe(0);
  });

  it('bulk stock set applies when explicitly confirmed', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A75' },
      { sku: 'AJ-A75-BLK-08', stock: 0, photographyStatus: 'verified' },
    );

    const response = await api()
      .post('/v1/admin/catalog/inventory/stock-set')
      .set(bearer(token))
      .send({ rows: [{ sku: variant.sku, quantity: 8 }], reason: 'audit', dryRun: false });

    expect(response.status).toBe(200);
    expect(success<{ dryRun: boolean }>(response.body).dryRun).toBe(false);

    const stored = await VariantModel.findOne({ sku: variant.sku }).lean();
    expect(stored?.stock).toBe(8);
  });

  it('refuses stock writes without inventory:write', async () => {
    const token = await adminToken({ role: 'content-editor' });
    const { variant } = await createProductWithVariant({}, { sku: 'AJ-A76-BLK-08', stock: 0 });

    const response = await api()
      .put(`/v1/admin/catalog/skus/${variant.sku}/stock`)
      .set(bearer(token))
      .send({ quantity: 5, reason: 'audit', expectedCurrentStock: 0 });

    expect(response.status).toBe(403);
  });
});

/* ========================================================================== */
/* Historical order preservation                                              */
/* ========================================================================== */

describe('historical order preservation', () => {
  it('archiving a design leaves its order history intact and resolvable', async () => {
    const token = await adminToken();
    const { product, variant } = await createProductWithVariant(
      { code: 'A80', colours: ['Black'] },
      { sku: 'AJ-A80-BLK-08', stock: 5, photographyStatus: 'verified' },
    );

    const order = await OrderModel.create({
      orderNumber: 'AJ-TEST-0001',
      customerId: new Types.ObjectId(await createCustomerId()),
      customerName: 'Test Customer',
      customerEmail: 'test-customer@example.test',
      customerPhone: '+919876543210',
      items: [
        {
          productId: new Types.ObjectId(product.id),
          variantId: new Types.ObjectId(variant.id),
          sku: variant.sku,
          title: 'Ordered Design',
          colour: 'Black',
          size: 8,
          unitPrice: 1500,
          mrp: 2000,
          quantity: 2,
          lineTotal: 3000,
        },
      ],
      subtotal: 3000,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 3000,
      currency: 'INR',
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: 'cod',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '+919876543210',
        line1: '12 Test Street',
        line2: '',
        city: 'Jaipur',
        state: 'Rajasthan',
        postalCode: '302001',
        country: 'India',
      },
      billingAddress: {
        fullName: 'Test Customer',
        phone: '+919876543210',
        line1: '12 Test Street',
        line2: '',
        city: 'Jaipur',
        state: 'Rajasthan',
        postalCode: '302001',
        country: 'India',
      },
      placedAt: new Date(),
    });

    await api().delete('/v1/admin/catalog/products/A80').set(bearer(token));

    // The design is archived, and the order still resolves against it.
    const productDoc = await ProductModel.findById(product.id).lean();
    expect(productDoc?.status).toBe('archived');

    const orderDoc = await OrderModel.findById(order._id).lean();
    expect(orderDoc?.items[0]?.sku).toBe('AJ-A80-BLK-08');

    const variantDoc = await VariantModel.findById(variant.id).lean();
    expect(variantDoc).not.toBeNull();
  });

  it('retiring a SKU leaves the order line and the stock ledger intact', async () => {
    const token = await adminToken();
    const { variant } = await createProductWithVariant(
      { code: 'A81' },
      { sku: 'AJ-A81-BLK-08', stock: 9, photographyStatus: 'verified' },
    );

    await api().delete(`/v1/admin/catalog/variants/${variant.sku}`).set(bearer(token));

    const variantDoc = await VariantModel.findById(variant.id).lean();
    expect(variantDoc).not.toBeNull();

    // The units released are explained by a ledger row, not silently lost.
    const movements = await StockMovementModel.find({ sku: variant.sku }).lean();
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.some((m) => m.delta === -9)).toBe(true);
  });
});

/** A bare customer id, for orders whose customer is irrelevant here. */
async function createCustomerId(): Promise<string> {
  const { createCustomer } = await import('./helpers/factories.js');
  const customer = await createCustomer();
  return customer.id;
}
