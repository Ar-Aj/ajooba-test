import type {
  AdminColourView,
  AdminProductView,
  AdminVariantView,
  BulkStockSetResult,
  CategoryView,
  ImageReviewItem,
  ImageReviewQueue,
  StockSetResult,
} from '@ajooba/contracts';
import { adminPath } from '@/lib/public-path';

/**
 * Client for the catalogue administration API.
 *
 * Every call goes to `/api/admin/catalog`, the admin app's own authenticated
 * proxy, which attaches the session cookie server-side. There is no local
 * mock and no optimistic "pretend it saved": each function resolves with the
 * server's response, and a failed write leaves the caller's form untouched.
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

/**
 * Attach the catalogue path and any query parameters to the proxy URL.
 *
 * The proxy takes the endpoint as `path` and the upstream query string as
 * `query`, so both are kept separate here rather than spliced together.
 */
function proxyUrl(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }

  const params = new URLSearchParams({ path });
  const queryString = search.toString();
  if (queryString) params.set('query', queryString);

  return adminPath('/api/admin/catalog?' + params.toString());
}

async function request<T>(
  method: string,
  path: string,
  options: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(proxyUrl(path, options.query), {
      method,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body), headers: { 'Content-Type': 'application/json' } }),
    });
  } catch {
    throw new AdminApiError(
      'Could not reach the admin API. Check that the API service is running.',
      0,
    );
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

/* -------------------------------------------------------------------------- */
/* G-1 — Products                                                             */
/* -------------------------------------------------------------------------- */

export interface ProductPage {
  readonly items: readonly AdminProductView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export function listProducts(
  query: {
    search?: string;
    status?: string;
    subcategory?: string;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ProductPage> {
  return request<ProductPage>('GET', 'products', { query });
}

export function getProduct(code: string): Promise<AdminProductView> {
  return request<AdminProductView>('GET', `products/${encodeURIComponent(code)}`);
}

export function createProduct(body: Record<string, unknown>): Promise<AdminProductView> {
  return request<AdminProductView>('POST', 'products', { body });
}

export function updateProduct(
  code: string,
  body: Record<string, unknown>,
): Promise<AdminProductView> {
  return request<AdminProductView>('PATCH', `products/${encodeURIComponent(code)}`, { body });
}

/** Archive a design. Soft delete — order history keeps referencing it. */
export function archiveProduct(code: string): Promise<AdminProductView> {
  return request<AdminProductView>('DELETE', `products/${encodeURIComponent(code)}`);
}

/* -------------------------------------------------------------------------- */
/* G-2 / G-3 — Colour variants and SKUs                                       */
/* -------------------------------------------------------------------------- */

export function listColours(code: string): Promise<{ items: AdminColourView[]; count: number }> {
  return request('GET', `products/${encodeURIComponent(code)}/colours`);
}

export function listVariants(
  code: string,
  query: { colour?: string; photographyStatus?: string; page?: number; pageSize?: number } = {},
): Promise<ProductPage & { items: AdminVariantView[] }> {
  return request('GET', `products/${encodeURIComponent(code)}/variants`, { query });
}

export function createVariant(
  code: string,
  body: Record<string, unknown>,
): Promise<AdminVariantView> {
  return request('POST', `products/${encodeURIComponent(code)}/variants`, { body });
}

export function getVariant(sku: string): Promise<AdminVariantView> {
  return request('GET', `skus/${encodeURIComponent(sku)}`);
}

export function updateVariant(
  sku: string,
  body: Record<string, unknown>,
): Promise<AdminVariantView> {
  return request('PATCH', `skus/${encodeURIComponent(sku)}`, { body });
}

export function retireVariant(sku: string): Promise<AdminVariantView> {
  return request('DELETE', `variants/${encodeURIComponent(sku)}`);
}

/* -------------------------------------------------------------------------- */
/* Phase 7 — Stock                                                            */
/* -------------------------------------------------------------------------- */

export interface StockHistoryEntry {
  readonly id: string;
  readonly delta: number;
  readonly stockAfter: number;
  readonly reason: string;
  readonly note?: string;
  readonly actorEmail?: string;
  readonly createdAt: string;
}

export function stockHistory(sku: string): Promise<{ items: StockHistoryEntry[]; count: number }> {
  return request('GET', `skus/${encodeURIComponent(sku)}/stock`);
}

/**
 * Set an absolute stock level.
 *
 * `expectedCurrentStock` is required by the API: it is the level the
 * administrator believes is on hand, and the server rejects the write when
 * it no longer matches, so a stale tab cannot overwrite a newer count.
 */
export function setStock(
  sku: string,
  body: { quantity: number; reason: string; note?: string; expectedCurrentStock: number },
): Promise<StockSetResult> {
  return request('PUT', `skus/${encodeURIComponent(sku)}/stock`, { body });
}

/** Bulk stock set. Defaults to a dry run, which writes nothing. */
export function bulkSetStock(body: {
  rows: Array<{ sku: string; quantity: number }>;
  reason: string;
  note?: string;
  dryRun?: boolean;
}): Promise<BulkStockSetResult> {
  return request('POST', 'inventory/stock-set', { body });
}

/* -------------------------------------------------------------------------- */
/* G-4 — Categories                                                           */
/* -------------------------------------------------------------------------- */

export function listCategories(query: { status?: string } = {}): Promise<{
  items: CategoryView[];
  count: number;
}> {
  return request('GET', 'categories', { query });
}

export function createCategory(body: Record<string, unknown>): Promise<CategoryView> {
  return request('POST', 'categories', { body });
}

export function updateCategory(slug: string, body: Record<string, unknown>): Promise<CategoryView> {
  return request('PATCH', `categories/${encodeURIComponent(slug)}`, { body });
}

export function retireCategory(slug: string): Promise<CategoryView> {
  return request('DELETE', `categories/${encodeURIComponent(slug)}`);
}

export function reorderCategories(orderedSlugs: string[]): Promise<{
  items: CategoryView[];
  count: number;
}> {
  return request('POST', 'categories/reorder', { body: { orderedSlugs } });
}

export function seedCategories(): Promise<Record<string, unknown>> {
  return request('POST', 'categories/seed', { body: {} });
}

/* -------------------------------------------------------------------------- */
/* G-5 — Image review                                                         */
/* -------------------------------------------------------------------------- */

export function listReviewQueue(
  query: {
    code?: string;
    status?: string;
    onlyGaps?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ImageReviewQueue> {
  return request('GET', 'images/review-queue', { query });
}

export interface DesignCoverage {
  readonly code: string;
  readonly productTitle: string;
  readonly totalImages: number;
  readonly quarantined: readonly string[];
  readonly colours: ReadonlyArray<{
    readonly colour: string;
    readonly verifiedImageCount: number;
    readonly photographyStatus: 'verified' | 'pending-review';
    readonly skus: number;
    readonly stock: number;
  }>;
}

export function imageCoverage(code: string): Promise<DesignCoverage> {
  return request('GET', `images/${encodeURIComponent(code)}/coverage`);
}

/**
 * Confirm an image's colour.
 *
 * The reason is mandatory server-side too: an unexplained override is how a
 * photograph ends up on the wrong colour gallery.
 */
export function assignImage(
  imageId: string,
  colour: string,
  reason: string,
): Promise<ImageReviewItem> {
  return request('POST', `images/${encodeURIComponent(imageId)}/assign`, {
    body: { colour, reason },
  });
}

/** Confirm quarantine is correct. The image stays undisplayed. */
export function rejectImage(imageId: string, reason: string): Promise<ImageReviewItem> {
  return request('POST', `images/${encodeURIComponent(imageId)}/reject`, { body: { reason } });
}

/** Undo an assignment, returning the image to quarantine. */
export function revertImage(imageId: string, reason: string): Promise<ImageReviewItem> {
  return request('POST', `images/${encodeURIComponent(imageId)}/revert`, { body: { reason } });
}

/* -------------------------------------------------------------------------- */
/* G-6 — Controlled import                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The counts an operator reads before approving.
 *
 * These are deliberately design-and-SKU shaped rather than a single "total",
 * because the question an operator asks is "will this create new designs or
 * overwrite existing ones".
 */
export interface ImportPlanCounts {
  readonly designsToCreate: number;
  readonly designsToUpdate: number;
  readonly variantsToCreate: number;
  readonly variantsToUpdate: number;
  readonly quarantine: number;
  readonly reject: number;
  readonly conflicts: number;
}

/** Lifecycle of a plan. Only `dry-run` can still be applied. */
export type ImportPlanStatus = 'dry-run' | 'approved' | 'applied' | 'failed' | 'superseded';

export interface ImportPlanSummary {
  readonly planId: string;
  readonly status: ImportPlanStatus;
  readonly targetDatabase: string;
  readonly sourceFilename: string;
  readonly payloadChecksum: string;
  readonly payloadBytes: number;
  readonly counts: ImportPlanCounts;
  readonly requestedByEmail: string | null;
  readonly approvedByEmail: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
}

export interface ImportApplyResult {
  readonly planId: string;
  readonly status: ImportPlanStatus;
  readonly targetDatabase: string;
  readonly dryRun: boolean;
  readonly applied: {
    readonly designsCreated: number;
    readonly designsUpdated: number;
    readonly variantsCreated: number;
    readonly variantsUpdated: number;
  };
  readonly skipped: number;
  readonly failed: ReadonlyArray<{ code?: string; sku?: string; reason: string }>;
}

export function listImportPlans(
  limit = 20,
): Promise<{ items: ImportPlanSummary[]; count: number }> {
  return request('GET', 'imports', { query: { limit } });
}

export function createImportPlan(body: {
  payload: string;
  sourceFilename: string;
}): Promise<ImportPlanSummary> {
  return request('POST', 'imports', { body });
}

export function getImportPlan(planId: string): Promise<ImportPlanSummary> {
  return request('GET', `imports/${encodeURIComponent(planId)}`);
}

export function applyImportPlan(
  planId: string,
  payloadChecksum: string,
): Promise<ImportApplyResult> {
  return request('POST', `imports/${encodeURIComponent(planId)}/apply`, {
    body: { payloadChecksum, confirm: true },
  });
}
