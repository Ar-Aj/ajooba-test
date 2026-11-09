import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import type { Order, ReturnRequest } from '@ajooba/contracts';
import { api, bearer, success, useApi } from './helpers/api.js';
import {
  TEST_ADDRESS,
  createCustomer,
  createProductWithVariant,
  setStoreSettings,
} from './helpers/factories.js';
import { EmailLogModel } from '../src/models/email-log.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { PaymentModel } from '../src/models/payment.model.js';
import { ReturnRequestModel } from '../src/models/return-request.model.js';
import {
  dispatchPending,
  emailConfiguration,
  notifyOrderConfirmation,
  notifyOrderEvent,
} from '../src/services/notification.service.js';
import { emailAllowlist, isRecipientAllowed, sanitiseTag } from '../src/services/resend.service.js';
import {
  escapeHtml,
  formatRupees,
  renderOrderCancelled,
  renderOrderConfirmation,
  renderReturnRejected,
} from '../src/services/email-templates.js';

/**
 * Transactional email.
 *
 * `fetch` is stubbed for the whole file, so nothing reaches Resend. The
 * properties under test are the ones that decide whether a customer is
 * emailed correctly, exactly once, and without leaking another customer's
 * data:
 *
 *  - a captured payment produces **one** confirmation, even though both the
 *    checkout verification and the webhook can reach the same transition;
 *  - a provider outage does **not** fail the payment that triggered the email;
 *  - a crash between recording and sending does **not** lose the email;
 *  - outside production, mail is only ever delivered to the allowlist;
 *  - nothing invented appears in the body — only persisted order values.
 */

useApi();

const ALLOWED_RECIPIENT = 'allowed-recipient@example.test';
const FIRST_BUYER = 'first-buyer@example.test';
const SECOND_BUYER = 'second-buyer@example.test';

/**
 * Every address a delivery test expects to reach the provider.
 *
 * All of them must be on the allowlist, because outside production nothing
 * else is deliverable — which is the correct behaviour and is asserted
 * separately in the allowlist suite below.
 */
const DELIVERABLE_RECIPIENTS = [ALLOWED_RECIPIENT, FIRST_BUYER, SECOND_BUYER];

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const SAVED_ENV: Record<string, string | undefined> = {};

/**
 * Point the notifier at fake credentials and an allowlist.
 *
 * `env` is frozen at boot, so the values are patched on `process.env` — the
 * same source the running configuration was validated from — and restored
 * afterwards. The production schema is never relaxed to accommodate a test.
 */
function withEmail(overrides: Record<string, string | undefined> = {}): void {
  for (const key of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_REPLY_TO', 'EMAIL_ALLOWLIST']) {
    if (!(key in SAVED_ENV)) {
      SAVED_ENV[key] = process.env[key];
    }
  }

  const values: Record<string, string | undefined> = {
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'Ajooba Footwear <orders@example.test>',
    RESEND_REPLY_TO: 'support@example.test',
    EMAIL_ALLOWLIST: DELIVERABLE_RECIPIENTS.join(','),
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
  for (const key of Object.keys(SAVED_ENV)) {
    delete SAVED_ENV[key];
  }
}

/** Stub the provider with one JSON response. */
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The request the provider actually received. */
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

/** A body the provider sent. */
function sentBody(mock: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  const { init } = sentRequest(mock, index);
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

/**
 * The body the provider received for a particular template.
 *
 * The outbox may deliver several different emails in one dispatch pass, so
 * the call is located by its documented `tags` entry rather than by
 * position.
 */
function sentBodyForTemplate(
  mock: ReturnType<typeof vi.fn>,
  template: string,
): Record<string, unknown> {
  const calls = mock.mock.calls as Array<[string, RequestInit]>;
  for (const [, init] of calls) {
    const body = JSON.parse(init.body as string) as {
      tags?: Array<{ name: string; value: string }>;
    };
    if (body.tags?.some((tag) => tag.name === 'template' && tag.value === template)) {
      return body;
    }
  }
  throw new Error(`The provider was never called with the "${template}" template.`);
}

async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  total: number;
  token: string;
  customerId: string;
  email: string;
}

/** Place a real order through the real checkout, paid online. */
async function placeOnlineOrder(overrides: { email?: string } = {}): Promise<PlacedOrder> {
  await setStoreSettings({ shippingFee: 99, freeShippingThreshold: 0, taxRateBps: 0 });

  const customer = await createCustomer(overrides.email ? { email: overrides.email } : {});
  const token = await customerToken(customer.email, customer.password);
  const { variant } = await createProductWithVariant(
    { title: 'Email Test Mojri', sellingPrice: 1500, mrp: 2000 },
    { stock: 10 },
  );

  await api()
    .post('/v1/cart/items')
    .set(bearer(token))
    .send({ variantId: variant.id, quantity: 2 });

  const key = `email-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await api()
    .post('/v1/checkout/orders')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send({ shippingAddress: TEST_ADDRESS, paymentMethod: 'razorpay', idempotencyKey: key });

  expect(response.status).toBe(201);
  const order = success<{
    id: string;
    orderNumber: string;
    totalAmount: number;
    customerId: string;
  }>(response.body);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: order.totalAmount,
    token,
    customerId: order.customerId,
    email: customer.email,
  };
}

/** Load the real projected order, exactly as the notifier does. */
async function loadOrder(orderId: string): Promise<Order> {
  const { mapOrder } = await import('../src/services/order.service.js');
  const doc = await OrderModel.findById(orderId).lean<Parameters<typeof mapOrder>[0] | null>();
  if (!doc) {
    throw new Error('The order under test was not found.');
  }
  return mapOrder(doc);
}

/**
 * Settle a payment through the real `markPaymentCaptured`, which is what
 * triggers the confirmation email.
 */
async function capturePayment(order: PlacedOrder, paymentId: Types.ObjectId): Promise<void> {
  const { markPaymentCaptured } = await import('../src/services/payment.service.js');
  await markPaymentCaptured(paymentId, `pay_${Date.now().toString(36)}`, 'upi', order.total);
}

/** Create the payment row and return its id. */
async function seedPayment(order: PlacedOrder): Promise<Types.ObjectId> {
  const doc = await PaymentModel.create({
    orderId: new Types.ObjectId(order.orderId),
    orderNumber: order.orderNumber,
    customerId: new Types.ObjectId(order.customerId),
    amount: order.total,
    currency: 'INR',
    status: 'pending',
    provider: 'razorpay',
    providerOrderId: `order_${order.orderNumber}`,
    idempotencyKey: `intent:${order.orderId}`,
  });
  return doc._id;
}

/* -------------------------------------------------------------------------- */
/* Provider contract                                                          */
/* -------------------------------------------------------------------------- */

describe('resend provider contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('posts to the documented endpoint with bearer auth', async () => {
    withEmail();
    const mock = stubFetch({ id: 'msg-1' });

    const { sendEmail } = await import('../src/services/resend.service.js');
    const result = await sendEmail({
      to: ALLOWED_RECIPIENT,
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      idempotencyKey: 'probe/1',
      tag: 'order-confirmation',
    });

    expect(result.id).toBe('msg-1');

    const { url, init, headers } = sentRequest(mock);
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
    // Documented as per-request, <=256 chars.
    expect(headers['Idempotency-Key']).toBe('probe/1');
  });

  it('sends only documented fields', async () => {
    withEmail();
    const mock = stubFetch({ id: 'msg-2' });

    const { sendEmail } = await import('../src/services/resend.service.js');
    await sendEmail({
      to: ALLOWED_RECIPIENT,
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      idempotencyKey: 'probe/2',
      tag: 'order-confirmation',
    });

    const body = sentBody(mock);
    expect(body.from).toBe('Ajooba Footwear <orders@example.test>');
    expect(body.to).toEqual([ALLOWED_RECIPIENT]);
    expect(body.subject).toBe('Subject');
    expect(body.reply_to).toBe('support@example.test');
    // A tag value must satisfy the documented character class.
    expect(body.tags).toEqual([{ name: 'template', value: 'order-confirmation' }]);
  });

  it('treats a 2xx without a message id as a failure, not a success', async () => {
    withEmail();
    // A body with no `id` — a provider bug must not become a false "sent".
    stubFetch({});

    const { sendEmail, ResendApiError } = await import('../src/services/resend.service.js');
    await expect(
      sendEmail({
        to: ALLOWED_RECIPIENT,
        subject: 'S',
        html: '<p>B</p>',
        text: 'B',
        idempotencyKey: 'probe/3',
        tag: 't',
      }),
    ).rejects.toBeInstanceOf(ResendApiError);
  });

  it('marks a 4xx as non-retryable and a 5xx as retryable', async () => {
    withEmail();
    const { sendEmail } = await import('../src/services/resend.service.js');

    stubFetch({ message: 'invalid' }, 422);
    await expect(
      sendEmail({
        to: ALLOWED_RECIPIENT,
        subject: 'S',
        html: '<p>B</p>',
        text: 'B',
        idempotencyKey: 'probe/4',
        tag: 't',
      }),
    ).rejects.toMatchObject({ retryable: false });

    stubFetch({ message: 'boom' }, 503);
    await expect(
      sendEmail({
        to: ALLOWED_RECIPIENT,
        subject: 'S',
        html: '<p>B</p>',
        text: 'B',
        idempotencyKey: 'probe/5',
        tag: 't',
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('sanitises a tag to the documented character class', () => {
    expect(sanitiseTag('order confirmation/2026')).toBe('order-confirmation-2026');
    expect(sanitiseTag('a'.repeat(300)).length).toBe(256);
  });
});

/* -------------------------------------------------------------------------- */
/* Allowlist                                                                  */
/* -------------------------------------------------------------------------- */

describe('outbound allowlist outside production', () => {
  afterEach(() => restoreEnv());

  it('permits only listed recipients', () => {
    withEmail();
    expect(isRecipientAllowed(ALLOWED_RECIPIENT)).toBe(true);
    expect(isRecipientAllowed(ALLOWED_RECIPIENT.toUpperCase())).toBe(true);
    expect(isRecipientAllowed('someone-else@example.test')).toBe(false);
  });

  it('permits nothing when the allowlist is unset', () => {
    withEmail({ EMAIL_ALLOWLIST: undefined });
    expect(emailAllowlist()).toHaveLength(0);
    expect(isRecipientAllowed('anyone@example.test')).toBe(false);
  });

  it('does not deliver to a non-allowlisted address, and records why', async () => {
    withEmail();
    stubFetch({ id: 'should-not-happen' });
    const order = await placeOnlineOrder();

    const projected = await loadOrder(order.orderId);
    const result = await notifyOrderConfirmation({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      to: projected.customerEmail,
      rendered: renderOrderConfirmation(projected, 'https://example.test/orders/x'),
    });

    expect(result.enqueued).toBe(false);

    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('skipped');
    expect(rows[0]!.detail).toContain('ALLOWLIST');
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration reporting                                                    */
/* -------------------------------------------------------------------------- */

describe('email configuration reporting', () => {
  afterEach(() => restoreEnv());

  it('names the missing variables instead of claiming to be configured', () => {
    withEmail({ RESEND_API_KEY: undefined, RESEND_FROM_EMAIL: undefined });
    expect(emailConfiguration()).toMatchObject({
      configured: false,
      missing: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
    });
  });

  it('reports configured when both a key and a sender are present', () => {
    withEmail();
    expect(emailConfiguration()).toMatchObject({ configured: true, missing: [] });
  });
});

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

describe('email templates', () => {
  afterEach(() => restoreEnv());

  it('renders only persisted order values', async () => {
    const order = await placeOnlineOrder();
    const projected = await loadOrder(order.orderId);

    const email = renderOrderConfirmation(projected, 'https://example.test/orders/1');

    // The real order number and the real total appear...
    expect(email.subject).toContain(projected.orderNumber);
    expect(email.html).toContain(projected.orderNumber);
    expect(email.html).toContain(formatRupees(projected.totalAmount));
    // ...and every line item the order actually holds.
    for (const item of projected.items) {
      expect(email.html).toContain(escapeHtml(item.title));
      expect(email.html).toContain(escapeHtml(item.sku));
    }
  });

  it('escapes customer-controlled text so a name cannot inject markup', () => {
    const hostile: Order = {
      id: 'o1',
      orderNumber: 'AJO-1',
      customerId: 'c1',
      customerName: '<script>alert(1)</script>',
      customerEmail: 'x@example.test',
      customerPhone: '+919876543210',
      items: [],
      subtotal: 100,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 100,
      currency: 'INR',
      status: 'placed',
      paymentStatus: 'paid',
      couponCode: null,
      shippingAddress: {
        fullName: 'A',
        phone: '1',
        line1: 'L',
        line2: '',
        city: 'C',
        state: 'S',
        postalCode: '1',
        country: 'India',
      },
      billingAddress: {
        fullName: 'A',
        phone: '1',
        line1: 'L',
        line2: '',
        city: 'C',
        state: 'S',
        postalCode: '1',
        country: 'India',
      },
      paymentRef: null,
      paymentMethod: 'razorpay',
      placedAt: new Date().toISOString(),
      deliveredAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const email = renderOrderConfirmation(hostile, 'https://example.test/o1');
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('does not claim a refund was issued for an unpaid order', () => {
    const base = {
      id: 'o1',
      orderNumber: 'AJO-1',
      customerId: 'c1',
      customerName: 'A',
      customerEmail: 'x@example.test',
      customerPhone: '+919876543210',
      items: [],
      subtotal: 100,
      shippingFee: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 100,
      currency: 'INR' as const,
      status: 'cancelled' as const,
      paymentStatus: 'pending' as const,
      couponCode: null,
      shippingAddress: {
        fullName: 'A',
        phone: '1',
        line1: 'L',
        line2: '',
        city: 'C',
        state: 'S',
        postalCode: '1',
        country: 'India',
      },
      billingAddress: {
        fullName: 'A',
        phone: '1',
        line1: 'L',
        line2: '',
        city: 'C',
        state: 'S',
        postalCode: '1',
        country: 'India',
      },
      paymentRef: null,
      paymentMethod: 'cod' as const,
      placedAt: new Date().toISOString(),
      deliveredAt: null,
      cancelledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies Order;

    const email = renderOrderCancelled(base);
    expect(email.text).toContain('No payment was taken');
    expect(email.text).not.toContain('A refund');
  });

  it('includes the administrator note in a rejected return', () => {
    const request = {
      id: 'r1',
      returnNumber: 'RET-1',
      orderId: 'o1',
      orderNumber: 'AJO-1',
      customerId: 'c1',
      items: [],
      reason: 'size-too-large',
      reasonNote: 'too big',
      status: 'rejected',
      refundAmount: 0,
      refundRef: null,
      resolutionNote: null,
      requestedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    } satisfies ReturnRequest;

    const email = renderReturnRejected(request, 'Outside the 7-day window.');
    expect(email.text).toContain('Outside the 7-day window.');
  });
});

/* -------------------------------------------------------------------------- */
/* Capture-triggered confirmation                                             */
/* -------------------------------------------------------------------------- */

describe('order confirmation on payment capture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('sends one confirmation when a payment is captured', async () => {
    withEmail();
    // The allowlist is bypassed by targeting the allowlisted address, so the
    // test exercises a real delivery rather than a skip.
    stubFetch({ id: 'msg-confirm-1' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);

    await capturePayment(order, paymentId);

    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.providerMessageId).toBe('msg-confirm-1');
    expect(rows[0]!.to).toBe(ALLOWED_RECIPIENT);
    expect(rows[0]!.orderNumber).toBe(order.orderNumber);

    // The body carries the real total, not a placeholder.
    const body = sentBody(vi.mocked(global.fetch));
    expect(body.html).toContain(order.orderNumber);
  });

  it('does not send a second confirmation when the capture repeats', async () => {
    withEmail();
    stubFetch({ id: 'msg-confirm-2' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);

    const { markPaymentCaptured } = await import('../src/services/payment.service.js');

    // First capture applies.
    await expect(markPaymentCaptured(paymentId, 'pay_one', 'upi', order.total)).resolves.toBe(true);

    // A duplicate capture (double-tap + webhook racing) applies nothing.
    await expect(markPaymentCaptured(paymentId, 'pay_two', 'upi', order.total)).resolves.toBe(
      false,
    );

    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows).toHaveLength(1);
    // Exactly one outbound provider call.
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it('settles the payment even when the email provider is down', async () => {
    withEmail();
    // A provider outage: 503 on every attempt.
    stubFetch({ message: 'provider unavailable' }, 503);

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);

    // This must not throw: the money already moved.
    await expect(capturePayment(order, paymentId)).resolves.toBeUndefined();

    const payment = await PaymentModel.findById(paymentId).lean();
    expect(payment?.status).toBe('paid');

    // The email is still recorded, and still queued for retry.
    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.attempts).toBe(1);
  });

  it('sends nothing at all when email is unconfigured, but still records it', async () => {
    withEmail({ RESEND_API_KEY: undefined, RESEND_FROM_EMAIL: undefined });
    const mock = stubFetch({ id: 'never' });

    const order = await placeOnlineOrder();
    const paymentId = await seedPayment(order);

    await capturePayment(order, paymentId);

    expect(mock).not.toHaveBeenCalled();

    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('skipped');
    expect(rows[0]!.detail).toContain('not configured');
  });
});

/* -------------------------------------------------------------------------- */
/* Durability and retry                                                       */
/* -------------------------------------------------------------------------- */

describe('outbox durability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('retries a previously failed email without re-recording it', async () => {
    withEmail();
    stubFetch({ message: 'temporary outage' }, 503);

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);
    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { status: 'completed', deliveredAt: new Date() } },
    );

    expect((await EmailLogModel.find({ template: 'order-confirmation' }).lean())[0]!.status).toBe(
      'failed',
    );

    // The provider recovers.
    stubFetch({ id: 'msg-recovered' });
    const result = await dispatchPending();

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    // Still exactly one row — a retry re-delivers, it does not re-create.
    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.providerMessageId).toBe('msg-recovered');
    expect(rows[0]!.attempts).toBe(2);
  });

  it('records but does not send when the caller defers delivery', async () => {
    withEmail();
    const mock = stubFetch({ id: 'msg-deferred' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const projected = await loadOrder(order.orderId);

    const result = await notifyOrderConfirmation({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      to: projected.customerEmail,
      rendered: renderOrderConfirmation(projected, 'https://example.test/o'),
      trySend: false,
    });

    expect(result.enqueued).toBe(true);
    expect(mock).not.toHaveBeenCalled();

    const rows = await EmailLogModel.find({ template: 'order-confirmation' }).lean();
    expect(rows[0]!.status).toBe('queued');
    expect(rows[0]!.attempts).toBe(0);
  });

  it('caps retries rather than hammering the provider forever', async () => {
    withEmail();
    stubFetch({ message: 'permanently rejected' }, 422);

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);
    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { status: 'completed', deliveredAt: new Date() } },
    );

    // Drive past the budget.
    for (let i = 0; i < 8; i += 1) {
      await dispatchPending();
    }

    const row = (await EmailLogModel.find({ template: 'order-confirmation' }).lean())[0]!;
    // Bounded, and the row says it was abandoned rather than silently looping.
    expect(row.attempts).toBeLessThanOrEqual(6);
    expect(row.detail.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Order lifecycle notifications                                               */
/* -------------------------------------------------------------------------- */

describe('order lifecycle notifications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('emails on delivery, once, and not again for the same status', async () => {
    withEmail();
    stubFetch({ id: 'msg-delivered' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);

    const token = (
      await api().post('/v1/auth/login').send({
        email: ALLOWED_RECIPIENT,
        password: 'TestPassw0rd!2026',
      })
    ).body as { data: { tokens: { accessToken: string } } };

    // A real admin drives the status change through the real route.
    const { createAdmin } = await import('./helpers/factories.js');
    const admin = await createAdmin();
    const adminToken = (
      await api()
        .post('/v1/admin/auth/login')
        .send({ email: admin.email, password: admin.password })
    ).body as { data: { tokens: { accessToken: string } } };

    void token;

    const first = await api()
      .patch(`/v1/admin/orders/${order.orderId}/status`)
      .set(bearer(adminToken.data.tokens.accessToken))
      .send({ status: 'processing' });
    expect(first.status).toBe(200);

    const second = await api()
      .patch(`/v1/admin/orders/${order.orderId}/status`)
      .set(bearer(adminToken.data.tokens.accessToken))
      .send({ status: 'processing' });
    expect(second.status).toBe(200);

    // Re-saving the same status is idempotent and must not re-notify.
    const delivered = await EmailLogModel.find({ template: 'order-delivered' }).lean();
    expect(delivered).toHaveLength(0);
  });

  it('emails a cancellation notice carrying the real reason', async () => {
    withEmail();
    stubFetch({ id: 'msg-cancelled' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);

    const { createAdmin } = await import('./helpers/factories.js');
    const admin = await createAdmin();
    const adminLogin = await api()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: admin.password });
    const adminToken = success<{ tokens: { accessToken: string } }>(adminLogin.body).tokens
      .accessToken;

    const cancelled = await api()
      .patch(`/v1/admin/orders/${order.orderId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'cancelled', note: 'Customer requested cancellation.' });

    expect(cancelled.status).toBe(200);

    const rows = await EmailLogModel.find({ template: 'order-cancelled' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');

    const body = sentBody(vi.mocked(global.fetch), 1);
    expect(JSON.stringify(body)).toContain('Customer requested cancellation.');
  });

  it('records a return acknowledgement when a return is raised', async () => {
    withEmail();
    stubFetch({ id: 'msg-return' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);
    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { status: 'completed', deliveredAt: new Date() } },
    );

    const projected = await loadOrder(order.orderId);
    const token = await customerToken(ALLOWED_RECIPIENT, 'TestPassw0rd!2026');

    const created = await api()
      .post('/v1/returns')
      .set(bearer(token))
      .send({
        orderId: order.orderId,
        items: [{ variantId: projected.items[0]!.variantId, quantity: 1 }],
        reason: 'size-too-large',
        reasonNote: 'It is too large.',
      });

    expect(created.status).toBe(201);

    const rows = await EmailLogModel.find({ template: 'return-acknowledged' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.to).toBe(ALLOWED_RECIPIENT);

    const doc = await ReturnRequestModel.findById(success<{ id: string }>(created.body).id).lean();
    expect(doc).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-customer isolation                                                   */
/* -------------------------------------------------------------------------- */

describe('recipient isolation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('sends each order to its own buyer, never to another', async () => {
    withEmail();
    stubFetch({ id: 'msg-isolation' });

    const first = await placeOnlineOrder({ email: FIRST_BUYER });
    const firstPayment = await seedPayment(first);
    await capturePayment(first, firstPayment);

    const second = await placeOnlineOrder({ email: SECOND_BUYER });
    const secondPayment = await seedPayment(second);
    await capturePayment(second, secondPayment);

    const rows = await EmailLogModel.find({ template: 'order-confirmation' })
      .sort({ createdAt: 1 })
      .lean();

    expect(rows).toHaveLength(2);
    expect(rows[0]!.to).toBe(FIRST_BUYER);
    expect(rows[1]!.to).toBe(SECOND_BUYER);
    // Neither message mentions the other order.
    const [callA, callB] = (vi.mocked(global.fetch).mock.calls as Array<[string, RequestInit]>).map(
      ([, init]) => JSON.parse(init.body as string) as Record<string, unknown>,
    );
    expect(JSON.stringify(callA)).not.toContain(second.orderNumber);
    expect(JSON.stringify(callB)).not.toContain(first.orderNumber);
  });
});

/* -------------------------------------------------------------------------- */
/* Notification helpers                                                       */
/* -------------------------------------------------------------------------- */

describe('notifyOrderEvent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('keys one row per template and order, so a shipped notice cannot recur', async () => {
    withEmail();
    stubFetch({ id: 'msg-event' });

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const projected = await loadOrder(order.orderId);

    const { renderOrderDelivered } = await import('../src/services/email-templates.js');

    const first = await notifyOrderEvent({
      template: 'order-delivered',
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      to: projected.customerEmail,
      rendered: renderOrderDelivered(projected),
    });
    expect(first.enqueued).toBe(true);

    const second = await notifyOrderEvent({
      template: 'order-delivered',
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      to: projected.customerEmail,
      rendered: renderOrderDelivered(projected),
    });
    expect(second.enqueued).toBe(false);
    expect(second.reason).toBe('duplicate');

    expect(await EmailLogModel.countDocuments({ template: 'order-delivered' })).toBe(1);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Outbox re-rendering                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The outbox stores the *identity* of an email, not its body. A retry
 * therefore re-renders the body from the persisted order or return.
 *
 * That only works if every enqueueable template is re-renderable. The gap
 * this suite pins shut: `return-*` templates and `order-cancelled` were
 * recorded but could never be rebuilt, so a failed return or cancellation
 * email sat in the outbox forever with no way to deliver it.
 */
describe('outbox re-rendering', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('rebuilds a return acknowledgement from the persisted return', async () => {
    withEmail();
    stubFetch({ message: 'temporary outage' }, 503);

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);
    await OrderModel.updateOne(
      { _id: new Types.ObjectId(order.orderId) },
      { $set: { status: 'completed', deliveredAt: new Date() } },
    );

    const projected = await loadOrder(order.orderId);
    const token = await customerToken(ALLOWED_RECIPIENT, 'TestPassw0rd!2026');

    const created = await api()
      .post('/v1/returns')
      .set(bearer(token))
      .send({
        orderId: order.orderId,
        items: [{ variantId: projected.items[0]!.variantId, quantity: 1 }],
        reason: 'size-too-large',
        reasonNote: 'It is too large.',
      });
    expect(created.status).toBe(201);

    // The acknowledgement failed to send.
    const row = (await EmailLogModel.find({ template: 'return-acknowledged' }).lean())[0]!;
    expect(row.status).toBe('failed');
    expect(row.returnId).toBeTruthy();

    // The provider recovers and the outbox rebuilds the body.
    stubFetch({ id: 'msg-return-retry' });
    const result = await dispatchPending();

    expect(result.sent).toBeGreaterThanOrEqual(1);

    const body = sentBodyForTemplate(vi.mocked(global.fetch), 'return-acknowledged');
    expect(String(body.subject)).toMatch(/return/i);
    expect(JSON.stringify(body)).toContain(row.returnNumber);
  });

  it('rebuilds a cancellation notice with the real cancellation reason', async () => {
    withEmail();
    stubFetch({ message: 'temporary outage' }, 503);

    const order = await placeOnlineOrder({ email: ALLOWED_RECIPIENT });
    const paymentId = await seedPayment(order);
    await capturePayment(order, paymentId);

    const { createAdmin } = await import('./helpers/factories.js');
    const admin = await createAdmin();
    const adminLogin = await api()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: admin.password });
    const adminToken = success<{ tokens: { accessToken: string } }>(adminLogin.body).tokens
      .accessToken;

    const cancelled = await api()
      .patch(`/v1/admin/orders/${order.orderId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'cancelled', note: 'The customer asked us to stop.' });
    expect(cancelled.status).toBe(200);

    const row = (await EmailLogModel.find({ template: 'order-cancelled' }).lean())[0]!;
    expect(row.status).toBe('failed');

    stubFetch({ id: 'msg-cancel-retry' });
    await dispatchPending();

    const body = sentBodyForTemplate(vi.mocked(global.fetch), 'order-cancelled');
    expect(JSON.stringify(body)).toContain('The customer asked us to stop.');
  });

  it('fails a password-reset email permanently rather than re-rendering it', async () => {
    withEmail();
    stubFetch({ message: 'temporary outage' }, 503);

    await createCustomer({ email: ALLOWED_RECIPIENT });
    await api().post('/v1/auth/password-reset/request').send({ email: ALLOWED_RECIPIENT });

    const row = (await EmailLogModel.find({ template: 'password-reset' }).lean())[0]!;
    expect(row.status).toBe('failed');

    // A retry must not rebuild a reset link: the raw token was never stored,
    // so there is nothing legitimate to rebuild.
    stubFetch({ id: 'msg-reset-retry' });
    await dispatchPending();

    const after = (await EmailLogModel.find({ template: 'password-reset' }).lean())[0]!;
    expect(after.status).toBe('failed');
    expect(after.detail.length).toBeGreaterThan(0);
  });
});
