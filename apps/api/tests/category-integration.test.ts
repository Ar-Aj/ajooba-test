import { describe, expect, it } from 'vitest';
import type { AdminProductView, CategoryView } from '@ajooba/contracts';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { createAdmin, createProduct, createProductWithVariant } from './helpers/factories.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { reconcileCategoryTaxonomy } from '../src/services/category-bootstrap.service.js';

/**
 * Category ↔ product integration.
 *
 * ## The defect these tests exist to pin down
 *
 * Products carried `subcategorySlug`; the `categories` collection was never
 * populated by anything. The store therefore ran with a full catalogue and an
 * empty taxonomy, and that one empty collection produced five separate
 * symptoms that all looked like different bugs:
 *
 *  1. the admin category screen listed nothing, so nothing could be assigned;
 *  2. saving a design failed `422 Unknown category`;
 *  3. the homepage editor refused every category section;
 *  4. the storefront silently dropped filters for any new category, because
 *     the URL layer validated against a hardcoded four-slug array;
 *  5. newly-created categories could not be used anywhere at all.
 *
 * Each test below asserts the **end-to-end** behaviour a shop-keeper would
 * notice — create a category, assign a design, find it in the shop — because
 * every one of those symptoms shipped past a green unit-test suite that only
 * called service functions in isolation.
 */

useApi();

async function adminToken(): Promise<string> {
  const admin = await createAdmin();
  const response = await api()
    .post('/v1/admin/auth/login')
    .send({ email: admin.email, password: admin.password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

describe('taxonomy reconciliation', () => {
  it('creates a category for every slug the catalogue actually uses', async () => {
    await createProduct({
      code: 'A10',
      subcategorySlug: 'mojri-jutti',
      subcategory: 'Mojri / Jutti',
    });
    await createProduct({ code: 'A11', subcategorySlug: 'chappal', subcategory: 'Chappal' });

    const result = await reconcileCategoryTaxonomy();

    expect([...result.created].sort()).toEqual(['chappal', 'mojri-jutti']);
    expect(await CategoryModel.countDocuments({})).toBe(2);

    // The curated display name, not a title-cased slug. "Mojri Jutti" would be
    // a worse name than the one the shop already uses in its copy.
    const mojri = await CategoryModel.findOne({ slug: 'mojri-jutti' }).lean<{
      displayName: string;
      status: string;
      isVisible: boolean;
    } | null>();
    expect(mojri?.displayName).toBe('Mojri & Jutti');
    expect(mojri?.status).toBe('active');
    expect(mojri?.isVisible).toBe(true);
  });

  it('is idempotent and never overwrites an administrator edit', async () => {
    await createProduct({ code: 'A12', subcategorySlug: 'shoe' });

    await reconcileCategoryTaxonomy();
    await CategoryModel.updateOne(
      { slug: 'shoe' },
      { $set: { displayName: 'Dress Shoes', position: 7 } },
    );

    const second = await reconcileCategoryTaxonomy();

    expect(second.created).toEqual([]);
    expect(second.existing).toContain('shoe');
    expect(await CategoryModel.countDocuments({})).toBe(1);

    const row = await CategoryModel.findOne({ slug: 'shoe' }).lean<{
      displayName: string;
      position: number;
    } | null>();
    // An administrator's naming and ordering survive a re-run.
    expect(row?.displayName).toBe('Dress Shoes');
    expect(row?.position).toBe(7);
  });

  it('creates nothing when the catalogue is empty', async () => {
    const result = await reconcileCategoryTaxonomy();
    expect(result.created).toEqual([]);
    expect(await CategoryModel.countDocuments({})).toBe(0);
  });

  it('ignores products with no category slug at all', async () => {
    /*
     * Written through the raw collection, not the model: `subcategorySlug` is
     * `required` in the schema, and these rows represent designs that predate
     * the taxonomy. The reconciler has to tolerate them rather than create a
     * category with an empty slug.
     */
    await ProductModel.collection.insertOne({
      code: 'A13',
      slug: 'no-category-design',
      title: 'No Category Design',
      description: 'A design that predates the taxonomy.',
      subcategory: '',
      subcategorySlug: '',
      brand: 'Ajooba Footwear',
      colours: [],
      images: [],
      mrp: 1000,
      sellingPrice: 900,
      inStock: false,
    });

    const result = await reconcileCategoryTaxonomy();
    expect(result.created).toEqual([]);
    expect(await CategoryModel.countDocuments({})).toBe(0);
  });
});

describe('assigning a design to a category after reconciliation', () => {
  it('accepts a design whose category was derived from the catalogue', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A20', subcategorySlug: 'chappal', subcategory: 'Chappal' });
    await reconcileCategoryTaxonomy();

    /*
     * The original failure mode. Before the bootstrap, this request — editing
     * the title of a design in an existing catalogue — answered
     * `422 Unknown category "chappal"` and the save was impossible.
     */
    const response = await api()
      .patch('/v1/admin/catalog/products/A20')
      .set(bearer(token))
      .send({ title: 'Renamed Chappal', subcategory: 'Chappal', subcategorySlug: 'chappal' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(success<AdminProductView>(response.body).title).toBe('Renamed Chappal');
  });

  it('still refuses a category that genuinely does not exist', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A21', subcategorySlug: 'chappal' });
    await reconcileCategoryTaxonomy();

    const response = await api()
      .patch('/v1/admin/catalog/products/A21')
      .set(bearer(token))
      .send({ subcategory: 'Boots', subcategorySlug: 'boots' });

    // The guard is real; the fix was never "stop validating".
    expect(response.status).toBe(422);
    expect(JSON.stringify(failure(response.body))).toMatch(/boots/i);
  });

  it('refuses to move a design into a retired category', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A22', subcategorySlug: 'shoe' });
    // A second design gives the `chappal` category real products to exist for.
    await createProduct({ code: 'A24', subcategorySlug: 'chappal' });
    await reconcileCategoryTaxonomy();
    await CategoryModel.updateOne({ slug: 'chappal' }, { $set: { status: 'retired' } });

    const response = await api()
      .patch('/v1/admin/catalog/products/A22')
      .set(bearer(token))
      .send({ subcategory: 'Chappal', subcategorySlug: 'chappal' });

    expect(response.status).toBe(422);
    expect(JSON.stringify(failure(response.body))).toMatch(/retired/i);
  });

  it('still lets an administrator edit a design whose category was retired', async () => {
    const token = await adminToken();
    await createProduct({ code: 'A23', subcategorySlug: 'chappal', subcategory: 'Chappal' });
    await reconcileCategoryTaxonomy();
    await CategoryModel.updateOne({ slug: 'chappal' }, { $set: { status: 'retired' } });

    /*
     * Retiring a category must not make the designs already in it
     * un-editable. The guard fires on *reassignment*; leaving the category
     * alone is not a reassignment, and blocking a title fix here would trap
     * the design permanently.
     */
    const response = await api()
      .patch('/v1/admin/catalog/products/A23')
      .set(bearer(token))
      .send({ title: 'A Renamed Chappal', subcategory: 'Chappal', subcategorySlug: 'chappal' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(success<AdminProductView>(response.body).title).toBe('A Renamed Chappal');
  });
});

describe('an administrator-created category is usable everywhere', () => {
  it('appears in the public taxonomy and filters the shop', async () => {
    const token = await adminToken();

    const created = await api()
      .post('/v1/admin/catalog/categories')
      .set(bearer(token))
      .send({ slug: 'bridal-jutti', displayName: 'Bridal Jutti', description: 'For the wedding.' });
    expect(created.status).toBe(201);

    // A design assigned to the brand-new category.
    const product = await createProduct({
      code: 'A30',
      title: 'A Bridal Jutti',
      subcategorySlug: 'bridal-jutti',
      subcategory: 'Bridal Jutti',
    });

    // 1. The public taxonomy lists it, with a real count.
    const taxonomy = await api().get('/v1/catalog/categories');
    expect(taxonomy.status).toBe(200);
    const categories = success<{ items: CategoryView[]; count: number }>(taxonomy.body).items;
    const bridal = categories.find((category) => category.slug === 'bridal-jutti');
    expect(bridal?.displayName).toBe('Bridal Jutti');
    expect(bridal?.productCount).toBe(1);

    // 2. The list endpoint accepts it as a filter — no longer a 400.
    const filtered = await api().get('/v1/catalog/products?subcategory=bridal-jutti');
    expect(filtered.status, JSON.stringify(filtered.body)).toBe(200);
    const body = success<{ items: Array<{ title: string }>; totalItems: number }>(filtered.body);
    expect(body.totalItems).toBe(1);
    expect(body.items[0]?.title).toBe(product.title);

    // 3. The facets agree with the list, so the filter panel cannot advertise
    //    a count the grid does not deliver.
    const facets = await api().get('/v1/catalog/facets');
    const facetBody = success<{
      categories: CategoryView[];
      subcategories: Array<{ value: string; count: number }>;
    }>(facets.body);
    expect(facetBody.categories.map((category) => category.slug)).toContain('bridal-jutti');
    expect(facetBody.subcategories.find((row) => row.value === 'bridal-jutti')?.count).toBe(1);
  });

  it('can be merchandised on the homepage', async () => {
    const token = await adminToken();
    await api()
      .post('/v1/admin/catalog/categories')
      .set(bearer(token))
      .send({ slug: 'festive-jutti', displayName: 'Festive Jutti' });
    await createProduct({
      code: 'A31',
      title: 'A Festive Jutti',
      subcategorySlug: 'festive-jutti',
      subcategory: 'Festive Jutti',
    });

    /*
     * Before the fix, the homepage editor validated against a hardcoded Set of
     * four slugs and answered `409 "festive-jutti" is not a category in this
     * catalogue` — for a category that the same API had just created.
     */
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
              heading: 'Shop by category',
              subheading: '',
              layout: 'grid',
              categorySlugs: ['festive-jutti'],
            },
          },
        ],
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const storefront = await api().get('/v1/content/homepage');
    const sections = success<{
      sections: Array<{ type: string; categories: Array<{ slug: string }> }>;
    }>(storefront.body).sections;

    expect(sections).toHaveLength(1);
    expect(sections[0]?.categories.map((category) => category.slug)).toEqual(['festive-jutti']);
  });

  it('refuses to merchandise a category that does not exist', async () => {
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
              type: 'collection-spotlight',
              heading: 'Spotlight',
              subheading: '',
              layout: 'rail',
              categorySlug: 'imaginary-collection',
              mode: 'category',
              productIds: [],
              limit: 4,
            },
          },
        ],
      });

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/not a category/i);
  });
});

describe('the public taxonomy hides what the shop cannot serve', () => {
  async function category(
    slug: string,
    overrides: Partial<{ status: 'active' | 'retired'; isVisible: boolean; position: number }> = {},
  ): Promise<void> {
    await CategoryModel.create({
      slug,
      displayName: slug,
      position: overrides.position ?? 0,
      status: overrides.status ?? 'active',
      isVisible: overrides.isVisible ?? true,
    });
  }

  it('omits a category with no published products', async () => {
    await category('empty-bucket');
    await category('full-bucket');
    await createProduct({ code: 'A40', subcategorySlug: 'full-bucket' });

    const response = await api().get('/v1/catalog/categories');
    const slugs = success<{ items: CategoryView[] }>(response.body).items.map((c) => c.slug);

    // A card leading to "no results" is the commonest reason a shopper leaves.
    expect(slugs).toContain('full-bucket');
    expect(slugs).not.toContain('empty-bucket');
  });

  it('omits a retired or hidden category even when it has products', async () => {
    await category('retired-bucket', { status: 'retired' });
    await category('hidden-bucket', { isVisible: false });
    await category('live-bucket');
    await createProduct({ code: 'A41', subcategorySlug: 'retired-bucket' });
    await createProduct({ code: 'A42', subcategorySlug: 'hidden-bucket' });
    await createProduct({ code: 'A43', subcategorySlug: 'live-bucket' });

    const response = await api().get('/v1/catalog/categories');
    const slugs = success<{ items: CategoryView[] }>(response.body).items.map((c) => c.slug);

    expect(slugs).toEqual(['live-bucket']);
  });

  it('does not count a draft design towards a category', async () => {
    await category('draft-bucket');
    const { product } = await createProductWithVariant({
      code: 'A44',
      subcategorySlug: 'draft-bucket',
    });
    await ProductModel.updateOne({ _id: product.id }, { $set: { status: 'draft' } });

    const response = await api().get('/v1/catalog/categories');
    const items = success<{ items: CategoryView[] }>(response.body).items;

    // The category has no *published* products, so it is not offered.
    expect(items.map((c) => c.slug)).not.toContain('draft-bucket');
  });

  it('orders categories by the position an administrator set', async () => {
    await category('third', { position: 2 });
    await category('first', { position: 0 });
    await category('second', { position: 1 });
    for (const [index, slug] of ['third', 'first', 'second'].entries()) {
      await createProduct({ code: `A5${index}`, subcategorySlug: slug });
    }

    const response = await api().get('/v1/catalog/categories');
    const slugs = success<{ items: CategoryView[] }>(response.body).items.map((c) => c.slug);

    expect(slugs).toEqual(['first', 'second', 'third']);
  });

  it('nests a child under its parent and keeps an empty parent reachable', async () => {
    await category('parent-group', { position: 0 });
    await category('child-style', { position: 0 });
    await CategoryModel.updateOne(
      { slug: 'child-style' },
      { $set: { parentSlug: 'parent-group' } },
    );
    await createProduct({ code: 'A60', subcategorySlug: 'child-style' });

    const response = await api().get('/v1/catalog/categories');
    const items = success<{ items: CategoryView[] }>(response.body).items;

    // The parent owns no products itself, but dropping it would make its child
    // unreachable from the navigation.
    expect(items.map((c) => c.slug)).toEqual(['parent-group']);
    expect(items[0]?.children.map((c) => c.slug)).toEqual(['child-style']);
    expect(items[0]?.productCount).toBe(0);
  });
});
