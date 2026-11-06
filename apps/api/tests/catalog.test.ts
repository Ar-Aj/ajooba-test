import { describe, expect, it } from 'vitest';
import { api, failure, success, useApi } from './helpers/api.js';
import { createProductWithVariant } from './helpers/factories.js';

/**
 * Catalogue read contract.
 *
 * These tests run against the real MongoDB (the throwaway in-memory one)
 * and the real Mongoose models, so they verify the actual indexes,
 * aggregations and query behaviour rather than a mock.
 */

useApi();

describe('GET /v1/catalog/products', () => {
  it('returns an empty, valid list for an empty catalogue', async () => {
    const response = await api().get('/v1/catalog/products');

    expect(response.status).toBe(200);

    const body = success<{ items: unknown[]; totalItems: number; page: number }>(response.body);
    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(0);
    expect(body.page).toBe(1);
  });

  it('returns the product with its variants', async () => {
    const { product, variant } = await createProductWithVariant(
      { title: 'Synthetic Test Design', subcategorySlug: 'shoe' },
      { size: 9, sellingPrice: 1600, mrp: 2000, stock: 4 },
    );

    const response = await api().get('/v1/catalog/products');
    const body = success<{
      items: Array<{ id: string; title: string; variants: Array<{ sku: string; size: number }> }>;
      totalItems: number;
    }>(response.body);

    expect(body.totalItems).toBe(1);
    expect(body.items[0]?.id).toBe(product.id);
    expect(body.items[0]?.title).toBe('Synthetic Test Design');
    expect(body.items[0]?.variants[0]?.sku).toBe(variant.sku);
    expect(body.items[0]?.variants[0]?.size).toBe(9);
  });

  it('filters by sub-category', async () => {
    await createProductWithVariant({ subcategorySlug: 'shoe', title: 'A Shoe' });
    await createProductWithVariant({ subcategorySlug: 'sandal', title: 'A Sandal' });

    const response = await api().get('/v1/catalog/products?subcategory=sandal');
    const body = success<{ items: Array<{ title: string }>; totalItems: number }>(response.body);

    expect(body.totalItems).toBe(1);
    expect(body.items[0]?.title).toBe('A Sandal');
  });

  it('filters by a size that a variant actually has', async () => {
    await createProductWithVariant({ title: 'Has Size 7' }, { size: 7 });
    await createProductWithVariant({ title: 'Has Size 11' }, { size: 11 });

    const response = await api().get('/v1/catalog/products?size=7');
    const body = success<{ items: Array<{ title: string }>; totalItems: number }>(response.body);

    expect(body.totalItems).toBe(1);
    expect(body.items[0]?.title).toBe('Has Size 7');
  });

  it('sorts by ascending price', async () => {
    await createProductWithVariant({ title: 'Cheap' }, { sellingPrice: 900, mrp: 1200 });
    await createProductWithVariant({ title: 'Expensive' }, { sellingPrice: 3000, mrp: 3500 });

    const response = await api().get('/v1/catalog/products?sort=price-asc');
    const body = success<{ items: Array<{ title: string; sellingPrice: number }> }>(response.body);

    expect(body.items.map((item) => item.title)).toEqual(['Cheap', 'Expensive']);
  });

  it('rejects an out-of-range size with a validation error', async () => {
    const response = await api().get('/v1/catalog/products?size=99');

    expect(response.status).toBe(422);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('paginates', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createProductWithVariant({ title: `Paged ${index}` });
    }

    const response = await api().get('/v1/catalog/products?page=1&pageSize=2');
    const body = success<{ items: unknown[]; totalItems: number; totalPages: number }>(
      response.body,
    );

    expect(body.items).toHaveLength(2);
    expect(body.totalItems).toBe(3);
    expect(body.totalPages).toBe(2);
  });
});

describe('GET /v1/catalog/products/:slug', () => {
  it('returns the product for a known slug', async () => {
    const { product } = await createProductWithVariant({ title: 'Findable Design' });

    const response = await api().get(`/v1/catalog/products/${product.slug}`);

    expect(response.status).toBe(200);
    const body = success<{ id: string; title: string }>(response.body);
    expect(body.title).toBe('Findable Design');
  });

  it('returns 404 for an unknown slug', async () => {
    const response = await api().get('/v1/catalog/products/no-such-product');

    expect(response.status).toBe(404);
    expect(failure(response.body).code).toBe('NOT_FOUND');
  });

  it('rejects a malformed slug', async () => {
    const response = await api().get('/v1/catalog/products/Not-A-Valid-Slug');

    expect(response.status).toBe(422);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /v1/catalog/facets', () => {
  it('counts sub-categories from real data', async () => {
    await createProductWithVariant({ subcategorySlug: 'chappal' });
    await createProductWithVariant({ subcategorySlug: 'chappal' });
    await createProductWithVariant({ subcategorySlug: 'mojri-jutti' });

    const response = await api().get('/v1/catalog/facets');
    const body = success<{
      subcategories: Array<{ value: string; count: number }>;
      priceRange: { min: number; max: number };
    }>(response.body);

    const chappal = body.subcategories.find((row) => row.value === 'chappal');
    expect(chappal?.count).toBe(2);

    // The facet is grouped by the SLUG, which is what the list endpoint
    // filters on, so the two must agree.
    expect(body.subcategories.map((row) => row.value)).toContain('mojri-jutti');
    expect(body.priceRange.max).toBeGreaterThanOrEqual(body.priceRange.min);
  });
});
