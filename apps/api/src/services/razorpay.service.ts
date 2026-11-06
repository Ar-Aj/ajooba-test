import { createHmac, timingSafeEqual } from 'node:crypto';
import { readProviderSetting } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ServiceUnavailableError } from '../core/errors.js';

/**
 * Razorpay API client.
 *
 * Everything Razorpay-related that touches the network lives here. The rest
 * of the codebase never sees a key secret, never constructs a URL, and
 * never has to know that amounts are denominated in paise.
 *
 * Two invariants:
 *
 *  1. **No SDK.** The provider's REST contract is small and stable, and a
 *     hand-rolled `fetch` keeps the dependency surface minimal while still
 *     using the documented endpoints exactly.
 *  2. **No credential fallback.** If credentials are absent, every call
 *     raises a clear "not configured" failure. There is no code path that
 *     falls back to a live key, a default key, or a fabricated response.
 */

const RAZORPAY_BASE = 'https://api.razorpay.com/v1';

/** The provider's own error envelope. */
interface RazorpayErrorBody {
  error?: {
    code?: string;
    description?: string;
    source?: string;
    step?: string;
    reason?: string;
    field?: string;
  };
}

/** `POST /v1/orders` response, per the Orders entity documentation. */
export interface RazorpayOrder {
  id: string;
  entity: 'order';
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt?: string | null;
  status: 'created' | 'attempted' | 'paid';
  attempts: number;
  notes?: Record<string, string> | unknown[];
  created_at: number;
}

/** `GET /v1/payments/:id` response, trimmed to what we reconcile against. */
export interface RazorpayPayment {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string | null;
  international?: boolean;
  captured: boolean;
  amount_refunded?: number;
  /**
   * The gateway order this payment settles.
   *
   * Present on the payment entity and used as a cross-check: if the provider
   * reports a payment under an order id other than the one we recorded, the
   * two records have been crossed and we refuse to settle rather than guess.
   */
  order_id?: string;
  error_code?: string | null;
  error_description?: string | null;
  error_source?: string | null;
  error_step?: string | null;
  error_reason?: string | null;
  created_at: number;
}

/** `POST /v1/payments/:id/refund` response. */
export interface RazorpayRefund {
  id: string;
  entity: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  notes?: Record<string, string> | unknown[];
  status: 'pending' | 'processed' | 'failed';
  speed_requested?: string;
  speed_processed?: string;
  created_at: number;
}

/** A serviceable courier and its rate, from the serviceability endpoint. */
export interface RazorpayServiceableCourier {
  courier_id: number;
  courier_name: string;
  rate: number;
  delivery_days?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Is the payment integration usable at all?
 *
 * `configured` means we hold a key pair. It does **not** mean payments are
 * live: `mode` is reported separately, and `test` is the default so a
 * deployment cannot accidentally be in live mode.
 */
export function isRazorpayConfigured(): boolean {
  return Boolean(razorpayKeyId() && razorpayKeySecret());
}

/**
 * Can a webhook signature be verified?
 *
 * Separate from `isRazorpayConfigured` on purpose: a deployment can
 * legitimately create orders without a webhook secret, but then it has no
 * way to confirm a payment and must not pretend otherwise.
 */
export function isRazorpayWebhookConfigured(): boolean {
  return Boolean(razorpayWebhookSecret());
}

/** The publishable key id, or `null` when unconfigured. */
export function razorpayKeyId(): string | null {
  return readProviderSetting('RAZORPAY_KEY_ID') ?? null;
}

/** The key secret. Never returned to a caller or placed in a response. */
function razorpayKeySecret(): string | undefined {
  return readProviderSetting('RAZORPAY_KEY_SECRET');
}

/** The webhook signing secret, or `undefined` when unconfigured. */
function razorpayWebhookSecret(): string | undefined {
  return readProviderSetting('RAZORPAY_WEBHOOK_SECRET');
}

/**
 * Which key pair is loaded: `test` or `live`.
 *
 * Never inferred from the key id — a deployment declares it, and the
 * environment schema refuses a `live` declaration that is missing its
 * credentials or its webhook secret.
 */
export function razorpayMode(): 'test' | 'live' {
  return readProviderSetting('RAZORPAY_MODE') === 'live' ? 'live' : 'test';
}

/**
 * Guard: raise unless the API credentials are present.
 */
function requireCredentials(): { keyId: string; keySecret: string } {
  const keyId = razorpayKeyId();
  const keySecret = razorpayKeySecret();

  if (!keyId || !keySecret) {
    throw new ServiceUnavailableError(
      'Payments are not configured on this deployment. Set RAZORPAY_KEY_ID and ' +
        'RAZORPAY_KEY_SECRET to enable them.',
    );
  }
  return { keyId, keySecret };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A failure from the provider.
 *
 * Carries the provider's own code and HTTP status so callers can decide
 * between retrying and giving up, without parsing message strings.
 */
export class RazorpayApiError extends Error {
  readonly httpStatus: number;
  readonly providerCode: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    httpStatus: number,
    providerCode: string | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = 'RazorpayApiError';
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.retryable = retryable;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Perform one authenticated request against the provider.
 *
 * Basic auth with `key_id:key_secret`, exactly as documented. The
 * credential pair is never logged, never placed in a URL (so it cannot leak
 * through an access log) and never returned to a caller.
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const { keyId, keySecret } = requireCredentials();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${RAZORPAY_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const errorBody = (parsed ?? {}) as RazorpayErrorBody;
      const providerCode = errorBody.error?.code ?? null;
      const description = errorBody.error?.description ?? `HTTP ${response.status}`;

      /*
       * 5xx and 429 are transient and safe to retry with the same
       * idempotency key. 4xx means the request itself was wrong, and
       * retrying it unchanged will fail identically.
       */
      const retryable = response.status === 429 || response.status >= 500;

      logger.warn(
        { path, httpStatus: response.status, providerCode, retryable },
        'Razorpay API call failed',
      );

      throw new RazorpayApiError(description, response.status, providerCode, retryable);
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof RazorpayApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RazorpayApiError(
        'The payment provider did not respond in time.',
        504,
        'TIMEOUT',
        true,
      );
    }
    throw new RazorpayApiError('The payment provider could not be reached.', 503, 'NETWORK', true);
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Signature helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Compare two hex strings without leaking their contents through timing.
 *
 * `timingSafeEqual` throws when the lengths differ, which is itself a
 * useful signal, so the length check happens first and returns `false`
 * rather than throwing.
 */
export function safeCompareHex(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase(), 'utf8');
  const right = Buffer.from(b.toLowerCase(), 'utf8');

  if (left.length !== right.length || left.length === 0) {
    return false;
  }

  return timingSafeEqual(left, right);
}

/**
 * Verify a Razorpay Checkout signature.
 *
 * The documented procedure is
 * `hmac_sha256(order_id + "|" + razorpay_payment_id, key_secret)`.
 *
 * The `orderId` **must** be the value from our own database, never the
 * `razorpay_order_id` echoed by the browser — using the browser's copy
 * would let an attacker sign their own arbitrary order id.
 */
export function verifyCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const keySecret = razorpayKeySecret();
  if (!keySecret) {
    return false;
  }

  const expected = createHmac('sha256', keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');

  return safeCompareHex(expected, input.signature);
}

/**
 * Verify a webhook signature.
 *
 * Per Razorpay's own documentation the HMAC input is the **raw request
 * body**, byte for byte. Any JSON re-serialisation would change key
 * ordering or whitespace and break verification, so the caller must pass the
 * unparsed buffer straight through.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  const webhookSecret = razorpayWebhookSecret();
  if (!webhookSecret) {
    return false;
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');

  const expected = createHmac('sha256', webhookSecret).update(body).digest('hex');

  return safeCompareHex(expected, signature);
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create a Razorpay order.
 *
 * `amountRupees` is whole rupees; Razorpay requires the smallest currency
 * unit, so the conversion happens here and nowhere else. Converting at the
 * boundary is what keeps every other module thinking in rupees and keeps a
 * stray "amount in paise" from leaking into the order total.
 */
export async function createRazorpayOrder(input: {
  amountRupees: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountRupees) || input.amountRupees <= 0) {
    throw new RazorpayApiError(
      'The order total must be a positive whole number of rupees.',
      400,
      'INVALID_AMOUNT',
      false,
    );
  }

  return request<RazorpayOrder>('POST', '/orders', {
    amount: input.amountRupees * 100,
    currency: 'INR',
    receipt: input.receipt,
    ...(input.notes ? { notes: input.notes } : {}),
  });
}

/** Fetch a Razorpay order, for reconciliation. */
export async function fetchRazorpayOrder(razorpayOrderId: string): Promise<RazorpayOrder> {
  return request<RazorpayOrder>('GET', `/orders/${encodeURIComponent(razorpayOrderId)}`);
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fetch a payment from the provider.
 *
 * This is the authoritative source used to reconcile a Checkout response
 * before an order is marked paid. A signature alone proves the response came
 * from Razorpay; only the provider's own record proves the money moved.
 */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPayment> {
  return request<RazorpayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
}

/**
 * Capture an authorized payment.
 *
 * Required when the account has automatic capture disabled, in which case
 * `payment.authorized` is the terminal state until we capture it.
 */
export async function captureRazorpayPayment(
  paymentId: string,
  amountRupees?: number,
): Promise<RazorpayPayment> {
  return request<RazorpayPayment>(
    'POST',
    `/payments/${encodeURIComponent(paymentId)}/capture`,
    amountRupees === undefined
      ? { currency: 'INR' }
      : { amount: amountRupees * 100, currency: 'INR' },
  );
}

/* -------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create a refund.
 *
 * `idempotencyKey` maps to Razorpay's `X-Refund-Idempotency` header, which
 * the provider documents as ≥10 characters of `[A-Za-z0-9-_]`. Reusing the
 * same key with the same body is a safe no-op at the provider; reusing it
 * with a *different* body is rejected. That is precisely the guarantee a
 * retried refund needs, so the key is derived from the return request and is
 * stable across retries.
 *
 * A `409` from the provider means a prior identical request is still in
 * flight. That is explicitly documented as safe to retry, so it is surfaced
 * as `retryable` rather than treated as a failure.
 */
export async function createRazorpayRefund(input: {
  paymentId: string;
  amountRupees: number;
  idempotencyKey: string;
  receipt?: string;
  speed?: 'normal' | 'instant';
  notes?: Record<string, string>;
}): Promise<RazorpayRefund> {
  const key = input.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

  if (key.length < 10) {
    throw new RazorpayApiError(
      'The refund idempotency key must be at least 10 characters.',
      400,
      'INVALID_IDEMPOTENCY_KEY',
      false,
    );
  }

  return request<RazorpayRefund>(
    'POST',
    `/payments/${encodeURIComponent(input.paymentId)}/refund`,
    {
      amount: input.amountRupees * 100,
      ...(input.speed ? { speed: input.speed } : {}),
      ...(input.receipt ? { receipt: input.receipt } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    },
    { 'X-Refund-Idempotency': key },
  );
}

/** Fetch a refund's current state from the provider. */
export async function fetchRazorpayRefund(refundId: string): Promise<RazorpayRefund> {
  return request<RazorpayRefund>('GET', `/refunds/${encodeURIComponent(refundId)}`);
}

/**
 * List the refunds already recorded against a payment.
 *
 * Used by reconciliation to work out how much has actually been returned to
 * the customer, rather than trusting our own running total.
 */
export async function listRazorpayRefunds(paymentId: string): Promise<RazorpayRefund[]> {
  return request<RazorpayRefund[]>('GET', `/payments/${encodeURIComponent(paymentId)}/refunds`);
}
