import type {
  ProductPickerResult,
  ResolvedHomepageSection,
  HomepageSectionInput,
} from '@ajooba/contracts';
import { apiUrl } from './env';

/**
 * Admin API client for the merchandising module.
 *
 * Every call is a real HTTP request to the API, authenticated with the
 * administrator's access token held in an httpOnly cookie. There is no local
 * mock, no seeded fixture and no "pretend save" — a control that appears in
 * the panel performs an operation that either succeeds against the database
 * or reports the server's actual error.
 */

/** A failed admin API call, carrying the server's own message and status. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');

  const { token, ...rest } = init;

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...rest,
      headers,
      cache: 'no-store',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    });
  } catch {
    throw new AdminApiError('The API is unreachable. Check that the API service is running.', 0);
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new AdminApiError('The API returned a malformed response.', response.status);
  }

  if (!response.ok || !body.ok || body.data === undefined) {
    throw new AdminApiError(
      body.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      body.error?.code,
    );
  }

  return body.data;
}

/** Search the real catalogue for the product picker. */
export async function searchProducts(
  token: string,
  params: { search?: string; subcategory?: string; page?: number; pageSize?: number } = {},
): Promise<ProductPickerResult> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.subcategory) query.set('subcategory', params.subcategory);
  query.set('page', String(params.page ?? 1));
  query.set('pageSize', String(params.pageSize ?? 24));

  return request<ProductPickerResult>(`/v1/admin/content/homepage/products?${query}`, { token });
}

/**
 * Everything the editor needs to open a page: the sections **and** the
 * optimistic-concurrency version to echo back on save.
 */
export interface AdminHomepagePayload {
  readonly items: ReadonlyArray<{ id: string; section: ResolvedHomepageSection }>;
  readonly version: number;
}

/** Load every section, including hidden ones, for the editor. */
export async function loadSections(token: string): Promise<AdminHomepagePayload> {
  return request<AdminHomepagePayload>('/v1/admin/content/homepage/sections', { token });
}

/** The save payload for the whole page. */
export interface SaveHomepageInput {
  version: number;
  sections: Array<{
    position: number;
    isVisible: boolean;
    startsAt: string | null;
    endsAt: string | null;
    config: HomepageSectionInput;
  }>;
  publish: boolean;
}

/** Persist the homepage. The API re-validates every reference server-side. */
export async function saveHomepage(
  token: string,
  input: SaveHomepageInput,
): Promise<{ sections: ResolvedHomepageSection[]; version: number }> {
  return request<{ sections: ResolvedHomepageSection[]; version: number }>(
    '/v1/admin/content/homepage/sections',
    { method: 'PUT', body: JSON.stringify(input), token },
  );
}
