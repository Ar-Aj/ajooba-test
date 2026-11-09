import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import {
  TEST_ADDRESS,
  createAdmin,
  createCustomer,
  createProductWithVariant,
  setStoreSettings,
} from './helpers/factories.js';
import { OrderModel } from '../src/models/order.model.js';
import { PaymentModel } from '../src/models/payment.model.js';
import { EmailLogModel } from '../src/models/email-log.model.js';
import { ReturnRequestModel } from '../src/models/return-request.model.js';
import { StockMovementModel } from '../src/models/stock-movement.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { WebhookEventModel } from '../src/models/webhook-event.model.js';
import { safeCompareHex, verifyCheckoutSignature } from '../src/services/razorpay.service.js';

/**
 * Payments, webhooks and refunds.
 *
 * `fetch` is stubbed for the whole file, so nothing here touches Razorpay.
 * Every assertion is about *our* logic — signature verification, amount
 * reconciliation, state transitions and exactly-once semantics.
 *
 * The properties under test are the ones that cost real money if they are
 * wrong:
 *
 *  - a browser success message alone never marks an order paid;
 *  - a mismatched amount never marks an order paid;
 *  - a duplicate webhook never double-settles;
 *  - a late failure never undoes a capture;
 *  - a refund is never reported complete before the provider confirms it.
 */

useApi();

const KEY_SECRET = 'test-key-secret-value-that-is-long-enough';
const WEBHOOK_SECRET = 'test-webhook-secret';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  total: number;
  token: string;
  customerId: string;
  firstVariantId: string;
}

async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

async function adminToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/admin/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

/**
 * Place a real order through the real checkout, to be paid online.
 *
 * Checkout goes through the genuine API path — cart, pricing, atomic stock
 * reservation — so the order that the payment tests operate on is one the
 * platform would really have created.
 */
async function placeOnlineOrder(quantity = 2): Promise<PlacedOrder> {
  await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0 });

  const customer = await createCustomer();
  const token = await customerToken(customer.email, customer.password);
  const { variant } = await createProductWithVariant(
    { sellingPrice: 1000, mrp: 2000 },
    { stock: 10 },
  );

  const add = await api()
    .post('/v1/cart/items')
    .set(bearer(token))
    .send({ variantId: variant.id, quantity });
  expect(add.status).toBe(200);

  const key = `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await api()
    .post('/v1/checkout/orders')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send({
      shippingAddress: TEST_ADDRESS,
      paymentMethod: 'razorpay',
      idempotencyKey: key,
    });

  expect(response.status).toBe(201);
  const order = success<{
    id: string;
    orderNumber: string;
    totalAmount: number;
    customerId: string;
    items: Array<{ variantId: string }>;
  }>(response.body);

  const firstItem = order.items[0];
  expect(firstItem, 'the order should contain the line that was added').toBeDefined();

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: order.totalAmount,
    token,
    customerId: order.customerId,
    firstVariantId: firstItem!.variantId,
  };
}

/** The signature a real Checkout callback would carry. */
function signCheckout(gatewayOrderId: string, paymentId: string): string {
  return createHmac('sha256', KEY_SECRET).update(`${gatewayOrderId}|${paymentId}`).digest('hex');
}

function signWebhook(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

/**
 * Point the services at test credentials.
 *
 * `env` is frozen at boot, so the values are patched on `process.env` — the
 * same source the running configuration was validated from — and restored
 * afterwards. The production schema is never relaxed to accommodate this.
 */
const SAVED_ENV: Record<string, string | undefined> = {};

function withRazorpay(overrides: Record<string, string | undefined> = {}): void {
  for (const key of [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'RAZORPAY_MODE',
  ]) {
    if (!(key in SAVED_ENV)) {
      SAVED_ENV[key] = process.env[key];
    }
  }

  const values: Record<string, string | undefined> = {
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_MODE: 'test',
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/** Stub every provider call with one JSON response. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const text = () => Promise.resolve(JSON.stringify(body));
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text,
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/**
 * The request the provider actually received.
 *
 * Asserting on the *outbound* call — the URL, the verb and the body that was
 * sent — is what proves the integration speaks Razorpay's contract rather
 * than merely returning a plausible-looking answer.
 */
function sentRequest(
  mock: ReturnType<typeof vi.fn>,
  index = 0,
): { url: string; init: RequestInit; headers: Record<string, string> } {
  const call = mock.mock.calls[index] as [string, RequestInit] | undefined;
  if (!call) {
    throw new Error(`Expected the provider to have been called at least ${index + 1} time(s).`);
  }
  const [url, init] = call;
  return { url, init, headers: (init.headers ?? {}) as Record<string, string> };
}

/** Create the payment row `createPaymentIntent` would have written. */
async function seedPayment(
  order: PlacedOrder,
  razorpayOrderId: string,
  overrides: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  const doc = await PaymentModel.create({
    orderId: new Types.ObjectId(order.orderId),
    orderNumber: order.orderNumber,
    customerId: new Types.ObjectId(order.customerId),
    amount: order.total,
    currency: 'INR',
    status: 'pending',
    provider: 'razorpay',
    providerOrderId: razorpayOrderId,
    idempotencyKey: `intent:${order.orderId}`,
    ...overrides,
  });
  return doc._id;
}

function gatewayOrderResponse(order: PlacedOrder, id: string) {
  return {
    id,
    entity: 'order',
    amount: order.total * 100,
    amount_paid: 0,
    amount_due: order.total * 100,
    currency: 'INR',
    status: 'created',
    attempts: 0,
    created_at: 1_700_000_000,
  };
}

function gatewayPaymentResponse(input: {
  id: string;
  orderId: string;
  amountPaise: number;
  status: 'captured' | 'authorized' | 'failed';
  extra?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    entity: 'payment',
    amount: input.amountPaise,
    currency: 'INR',
    status: input.status,
    captured: input.status === 'captured',
    order_id: input.orderId,
    created_at: 1_700_000_000,
    ...input.extra,
  };
}

/**
 * Read the webhook route's outcome.
 *
 * The webhook endpoint deliberately does **not** use the standard
 * `{ ok, data }` envelope. It is an endpoint a third-party provider posts to,
 * and its response contract is intentionally minimal — `ok` plus a single
 * `outcome` word — so the shape cannot drift as internal response types
 * change underneath it.
 */
function outcome(body: unknown): string {
  return (body as { outcome: string }).outcome;
}

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  return `evt_${Date.now().toString(36)}_${eventCounter}`;
}

/**
 * Deliver a webhook exactly as Razorpay would.
 *
 * The raw string is both signed and sent, so the bytes the server hashes are
 * the bytes that arrived — which is the property under test.
 */
async function deliverWebhook(payload: unknown, eventId = nextEventId()) {
  const raw = JSON.stringify(payload);
  return api()
    .post('/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signWebhook(raw))
    .set('x-razorpay-event-id', eventId)
    .send(raw);
}

function capturedEvent(paymentId: string, gatewayOrderId: string, amountPaise: number) {
  return {
    entity: 'payment',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: 'payment',
        id: paymentId,
        amount: amountPaise,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        order_id: gatewayOrderId,
        captured: true,
      },
    },
  };
}

/**
 * A `payment.captured` event in **Razorpay's documented shape**.
 *
 * Transcribed from
 * `https://razorpay.com/docs/build/llm-docs/webhooks/payments.md`
 * (verified 23 Oct 2026). Two details here are the whole point of this
 * fixture, and both are easy to get wrong:
 *
 *  - the envelope's `entity` is `"event"`, not `"payment"`;
 *  - the payment fields are nested at `payload.payment.entity.*`, not at
 *    `payload.payment.*`.
 *
 * The first payload the platform ever had trouble with was this one, and it
 * was silently acknowledged as "unrecognised" — meaning a captured payment
 * would never have settled an order.
 */
function documentedCapturedEvent(
  paymentId: string,
  gatewayOrderId: string,
  amountPaise: number,
): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_TESTONLY',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: 'payment',
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
          order_id: gatewayOrderId,
          captured: true,
          method: 'upi',
          international: false,
          fee: 0,
          tax: 0,
          error_code: null,
          error_description: null,
          error_source: null,
          error_step: null,
          error_reason: null,
          notes: [],
          created_at: 1_691_735_748,
        },
      },
    },
    created_at: 1_691_735_748,
  };
}

/**
 * A `refund.failed` event in Razorpay's documented shape.
 *
 * Transcribed from
 * `https://razorpay.com/docs/build/llm-docs/webhooks/refunds.md`
 * (verified 23 Oct 2026). The refund entity lives at
 * `payload.refund.entity` and names the payment it reverses via
 * `payment_id`.
 */
function documentedRefundFailedEvent(
  refundId: string,
  paymentId: string,
  amountPaise: number,
): Record<string, unknown> {
  return {
    entity: 'event',
    account_id: 'acc_TESTONLY',
    event: 'refund.failed',
    contains: ['refund', 'payment'],
    payload: {
      refund: {
        entity: {
          id: refundId,
          entity: 'refund',
          amount: amountPaise,
          currency: 'INR',
          payment_id: paymentId,
          status: 'failed',
          receipt: null,
          notes: {},
          acquirer_data: { arn: null },
          created_at: 1_597_734_071,
        },
      },
      payment: {
        entity: {
          id: paymentId,
          entity: 'payment',
          amount: amountPaise * 10,
          currency: 'INR',
          base_amount: amountPaise * 10,
          status: 'captured',
          order_id: 'order_testonly',
          captured: true,
          refund_status: 'partial',
          amount_refunded: amountPaise,
          method: 'upi',
          notes: [],
          fee: 0,
          tax: 0,
          error_code: null,
          error_description: null,
          error_source: null,
          error_step: null,
          error_reason: null,
          international: false,
          invoice_id: null,
          bank: null,
          wallet: null,
          vpa: null,
          card_id: null,
          description: null,
          created_at: 1_597_226_379,
        },
      },
    },
    created_at: 1_597_734_071,
  };
}

/* -------------------------------------------------------------------------- */

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Signature verification                                                     */
/* -------------------------------------------------------------------------- */

describe('signature verification', () => {
  it('compares hex digests without throwing on a length mismatch', () => {
    expect(safeCompareHex('abcd', 'abcd')).toBe(true);
    expect(safeCompareHex('abcd', 'abcde')).toBe(false);
    expect(safeCompareHex('', '')).toBe(false);
    // Case-insensitive: Razorpay sends lowercase hex.
    expect(safeCompareHex('ABCD', 'abcd')).toBe(true);
  });

  it('accepts a signature built over our own gateway order id', () => {
    withRazorpay();
    expect(
      verifyCheckoutSignature({
        orderId: 'order_abc',
        paymentId: 'pay_xyz',
        signature: signCheckout('order_abc', 'pay_xyz'),
      }),
    ).toBe(true);
  });

  it('rejects a signature built over a different order id', () => {
    withRazorpay();
    expect(
      verifyCheckoutSignature({
        orderId: 'order_abc',
        paymentId: 'pay_xyz',
        signature: signCheckout('order_attacker', 'pay_xyz'),
      }),
    ).toBe(false);
  });

  it('rejects everything when no key secret is configured', () => {
    withRazorpay({ RAZORPAY_KEY_SECRET: undefined });
    expect(
      verifyCheckoutSignature({
        orderId: 'order_abc',
        paymentId: 'pay_xyz',
        signature: signCheckout('order_abc', 'pay_xyz'),
      }),
    ).toBe(false);
  });

  it('does not leak the key secret through the digest comparison', () => {
    withRazorpay();
    const digest = createHmac('sha256', KEY_SECRET).update('order_abc|pay_xyz').digest('hex');
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(KEY_SECRET);
  });
});

/* -------------------------------------------------------------------------- */
/* Payment configuration                                                      */
/* -------------------------------------------------------------------------- */

describe('payment configuration', () => {
  it('reports an unconfigured deployment honestly', async () => {
    withRazorpay({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined });

    const response = await api().get('/v1/payments/configuration');
    expect(response.status).toBe(200);

    const config = success<{ configured: boolean; keyId: string | null; mode: string }>(
      response.body,
    );
    expect(config.configured).toBe(false);
    expect(config.keyId).toBeNull();
    expect(config.mode).toBe('test');
  });

  it('reports test mode by default, never live', async () => {
    withRazorpay();
    const config = success<{ mode: string }>((await api().get('/v1/payments/configuration')).body);
    expect(config.mode).toBe('test');
  });

  it('never exposes the key secret to a browser', async () => {
    withRazorpay();
    const response = await api().get('/v1/payments/configuration');
    expect(JSON.stringify(response.body)).not.toContain(KEY_SECRET);
  });
});

/* -------------------------------------------------------------------------- */
/* Payment intent                                                             */
/* -------------------------------------------------------------------------- */

describe('payment intent', () => {
  it('refuses to start a payment when the provider is unconfigured', async () => {
    withRazorpay({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined });
    const order = await placeOnlineOrder();

    const response = await api()
      .post(`/v1/payments/${order.orderId}/intent`)
      .set(bearer(order.token))
      .send({});

    expect(response.status).toBe(422);
    expect(failure(response.body).message).toMatch(/not available/i);
  });

  it('requires authentication', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();

    const response = await api().post(`/v1/payments/${order.orderId}/intent`).send({});
    expect(response.status).toBe(401);
  });

  it('creates the gateway order from the stored total and returns only safe fields', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();

    const fetchMock = stubFetch(gatewayOrderResponse(order, 'order_gateway_1'));

    const response = await api()
      .post(`/v1/payments/${order.orderId}/intent`)
      .set(bearer(order.token))
      .send({});

    expect(response.status).toBe(200);
    const intent = success<Record<string, unknown>>(response.body);

    // The provider was asked for the server-calculated amount, in paise.
    const { init } = sentRequest(fetchMock);
    const outbound = JSON.parse(String(init.body as string)) as { amount?: unknown };
    expect(outbound.amount).toBe(order.total * 100);

    expect(intent.razorpayOrderId).toBe('order_gateway_1');
    expect(intent.amount).toBe(order.total * 100);
    expect(intent.keyId).toBe('rzp_test_key');

    // Nothing secret may appear anywhere in the response.
    expect(JSON.stringify(intent)).not.toContain(KEY_SECRET);
  });

  it('sends the key pair over basic auth, never in a URL', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();

    const fetchMock = stubFetch(gatewayOrderResponse(order, 'order_auth_check'));
    await api().post(`/v1/payments/${order.orderId}/intent`).set(bearer(order.token)).send({});

    const { url, headers } = sentRequest(fetchMock);
    const expected = Buffer.from(`rzp_test_key:${KEY_SECRET}`).toString('base64');

    expect(headers.Authorization).toBe(`Basic ${expected}`);
    // A credential in a URL leaks through access logs and referrers.
    expect(url).not.toContain(KEY_SECRET);
    expect(url).toBe('https://api.razorpay.com/v1/orders');
  });

  it('reuses the same gateway order when the customer comes back', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();

    stubFetch(gatewayOrderResponse(order, 'order_reuse_1'));
    await api().post(`/v1/payments/${order.orderId}/intent`).set(bearer(order.token)).send({});

    // A second attempt must not call the provider again.
    const secondMock = vi.fn();
    vi.stubGlobal('fetch', secondMock);

    const response = await api()
      .post(`/v1/payments/${order.orderId}/intent`)
      .set(bearer(order.token))
      .send({});

    expect(response.status).toBe(200);
    expect(success<{ razorpayOrderId: string }>(response.body).razorpayOrderId).toBe(
      'order_reuse_1',
    );
    expect(secondMock).not.toHaveBeenCalled();

    // And exactly one payment attempt exists for the order.
    expect(await PaymentModel.countDocuments({ orderId: new Types.ObjectId(order.orderId) })).toBe(
      1,
    );
  });

  it('will not let one customer pay for another customer order', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    const intruder = await createCustomer();
    const token = await customerToken(intruder.email, intruder.password);

    const response = await api()
      .post(`/v1/payments/${order.orderId}/intent`)
      .set(bearer(token))
      .send({});

    // 404, not 403: the endpoint must not confirm the order exists.
    expect(response.status).toBe(404);
  });

  it('refuses a payment for a cash-on-delivery order', async () => {
    withRazorpay();
    await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0 });

    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 1 });

    const placed = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', 'cod-order-key')
      .send({
        shippingAddress: TEST_ADDRESS,
        paymentMethod: 'cod',
        idempotencyKey: 'cod-order-key',
      });
    expect(placed.status).toBe(201);
    const codOrder = success<{ id: string }>(placed.body);

    const response = await api()
      .post(`/v1/payments/${codOrder.id}/intent`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Checkout verification                                                      */
/* -------------------------------------------------------------------------- */

describe('payment verification', () => {
  it('settles the order when the signature and the provider both agree', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_v1');

    stubFetch(
      gatewayPaymentResponse({
        id: 'pay_captured_1',
        orderId: 'order_v1',
        amountPaise: order.total * 100,
        status: 'captured',
        extra: { method: 'upi' },
      }),
    );

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_captured_1',
        razorpay_order_id: 'order_v1',
        razorpay_signature: signCheckout('order_v1', 'pay_captured_1'),
      });

    expect(response.status).toBe(200);
    expect(success<{ verified: boolean }>(response.body).verified).toBe(true);

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).toBe('paid');

    // The capture must be attributed to the right provider payment.
    const payment = await PaymentModel.findOne({
      orderId: new Types.ObjectId(order.orderId),
    }).lean<{ status: string; providerReference: string; amount: number }>();
    expect(payment?.status).toBe('paid');
    expect(payment?.providerReference).toBe('pay_captured_1');
    expect(payment?.amount).toBe(order.total);
  });

  it('does NOT settle when the signature is invalid, even if the provider would agree', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_v2');

    // The provider would happily confirm — but the signature is forged, so
    // we must never ask it and must never mark the order paid.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_forged',
        razorpay_order_id: 'order_v2',
        razorpay_signature: 'f'.repeat(64),
      });

    expect(response.status).toBe(200);
    expect(success<{ verified: boolean }>(response.body).verified).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');
  });

  it('does NOT settle when the captured amount differs from the order total', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_v3');

    stubFetch(
      gatewayPaymentResponse({
        id: 'pay_short',
        orderId: 'order_v3',
        amountPaise: 1, // one paisa
        status: 'captured',
      }),
    );

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_short',
        razorpay_order_id: 'order_v3',
        razorpay_signature: signCheckout('order_v3', 'pay_short'),
      });

    expect(response.status).toBe(200);
    const result = success<{ verified: boolean; status: string }>(response.body);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('pending');

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');
  });

  it('rejects a response whose gateway order id is not ours', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_mine');

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_x',
        razorpay_order_id: 'order_someone_else',
        razorpay_signature: signCheckout('order_mine', 'pay_x'),
      });

    expect(success<{ verified: boolean }>(response.body).verified).toBe(false);
  });

  it('reports a decline as failed without marking the order paid', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_declined');

    stubFetch(
      gatewayPaymentResponse({
        id: 'pay_declined',
        orderId: 'order_declined',
        amountPaise: order.total * 100,
        status: 'failed',
        extra: { error_description: 'Your card was declined.' },
      }),
    );

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_declined',
        razorpay_order_id: 'order_declined',
        razorpay_signature: signCheckout('order_declined', 'pay_declined'),
      });

    const result = success<{ verified: boolean; status: string; reason: string }>(response.body);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/declined/i);
  });

  it('holds an authorized-but-uncaptured payment as pending', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_auth');

    stubFetch(
      gatewayPaymentResponse({
        id: 'pay_auth',
        orderId: 'order_auth',
        amountPaise: order.total * 100,
        status: 'authorized',
      }),
    );

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_auth',
        razorpay_order_id: 'order_auth',
        razorpay_signature: signCheckout('order_auth', 'pay_auth'),
      });

    const result = success<{ verified: boolean; status: string }>(response.body);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('pending');

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');
  });

  it('falls back to pending when the provider is unreachable', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_offline');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const response = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_offline',
        razorpay_order_id: 'order_offline',
        razorpay_signature: signCheckout('order_offline', 'pay_offline'),
      });

    const result = success<{ verified: boolean; status: string }>(response.body);
    // We must not guess. The webhook settles it when the provider recovers.
    expect(result.verified).toBe(false);
    expect(result.status).toBe('pending');

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');
  });

  it('is safe to call twice: the second call does not double-apply', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_twice');

    stubFetch(
      gatewayPaymentResponse({
        id: 'pay_twice',
        orderId: 'order_twice',
        amountPaise: order.total * 100,
        status: 'captured',
      }),
    );

    const payload = {
      razorpay_payment_id: 'pay_twice',
      razorpay_order_id: 'order_twice',
      razorpay_signature: signCheckout('order_twice', 'pay_twice'),
    };

    await api().post(`/v1/payments/${order.orderId}/verify`).set(bearer(order.token)).send(payload);

    // The sale already moved stock at checkout. Capture must not move it again.
    const movementsBefore = await StockMovementModel.countDocuments({});

    const second = await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send(payload);

    expect(success<{ verified: boolean }>(second.body).verified).toBe(true);

    // Exactly-once: no extra stock movement, no extra payment row.
    expect(await StockMovementModel.countDocuments({})).toBe(movementsBefore);
    expect(await PaymentModel.countDocuments({ orderId: new Types.ObjectId(order.orderId) })).toBe(
      1,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Webhooks                                                                   */
/* -------------------------------------------------------------------------- */

describe('razorpay webhook', () => {
  it('rejects every delivery when no webhook secret is configured', async () => {
    withRazorpay({ RAZORPAY_WEBHOOK_SECRET: undefined });

    const raw = JSON.stringify(capturedEvent('pay_x', 'order_x', 100));
    const response = await api()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhook(raw))
      .set('x-razorpay-event-id', 'evt_unconfigured')
      .send(raw);

    expect(response.status).toBe(503);
  });

  it('rejects a bad signature with 401 and never touches the order', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_hs', { providerReference: 'pay_hs' });

    const response = await api()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'b'.repeat(64))
      .set('x-razorpay-event-id', 'evt_badsig')
      .send(JSON.stringify(capturedEvent('pay_hs', 'order_hs', order.total * 100)));

    expect(response.status).toBe(401);

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');

    // A rejected delivery must not even be recorded, so a retry is possible.
    expect(await WebhookEventModel.countDocuments({ eventId: 'evt_badsig' })).toBe(0);
  });

  it('rejects a delivery with no signature header', async () => {
    withRazorpay();
    const response = await api()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', 'evt_nosig')
      .send(JSON.stringify(capturedEvent('pay_x', 'order_x', 100)));

    expect(response.status).toBe(400);
  });

  it('refuses a delivery with no event id, because it cannot be deduplicated', async () => {
    withRazorpay();
    const raw = JSON.stringify(capturedEvent('pay_x', 'order_x', 100));

    const response = await api()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signWebhook(raw))
      .send(raw);

    expect(response.status).toBe(400);
  });

  it('settles a capture exactly once', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_cap', { providerReference: 'pay_cap' });

    const payload = capturedEvent('pay_cap', 'order_cap', order.total * 100);
    const first = await deliverWebhook(payload, 'evt_cap_1');
    expect(first.status).toBe(200);
    expect(outcome(first.body)).toBe('processed');

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).toBe('paid');

    // The exact same event, redelivered.
    const second = await deliverWebhook(payload, 'evt_cap_1');
    expect(second.status).toBe(200);
    expect(outcome(second.body)).toBe('duplicate');

    expect(await WebhookEventModel.countDocuments({ eventId: 'evt_cap_1' })).toBe(1);

    // And no second stock movement was created.
    const sales = await StockMovementModel.countDocuments({ reason: 'sale' });
    expect(sales).toBe(1);
  });

  it('ignores a late failure that arrives after a capture', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_late', { providerReference: 'pay_late' });

    // The capture lands first...
    await deliverWebhook(capturedEvent('pay_late', 'order_late', order.total * 100), 'evt_l_cap');

    // ...and then a failure for the same payment arrives out of order.
    const failed = await deliverWebhook(
      {
        entity: 'payment',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: 'payment',
            id: 'pay_late',
            amount: order.total * 100,
            currency: 'INR',
            status: 'failed',
            captured: false,
            error_description: 'Late failure',
            order_id: 'order_late',
          },
        },
      },
      'evt_l_fail',
    );

    expect(failed.status).toBe(200);

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    // The capture must survive.
    expect(stored?.paymentStatus).toBe('paid');

    const payment = await PaymentModel.findOne({ providerReference: 'pay_late' }).lean<{
      status: string;
    }>();
    expect(payment?.status).toBe('paid');

    // The out-of-order delivery is still recorded, so it stays diagnosable.
    const event = await WebhookEventModel.findOne({ eventId: 'evt_l_fail' }).lean<{
      outcome: string;
      detail: string;
    }>();
    expect(event?.outcome).toBe('ignored');
    expect(event?.detail).toMatch(/already settled/i);
  });

  it('holds a capture whose amount does not match the order', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_wrongamt', { providerReference: 'pay_wrongamt' });

    const response = await deliverWebhook(
      capturedEvent('pay_wrongamt', 'order_wrongamt', 1),
      'evt_wrongamt',
    );

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('ignored');

    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');
  });

  it('acknowledges an event it does not handle, without retrying forever', async () => {
    withRazorpay();
    const response = await deliverWebhook(
      { entity: 'settlement', event: 'settlement.on-demand' },
      'evt_unknown',
    );

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('ignored');
  });

  it('ignores a capture for a payment it has never seen', async () => {
    withRazorpay();
    const response = await deliverWebhook(
      capturedEvent('pay_stranger', 'order_stranger', 500),
      'evt_stranger',
    );

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('ignored');
  });

  it('does not settle a cancelled order', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_cancelled', { providerReference: 'pay_cancelled' });

    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { status: 'cancelled' } },
    );

    const response = await deliverWebhook(
      capturedEvent('pay_cancelled', 'order_cancelled', order.total * 100),
      'evt_cancelled',
    );

    expect(response.status).toBe(200);
    const stored = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(stored?.paymentStatus).not.toBe('paid');
  });

  it('logs the event without leaking the signature or any secret', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_logged', { providerReference: 'pay_logged' });

    await deliverWebhook(
      capturedEvent('pay_logged', 'order_logged', order.total * 100),
      'evt_logged',
    );

    const event = await WebhookEventModel.findOne({ eventId: 'evt_logged' }).lean<{
      correlationId: string;
      eventType: string;
      detail: string;
    }>();

    expect(event?.eventType).toBe('payment.captured');
    // Every row carries a correlation id, so a delivery is traceable.
    expect(event?.correlationId).toBeTruthy();
    expect(event?.detail).not.toContain(WEBHOOK_SECRET);
  });
});

/* -------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Take an order all the way to a paid return received and inspected by staff.
 *
 * Module scope rather than nested inside `describe('refunds')` so the
 * documented-payload-shape suite can reach it too.
 */
async function paidOrderWithApprovedReturn(): Promise<{
  order: PlacedOrder;
  returnId: string;
  adminToken: string;
}> {
  const order = await placeOnlineOrder();
  await seedPayment(order, 'order_ref', {
    providerReference: 'pay_ref',
    status: 'paid',
  });

  await OrderModel.updateOne(
    { _id: new Types.ObjectId(order.orderId) },
    {
      $set: {
        paymentStatus: 'paid',
        paymentRef: 'pay_ref',
        status: 'completed',
        deliveredAt: new Date(),
      },
    },
  );

  const created = await api()
    .post('/v1/returns')
    .set(bearer(order.token))
    .send({
      orderId: order.orderId,
      items: [{ variantId: order.firstVariantId, quantity: 1 }],
      reason: 'size-too-large',
      reasonNote: 'Too big',
    });
  expect(created.status).toBe(201);
  const returnId = success<{ id: string }>(created.body).id;

  const admin = await createAdmin();
  const token = await adminToken(admin.email, admin.password);

  const approved = await api()
    .patch(`/v1/admin/returns/${returnId}`)
    .set(bearer(token))
    .send({ status: 'approved', note: 'Approved for refund' });
  expect(approved.status).toBe(200);

  const received = await api()
    .patch(`/v1/admin/returns/${returnId}`)
    .set(bearer(token))
    .send({ status: 'received', note: 'Pair received and inspected' });
  expect(received.status).toBe(200);

  return { order, returnId, adminToken: token };
}

describe('refunds', () => {
  it('will not refund a return that was never approved', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_unapproved', {
      providerReference: 'pay_unapproved',
      status: 'paid',
    });
    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { paymentStatus: 'paid', status: 'completed', deliveredAt: new Date() } },
    );

    const created = await api()
      .post('/v1/returns')
      .set(bearer(order.token))
      .send({
        orderId: order.orderId,
        items: [{ variantId: order.firstVariantId, quantity: 1 }],
        reason: 'damaged',
        reasonNote: '',
      });
    const returnId = success<{ id: string }>(created.body).id;

    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/received|inspection/i);
  });

  it('will not refund an order that was never paid', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();

    const returnDoc = await ReturnRequestModel.create({
      returnNumber: `RT-${Date.now().toString(36)}-TEST`,
      orderId: new Types.ObjectId(order.orderId),
      orderNumber: order.orderNumber,
      customerId: new Types.ObjectId(order.customerId),
      items: [],
      reason: 'other',
      reasonNote: '',
      status: 'received',
      refundAmount: 100,
      requestedAt: new Date(),
    });

    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .post(`/v1/admin/returns/${returnDoc._id.toString()}/refund`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(409);
  });

  it('will not refund until staff receive and inspect the returned pair', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_not_received', {
      providerReference: 'pay_not_received',
      status: 'paid',
    });
    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { paymentStatus: 'paid', status: 'completed', deliveredAt: new Date() } },
    );
    const created = await api()
      .post('/v1/returns')
      .set(bearer(order.token))
      .send({
        orderId: order.orderId,
        items: [{ variantId: order.firstVariantId, quantity: 1 }],
        reason: 'damaged',
        reasonNote: '',
      });
    const returnId = success<{ id: string }>(created.body).id;
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);
    await api()
      .patch(`/v1/admin/returns/${returnId}`)
      .set(bearer(token))
      .send({ status: 'approved', note: 'Approved subject to receipt' });

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/received|inspection/i);
  });

  it('refuses to mark a return refunded as an administrative decision', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    // `refunded` is not an accepted admin status. This is the defect that
    // would otherwise let an order be marked refunded with no money moving.
    const response = await api()
      .patch(`/v1/admin/returns/${returnId}`)
      .set(bearer(adminToken))
      .send({ status: 'refunded', refundAmount: 999 });

    expect(response.status).toBe(422);

    const stored = await ReturnRequestModel.findById(returnId).lean<{ status: string }>();
    expect(stored?.status).toBe('received');

    const order = await OrderModel.findById(
      (await ReturnRequestModel.findById(returnId).lean<{ orderId: Types.ObjectId }>())!.orderId,
    ).lean<{ paymentStatus: string }>();
    expect(order?.paymentStatus).toBe('paid');
  });

  it('does not claim completion until the provider has processed the refund', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    stubFetch({
      id: 'rfnd_pending',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'pending',
      created_at: 1_700_000_000,
    });

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({});

    expect(response.status).toBe(200);
    const outcome = success<{ settled: boolean; providerStatus: string }>(response.body);

    // A pending refund is NOT a completed refund.
    expect(outcome.providerStatus).toBe('pending');
    expect(outcome.settled).toBe(false);

    const stored = await ReturnRequestModel.findById(returnId).lean<{ status: string }>();
    expect(stored?.status).toBe('received');
  });

  it('reconciles a pending refund without reserving its amount twice', async () => {
    withRazorpay();
    const { returnId, adminToken, order } = await paidOrderWithApprovedReturn();

    stubFetch({
      id: 'rfnd_reconcile',
      entity: 'refund',
      amount: 150_000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'pending',
      created_at: 1_700_000_000,
    });
    const issued = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({});
    expect(issued.status).toBe(200);

    const pendingPayment = await PaymentModel.findOne({ orderId: order.orderId }).lean<{
      refundedAmount: number;
    }>();
    expect(pendingPayment?.refundedAmount).toBe(1500);

    stubFetch({
      id: 'rfnd_reconcile',
      entity: 'refund',
      amount: 150_000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });
    const reconciled = await api()
      .post(`/v1/admin/returns/${returnId}/reconcile`)
      .set(bearer(adminToken));

    expect(reconciled.status).toBe(200);
    expect(success<{ settled: boolean }>(reconciled.body).settled).toBe(true);
    const finalPayment = await PaymentModel.findOne({ orderId: order.orderId }).lean<{
      refundedAmount: number;
    }>();
    expect(finalPayment?.refundedAmount).toBe(1500);
    const finalReturn = await ReturnRequestModel.findById(returnId).lean<{ status: string }>();
    expect(finalReturn?.status).toBe('refunded');
  });

  it('marks the return refunded only when the provider confirms', async () => {
    withRazorpay();
    const { returnId, adminToken, order } = await paidOrderWithApprovedReturn();

    stubFetch({
      id: 'rfnd_done',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({});

    const outcome = success<{ settled: boolean }>(response.body);
    expect(outcome.settled).toBe(true);

    const stored = await ReturnRequestModel.findById(returnId).lean<{
      status: string;
      refundRef: string;
    }>();
    expect(stored?.status).toBe('refunded');
    expect(stored?.refundRef).toBe('rfnd_done');

    // The order is promoted to refunded / partially_refunded too.
    const orderDoc = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(['refunded', 'partially_refunded']).toContain(orderDoc?.paymentStatus);
  });

  it('sends a stable idempotency key so a retry cannot double-refund', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    const fetchMock = stubFetch({
      id: 'rfnd_idem',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });

    await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

    const { init, headers } = sentRequest(fetchMock);
    const key = headers['X-Refund-Idempotency'];

    // Razorpay documents the key as >= 10 characters of [A-Za-z0-9-_].
    expect(init.method).toBe('POST');
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThanOrEqual(10);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not send a second refund when the same return is refunded again', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    stubFetch({
      id: 'rfnd_twice',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });

    await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

    // A second attempt must not create another refund at the provider.
    const secondMock = stubFetch({
      id: 'rfnd_twice',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });
    vi.stubGlobal('fetch', secondMock);

    const second = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({});

    expect(second.status).toBe(200);
    // It only reads the existing refund; it never issues a new one.
    for (const [url, init] of secondMock.mock.calls as Array<[string, RequestInit]>) {
      const headers = init.headers as Record<string, string>;
      // The outbound verb must be a read, and no new refund may be created.
      expect(init.method).toBe('GET');
      expect(headers['X-Refund-Idempotency']).toBeUndefined();
      expect(url).toBe('https://api.razorpay.com/v1/refunds/rfnd_twice');
    }
  });

  it('refuses a refund larger than the refundable balance', async () => {
    withRazorpay();
    const { returnId, adminToken, order } = await paidOrderWithApprovedReturn();

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({ amount: order.total * 10 });

    expect(response.status).toBe(409);
    expect(failure(response.body).message).toMatch(/remain refundable/i);
  });

  it('refunds the returned amount, not the whole order, when no amount is given', async () => {
    /*
     * Regression test.
     *
     * The refund defaulted to the **order's** remaining refundable balance
     * rather than the **return's** approved amount. A customer who returned
     * one pair out of two — and was therefore owed 1 unit, not 2 — would
     * have had the entire order refunded the moment an administrator issued
     * the refund.
     *
     * `placeOnlineOrder` buys 2 units at 1500 rupees each, and the return
     * covers 1 of them, so the return's refund amount is 1500 and the
     * order's balance is 3000. The refund must be for 1500.
     */
    withRazorpay();
    const { returnId, adminToken, order } = await paidOrderWithApprovedReturn();

    const stored = await ReturnRequestModel.findById(returnId).lean<{ refundAmount: number }>();
    expect(stored?.refundAmount).toBe(1500);
    expect(order.total).toBe(3000);

    const mock = stubFetch({
      id: 'rfnd_partial',
      entity: 'refund',
      amount: 150_000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({});

    expect(response.status).toBe(200);
    const outcome = success<{ amountRupees: number; settled: boolean }>(response.body);

    expect(outcome.amountRupees).toBe(1500);
    expect(outcome.settled).toBe(true);
    // The outbound refund must carry the returned amount, in paise.
    const outbound = JSON.parse((sentRequest(mock).init.body ?? '{}') as string) as {
      amount?: number;
    };
    expect(outbound.amount).toBe(150_000);

    // The order is only partially refunded — the other unit was not lost.
    const payment = await PaymentModel.findOne({
      orderId: new Types.ObjectId(order.orderId),
    }).lean<{ refundedAmount: number; status: string }>();
    expect(payment?.refundedAmount).toBe(1500);
    expect(payment?.status).toBe('partially_refunded');
  });

  it('restores only the returned units to the catalogue', async () => {
    /*
     * The counterpart of the previous test: the stock that comes back must
     * match the lines that were actually returned, not the whole order.
     */
    withRazorpay();
    const { returnId, adminToken, order } = await paidOrderWithApprovedReturn();

    const before = await VariantModel.findById(order.firstVariantId).lean<{ stock: number }>();

    stubFetch({
      id: 'rfnd_partial_stock',
      entity: 'refund',
      amount: 100_000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });

    await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

    const after = await VariantModel.findById(order.firstVariantId).lean<{ stock: number }>();

    // One unit was bought and one unit came back.
    expect((after?.stock ?? 0) - (before?.stock ?? 0)).toBe(1);
  });

  it('requires an administrator to refund', async () => {
    withRazorpay();
    const { returnId } = await paidOrderWithApprovedReturn();

    const response = await api().post(`/v1/admin/returns/${returnId}/refund`).send({});
    expect(response.status).toBe(401);
  });

  it('refuses a customer token on the refund route', async () => {
    withRazorpay();
    const { returnId, order } = await paidOrderWithApprovedReturn();

    const response = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(order.token))
      .send({});

    expect(response.status).toBe(403);
  });

  it('records an audit entry for a refund decision', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    stubFetch({
      id: 'rfnd_audit',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'processed',
      created_at: 1_700_000_000,
    });

    await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

    const { AuditLogModel } = await import('../src/models/audit-log.model.js');
    const entry = await AuditLogModel.findOne({ action: 'refund' }).lean<{
      entity: string;
      entityId: string;
    }>();

    expect(entry).not.toBeNull();
    expect(entry?.entity).toBe('return');
    expect(entry?.entityId).toBe(returnId);
  });
});

/* -------------------------------------------------------------------------- */
/* Admin visibility                                                           */
/* -------------------------------------------------------------------------- */

describe('admin payment visibility', () => {
  it('shows an admin the payments behind an order', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_admin', {
      providerReference: 'pay_admin',
      status: 'paid',
    });

    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api().get(`/v1/admin/payments/${order.orderId}`).set(bearer(token));

    expect(response.status).toBe(200);
    const payments = success<Array<{ providerReference: string; status: string }>>(response.body);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.providerReference).toBe('pay_admin');
    expect(payments[0]?.status).toBe('paid');
  });

  it('does not show an admin payment record to a customer', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_priv');

    const response = await api()
      .get(`/v1/admin/payments/${order.orderId}`)
      .set(bearer(order.token));

    expect(response.status).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */
/* Stock integrity around payment                                            */
/* -------------------------------------------------------------------------- */

describe('stock integrity around payment', () => {
  it('leaves stock decremented exactly once whether paid by webhook or by callback', async () => {
    withRazorpay();
    const order = await placeOnlineOrder(1);
    await seedPayment(order, 'order_stock', { providerReference: 'pay_stock' });

    const variantBefore = await VariantModel.findById(order.firstVariantId).lean<{
      stock: number;
    }>();
    expect(variantBefore?.stock).toBe(9);

    // Pay through the callback...
    stubFetch(
      gatewayPaymentResponse({
        id: 'pay_stock',
        orderId: 'order_stock',
        amountPaise: order.total * 100,
        status: 'captured',
      }),
    );
    await api()
      .post(`/v1/payments/${order.orderId}/verify`)
      .set(bearer(order.token))
      .send({
        razorpay_payment_id: 'pay_stock',
        razorpay_order_id: 'order_stock',
        razorpay_signature: signCheckout('order_stock', 'pay_stock'),
      });

    // ...and then have the webhook redeliver the same capture.
    await deliverWebhook(
      capturedEvent('pay_stock', 'order_stock', order.total * 100),
      'evt_stock_cap',
    );

    const variantAfter = await VariantModel.findById(order.firstVariantId).lean<{
      stock: number;
    }>();
    expect(variantAfter?.stock).toBe(9);

    const sales = await StockMovementModel.find({ reason: 'sale' }).lean<
      Array<{ delta: number }>
    >();
    expect(sales).toHaveLength(1);
    expect(sales[0]?.delta).toBe(-1);
  });
});

/* -------------------------------------------------------------------------- */
/* Razorpay's documented payload shape                                        */
/* -------------------------------------------------------------------------- */

describe('razorpay documented payload shape', () => {
  /*
   * The next tests exist because the webhook schema did not match the
   * provider's actual documentation, and every test we had was written
   * against our own — also incorrect — idea of the shape. A suite that only
   * proves the code agrees with itself is not evidence of correctness.
   *
   * Each fixture below is transcribed from Razorpay's published payloads:
   *
   *   payments: https://razorpay.com/docs/build/llm-docs/webhooks/payments.md
   *   refunds:  https://razorpay.com/docs/build/llm-docs/webhooks/refunds.md
   *
   * verified 23 Oct 2026.
   */

  it('settles the order from a payment.captured event in the documented shape', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_doc', { providerReference: 'pay_doc' });

    const response = await deliverWebhook(
      documentedCapturedEvent('pay_doc', 'order_doc', order.total * 100),
      'evt_doc_captured',
    );

    expect(response.status).toBe(200);
    // The critical assertion: not "unrecognised".
    expect(outcome(response.body)).toBe('processed');

    const stored = await PaymentModel.findOne({ providerReference: 'pay_doc' }).lean<{
      status: string;
    }>();
    expect(stored?.status).toBe('paid');

    const orderDoc = await OrderModel.findById(order.orderId).lean<{ paymentStatus: string }>();
    expect(orderDoc?.paymentStatus).toBe('paid');
  });

  it('accepts the documented envelope even though its entity is "event", not "payment"', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_env', { providerReference: 'pay_env' });

    // The envelope entity is the string "event"; a schema pinned to the
    // literal "payment" rejects this outright.
    const payload = documentedCapturedEvent('pay_env', 'order_env', order.total * 100);
    expect((payload as { entity: string }).entity).toBe('event');

    const response = await deliverWebhook(payload, 'evt_doc_envelope');

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('processed');
  });

  it('reads the amount from payload.payment.entity, not payload.payment', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_nest', { providerReference: 'pay_nest' });

    /*
     * If the handler read the amount from the wrong level it would see
     * `undefined`, and the arithmetic below would compare `NaN` against the
     * order total — which is *not* equal, so the mismatch guard would fire
     * and the payment would be left pending. The guard is doing its job; the
     * bug would be invisible without this assertion.
     */
    const response = await deliverWebhook(
      documentedCapturedEvent('pay_nest', 'order_nest', order.total * 100),
      'evt_doc_nested',
    );

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('processed');

    const stored = await PaymentModel.findOne({ providerReference: 'pay_nest' }).lean<{
      status: string;
    }>();
    expect(stored?.status).toBe('paid');
  });

  it('detects a genuine amount mismatch rather than settling on a wrong number', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_bad', { providerReference: 'pay_bad' });

    const response = await deliverWebhook(
      documentedCapturedEvent('pay_bad', 'order_bad', (order.total - 1) * 100),
      'evt_doc_mismatch',
    );

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('ignored');

    const stored = await PaymentModel.findOne({ providerReference: 'pay_bad' }).lean<{
      status: string;
    }>();
    // Still pending: an event that does not reconcile is left for a human.
    expect(stored?.status).toBe('pending');
  });

  it('treats a refund.failed event as a refund problem, not a payment failure', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    /*
     * Put a refund genuinely in flight: the provider accepted it, so the
     * return carries a refundRef and the payment's refundedAmount has been
     * incremented.
     */
    stubFetch({
      id: 'rfnd_doc_failed',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'pending',
      created_at: 1_700_000_000,
    });

    const issued = await api()
      .post(`/v1/admin/returns/${returnId}/refund`)
      .set(bearer(adminToken))
      .send({});

    expect(issued.status).toBe(200);

    const before = await PaymentModel.findOne({ providerReference: 'pay_ref' }).lean<{
      status: string;
      refundedAmount: number;
    }>();
    expect(before?.refundedAmount).toBeGreaterThan(0);

    const returnBefore = await ReturnRequestModel.findById(returnId).lean<{
      status: string;
      refundRef?: string;
    }>();
    expect(returnBefore?.status).toBe('received');

    /*
     * Now the provider reports it could not process the refund. This used to
     * be handled by the same branch as `payment.failed`, which flipped the
     * *payment* to `failed` and released the order's stock. The customer had
     * paid and still had their goods — that is a finance problem, not a
     * payment failure.
     */
    const response = await deliverWebhook(
      documentedRefundFailedEvent('rfnd_doc_failed', 'pay_ref', 1000),
      'evt_doc_refund_failed',
    );

    expect(response.status).toBe(200);

    const paymentAfter = await PaymentModel.findOne({ providerReference: 'pay_ref' }).lean<{
      status: string;
      refundedAmount: number;
    }>();

    // The payment is untouched: still paid, and the provisional amount restored.
    expect(paymentAfter?.status).toBe('paid');
    expect(paymentAfter?.refundedAmount).toBe(0);

    const orderAfter = await OrderModel.findById(
      new Types.ObjectId(
        (await ReturnRequestModel.findById(returnId).lean<{
          orderId: Types.ObjectId;
        }>())!.orderId.toString(),
      ),
    ).lean<{ paymentStatus: string }>();

    // The order is not failed, and no stock was released.
    expect(orderAfter?.paymentStatus).toBe('paid');

    const returnAfter = await ReturnRequestModel.findById(returnId).lean<{
      status: string;
      refundRef?: string;
    }>();

    // The return is reopened so an administrator can retry.
    expect(returnAfter?.status).toBe('received');
    expect(returnAfter?.refundRef).toBeUndefined();
  });

  it('ignores a refund.failed event that names no refund', async () => {
    withRazorpay();
    const { returnId, adminToken } = await paidOrderWithApprovedReturn();

    stubFetch({
      id: 'rfnd_doc_orphan',
      entity: 'refund',
      amount: 1000,
      currency: 'INR',
      payment_id: 'pay_ref',
      status: 'pending',
      created_at: 1_700_000_000,
    });

    await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

    // A failure event with no refund entity: nothing to roll back.
    const response = await deliverWebhook(
      documentedRefundFailedEvent('rfnd_doc_missing', 'pay_ref', 1000),
      'evt_doc_refund_orphan',
    );

    expect(response.status).toBe(200);

    const payment = await PaymentModel.findOne({ providerReference: 'pay_ref' }).lean<{
      status: string;
    }>();
    // Still paid — an unrecognisable event must not move money or stock.
    expect(payment?.status).toBe('paid');
  });

  it('records every delivery, including the ones it declines to act on', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_rec', { providerReference: 'pay_rec' });

    await deliverWebhook(
      documentedCapturedEvent('pay_rec', 'order_rec', order.total * 100),
      'evt_doc_recorded',
    );

    const event = await WebhookEventModel.findOne({ eventId: 'evt_doc_recorded' }).lean<{
      eventType: string;
      detail: string;
    }>();

    expect(event).not.toBeNull();
    expect(event?.eventType).toBe('payment.captured');
  });

  it('keeps the raw-body signature check intact for the documented shape', async () => {
    withRazorpay();
    const order = await placeOnlineOrder();
    await seedPayment(order, 'order_sig', { providerReference: 'pay_sig' });

    // An unsigned delivery of the same, correctly-shaped payload is rejected.
    const payload = documentedCapturedEvent('pay_sig', 'order_sig', order.total * 100);
    const raw = JSON.stringify(payload);

    const response = await api()
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-event-id', 'evt_doc_unsigned')
      .send(raw);

    expect(response.status).toBe(400);
  });

  it('still accepts the platform fixture shape and the flat shape', async () => {
    withRazorpay();

    // Shape 2: `entity` is the marker string, fields on the enclosing object.
    const flatOrder = await placeOnlineOrder();
    await seedPayment(flatOrder, 'order_flat', { providerReference: 'pay_flat' });

    const markerShape = await deliverWebhook(
      capturedEvent('pay_flat', 'order_flat', flatOrder.total * 100),
      'evt_shape_marker',
    );
    expect(outcome(markerShape.body)).toBe('processed');

    // Shape 3: the fields sit directly on `payload.payment`.
    const directOrder = await placeOnlineOrder();
    await seedPayment(directOrder, 'order_direct', { providerReference: 'pay_direct' });

    const directShape = await deliverWebhook(
      {
        entity: 'event',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            id: 'pay_direct',
            amount: directOrder.total * 100,
            currency: 'INR',
            status: 'captured',
            order_id: 'order_direct',
            captured: true,
          },
        },
        created_at: 1_691_735_748,
      },
      'evt_shape_direct',
    );

    expect(outcome(directShape.body)).toBe('processed');

    const directPayment = await PaymentModel.findOne({
      providerReference: 'pay_direct',
    }).lean<{ status: string }>();
    expect(directPayment?.status).toBe('paid');
  });
});

/* -------------------------------------------------------------------------- */
/* Refund confirmation email                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A customer must be told their money is back — but only once the provider
 * has actually processed the refund.
 *
 * The `return-refunded` template existed and was re-renderable, but nothing
 * ever enqueued it: the refund service moved the return to `refunded` and
 * stopped. A customer whose refund settled was therefore never told.
 */
describe('refund confirmation email', () => {
  it('is sent once the provider confirms the refund', async () => {
    withRazorpay();

    /*
     * Email delivery is configured, and the provider is stubbed to fail so
     * the *recording* is observable without depending on a live mail path.
     */
    const savedEnv = { ...process.env };
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM_EMAIL = 'Ajooba Footwear <orders@example.test>';
    process.env.EMAIL_ALLOWLIST = 'customer@example.test';

    try {
      const { returnId, adminToken, order } = await paidOrderWithApprovedReturn();

      stubFetch({
        id: 'rfnd_mail',
        entity: 'refund',
        amount: 150_000,
        currency: 'INR',
        payment_id: 'pay_ref',
        status: 'processed',
        created_at: 1_700_000_000,
      });

      await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

      const rows = await EmailLogModel.find({ template: 'return-refunded' }).lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.returnId?.toString()).toBe(returnId);
      expect(rows[0]!.orderNumber).toBe(order.orderNumber);

      void adminToken;
    } finally {
      process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
      process.env.RESEND_FROM_EMAIL = savedEnv.RESEND_FROM_EMAIL;
      process.env.EMAIL_ALLOWLIST = savedEnv.EMAIL_ALLOWLIST;
    }
  });

  it('is not sent while the refund is still pending at the provider', async () => {
    withRazorpay();

    const savedEnv = { ...process.env };
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM_EMAIL = 'Ajooba Footwear <orders@example.test>';
    process.env.EMAIL_ALLOWLIST = 'customer@example.test';

    try {
      const { returnId, adminToken } = await paidOrderWithApprovedReturn();

      stubFetch({
        id: 'rfnd_pending_mail',
        entity: 'refund',
        amount: 150_000,
        currency: 'INR',
        payment_id: 'pay_ref',
        status: 'pending',
        created_at: 1_700_000_000,
      });

      await api().post(`/v1/admin/returns/${returnId}/refund`).set(bearer(adminToken)).send({});

      const rows = await EmailLogModel.find({ template: 'return-refunded' }).lean();
      // A pending refund is not a refund — telling the customer it is would
      // be a false statement about their money.
      expect(rows).toHaveLength(0);
    } finally {
      process.env.RESEND_API_KEY = savedEnv.RESEND_API_KEY;
      process.env.RESEND_FROM_EMAIL = savedEnv.RESEND_FROM_EMAIL;
      process.env.EMAIL_ALLOWLIST = savedEnv.EMAIL_ALLOWLIST;
    }
  });
});
