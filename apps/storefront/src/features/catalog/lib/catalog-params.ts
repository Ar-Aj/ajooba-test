import type { CatalogSort } from '@ajooba/contracts';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_PATTERN,
  COLOUR_RAW_VALUES,
  SIZE_VALUES,
  CATALOG_SORTS,
} from '@ajooba/contracts';

/**
 * Search-parameter handling for the shop and search pages.
 *
 * The query lives in the URL, which is deliberate:
 *   - every filtered view is shareable and bookmarkable,
 *   - back/forward behave the way a shopper expects,
 *   - the server component can read it directly without client state, so the
 *     first paint already reflects the filters.
 *
 * `readCatalogParams` never throws. A hand-edited URL with junk in it falls
 * back to the defaults instead of producing an error page.
 */

export const SORT_OPTIONS: ReadonlyArray<{ value: CatalogSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'title-asc', label: 'Name: A to Z' },
  { value: 'title-desc', label: 'Name: Z to A' },
];

export const COLOUR_SWATCHES: Readonly<Record<string, string>> = {
  Beige: '#e6d5b8',
  Black: '#1b1b1b',
  Blue: '#2f4d7a',
  Brown: '#6b4423',
  Chickoo: '#c47b4a',
  Cherry: '#8e1f2f',
  Golden: '#c9a24a',
  Grey: '#8a8a8a',
  Ivory: '#f4ede0',
  Olive: '#6b7a3a',
  Tan: '#b98b5e',
  White: '#fafafa',
};

export interface CatalogParams {
  search: string | undefined;
  subcategory: string | undefined;
  colour: string | undefined;
  size: number | undefined;
  minPrice: number | undefined;
  maxPrice: number | undefined;
  inStock: boolean | undefined;
  sort: CatalogSort;
  page: number;
  pageSize: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function isOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Accept any structurally valid category slug.
 *
 * This used to be `isOneOf(value, ['mojri-jutti', 'shoe', 'sandal', 'chappal'])`,
 * which meant a category created in the admin panel could never be filtered on:
 * the storefront silently dropped the URL parameter and the shopper got the
 * whole catalogue back with no explanation. The shape is the only thing the URL
 * layer can legitimately check — whether the category *exists* is the API's
 * question, and it answers it with real counts.
 */
function toCategorySlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CATEGORY_SLUG_MAX_LENGTH) return undefined;
  return CATEGORY_SLUG_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** Parse `searchParams` into a safe `CatalogParams`. Never throws. */
export function readCatalogParams(raw: RawParams): CatalogParams {
  const size = toInt(first(raw.size));
  const minPrice = toInt(first(raw.minPrice));
  const maxPrice = toInt(first(raw.maxPrice));
  const page = toInt(first(raw.page));
  const inStockRaw = first(raw.inStock);

  return {
    search: first(raw.search)?.trim() || undefined,
    subcategory: toCategorySlug(first(raw.subcategory)),
    colour: isOneOf(first(raw.colour), COLOUR_RAW_VALUES),
    size:
      size !== undefined && SIZE_VALUES.includes(size as (typeof SIZE_VALUES)[number])
        ? size
        : undefined,
    minPrice: minPrice !== undefined && minPrice >= 0 ? minPrice : undefined,
    maxPrice: maxPrice !== undefined && maxPrice >= 0 ? maxPrice : undefined,
    inStock: inStockRaw === 'true' ? true : inStockRaw === 'false' ? false : undefined,
    sort: isOneOf(first(raw.sort), CATALOG_SORTS) ?? 'newest',
    page: page !== undefined && page > 0 ? page : 1,
    pageSize: 24,
  };
}

/** Convert parsed params into the shape `catalogQuerySchema` accepts. */
export function toApiQuery(params: CatalogParams): Record<string, unknown> {
  return {
    search: params.search,
    subcategory: params.subcategory,
    colour: params.colour,
    size: params.size,
    minPrice: params.minPrice,
    maxPrice: params.maxPrice,
    inStock: params.inStock === undefined ? undefined : params.inStock ? 'true' : 'false',
    sort: params.sort,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/**
 * Build the href for a modified view of the current query.
 * Any change other than `page` resets to page 1 — keeping page 5 while
 * narrowing a filter is almost always an empty grid and a dead end.
 */
export function buildCatalogHref(
  params: CatalogParams,
  changes: Partial<CatalogParams> & { page?: number },
  basePath = '/products',
): string {
  const next: CatalogParams = { ...params, ...changes };
  const isPageOnly = Object.keys(changes).every((key) => key === 'page');
  const finalPage = changes.page ?? (isPageOnly ? next.page : 1);

  const search = new URLSearchParams();
  if (next.search) search.set('search', next.search);
  if (next.subcategory) search.set('subcategory', next.subcategory);
  if (next.colour) search.set('colour', next.colour);
  if (next.size !== undefined) search.set('size', String(next.size));
  if (next.minPrice !== undefined) search.set('minPrice', String(next.minPrice));
  if (next.maxPrice !== undefined) search.set('maxPrice', String(next.maxPrice));
  if (next.inStock !== undefined) search.set('inStock', next.inStock ? 'true' : 'false');
  if (next.sort && next.sort !== 'newest') search.set('sort', next.sort);
  if (finalPage > 1) search.set('page', String(finalPage));

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** True when any filter (other than sort/page) is active. */
export function hasActiveFilters(params: CatalogParams): boolean {
  return Boolean(
    params.search ||
    params.subcategory ||
    params.colour ||
    params.size !== undefined ||
    params.minPrice !== undefined ||
    params.maxPrice !== undefined ||
    params.inStock !== undefined,
  );
}

/** The list of active filters, rendered as removable chips. */
export function activeFilterChips(params: CatalogParams): Array<{
  key: keyof CatalogParams;
  label: string;
  value: CatalogParams[keyof CatalogParams];
}> {
  const chips: Array<{
    key: keyof CatalogParams;
    label: string;
    value: CatalogParams[keyof CatalogParams];
  }> = [];
  if (params.subcategory)
    chips.push({ key: 'subcategory', label: 'Category', value: params.subcategory });
  if (params.colour) chips.push({ key: 'colour', label: 'Colour', value: params.colour });
  if (params.size !== undefined) chips.push({ key: 'size', label: 'Size', value: params.size });
  if (params.minPrice !== undefined)
    chips.push({ key: 'minPrice', label: 'Min price', value: params.minPrice });
  if (params.maxPrice !== undefined)
    chips.push({ key: 'maxPrice', label: 'Max price', value: params.maxPrice });
  if (params.inStock !== undefined) {
    chips.push({ key: 'inStock', label: 'Availability', value: params.inStock });
  }
  return chips;
}
