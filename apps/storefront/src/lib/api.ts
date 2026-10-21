import { catalogQuerySchema, type CatalogListResult, type Product } from '@ajooba/contracts';
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
      cache: 'no-store',
    });
  } catch {
    // DNS failure, connection refused, timeout — the API is not reachable.
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
