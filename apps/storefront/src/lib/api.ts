import {
  catalogQuerySchema,
  type CatalogFacets,
  type CatalogListResult,
  type CategoryView,
  type Product,
  type ResolvedHomepageSection,
} from '@ajooba/contracts';
import { apiUrl } from './env';

/**
 * Server-side API client for the storefront.
 *
 * This module runs only on the Next.js server. It talks to the REST API over
 * the internal network and never exposes credentials to the browser.
 *
 * Errors are typed, because the caller genuinely needs to distinguish three
 * cases that have three different correct UI responses:
 *
 *   - the product does not exist        -> 404 page
 *   - the API is unreachable / failing  -> "temporarily unavailable" state
 *   - the API answered with bad data    -> error boundary
 */

/** Why a request to the API failed. */
export type ApiFailureKind = 'not_found' | 'unavailable' | 'invalid_response';

/** A typed failure from the API client. */
export class ApiRequestError extends Error {
  readonly kind: ApiFailureKind;
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(message: string, kind: ApiFailureKind, status?: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }

  /** True when the API confirmed the resource does not exist. */
  get isNotFound(): boolean {
    return this.kind === 'not_found';
  }

  /** True when the API could not be reached or returned a server error. */
  get isUnavailable(): boolean {
    return this.kind === 'unavailable';
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Perform a GET request against the API and unwrap the envelope.
 *
 * Throws `ApiRequestError` on any failure. Never throws a raw `TypeError`
 * from `fetch`, so callers can always branch on `err.kind`.
 */
async function get<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      headers: { Accept: 'application/json' },
      // Avoid `no-store`: the catalogue API is mostly idempotent and the
      // storefront benefits from CDN-friendly responses. ISR configures
      // revalidation separately at the page level.
      next: { revalidate: 300 },
    });
  } catch {
    throw new ApiRequestError(
      'The catalogue API is unreachable.',
      'unavailable',
      undefined,
      'API_UNREACHABLE',
    );
  }

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiRequestError(
      'The catalogue API returned a malformed response.',
      'invalid_response',
      response.status,
    );
  }

  if (!response.ok || !body.ok || body.data === undefined) {
    const code = body.error?.code;

    if (response.status === 404 || code === 'NOT_FOUND') {
      throw new ApiRequestError(
        body.error?.message ?? 'Not found.',
        'not_found',
        response.status,
        code,
      );
    }

    if (response.status >= 500) {
      throw new ApiRequestError(
        body.error?.message ?? 'The catalogue API is currently failing.',
        'unavailable',
        response.status,
        code,
      );
    }

    throw new ApiRequestError(
      body.error?.message ?? `API request failed with status ${response.status}.`,
      'invalid_response',
      response.status,
      code,
    );
  }

  return body.data;
}

/** Build a query string from a catalogue query, omitting empty values. */
function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

/**
 * Fetch a page of catalogue products.
 *
 * Throws `ApiRequestError` when the API is unreachable or failing. An empty
 * catalogue is NOT an error — it returns an empty `items` array.
 */
export async function fetchProducts(
  query: Partial<Record<string, unknown>> = {},
): Promise<CatalogListResult> {
  const parsed = catalogQuerySchema.parse(query);
  const path = `/v1/catalog/products${toQueryString(parsed)}`;
  return get<CatalogListResult>(path);
}

/**
 * Fetch a single product by slug.
 *
 * Returns `null` only when the API has *confirmed* the product does not
 * exist. When the API is unreachable the error is rethrown, because showing
 * a 404 for a product that may well exist would be a lie.
 */
export async function fetchProductBySlug(slug: string): Promise<Product | null> {
  try {
    return await get<Product>(`/v1/catalog/products/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.isNotFound) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetch the facet counts for the catalogue.
 *
 * These are real counts computed from the live collection, so the filter
 * panel can tell the customer how many designs a colour or size actually has
 * before they commit to it.
 *
 * A failure here is NOT fatal: the caller falls back to showing the filter
 * options without counts. Facet counts are a nicety; refusing to render the
 * catalogue because the count endpoint blipped would be a much worse trade.
 */
export async function fetchCatalogFacets(): Promise<CatalogFacets | null> {
  try {
    return await get<CatalogFacets>('/v1/catalog/facets');
  } catch {
    return null;
  }
}

/**
 * Fetch the live category taxonomy.
 *
 * This is the single source of truth for every category affordance on the
 * storefront — the header rail, the mobile sheet, the footer and the homepage
 * category index all read it. Before it existed, those three surfaces each kept
 * their own hardcoded copy of four slugs, so adding a category in the admin
 * changed nothing a shopper could see.
 *
 * The API returns only published, visible categories, already arranged
 * hierarchically with live product counts. A failure returns an empty list
 * rather than throwing: navigation degrading to "Shop all" is a far better
 * outcome than the whole storefront erroring because one read failed.
 */
export async function fetchCategories(): Promise<readonly CategoryView[]> {
  try {
    const result = await get<{ items: CategoryView[]; count: number }>('/v1/catalog/categories');
    return result.items ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch the full catalogue as an id → product lookup.
 *
 * The homepage's resolved cards (`HomepageProductCard`) are a deliberately thin
 * projection: no variants, no sizes, no per-colour photography. A shopper
 * deciding from the homepage needs those, so the homepage enriches each card
 * with the full public product record from the same `/v1/catalog/products`
 * read the catalogue page uses. Nothing new is asked of the API — this is the
 * existing endpoint, at its maximum page size, cached on the shared window.
 *
 * Non-fatal by design: a failure returns an empty lookup and every card simply
 * renders its thin version, exactly as it did before enrichment existed.
 */
export async function fetchCatalogueIndex(): Promise<Record<string, Product>> {
  const index: Record<string, Product> = {};
  try {
    let page = 1;
    let totalPages = 1;
    // Hard cap on pages so a misbehaving response can never loop forever.
    while (page <= totalPages && page <= 10) {
      const result = await fetchProducts({ page, pageSize: 100 });
      for (const product of result.items) index[product.id] = product;
      totalPages = result.totalPages;
      page += 1;
    }
  } catch {
    // Keep whatever pages did arrive; an empty index is also a valid answer.
  }
  return index;
}

/**
 * Fetch the resolved homepage.
 *
 * The API has already decided which sections are publishable — expired
 * campaigns and unresolvable product references are filtered out
 * server-side. The storefront therefore renders exactly what it is given
 * and never has to second-guess whether a deal is still live.
 *
 * A failure here returns an empty list rather than throwing: the homepage
 * must still render (with its own static fallbacks) when merchandising is
 * unavailable, and a merchandising outage should not take the shop offline.
 */
export async function fetchHomepage(): Promise<ResolvedHomepageSection[]> {
  try {
    /*
     * Deliberately NOT cached like the catalogue.
     *
     * The homepage is the one surface an administrator changes on purpose and
     * expects to see immediately. Reusing the shared 5-minute revalidate meant
     * a published change took up to 300 seconds to appear, which reads as
     * "my save did nothing". Product data changes rarely; merchandising does.
     *
     * The cost is one extra API call per homepage render, which is a fair
     * trade for an editor that behaves predictably.
     */
    const response = await fetch(apiUrl('/v1/content/homepage'), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return [];
    const body = (await response.json()) as ApiEnvelope<{
      sections: ResolvedHomepageSection[];
    }>;
    if (!body.ok || body.data === undefined) return [];
    return body.data.sections ?? [];
  } catch {
    return [];
  }
}
