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
import { EmailLogModel } from '../src/models/email-log.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { PaymentModel } from '../src/models/payment.model.js';
import { ReturnRequestModel } from '../src/models/return-request.model.js';
import { ShipmentModel } from '../src/models/shipment.model.js';
import { StockMovementModel } from '../src/models/stock-movement.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { WebhookEventModel } from '../src/models/webhook-event.model.js';
import { clearShiprocketToken } from '../src/services/shiprocket.service.js';

/**
 * End-to-end lifecycle.
 *
 * One test walks a single order through the **entire** commercial lifecycle,
 * crossing every boundary the platform has:
 *
 *   catalogue → cart → checkout → payment → dispatch → delivery → return →
 *   refund → stock restoration
 *
 * The providers (Razorpay, Shiprocket, Resend) are stubbed at the `fetch`
 * boundary, so no money moves, no parcel is created and no mail is
 * delivered. Everything in between — the order, the payment record, the
 * shipment, the return, the refunds, the stock ledger, the audit trail, the
 * outbox — is the **real** implementation, exercised through the **real**
 * HTTP stack.
 *
 * The point is the seams. Each phase is tested in isolation elsewhere; this
 * test is what proves the phases compose. A defect that only shows up when a
 * payment is followed by a dispatch, or a return by a refund, is exactly the
 * defect a customer would find and a unit test would miss.
 */

useApi();

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const KEY_SECRET = 'e2e-key-secret-value-that-is-long-enough';
const WEBHOOK_SECRET = 'e2e-webhook-secret';
const SR_WEBHOOK_SECRET = 'e2e-shiprocket-webhook-secret';

const SAVED_ENV: Record<string, string | undefined> = {};

/**
 * Configure every provider at once.
 *
 * The values are patched on `process.env` — the same source the running
 * configuration was validated from — and restored afterwards.
 */
function withProviders(overrides: Record<string, string | undefined> = {}): void {
  const keys = [
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'RAZORPAY_MODE',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'EMAIL_ALLOWLIST',
    'SHIPROCKET_API_EMAIL',
    'SHIPROCKET_API_PASSWORD',
    'SHIPROCKET_PICKUP_LOCATION',
    'SHIPROCKET_COURIER_ID',
    'SHIPROCKET_WEBHOOK_SECRET',
  ];

  for (const key of keys) {
    if (!(key in SAVED_ENV)) {
      SAVED_ENV[key] = process.env[key];
    }
  }

  const values: Record<string, string | undefined> = {
    RAZORPAY_KEY_ID: 'rzp_test_e2e',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_MODE: 'test',
    RESEND_API_KEY: 're_e2e_key',
    RESEND_FROM_EMAIL: 'Ajooba Footwear <orders@example.test>',
    EMAIL_ALLOWLIST: 'e2e-buyer@example.test',
    SHIPROCKET_API_EMAIL: 'api-user@example.test',
    SHIPROCKET_API_PASSWORD: 'api-password',
    SHIPROCKET_PICKUP_LOCATION: 'Primary Warehouse',
    SHIPROCKET_COURIER_ID: '9',
    SHIPROCKET_WEBHOOK_SECRET: SR_WEBHOOK_SECRET,
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  clearShiprocketToken();
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
  clearShiprocketToken();
}

/** Every outbound provider call, so the test can assert on the contract. */
interface ProviderCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

const calls: ProviderCall[] = [];

/**
 * The amount the stubbed Razorpay payment reports, in paise.
 *
 * It is a variable rather than a constant because the amount must **match
 * the order total** for the platform to settle it — and the order total
 * depends on the catalogue prices and the shipping fee. A hard-coded
 * provider amount would make the reconciliation branch untestable and, worse,
 * would hide a genuine mismatch behind a convenient fixture.
 */
let razorpayAmountPaise = 309_900;

/**
 * Read the outcome of a webhook response.
 *
 * The webhook endpoints deliberately answer with a flat `{ ok, outcome }`
 * body rather than the standard `{ ok, data }` envelope, because the
 * provider — not our API — is the consumer of that response.
 */
function webhookOutcome(body: unknown): string {
  return (body as { outcome?: string }).outcome ?? '';
}

/**
 * Route the outbound calls by URL fragment.
 *
 * Each provider endpoint gets its own response, so the stub reflects the
 * documented shape of that endpoint rather than one generic answer.
 */
function stubProviders(): void {
  const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const rawBody = typeof init?.body === 'string' ? init.body : null;
    const body =
      rawBody && rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    const headers = (init?.headers ?? {}) as Record<string, string>;

    calls.push({ url, method, body, headers });

    let response: unknown = { success: true, data: {} };

    if (url.includes('/v1/external/auth/login')) {
      response = { success: true, data: { token: 'shiprocket-e2e-token' } };
    } else if (url.includes('/v1/external/orders/create/adhoc')) {
      response = {
        success: true,
        data: {
          order_id: 'AJ-E2E-1',
          shipment_id: 'shipment-e2e-1',
          status: 'new',
          status_code: 1,
          awb_code: 'AWBE2E0001',
          courier_name: 'E2E Courier',
          courier_id: 9,
          label_url: 'https://labels.example.test/e2e.pdf',
        },
      };
    } else if (url.includes('/v1/external/courier/assign/awb')) {
      response = {
        success: true,
        data: {
          awb_code: 'AWBE2E0001',
          awb_assigned: true,
          courier_id: 9,
          courier_name: 'E2E Courier',
        },
      };
    } else if (url.includes('/v1/external/courier/generate/label')) {
      response = {
        success: true,
        data: { label_url: 'https://labels.example.test/e2e.pdf' },
      };
    } else if (url.includes('/v1/external/courier/generate/pickup')) {
      response = { success: true, data: { pickup_scheduled_date: '2026-10-28' } };
    } else if (url.includes('/v1/external/courier/track/awb/')) {
      response = {
        success: true,
        data: {
          awb: 'AWBE2E0001',
          current_status: 'IN TRANSIT',
          current_status_id: 4,
          etd: '2026-10-30',
          scans: [],
        },
      };
    } else if (url.includes('/refund')) {
      /*
       * The refund endpoint. Checked **before** the generic payment
       * endpoint, because the refund path is
       * `/v1/payments/:id/refund` and would otherwise be swallowed by it.
       */
      response = {
        id: 'rfnd_E2E_1',
        entity: 'refund',
        amount: 150000,
        currency: 'INR',
        status: 'processed',
        payment_id: 'pay_E2E_1',
      };
    } else if (url.includes('/v1/orders')) {
      // Razorpay order creation.
      response = {
        id: 'order_E2E_GATEWAY_1',
        entity: 'order',
        amount: razorpayAmountPaise,
        amount_paid: 0,
        amount_received: 0,
        currency: 'INR',
        status: 'created',
        receipt: 'e2e-receipt',
      };
    } else if (url.includes('/v1/payments/')) {
      // Razorpay payment fetch.
      response = {
        id: 'pay_E2E_1',
        entity: 'payment',
        amount: razorpayAmountPaise,
        currency: 'INR',
        status: 'captured',
        captured: true,
        method: 'card',
        order_id: 'order_E2E_GATEWAY_1',
      };
    } else if (url.includes('resend.com') || url.includes('/emails')) {
      response = { id: 'email_e2e_1', object: 'email' };
    }

    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(response)),
    };
  });

  vi.stubGlobal('fetch', mock);
}

/** The signature a real Checkout callback would carry. */
function signCheckout(gatewayOrderId: string, paymentId: string): string {
  return createHmac('sha256', KEY_SECRET).update(`${gatewayOrderId}|${paymentId}`).digest('hex');
}

/** The signature a real Razorpay webhook would carry. */
function signWebhook(rawBody: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
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

afterEach(() => {
  restoreEnv();
  calls.length = 0;
  razorpayAmountPaise = 309_900;
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The lifecycle                                                              */
/* -------------------------------------------------------------------------- */

describe('end-to-end order lifecycle', () => {
  it('carries one order from checkout to a settled refund, restoring stock at each step', async () => {
    withProviders();
    stubProviders();

    /* ---------------------------------------------------------------- */
    /* 1. Catalogue and cart                                            */
    /* ---------------------------------------------------------------- */

    await setStoreSettings({ shippingFee: 99, freeShippingThreshold: 0, taxRateBps: 0 });

    const customer = await createCustomer({ email: 'e2e-buyer@example.test' });
    const token = await customerToken(customer.email, customer.password);
    const admin = await createAdmin({ role: 'owner' });
    const adminJwt = await adminToken(admin.email, admin.password);

    const { variant } = await createProductWithVariant(
      { title: 'E2E Mojri', sellingPrice: 1500, mrp: 2000 },
      { stock: 5 },
    );

    const added = await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 2 });
    expect(added.status).toBe(200);

    /* ---------------------------------------------------------------- */
    /* 2. Checkout                                                      */
    /* ---------------------------------------------------------------- */

    const checkoutKey = `e2e-checkout-${Date.now().toString(36)}`;
    const checkout = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', checkoutKey)
      .send({
        shippingAddress: TEST_ADDRESS,
        paymentMethod: 'razorpay',
        idempotencyKey: checkoutKey,
      });

    expect(checkout.status).toBe(201);
    const order = success<{
      id: string;
      orderNumber: string;
      totalAmount: number;
      status: string;
      paymentStatus: string;
      items: Array<{ variantId: string; quantity: number; lineTotal: number }>;
    }>(checkout.body);

    expect(order.totalAmount).toBe(3099);
    expect(order.paymentStatus).toBe('pending');

    // The provider reports exactly what the order is worth. The platform
    // reconciles the two, and a mismatch would (correctly) refuse to
    // settle — so the fixture has to be honest.
    razorpayAmountPaise = order.totalAmount * 100;

    // Stock was consumed at placement, not at capture.
    const afterCheckout = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(afterCheckout?.stock).toBe(3);

    const saleMovements = await StockMovementModel.find({
      variantId: new Types.ObjectId(variant.id),
      reason: 'sale',
    }).lean<Array<{ delta: number }>>();
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0]?.delta).toBe(-2);

    /* ---------------------------------------------------------------- */
    /* 3. Payment intent                                                */
    /* ---------------------------------------------------------------- */

    const intent = await api().post(`/v1/payments/${order.id}/intent`).set(bearer(token)).send({});

    expect(intent.status).toBe(200);
    const gateway = success<{ razorpayOrderId: string; amount: number; keyId: string }>(
      intent.body,
    );

    expect(gateway.razorpayOrderId).toBe('order_E2E_GATEWAY_1');
    // The amount comes from the stored order, in paise.
    expect(gateway.amount).toBe(3099 * 100);
    expect(gateway.keyId).toBe('rzp_test_e2e');

    /* ---------------------------------------------------------------- */
    /* 4. Payment verification settles the order                        */
    /* ---------------------------------------------------------------- */

    const verified = await api()
      .post(`/v1/payments/${order.id}/verify`)
      .set(bearer(token))
      .send({
        razorpay_payment_id: 'pay_E2E_1',
        razorpay_order_id: gateway.razorpayOrderId,
        razorpay_signature: signCheckout(gateway.razorpayOrderId, 'pay_E2E_1'),
      });

    expect(verified.status).toBe(200);
    const settlement = success<{ verified: boolean; status: string; amountRupees: number }>(
      verified.body,
    );
    expect(settlement.verified).toBe(true);
    expect(settlement.status).toBe('paid');
    expect(settlement.amountRupees).toBe(3099);

    const paidOrder = await OrderModel.findById(order.id).lean<{
      paymentStatus: string;
      paymentRef: string | null;
    }>();
    expect(paidOrder?.paymentStatus).toBe('paid');
    expect(paidOrder?.paymentRef).toBe('pay_E2E_1');

    // The order confirmation was recorded exactly once.
    const confirmations = await EmailLogModel.find({
      template: 'order-confirmation',
      idempotencyKey: `order-confirmation/${order.orderNumber}`,
    }).lean<Array<{ status: string }>>();
    expect(confirmations).toHaveLength(1);

    /* ---------------------------------------------------------------- */
    /* 5. Dispatch: shipment, AWB, label, pickup                        */
    /* ---------------------------------------------------------------- */

    const shipmentResponse = await api()
      .post(`/v1/admin/shipments/orders/${order.id}`)
      .set(bearer(adminJwt))
      .send({});

    expect(shipmentResponse.status).toBe(201);
    const shipment = success<{ id: string; status: string; awbCode: string | null }>(
      shipmentResponse.body,
    );
    expect(shipment.status).toBe('created');

    const awbResponse = await api()
      .post(`/v1/admin/shipments/${shipment.id}/awb`)
      .set(bearer(adminJwt))
      .send({});
    expect(awbResponse.status).toBe(200);
    expect(success<{ status: string }>(awbResponse.body).status).toBe('awb_assigned');

    const pickupResponse = await api()
      .post(`/v1/admin/shipments/${shipment.id}/pickup`)
      .set(bearer(adminJwt))
      .send({});
    expect(pickupResponse.status).toBe(200);

    /*
     * A label is not a dispatch. The order must still not be `shipped`.
     */
    const beforeScan = await OrderModel.findById(order.id).lean<{ status: string }>();
    expect(beforeScan?.status).toBe('placed');

    /* ---------------------------------------------------------------- */
    /* 6. The carrier actually moves the parcel                          */
    /* ---------------------------------------------------------------- */

    const tracking = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', SR_WEBHOOK_SECRET)
      .send({
        awb: 'AWBE2E0001',
        order_id: 'AJ-E2E-1',
        current_status: 'IN TRANSIT',
        current_status_id: 4,
        etd: '2026-10-30',
        scans: [{ date: '2026-10-28T09:00:00+05:30', status: 'IN TRANSIT', activity: 'Hub' }],
      });

    expect(tracking.status).toBe(200);
    expect(webhookOutcome(tracking.body)).toBe('processed');

    const shippedOrder = await OrderModel.findById(order.id).lean<{ status: string }>();
    expect(shippedOrder?.status).toBe('shipped');

    const shipmentRow = await ShipmentModel.findById(shipment.id).lean<{ status: string }>();
    expect(shipmentRow?.status).toBe('shipped');

    // The dispatch email was recorded — exactly once.
    const dispatchEmails = await EmailLogModel.find({
      template: 'order-shipped',
      idempotencyKey: `order-shipped/${order.orderNumber}`,
    }).lean<Array<{ status: string }>>();
    expect(dispatchEmails).toHaveLength(1);

    /* ---------------------------------------------------------------- */
    /* 7. Delivery                                                      */
    /* ---------------------------------------------------------------- */

    const delivery = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', SR_WEBHOOK_SECRET)
      .send({
        awb: 'AWBE2E0001',
        current_status: 'DELIVERED',
        current_status_id: 9,
      });

    expect(delivery.status).toBe(200);

    const deliveredOrder = await OrderModel.findById(order.id).lean<{
      status: string;
      deliveredAt: Date | null;
    }>();
    expect(deliveredOrder?.status).toBe('completed');
    expect(deliveredOrder?.deliveredAt).not.toBeNull();

    /* ---------------------------------------------------------------- */
    /* 8. The customer raises a return                                   */
    /* ---------------------------------------------------------------- */

    const returnResponse = await api()
      .post('/v1/returns')
      .set(bearer(token))
      .send({
        orderId: order.id,
        items: [{ variantId: variant.id, quantity: 1 }],
        reason: 'size-too-large',
        reasonNote: 'The size does not fit.',
      });

    expect(returnResponse.status).toBe(201);
    const returnRequest = success<{
      id: string;
      returnNumber: string;
      status: string;
      refundAmount: number;
    }>(returnResponse.body);

    expect(returnRequest.status).toBe('requested');
    expect(returnRequest.refundAmount).toBe(1500);

    /* ---------------------------------------------------------------- */
    /* 9. An administrator approves it — and no money moves yet         */
    /* ---------------------------------------------------------------- */

    const approve = await api()
      .patch(`/v1/admin/returns/${returnRequest.id}`)
      .set(bearer(adminJwt))
      .send({ status: 'approved', note: 'Approved after inspection.' });

    expect(approve.status).toBe(200);
    expect(success<{ status: string }>(approve.body).status).toBe('approved');

    // Approval is a decision, not a refund.
    const stillApproved = await ReturnRequestModel.findById(returnRequest.id).lean<{
      status: string;
      refundRef?: string | null;
    }>();
    expect(stillApproved?.status).toBe('approved');
    expect(stillApproved?.refundRef ?? null).toBeNull();

    const paymentAfterApproval = await PaymentModel.findOne({
      orderId: new Types.ObjectId(order.id),
    }).lean<{ status: string; refundedAmount: number }>();
    expect(paymentAfterApproval?.status).toBe('paid');
    expect(paymentAfterApproval?.refundedAmount).toBe(0);

    /* ---------------------------------------------------------------- */
    /* 10. The refund is issued and confirmed by the provider           */
    /* ---------------------------------------------------------------- */

    const refund = await api()
      .post(`/v1/admin/returns/${returnRequest.id}/refund`)
      .set(bearer(adminJwt))
      .send({});

    expect(refund.status).toBe(200);
    const refundOutcome = success<{
      settled: boolean;
      providerStatus: string | null;
      amountRupees: number;
      refundId: string | null;
    }>(refund.body);

    expect(refundOutcome.settled).toBe(true);
    expect(refundOutcome.providerStatus).toBe('processed');
    expect(refundOutcome.amountRupees).toBe(1500);

    const refundedReturn = await ReturnRequestModel.findById(returnRequest.id).lean<{
      status: string;
      refundRef?: string | null;
    }>();
    expect(refundedReturn?.status).toBe('refunded');
    expect(refundedReturn?.refundRef).toBe('rfnd_E2E_1');

    const refundedOrder = await OrderModel.findById(order.id).lean<{
      paymentStatus: string;
    }>();
    expect(refundedOrder?.paymentStatus).toBe('partially_refunded');

    /* ---------------------------------------------------------------- */
    /* 11. The returned unit is back in the catalogue                   */
    /* ---------------------------------------------------------------- */

    const afterReturn = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(afterReturn?.stock).toBe(4);

    const returnMovements = await StockMovementModel.find({
      variantId: new Types.ObjectId(variant.id),
      reason: 'return',
    }).lean<Array<{ delta: number; stockAfter: number }>>();
    expect(returnMovements).toHaveLength(1);
    expect(returnMovements[0]?.delta).toBe(1);
    expect(returnMovements[0]?.stockAfter).toBe(4);

    /* ---------------------------------------------------------------- */
    /* 12. The audit trail names the operator for every decision        */
    /* ---------------------------------------------------------------- */

    const audit = await (
      await import('../src/models/audit-log.model.js')
    ).AuditLogModel.find({
      entityId: { $in: [order.id, returnRequest.id, shipment.id] },
    }).lean<Array<{ action: string; actorEmail: string; entity: string }>>();

    const actions = audit.map((entry) => entry.action);
    expect(actions).toContain('shipment-create');
    expect(actions).toContain('shipment-awb');
    expect(actions).toContain('refund');

    // Every audit entry that names a person names the administrator who acted.
    for (const entry of audit) {
      if (entry.actorEmail !== 'system') {
        expect(entry.actorEmail).toBe(admin.email);
      }
    }

    /* ---------------------------------------------------------------- */
    /* 13. The customer sees their own order and nothing else           */
    /* ---------------------------------------------------------------- */

    const customerOrder = await api().get(`/v1/orders/${order.orderNumber}`).set(bearer(token));
    expect(customerOrder.status).toBe(200);
    expect(success<{ status: string }>(customerOrder.body).status).toBe('completed');

    const stranger = await createCustomer();
    const strangerToken = await customerToken(stranger.email, stranger.password);

    const leaked = await api().get(`/v1/orders/${order.orderNumber}`).set(bearer(strangerToken));
    expect(leaked.status).toBe(404);
    expect(failure(leaked.body).code).toBe('NOT_FOUND');

    const leakedShipment = await api()
      .get(`/v1/shipments/orders/${order.id}/shipment`)
      .set(bearer(strangerToken));
    expect(leakedShipment.status).toBe(404);
  });

  it('never emails a real customer and never moves money when a provider is unreachable', async () => {
    withProviders();

    // Every outbound call fails.
    const mock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: () => Promise.resolve(JSON.stringify({ error: 'provider down' })),
    }));
    vi.stubGlobal('fetch', mock);

    await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0, taxRateBps: 0 });

    const customer = await createCustomer({ email: 'e2e-buyer@example.test' });
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant(
      { title: 'E2E Offline', sellingPrice: 1500, mrp: 2000 },
      { stock: 5 },
    );

    await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 1 });

    const key = `e2e-offline-${Date.now().toString(36)}`;
    const checkout = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send({ shippingAddress: TEST_ADDRESS, paymentMethod: 'razorpay', idempotencyKey: key });

    expect(checkout.status).toBe(201);
    const order = success<{ id: string; orderNumber: string }>(checkout.body);

    /*
     * The payment provider is unreachable. The order must survive as
     * `pending` — the customer must not be told the order failed, because
     * the order *is* fine and only the confirmation is delayed.
     */
    const intent = await api().post(`/v1/payments/${order.id}/intent`).set(bearer(token)).send({});
    expect(intent.status).toBeGreaterThanOrEqual(400);

    const orderRow = await OrderModel.findById(order.id).lean<{ paymentStatus: string }>();
    expect(orderRow?.paymentStatus).toBe('pending');

    // The stock is still held for this order — not lost.
    const after = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(after?.stock).toBe(4);

    // Nothing was emailed, because no email was configured as deliverable
    // beyond the allowlist and the provider was down.
    const emails = await EmailLogModel.find({ orderNumber: order.orderNumber }).lean<
      Array<{ status: string; attempts: number }>
    >();
    for (const email of emails) {
      expect(['queued', 'failed', 'skipped']).toContain(email.status);
    }
  });

  it('treats a duplicated payment webhook as a no-op, so stock is decremented once', async () => {
    withProviders();
    stubProviders();

    await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0, taxRateBps: 0 });

    const customer = await createCustomer({ email: 'e2e-buyer@example.test' });
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant(
      { title: 'E2E Duplicate', sellingPrice: 1500, mrp: 2000 },
      { stock: 5 },
    );

    await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 1 });

    const key = `e2e-dup-${Date.now().toString(36)}`;
    const checkout = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send({ shippingAddress: TEST_ADDRESS, paymentMethod: 'razorpay', idempotencyKey: key });

    const order = success<{ id: string; orderNumber: string; totalAmount: number }>(checkout.body);

    // Seed the payment row the intent route would have written.
    await PaymentModel.create({
      orderId: new Types.ObjectId(order.id),
      orderNumber: order.orderNumber,
      customerId: new Types.ObjectId(customer.id),
      amount: order.totalAmount,
      currency: 'INR',
      status: 'pending',
      provider: 'razorpay',
      providerOrderId: 'order_E2E_GATEWAY_1',
      /*
       * `providerReference` is the link the webhook resolves on — the
       * provider's payment id, not the gateway order id.
       */
      providerReference: 'pay_E2E_1',
      idempotencyKey: `intent:${order.id}`,
    });

    /*
     * The documented Razorpay payload shape: `contains` is an ARRAY, and
     * the body is signed over the raw bytes.
     */
    const eventId = `evt_e2e_${Date.now().toString(36)}`;
    const payload = {
      entity: 'payment',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: 'payment',
          id: 'pay_E2E_1',
          amount: order.totalAmount * 100,
          currency: 'INR',
          status: 'captured',
          method: 'card',
          captured: true,
          order_id: 'order_E2E_GATEWAY_1',
        },
      },
    };
    const rawBody = JSON.stringify(payload);

    const first = await api()
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', signWebhook(rawBody))
      .set('x-razorpay-event-id', eventId)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(first.status).toBe(200);
    expect(webhookOutcome(first.body)).toBe('processed');

    const stockAfterFirst = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(stockAfterFirst?.stock).toBe(4);

    // The identical delivery, redelivered.
    const second = await api()
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', signWebhook(rawBody))
      .set('x-razorpay-event-id', eventId)
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(second.status).toBe(200);
    expect(webhookOutcome(second.body)).toBe('duplicate');

    const stockAfterSecond = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(stockAfterSecond?.stock).toBe(4);

    // Exactly one sale movement, and exactly one confirmation email.
    const movements = await StockMovementModel.find({
      variantId: new Types.ObjectId(variant.id),
      reason: 'sale',
    }).lean<Array<{ delta: number }>>();
    expect(movements).toHaveLength(1);

    const confirmations = await EmailLogModel.find({
      template: 'order-confirmation',
      idempotencyKey: `order-confirmation/${order.orderNumber}`,
    }).lean();
    expect(confirmations).toHaveLength(1);

    const events = await WebhookEventModel.find({
      provider: 'razorpay',
      eventId,
    }).lean<Array<{ outcome: string }>>();
    expect(events).toHaveLength(1);
  });

  it('refuses to dispatch an order that was never paid', async () => {
    withProviders();
    stubProviders();

    await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0, taxRateBps: 0 });

    const customer = await createCustomer({ email: 'e2e-buyer@example.test' });
    const token = await customerToken(customer.email, customer.password);
    const admin = await createAdmin({ role: 'owner' });
    const adminJwt = await adminToken(admin.email, admin.password);

    const { variant } = await createProductWithVariant(
      { title: 'E2E Unpaid', sellingPrice: 1500, mrp: 2000 },
      { stock: 5 },
    );

    await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 1 });

    const key = `e2e-unpaid-${Date.now().toString(36)}`;
    await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send({ shippingAddress: TEST_ADDRESS, paymentMethod: 'razorpay', idempotencyKey: key });

    const list = success<{ items: Array<{ id: string }>; totalItems: number }>(
      (await api().get('/v1/orders').set(bearer(token))).body,
    );
    expect(list.totalItems).toBe(1);

    const dispatch = await api()
      .post(`/v1/admin/shipments/orders/${list.items[0]!.id}`)
      .set(bearer(adminJwt))
      .send({});

    expect(dispatch.status).toBe(409);
    expect(failure(dispatch.body).code).toBe('CONFLICT');

    // No provider call was made.
    expect(calls.filter((call) => call.url.includes('/orders/create/adhoc'))).toHaveLength(0);
  });
});
