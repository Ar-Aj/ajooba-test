import { cookies } from 'next/headers';
import type {
  AdminInventoryQuery,
  AdminProfile,
  AuditLogEntry,
  Coupon,
  CouponInput,
  CustomerInteractionProfile,
  DashboardMetrics,
  ExchangeRequest,
  ExchangeStatus,
  InteractionCustomerSpectrumRow,
  InteractionInsights,
  InteractionProductProfile,
  InteractionProductSpectrumRow,
  InteractionVisitorRow,
  InteractionWindow,
  Order,
  OrderStatus,
  ReturnRequest,
  ReturnStatus,
  ResolveReturnRequest,
  InitiateRefundRequest,
  ResolveExchangeRequest,
  StockMovement,
  UpdateCouponRequest,
} from '@ajooba/contracts';
import { apiUrl } from './env';

/**
 * Server-side client for the operations endpoints.
 *
 * ## Why this is a server module and not a browser fetch
 *
 * Every catalogue module talks to a Next route handler that re-attaches the
 * session cookie. That is right for interactive screens, but a dashboard is a
 * server render: the numbers belong in the first HTML response, not painted
 * after a round-trip to a proxy route that then round-trips to the API.
 *
 * So this module reads the httpOnly cookie directly on the server and calls the
 * API. The token still never reaches the browser, and the heaviest screen in the
 * product gets one network hop fewer.
 *
 * ## Failure is typed
 *
 * Callers must be able to tell apart three cases with three different correct
 * screens: the session has gone (`isUnauthorised` → redirect to sign-in), the
 * API is down (show the outage notice, keep the shell), and the API answered
 * with an error of its own (show that message verbatim). An untyped throw would
 * collapse all three into "something went wrong", which is the least useful
 * thing an operations panel can say.
 */

export class OpsApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OpsApiError';
    this.status = status;
    this.code = code;
  }

  /** True when the session is missing or has expired mid-render. */
  get isUnauthorised(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True when the API could not be reached at all. */
  get isUnreachable(): boolean {
    return this.status === 0;
  }
}

export async function readAdminToken(): Promise<string | null> {
  return (await cookies()).get('ajooba_admin_token')?.value ?? null;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Query;
  body?: unknown;
  /**
   * Sent as `Idempotency-Key`. The stock-adjustment route **requires** it, so a
   * retried adjustment can never be applied twice; the coupons and order-status
   * routes ignore it.
   */
  idempotencyKey?: string;
}

async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await readAdminToken();
  if (!token) {
    throw new OpsApiError('Sign in to continue.', 401, 'UNAUTHORIZED');
  }

  const url = new URL(apiUrl(path));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const method = options.method ?? 'GET';
  const hasBody = options.body !== undefined;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      cache: 'no-store',
    });
  } catch {
    throw new OpsApiError('The API is unreachable. Check that the API service is running.', 0);
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new OpsApiError('The API returned a malformed response.', response.status);
  }

  if (!response.ok || !body.ok || body.data === undefined) {
    throw new OpsApiError(
      body.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      body.error?.code,
    );
  }

  return body.data;
}

const get = <T>(path: string, query?: Query): Promise<T> => call<T>(path, { query });

/** A paginated list, as every list endpoint in this API returns it. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly totalItems: number;
  readonly page: number;
  readonly pageSize: number;
  /** Present on most list endpoints; recomputed locally when absent. */
  readonly totalPages?: number;
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The signed-in administrator, or `null` when the session is unreadable.
 *
 * Used by the shell to print the operator's address and to hide navigation the
 * operator cannot use. It is **not** an authorisation decision — the API checks
 * every permission on every request, and a hidden link is only about not
 * offering someone a door that will be shut in their face.
 */
export async function fetchAdmin(): Promise<AdminProfile | null> {
  try {
    return await get<AdminProfile>('/v1/admin/auth/me');
  } catch (error) {
    if (error instanceof OpsApiError && error.isUnauthorised) return null;
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

/** The dashboard window, in days. */
export async function fetchDashboard(days = 30): Promise<DashboardMetrics> {
  return get<DashboardMetrics>('/v1/admin/dashboard', { days });
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

export interface OrderQuery {
  status?: string;
  paymentStatus?: string;
  customerId?: string;
  orderNumber?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchOrders(query: OrderQuery): Promise<Page<Order>> {
  return get<Page<Order>>('/v1/admin/orders', query as Query);
}

export async function fetchOrder(orderId: string): Promise<Order> {
  return get<Order>(`/v1/admin/orders/${encodeURIComponent(orderId)}`);
}

/**
 * Move an order through its lifecycle.
 *
 * The API enforces the transition table and returns a conflict for an illegal
 * move, so the panel offers only the legal next steps and treats the server's
 * refusal as the truth if the two ever disagree.
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  note?: string,
): Promise<Order> {
  return call<Order>(`/v1/admin/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    body: note === undefined ? { status } : { status, note },
  });
}

/* -------------------------------------------------------------------------- */
/* Size exchanges                                                             */
/* -------------------------------------------------------------------------- */

export async function fetchExchanges(query: {
  status?: ExchangeStatus;
  page?: number;
  pageSize?: number;
}): Promise<Page<ExchangeRequest>> {
  return get<Page<ExchangeRequest>>('/v1/admin/exchanges', query as Query);
}

export async function updateExchange(
  exchangeId: string,
  input: ResolveExchangeRequest,
): Promise<ExchangeRequest> {
  return call<ExchangeRequest>(`/v1/admin/exchanges/${encodeURIComponent(exchangeId)}`, {
    method: 'PATCH',
    body: input,
  });
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A customer row.
 *
 * Not in the shared contracts because nothing public consumes it: the list route
 * builds this shape inline from the `users` projection. It is declared here so
 * the screen is typed against what the route actually returns rather than
 * against `unknown`.
 */
export interface CustomerRow {
  readonly id: string;
  readonly email: string;
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
}

export async function fetchCustomers(query: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<Page<CustomerRow>> {
  return get<Page<CustomerRow>>('/v1/admin/customers', query);
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

/** One stock row: a single SKU's on-hand count. */
export interface InventoryRow {
  readonly variantId: string;
  readonly sku: string;
  readonly productCode: string;
  readonly size: number;
  readonly colour: string;
  readonly stock: number;
  readonly inStock: boolean;
}

export async function fetchInventory(
  query: Pick<AdminInventoryQuery, 'search' | 'productCode' | 'inStock' | 'page' | 'pageSize'>,
): Promise<Page<InventoryRow>> {
  return get<Page<InventoryRow>>('/v1/admin/inventory', query as Query);
}

export async function fetchStockMovements(query: {
  page?: number;
  pageSize?: number;
  variantId?: string;
  productCode?: string;
}): Promise<Page<StockMovement>> {
  return get<Page<StockMovement>>('/v1/admin/inventory/movements', query);
}

/** One line of a stock adjustment batch. */
export interface StockAdjustmentLine {
  readonly variantId: string;
  readonly delta: number;
  readonly reason: string;
  readonly note?: string;
}

export interface StockAdjustmentOutcome {
  readonly applied: ReadonlyArray<{
    variant: { readonly id: string; readonly sku: string };
    movement: StockMovement;
  }>;
  readonly failed: ReadonlyArray<{ variantId: string; reason: string }>;
}

/**
 * Apply a batch of stock adjustments.
 *
 * The route requires an `Idempotency-Key`. It is generated here per call rather
 * than per attempt, because a retry of *this* submission is exactly the case the
 * key exists to collapse: two adjustments of −3 for one damaged pair.
 */
export async function adjustStock(
  lines: readonly StockAdjustmentLine[],
  note = '',
): Promise<StockAdjustmentOutcome> {
  return call<StockAdjustmentOutcome>('/v1/admin/inventory/adjustments', {
    method: 'POST',
    body: { adjustments: lines, note },
    idempotencyKey: crypto.randomUUID(),
  });
}

/* -------------------------------------------------------------------------- */
/* Promotions                                                                 */
/* -------------------------------------------------------------------------- */

export async function fetchCoupons(query?: {
  page?: number;
  pageSize?: number;
}): Promise<Page<Coupon>> {
  return get<Page<Coupon>>('/v1/admin/coupons', query);
}

export async function createCoupon(input: CouponInput): Promise<Coupon> {
  return call<Coupon>('/v1/admin/coupons', { method: 'POST', body: input });
}

export async function updateCoupon(couponId: string, input: UpdateCouponRequest): Promise<Coupon> {
  return call<Coupon>(`/v1/admin/coupons/${encodeURIComponent(couponId)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function deleteCoupon(couponId: string): Promise<{ deleted: boolean }> {
  return call<{ deleted: boolean }>(`/v1/admin/coupons/${encodeURIComponent(couponId)}`, {
    method: 'DELETE',
  });
}

/** What a coupon is worth against a given subtotal. Computed by the API. */
export interface CouponPreview {
  readonly code: string;
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly totalAfterDiscount: number;
}

export async function previewCoupon(couponId: string, subtotal: number): Promise<CouponPreview> {
  return call<CouponPreview>(`/v1/admin/coupons/${encodeURIComponent(couponId)}/preview`, {
    method: 'POST',
    body: { subtotal },
  });
}

/* -------------------------------------------------------------------------- */
/* Returns                                                                    */
/* -------------------------------------------------------------------------- */

export async function fetchReturns(query: {
  status?: ReturnStatus;
  orderId?: string;
  page?: number;
  pageSize?: number;
}): Promise<Page<ReturnRequest>> {
  return get<Page<ReturnRequest>>('/v1/admin/returns', query);
}

export async function updateReturnRequest(
  returnId: string,
  input: ResolveReturnRequest,
): Promise<ReturnRequest> {
  return call<ReturnRequest>(`/v1/admin/returns/${encodeURIComponent(returnId)}`, {
    method: 'PATCH',
    body: input,
  });
}

export async function initiateReturnRefund(
  returnId: string,
  input: InitiateRefundRequest = {},
): Promise<{
  returnId: string;
  returnNumber: string;
  orderId: string;
  refundId: string | null;
  amountRupees: number;
  providerStatus: string | null;
  settled: boolean;
  message: string;
}> {
  return call(`/v1/admin/returns/${encodeURIComponent(returnId)}/refund`, {
    method: 'POST',
    body: input,
  });
}

export async function reconcileReturnRefund(returnId: string): Promise<{
  returnId: string;
  returnNumber: string;
  orderId: string;
  refundId: string | null;
  amountRupees: number;
  providerStatus: string | null;
  settled: boolean;
  message: string;
}> {
  return call(`/v1/admin/returns/${encodeURIComponent(returnId)}/reconcile`, {
    method: 'POST',
    body: {},
  });
}

/** What each return status means for the operator, in one word. */
export const RETURN_STATUS_LABEL: Readonly<Record<string, string>> = {
  requested: 'Awaiting decision',
  approved: 'Approved',
  rejected: 'Rejected',
  received: 'Received & inspected',
  refunded: 'Refunded',
};

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export async function fetchAuditLogs(query: {
  page?: number;
  pageSize?: number;
  action?: string;
  entity?: string;
}): Promise<Page<AuditLogEntry>> {
  return get<Page<AuditLogEntry>>('/v1/admin/audit-logs', query);
}

/* -------------------------------------------------------------------------- */
/* Interaction analytics                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The interaction report for a window.
 *
 * One request returns every block the insight screens read — totals, the surface
 * and action breakdowns, the product and category tables, devices and the daily
 * trend — because they are one document on the server. Three requests would let
 * the page show a product table that disagrees with its own headline figure.
 *
 * `categorySlug` narrows the report to one category, which is the drill-down the
 * category table links into; without it the report is store-wide.
 */
export async function fetchInsights(query: {
  days?: number;
  limit?: number;
  categorySlug?: string;
}): Promise<InteractionInsights> {
  return get<InteractionInsights>('/v1/admin/analytics/insights', query as Query);
}

/**
 * Signed-in visitors with activity in the window.
 *
 * The endpoint returns `{ items, count }` rather than the usual paginated page
 * shape, because it is a bounded ranked list (the query caps it at 50) and not a
 * browsable collection. It is normalised to `items` here so the screen reads the
 * same as every other list.
 */
export async function fetchInteractionVisitors(query: {
  days?: number;
  limit?: number;
}): Promise<readonly InteractionVisitorRow[]> {
  const payload = await get<{ items: InteractionVisitorRow[] }>(
    '/v1/admin/analytics/visitors',
    query as Query,
  );
  return payload.items;
}

/** One visitor's full interaction profile. */
export async function fetchVisitorProfile(
  customerId: string,
  query: { days?: number; limit?: number },
): Promise<CustomerInteractionProfile> {
  return get<CustomerInteractionProfile>(
    `/v1/admin/analytics/visitors/${encodeURIComponent(customerId)}`,
    query as Query,
  );
}

/* -------------------------------------------------------------------------- */
/* The two spectrums                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The product spectrum: designs ranked by the buttons they earn.
 *
 * One request returns the summary and the ranked list together, because the
 * headline figure on the screen must be computed from the same match as the rows
 * below it. Two requests would let the lead number disagree with its own table.
 */
export async function fetchProductSpectrum(query: {
  days?: number;
  limit?: number;
  categorySlug?: string;
  sort?: 'taps' | 'views' | 'addToCart' | 'wishlist' | 'rate';
}): Promise<ProductSpectrumResponse<InteractionProductSpectrumRow>> {
  return get<ProductSpectrumResponse<InteractionProductSpectrumRow>>(
    '/v1/admin/analytics/products',
    query as Query,
  );
}

/** The envelope the product-spectrum list endpoint returns. */
export interface ProductSpectrumResponse<T> {
  readonly window: InteractionWindow;
  readonly designs: number;
  readonly viewers: number;
  readonly configurers: number;
  readonly carters: number;
  readonly generatedAt: string;
  readonly items: readonly T[];
}

/**
 * The envelope the customer-spectrum endpoint returns.
 *
 * Declared separately rather than made generic over the summary, because the two
 * summaries count different things: the product side counts designs and viewers,
 * the customer side counts people and wishlists. Sharing one shape would mean
 * either lying about a field or making every field optional.
 */
export interface CustomerSpectrumResponse<T> {
  readonly window: InteractionWindow;
  readonly customers: number;
  readonly configured: number;
  readonly carters: number;
  readonly wishlisted: number;
  readonly generatedAt: string;
  readonly items: readonly T[];
}

/** One design's full interaction profile. */
export async function fetchProductSpectrumProfile(
  productId: string,
  query: { days?: number; limit?: number },
): Promise<InteractionProductProfile> {
  return get<InteractionProductProfile>(
    `/v1/admin/analytics/products/${encodeURIComponent(productId)}`,
    query as Query,
  );
}

/** The customer spectrum: customers ranked by intent rather than traffic. */
export async function fetchCustomerSpectrum(query: {
  days?: number;
  limit?: number;
  sort?: 'taps' | 'addToCart' | 'wishlist' | 'views';
}): Promise<CustomerSpectrumResponse<InteractionCustomerSpectrumRow>> {
  return get<CustomerSpectrumResponse<InteractionCustomerSpectrumRow>>(
    '/v1/admin/analytics/customer-spectrum',
    query as Query,
  );
}
