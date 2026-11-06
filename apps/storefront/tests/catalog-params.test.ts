import { describe, expect, it } from 'vitest';
import {
  activeFilterChips,
  buildCatalogHref,
  hasActiveFilters,
  readCatalogParams,
  toApiQuery,
} from '@/features/catalog/lib/catalog-params';

/**
 * The catalogue view is entirely URL-driven. These tests pin down the
 * translation between the URL and the API query, because a mistake here
 * means a filter silently does nothing — a defect a customer cannot see,
 * only feel.
 */

describe('readCatalogParams', () => {
  it('returns sensible defaults for an empty query', () => {
    const params = readCatalogParams({});
    expect(params.page).toBe(1);
    expect(params.sort).toBe('newest');
    expect(params.search).toBeUndefined();
    expect(params.subcategory).toBeUndefined();
  });

  it('parses a valid query', () => {
    const params = readCatalogParams({
      search: 'mojri',
      subcategory: 'mojri-jutti',
      colour: 'Tan',
      size: '9',
      minPrice: '500',
      maxPrice: '2500',
      inStock: 'true',
      sort: 'price-asc',
      page: '3',
    });
    expect(params).toMatchObject({
      search: 'mojri',
      subcategory: 'mojri-jutti',
      colour: 'Tan',
      size: 9,
      minPrice: 500,
      maxPrice: 2500,
      inStock: true,
      sort: 'price-asc',
      page: 3,
    });
  });

  it('rejects malformed values instead of forwarding them to the API', () => {
    const params = readCatalogParams({
      subcategory: 'Not A Slug!',
      colour: 'Chartreuse',
      size: '99',
      sort: 'by-vibes',
    });
    expect(params.subcategory).toBeUndefined();
    expect(params.colour).toBeUndefined();
    expect(params.size).toBeUndefined();
    expect(params.sort).toBe('newest');
  });

  /*
   * Regression: a category created in the admin panel could not be filtered on.
   *
   * `readCatalogParams` used to validate `subcategory` against a hardcoded
   * four-slug array. A shopper who clicked a newly-created category got the
   * entire catalogue back with no filter applied and no explanation — the
   * parameter was dropped silently. The URL layer must accept any structurally
   * valid slug; existence is the API's question, and it answers with counts.
   */
  it('accepts a category slug the hardcoded seed set never contained', () => {
    expect(readCatalogParams({ subcategory: 'bridal-jutti' }).subcategory).toBe('bridal-jutti');
    expect(readCatalogParams({ subcategory: 'heeled-sandal' }).subcategory).toBe('heeled-sandal');
  });

  it('still rejects a slug that is not a slug at all', () => {
    expect(readCatalogParams({ subcategory: '../../etc/passwd' }).subcategory).toBeUndefined();
    expect(readCatalogParams({ subcategory: 'UPPER CASE' }).subcategory).toBeUndefined();
    expect(readCatalogParams({ subcategory: '-leading-hyphen' }).subcategory).toBeUndefined();
    expect(readCatalogParams({ subcategory: 'a'.repeat(61) }).subcategory).toBeUndefined();
  });

  it('never throws on a hand-edited URL', () => {
    expect(() => readCatalogParams({ page: 'abc', minPrice: '-5' })).not.toThrow();
    const params = readCatalogParams({ page: 'abc', minPrice: '-5' });
    expect(params.page).toBe(1);
    expect(params.minPrice).toBeUndefined();
  });

  it('takes the first value of a repeated parameter', () => {
    const params = readCatalogParams({ colour: ['Tan', 'Black'] });
    expect(params.colour).toBe('Tan');
  });
});

describe('toApiQuery', () => {
  it('maps inStock to the string the API schema expects', () => {
    expect(toApiQuery(readCatalogParams({ inStock: 'true' })).inStock).toBe('true');
    expect(toApiQuery(readCatalogParams({ inStock: 'false' })).inStock).toBe('false');
    expect(toApiQuery(readCatalogParams({})).inStock).toBeUndefined();
  });

  it('omits absent filters so the API is not asked to filter on nothing', () => {
    const query = toApiQuery(readCatalogParams({}));
    expect(query.search).toBeUndefined();
    expect(query.colour).toBeUndefined();
    expect(query.size).toBeUndefined();
    expect(query.minPrice).toBeUndefined();
  });
});

describe('buildCatalogHref', () => {
  it('returns the bare path when nothing is filtered', () => {
    expect(buildCatalogHref(readCatalogParams({}), {})).toBe('/products');
  });

  it('resets to page 1 when a filter changes', () => {
    const params = readCatalogParams({ page: '5' });
    expect(buildCatalogHref(params, { colour: 'Tan' })).toBe('/products?colour=Tan');
  });

  it('keeps the page when only the page changes', () => {
    const params = readCatalogParams({ page: '2', colour: 'Tan' });
    expect(buildCatalogHref(params, { page: 3 })).toBe('/products?colour=Tan&page=3');
  });

  it('honours a custom base path', () => {
    expect(buildCatalogHref(readCatalogParams({}), { colour: 'Tan' }, '/search')).toBe(
      '/search?colour=Tan',
    );
  });

  it('omits the default sort from the URL', () => {
    expect(buildCatalogHref(readCatalogParams({ sort: 'newest' }), {})).toBe('/products');
    expect(buildCatalogHref(readCatalogParams({ sort: 'price-asc' }), {})).toBe(
      '/products?sort=price-asc',
    );
  });

  it('round-trips through readCatalogParams', () => {
    const original = readCatalogParams({
      search: 'jutti',
      subcategory: 'mojri-jutti',
      colour: 'Tan',
      size: '8',
      sort: 'price-desc',
      page: '4',
    });
    const href = buildCatalogHref(original, {});
    const query = Object.fromEntries(new URL(href, 'http://x').searchParams);
    const reparsed = readCatalogParams(query);
    expect(reparsed.search).toBe('jutti');
    expect(reparsed.subcategory).toBe('mojri-jutti');
    expect(reparsed.colour).toBe('Tan');
    expect(reparsed.size).toBe(8);
    expect(reparsed.sort).toBe('price-desc');
    expect(reparsed.page).toBe(4);
  });
});

describe('hasActiveFilters and activeFilterChips', () => {
  it('reports no filters for a bare catalogue', () => {
    expect(hasActiveFilters(readCatalogParams({}))).toBe(false);
    expect(activeFilterChips(readCatalogParams({}))).toHaveLength(0);
  });

  it('lists every active filter so each can be removed', () => {
    const params = readCatalogParams({
      subcategory: 'shoe',
      colour: 'Black',
      size: '10',
      minPrice: '500',
      maxPrice: '3000',
      inStock: 'true',
    });
    expect(hasActiveFilters(params)).toBe(true);
    const keys = activeFilterChips(params).map((c) => c.key);
    expect(keys).toContain('subcategory');
    expect(keys).toContain('colour');
    expect(keys).toContain('size');
    expect(keys).toContain('minPrice');
    expect(keys).toContain('maxPrice');
    expect(keys).toContain('inStock');
  });
});
