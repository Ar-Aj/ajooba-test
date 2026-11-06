import { readProviderSetting } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ServiceUnavailableError } from '../core/errors.js';

/**
 * Shiprocket API client.
 *
 * Shiprocket's v2 API is a token-authenticated REST API. The contract below
 * was read from Shiprocket's own documentation and their official Postman
 * workspace on 25 Oct 2026.
 *
 * ```
 * POST https://apiv2.shiprocket.in/v1/external/auth/login
 *   { "email": "...", "password": "..." }
 *   -> { "success": true, "data": { "token": "<jwt>" } }
 *   (some deployments return the token at the top level instead)
 *
 * GET|POST https://apiv2.shiprocket.in/v1/external/...
 *   Authorization: Bearer <token>
 * ```
 *
 * Four documented facts shape this module:
 *
 *  1. **The token is valid for 10 days.** It must be refreshed, and a `401`
 *     must trigger exactly one re-authentication and one retry.
 *  2. **`order_id` must be unique, and cannot be reused from a cancelled
 *     order.** A reused id is rejected with `422`.
 *  3. **The webhook endpoint must return only HTTP 200.** Any other status
 *     and Shiprocket treats the delivery as failed and retries.
 *  4. **The response envelope is not uniform.** Some endpoints return
 *     `{ success, data }`, some return the payload at the top level, and the
 *     AWB endpoint nests it a third level deep under `response.data`. The
 *     unwrapping therefore handles all three, rather than assuming one.
 *
 * As with the other providers, there is no SDK: the contract is small and
 * the hand-rolled client keeps the dependency surface minimal while using
 * the documented endpoints exactly.
 */

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in';

/** The provider's success envelope. */
interface ShiprocketEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

/** A failure from the provider. */
export class ShiprocketApiError extends Error {
  readonly httpStatus: number;
  /** The provider's own status code, when it supplied one. */
  readonly providerCode: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    httpStatus: number,
    providerCode: number | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'ShiprocketApiError';
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.retryable = retryable;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Is the shipping integration usable at all?
 *
 * Requires the credential pair. The pickup location is reported separately
 * because a missing one is an account setup issue rather than a credential
 * one — and Shiprocket rejects an unknown pickup location outright, so a
 * deployment with credentials but no location still cannot ship.
 */
export function isShiprocketConfigured(): boolean {
  return Boolean(shiprocketApiEmail() && shiprocketApiPassword());
}

/** The API-user email. */
export function shiprocketApiEmail(): string | undefined {
  return readProviderSetting('SHIPROCKET_API_EMAIL');
}

/** The API-user password. */
function shiprocketApiPassword(): string | undefined {
  return readProviderSetting('SHIPROCKET_API_PASSWORD');
}

/** The pickup location name configured in the Shiprocket account. */
export function shiprocketPickupLocation(): string | undefined {
  return readProviderSetting('SHIPROCKET_PICKUP_LOCATION');
}

/** The pinned courier id, when the account has one. */
export function shiprocketCourierId(): number | null {
  const raw = readProviderSetting('SHIPROCKET_COURIER_ID');
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** The shared secret checked against the tracking webhook's `x-api-key`. */
export function shiprocketWebhookSecret(): string | undefined {
  return readProviderSetting('SHIPROCKET_WEBHOOK_SECRET');
}

/**
 * Can tracking webhooks be authenticated?
 *
 * Separate from `isShiprocketConfigured`, because a deployment can legitimately
 * create shipments without a webhook secret — it just must not pretend it can
 * receive tracking updates.
 */
export function isShiprocketWebhookConfigured(): boolean {
  return Boolean(shiprocketWebhookSecret());
}

/**
 * What setup is still missing?
 *
 * Surfaced to the admin panel so an operator sees exactly what to configure
 * rather than a generic "shipping unavailable".
 */
export function shippingMissingSetup(): string[] {
  const missing: string[] = [];
  if (!shiprocketApiEmail()) missing.push('SHIPROCKET_API_EMAIL');
  if (!shiprocketApiPassword()) missing.push('SHIPROCKET_API_PASSWORD');
  if (!shiprocketPickupLocation()) missing.push('SHIPROCKET_PICKUP_LOCATION');
  return missing;
}

/* -------------------------------------------------------------------------- */
/* Token management                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The bearer token, and when it was minted.
 *
 * Cached in memory only. The token is never written to disk or to a log, and
 * it is never returned to a caller.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Refresh the bearer token before it expires.
 *
 * Shiprocket documents a 10-day lifetime. The buffer below is deliberately
 * generous (6 hours) so a token is renewed well before it can expire
 * mid-request — and because clock skew between our host and theirs is
 * unknown.
 */
const TOKEN_REFRESH_BUFFER_MS = 6 * 60 * 60 * 1000;

/**
 * Get a valid bearer token, authenticating if needed.
 *
 * The concurrency guard matters: several shipments created at once must not
 * each mint a token, because the provider invalidates the previous one on a
 * new login and a burst of logins can invalidate the token a request is
 * already using.
 */
let tokenPromise: Promise<string> | null = null;

export async function getShiprocketToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  // Collapse concurrent authentications onto one in-flight request.
  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    const email = shiprocketApiEmail();
    const password = shiprocketApiPassword();

    if (!email || !password) {
      throw new ServiceUnavailableError(
        'Shipping is not configured on this deployment. Set SHIPROCKET_API_EMAIL and ' +
          'SHIPROCKET_API_PASSWORD to enable it.',
      );
    }

    const response = await fetch(`${SHIPROCKET_BASE}/v1/external/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    let parsed: ShiprocketEnvelope<{ token?: string }> | null = null;
    try {
      parsed = JSON.parse(text) as ShiprocketEnvelope<{ token?: string }>;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      logger.warn({ httpStatus: response.status }, 'Shiprocket authentication failed');
      throw new ShiprocketApiError(
        parsed?.message ?? `Shiprocket returned HTTP ${response.status}.`,
        response.status,
        null,
        response.status >= 500,
      );
    }

    /*
     * The token is documented under `data.token`, but some Shiprocket
     * deployments return the login payload at the **top level** instead
     * (`{ success: true, token: "..." }`). Reading only `data.token` made
     * authentication fail against those accounts with the misleading error
     * "Shiprocket did not return an access token".
     *
     * Both documented shapes are therefore accepted, and the token is never
     * logged.
     */
    const token = parsed?.data?.token ?? (parsed as { token?: string } | null)?.token;
    if (!token) {
      throw new ShiprocketApiError('Shiprocket did not return an access token.', 502, null, true);
    }

    cachedToken = {
      token,
      // 10 days, minus the refresh buffer.
      expiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000 - TOKEN_REFRESH_BUFFER_MS,
    };

    return token;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

/** Drop the cached token — used after a 401 so the next call re-authenticates. */
export function clearShiprocketToken(): void {
  cachedToken = null;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Perform one authenticated request.
 *
 * A `401` triggers **exactly one** re-authentication and retry, as the
 * provider documents. More than one retry risks a loop, and zero would mean
 * a deployment whose token expired can never ship again without a restart.
 */
async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const send = async (token: string): Promise<Response> => {
    const url = new URL(`${SHIPROCKET_BASE}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  const token = await getShiprocketToken();
  let response = await send(token);

  if (response.status === 401) {
    // The token expired early. Re-authenticate once, then retry once.
    logger.info('Shiprocket token rejected; re-authenticating once');
    clearShiprocketToken();
    const fresh = await getShiprocketToken();
    response = await send(fresh);
  }

  const text = await response.text();
  let parsed: ShiprocketEnvelope<T> | null = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as ShiprocketEnvelope<T>;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const providerCode =
      parsed && typeof parsed === 'object' && 'status_code' in parsed
        ? Number((parsed as { status_code?: unknown }).status_code)
        : null;

    logger.warn({ path, httpStatus: response.status, providerCode }, 'Shiprocket API call failed');

    throw new ShiprocketApiError(
      parsed?.message ?? `Shiprocket returned HTTP ${response.status}.`,
      response.status,
      Number.isFinite(providerCode) ? providerCode : null,
      response.status === 429 || response.status >= 500,
    );
  }

  /*
   * Shiprocket's envelope is `{ success, message, data }`. A `success: false`
   * with HTTP 200 is a documented shape for a rejected operation, so it is
   * treated as a failure rather than unwrapped as success.
   */
  if (parsed && parsed.success === false) {
    throw new ShiprocketApiError(
      parsed.message ?? 'Shiprocket rejected the request.',
      response.status,
      null,
      false,
    );
  }

  return unwrapShiprocketPayload(parsed) as T;
}

/**
 * Unwrap a Shiprocket payload.
 *
 * The provider is **not** consistent about where the payload sits:
 *
 *  - the common shape is `{ success: true, data: { ... } }`;
 *  - some endpoints return the payload at the **top level**
 *    (`{ order_id, shipment_id, status }`);
 *  - the AWB assignment endpoint nests it a **third** level deep, under
 *    `{ awb_assign_status, response: { data: { ... } } }`;
 *  - the serviceability endpoint returns
 *    `{ data: { available_courier_companies: [...] } }`.
 *
 * Reading only `data` therefore dropped the AWB assignment on the floor —
 * the shipment would have been created and then never given a waybill.
 * Each documented layer is unwrapped in turn.
 */
function unwrapShiprocketPayload(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') {
    return parsed;
  }

  const envelope = parsed as {
    data?: unknown;
    response?: { data?: unknown };
    awb_assign_status?: number;
    awb_assign_error?: string;
  };

  // Third level: `{ awb_assign_status, response: { data } }`.
  if (envelope.response && typeof envelope.response === 'object' && 'data' in envelope.response) {
    /*
     * The status flag lives on the **enclosing** object, so it is carried
     * across rather than discarded with the wrapper. Dropping it would hide
     * a failed waybill assignment behind a successful HTTP 200.
     */
    return {
      ...(envelope.response.data as Record<string, unknown>),
      ...(envelope.awb_assign_status === undefined
        ? {}
        : { awb_assign_status: envelope.awb_assign_status }),
      ...(envelope.awb_assign_error === undefined
        ? {}
        : { awb_assign_error: envelope.awb_assign_error }),
    };
  }

  // Second level: `{ success, data }`.
  if ('data' in envelope && envelope.data !== undefined) {
    return envelope.data;
  }

  // Top level.
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Provider types                                                             */
/* -------------------------------------------------------------------------- */

/** A courier that can serve a pincode pair, with its rate. */
export interface ShiprocketServiceableCourier {
  /**
   * The courier's id, as the provider names it.
   *
   * The serviceability response carries `courier_company_id` (e.g. `43`),
   * which is the value the AWB assignment endpoint expects back as
   * `courier_id`. The response also carries an unrelated `id`, which is a
   * per-quote identifier and is **not** the courier id — sending that one
   * gets the wrong courier or no courier at all.
   */
  readonly courier_company_id?: number;
  /** Retained as a fallback for a response variant that uses this key. */
  readonly courier_id?: number;
  readonly courier_name: string;
  readonly rate?: number;
  readonly freight_charge?: number;
  readonly delivery_days?: number | null;
  readonly estimated_delivery_days?: number | null;
  readonly pickup_date?: string | null;
  readonly drop_off_date?: string | null;
}

/** The response to creating an adhoc order. */
export interface ShiprocketCreateOrderResult {
  readonly order_id: string;
  readonly shipment_id: string;
  readonly status: string;
  readonly status_code: number;
  readonly awb_code?: string | null;
  readonly awb_assigned?: boolean;
  readonly courier_name?: string | null;
  readonly courier_id?: number | null;
  readonly onboarding_completed_now?: boolean;
  readonly label_url?: string | null;
  readonly pickup_scheduled_date?: string | null;
  readonly manifest_date?: string | null;
  readonly shipping_method?: string | null;
}

/** The response to assigning an AWB. */
export interface ShiprocketAssignAwbResult {
  readonly awb_code?: string | null;
  readonly awb_assigned?: boolean;
  readonly status?: string | null;
  readonly courier_id?: number | null;
  readonly courier_name?: string | null;
  readonly label_url?: string | null;
  readonly pickup_scheduled_date?: string | null;
}

/** A tracking scan. */
export interface ShiprocketScan {
  readonly date?: string;
  readonly status?: string;
  readonly activity?: string;
  readonly location?: string;
  readonly 'sr-status'?: string;
  readonly 'sr-status-label'?: string;
}

/** A tracking record. */
export interface ShiprocketTracking {
  readonly awb?: string;
  readonly awb_assigned_date?: string;
  readonly courier_name?: string;
  readonly current_status?: string;
  readonly current_status_id?: number;
  readonly shipment_status?: string;
  readonly shipment_status_id?: number;
  readonly current_timestamp?: string;
  readonly order_id?: string;
  readonly sr_order_id?: number | string;
  readonly pickup_scheduled_date?: string;
  readonly etd?: string;
  readonly scans?: ShiprocketScan[];
  readonly is_return?: number;
  readonly pod_status?: string;
}

/** A pickup location configured in the account. */
export interface ShiprocketPickupLocation {
  readonly pickup_location_id?: number;
  readonly pickup_location?: string;
  readonly name?: string;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly pincode?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address?: string;
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/** Log in and return a bearer token. Exposed for diagnostics and tests. */
export async function loginToShiprocket(): Promise<string> {
  clearShiprocketToken();
  return getShiprocketToken();
}

/** List the pickup locations configured in the account. */
export async function listPickupLocations(): Promise<ShiprocketPickupLocation[]> {
  const data = await request<ShiprocketPickupLocation[]>('GET', '/v1/external/pickup');
  return Array.isArray(data) ? data : [];
}

/**
 * Check which couriers can serve a pincode pair.
 *
 * The provider requires `pickup_postcode`, `delivery_postcode` and either an
 * `order_id` or the pair `cod` + `weight`.
 *
 * The documented response puts the list under
 * `data.available_courier_companies` — **not** `courier_serviceability`, which
 * is what an earlier version of this function read. Reading the wrong key
 * returned an empty list for every pincode, which reads as "no courier can
 * serve this address" and would have blocked every dispatch.
 */
export async function checkServiceability(input: {
  pickupPostcode: string;
  deliveryPostcode: string;
  orderId?: string;
  cod?: boolean;
  weight?: number;
  length?: number;
  breadth?: number;
  height?: number;
  declaredValue?: number;
}): Promise<ShiprocketServiceableCourier[]> {
  const data = await request<{
    available_courier_companies?: ShiprocketServiceableCourier[];
    /** Retained because one documented response variant uses this key. */
    courier_serviceability?: ShiprocketServiceableCourier[];
  }>('GET', '/v1/external/courier/serviceability', undefined, {
    pickup_postcode: input.pickupPostcode,
    delivery_postcode: input.deliveryPostcode,
    is_return: 0,
    ...(input.orderId ? { order_id: input.orderId } : {}),
    ...(input.cod === undefined ? {} : { cod: input.cod ? 1 : 0 }),
    ...(input.weight === undefined ? {} : { weight: input.weight }),
    ...(input.length === undefined ? {} : { length: input.length }),
    ...(input.breadth === undefined ? {} : { breadth: input.breadth }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.declaredValue === undefined ? {} : { declared_value: input.declaredValue }),
  });

  return data?.available_courier_companies ?? data?.courier_serviceability ?? [];
}

/**
 * Create an adhoc (custom) order.
 *
 * The payload is built by the caller and validated by the provider; this
 * function is a thin, typed wrapper so the transport and the error handling
 * live in one place.
 */
export async function createShiprocketOrder(payload: {
  order_id: string;
  order_date: string;
  pickup_location: string;
  billing_customer_name: string;
  billing_address?: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email: string;
  billing_phone: string;
  shipping_is_billing: boolean;
  shipping_customer_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_pincode?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_email?: string;
  shipping_phone?: string;
  order_items: Array<{
    name: string;
    sku: string;
    units: number;
    selling_price: number;
    discount?: number;
    tax?: number;
    hsn?: string;
  }>;
  payment_method: 'COD' | 'Prepaid';
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
  note?: string;
}): Promise<ShiprocketCreateOrderResult> {
  return request<ShiprocketCreateOrderResult>('POST', '/v1/external/orders/create/adhoc', payload);
}

/**
 * Assign an AWB to a shipment, choosing a courier.
 *
 * The documented success body is:
 *
 * ```json
 * {
 *   "awb_assign_status": 1,
 *   "response": { "data": { "awb_code": "...", "courier_name": "..." } }
 * }
 * ```
 *
 * and the documented **failure** body is:
 *
 * ```json
 * { "awb_assign_status": 0, "response": { "data": { "awb_assign_error": "..." } } }
 * ```
 *
 * Both arrive with HTTP 200. Without checking `awb_assign_status`, a failed
 * assignment looked like a success and the shipment was left with no waybill
 * while the operator was told it had one.
 */
export async function assignShiprocketAwb(input: {
  shipmentId: string;
  courierId?: number | null;
}): Promise<ShiprocketAssignAwbResult> {
  const data = await request<ShiprocketAssignAwbResult & { awb_assign_status?: number }>(
    'POST',
    '/v1/external/courier/assign/awb',
    {
      shipment_id: input.shipmentId,
      ...(input.courierId ? { courier_id: input.courierId } : {}),
    },
  );

  if (data?.awb_assign_status === 0) {
    const error = (data as { awb_assign_error?: string }).awb_assign_error;
    throw new ShiprocketApiError(
      error ?? 'The carrier could not assign a waybill to this shipment.',
      422,
      null,
      false,
    );
  }

  if (!data?.awb_code) {
    /*
     * A 200 with no waybill is not an assignment. Treating it as one would
     * leave the shipment permanently without a tracking number.
     */
    throw new ShiprocketApiError(
      'The carrier returned no waybill for this shipment.',
      502,
      null,
      true,
    );
  }

  return data;
}

/**
 * Generate the shipping label.
 *
 * The documented request body is `{ shipment_id: [<id>] }` — an **array**.
 * The documented response puts `label_url` at the **top level** alongside
 * `label_created` and `not_created`, so the transport's top-level fallback
 * is what reads it.
 */
export async function generateShiprocketLabel(
  shipmentId: string,
): Promise<{ label_url?: string | null; label_created?: number }> {
  const data = await request<{ label_url?: string | null; label_created?: number }>(
    'POST',
    '/v1/external/courier/generate/label',
    { shipment_id: [shipmentId] },
  );
  return data ?? {};
}

/**
 * Request a courier pickup.
 *
 * The documented body is `{ shipment_id: [<id>] }` — an **array**, with
 * exactly one entry ("Only one shipment_id can be passed at a time").
 *
 * The AWB must already be assigned; the provider rejects a pickup request
 * for a shipment that has no waybill.
 */
export async function requestShiprocketPickup(shipmentId: string): Promise<unknown> {
  return request<unknown>('POST', '/v1/external/courier/generate/pickup', {
    shipment_id: [shipmentId],
  });
}

/** Track a shipment by AWB. */
export async function trackShiprocketAwb(awbCode: string): Promise<ShiprocketTracking> {
  const data = await request<ShiprocketTracking>(
    'GET',
    `/v1/external/courier/track/awb/${encodeURIComponent(awbCode)}`,
  );
  return data ?? {};
}

/** Read a shipment's current state from the provider. */
export async function fetchShiprocketOrder(orderId: string): Promise<ShiprocketTracking> {
  const data = await request<ShiprocketTracking>(
    'GET',
    `/v1/external/orders/${encodeURIComponent(orderId)}`,
  );
  return data ?? {};
}

/**
 * Cancel a shipment.
 *
 * The documented body is `{ ids: [<shiprocket_order_id>] }` — an **array** of
 * Shiprocket's own order ids, which is what the provider's own reference
 * collection sends. The earlier `{ order_id, cancel_reason }` body was not
 * the documented shape and the provider ignored it, so a cancelled shipment
 * stayed live at the carrier while the store believed it had been cancelled.
 *
 * The reference id is our `order_id`; Shiprocket's own order id is what the
 * provider expects, so the caller passes the id it was given at creation.
 *
 * The endpoint returns **no response body** on success, which is why the
 * transport tolerates an empty body.
 */
export async function cancelShiprocketOrder(
  shiprocketOrderId: string | number,
  reason: string,
): Promise<unknown> {
  /*
   * The documented body is `{ ids: [<shiprocket_order_id>] }`, where the id
   * is an **integer** — the provider's own numeric order id, not our
   * reference id. It is stored as a string on the shipment (the provider
   * returns different shapes across endpoints), so it is converted back to a
   * number here when it looks numeric.
   */
  const numeric = /^\d+$/.test(String(shiprocketOrderId))
    ? Number(shiprocketOrderId)
    : shiprocketOrderId;

  return request<unknown>('POST', '/v1/external/orders/cancel', {
    ids: [numeric],
    // Not documented as required, but harmless and useful in the carrier's
    // own record of why the parcel was stopped.
    cancel_reason: reason,
  });
}
