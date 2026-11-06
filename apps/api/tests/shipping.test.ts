import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import {
  TEST_ADDRESS,
  createAdmin,
  createCustomer,
  createProductWithVariant,
  setStoreSettings,
} from './helpers/factories.js';
import { OrderModel } from '../src/models/order.model.js';
import { ShipmentModel } from '../src/models/shipment.model.js';
import { WebhookEventModel } from '../src/models/webhook-event.model.js';
import { buildShiprocketOrderId, mapTrackingStatus } from '../src/services/shipping.service.js';
import { shippingConfiguration } from '../src/services/shipping.service.js';
import { clearShiprocketToken } from '../src/services/shiprocket.service.js';
import { SHIPROCKET_WEBHOOK_PATH } from '../src/routes/webhook.routes.js';

/**
 * Shipping.
 *
 * `fetch` is stubbed for the whole file, so nothing here reaches Shiprocket.
 * The properties under test are the ones that decide whether a parcel is
 * dispatched honestly and whether a customer can be misled about it:
 *
 *  - an unshippable order (unpaid, cancelled, delivered) cannot get a
 *    shipment;
 *  - one order cannot get two live shipments;
 *  - generating a label or requesting a pickup does **not** mark the order
 *    as shipped — only a real carrier scan does;
 *  - the tracking webhook is authenticated and the order status it writes
 *    is monotonic, so an out-of-order scan cannot walk a parcel backwards;
 *  - a customer can read only their own shipment, and cannot read another
 *    customer's order id into existence;
 *  - `support` can read a shipment but cannot dispatch one.
 */

useApi();

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const SAVED_ENV: Record<string, string | undefined> = {};

const SHIPPING_ENV_KEYS = [
  'SHIPROCKET_API_EMAIL',
  'SHIPROCKET_API_PASSWORD',
  'SHIPROCKET_PICKUP_LOCATION',
  'SHIPROCKET_COURIER_ID',
  'SHIPROCKET_WEBHOOK_SECRET',
];

/**
 * Point the shipping services at fake credentials.
 *
 * `env` is frozen at boot, so the values are patched on `process.env` — the
 * same source the running configuration was validated from — and restored
 * afterwards. The production schema is never relaxed to accommodate a test.
 */
function withShiprocket(overrides: Record<string, string | undefined> = {}): void {
  for (const key of SHIPPING_ENV_KEYS) {
    if (!(key in SAVED_ENV)) {
      SAVED_ENV[key] = process.env[key];
    }
  }

  const values: Record<string, string | undefined> = {
    SHIPROCKET_API_EMAIL: 'api-user@example.test',
    SHIPROCKET_API_PASSWORD: 'api-password',
    SHIPROCKET_PICKUP_LOCATION: 'Primary Warehouse',
    SHIPROCKET_COURIER_ID: '9',
    SHIPROCKET_WEBHOOK_SECRET: 'shiprocket-webhook-secret',
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // A cached token from a previous test would mask a re-authentication.
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

/**
 * Stub the provider.
 *
 * The routing is by URL, because the shipping flow makes several calls with
 * different shapes: a login, an order creation, an AWB assignment, a label
 * generation and a tracking read.
 */
interface StubbedCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

const calls: StubbedCall[] = [];

/**
 * Read the webhook endpoint's outcome word.
 *
 * The webhook route deliberately does not use the standard `{ ok, data }`
 * envelope — it is an endpoint a provider posts to, and its contract is kept
 * minimal on purpose so it cannot drift as internal response types change.
 */
function outcome(body: unknown): string {
  return (body as { outcome: string }).outcome;
}

/**
 * Install a fetch stub.
 *
 * `routes` maps a URL fragment to the response. A fragment that is not
 * mapped falls back to `fallback`, so a test only has to describe the calls
 * it cares about.
 */
function stubShiprocket(
  routes: Array<{ match: string; body: unknown; status?: number }>,
  fallback: { body: unknown; status?: number } = { body: { success: true, data: {} } },
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;

    calls.push({ url, method, body });

    const route = routes.find((candidate) => url.includes(candidate.match));
    const response = route ?? fallback;

    const status = response.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(response.body)),
    };
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

/**
 * The successful provider responses for a complete dispatch.
 *
 * The shapes are the ones Shiprocket actually documents (verified 25 Oct
 * 2026):
 *
 *  - the login returns `{ success, data: { token } }`;
 *  - order creation returns `{ order_id, shipment_id, status, status_code }`
 *    at the **top level** — there is no `data` wrapper;
 *  - AWB assignment returns `{ awb_assign_status, response: { data: {...} } }`
 *    — the payload is a **third** level down;
 *  - label generation returns `{ label_created, label_url }` at the top level.
 */
function providerHappyPath(): Array<{ match: string; body: unknown }> {
  return [
    {
      match: '/auth/login',
      body: { success: true, data: { token: 'shiprocket-test-token' } },
    },
    {
      match: '/orders/create/adhoc',
      body: {
        success: true,
        order_id: 16161616,
        shipment_id: 15151515,
        status: 'NEW',
        status_code: 1,
        awb_code: null,
        courier_company_id: null,
        courier_name: null,
      },
    },
    {
      match: '/courier/assign/awb',
      body: {
        awb_assign_status: 1,
        response: {
          data: {
            courier_company_id: 9,
            awb_code: 'AWB1234567',
            awb_code_status: 1,
            shipment_id: 15151515,
            courier_name: 'Test Courier',
            pickup_scheduled_date: '2026-10-25 14:00:00',
          },
        },
      },
    },
    {
      match: '/courier/generate/label',
      body: {
        label_created: 1,
        label_url: 'https://labels.example.test/label.pdf',
        response: 'Label has been created and uploaded successfully!',
        not_created: [],
      },
    },
    {
      match: '/courier/generate/pickup',
      body: { success: true, data: { pickup_scheduled_date: '2026-10-25' } },
    },
    {
      match: '/courier/track/awb/',
      body: {
        success: true,
        data: {
          awb: 'AWB1234567',
          current_status: 'IN TRANSIT',
          current_status_id: 4,
          etd: '2026-10-27',
          scans: [
            {
              date: '2026-10-24T10:00:00+05:30',
              status: 'IN TRANSIT',
              activity: 'Departed hub',
              location: 'Jaipur',
            },
          ],
        },
      },
    },
  ];
}

/** The signed-in customer's token. */
async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

/** The signed-in administrator's token. */
async function adminToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/admin/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

/** A real order, placed through the real checkout. */
async function placeCodOrder(): Promise<{
  orderId: string;
  orderNumber: string;
  token: string;
  customerId: string;
  email: string;
}> {
  await setStoreSettings({ shippingFee: 99, freeShippingThreshold: 0, taxRateBps: 0 });

  const customer = await createCustomer();
  const token = await customerToken(customer.email, customer.password);
  const { variant } = await createProductWithVariant(
    { title: 'Shipping Test Mojri', sellingPrice: 1500, mrp: 2000 },
    { stock: 10 },
  );

  await api()
    .post('/v1/cart/items')
    .set(bearer(token))
    .send({ variantId: variant.id, quantity: 1 });

  const key = `ship-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await api()
    .post('/v1/checkout/orders')
    .set(bearer(token))
    .set('Idempotency-Key', key)
    .send({ shippingAddress: TEST_ADDRESS, paymentMethod: 'cod', idempotencyKey: key });

  expect(response.status).toBe(201);
  const order = success<{ id: string; orderNumber: string; customerId: string }>(response.body);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    token,
    customerId: order.customerId,
    email: customer.email,
  };
}

afterEach(() => {
  restoreEnv();
  calls.length = 0;
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

describe('shipping configuration', () => {
  it('reports what is missing when shipping is unconfigured', async () => {
    withShiprocket({
      SHIPROCKET_API_EMAIL: undefined,
      SHIPROCKET_API_PASSWORD: undefined,
      SHIPROCKET_PICKUP_LOCATION: undefined,
    });

    const configuration = shippingConfiguration();
    expect(configuration.configured).toBe(false);
    expect(configuration.missing).toContain('SHIPROCKET_API_EMAIL');
    expect(configuration.missing).toContain('SHIPROCKET_API_PASSWORD');
    expect(configuration.missing).toContain('SHIPROCKET_PICKUP_LOCATION');
  });

  it('reports a configured deployment honestly', async () => {
    withShiprocket();

    const configuration = shippingConfiguration();
    expect(configuration.configured).toBe(true);
    expect(configuration.pickupLocation).toBe('Primary Warehouse');
    expect(configuration.webhooksEnabled).toBe(true);
    expect(configuration.missing).toHaveLength(0);
  });

  it('requires the credential pair together', async () => {
    withShiprocket({ SHIPROCKET_API_PASSWORD: undefined });

    expect(shippingConfiguration().configured).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Provider identifier                                                        */
/* -------------------------------------------------------------------------- */

describe('provider order identifier', () => {
  it('derives a stable identifier from the order number', () => {
    expect(buildShiprocketOrderId('AJ20261023ABCD')).toBe('AJ-AJ20261023ABCD');
  });

  it('never exceeds the documented fifty-character limit', () => {
    expect(buildShiprocketOrderId('X'.repeat(120)).length).toBeLessThanOrEqual(50);
  });

  it('keeps an existing identifier stable, so a retry does not fork the order', () => {
    expect(buildShiprocketOrderId('AJ20261023ABCD', 'AJ-AJ20261023ABCD-R2')).toBe(
      'AJ-AJ20261023ABCD-R2',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Status mapping                                                             */
/* -------------------------------------------------------------------------- */

describe('carrier status mapping', () => {
  it('maps a pickup scan to shipped', () => {
    expect(mapTrackingStatus('PICKED UP')).toBe('shipped');
    expect(mapTrackingStatus('IN TRANSIT')).toBe('shipped');
  });

  it('maps an out-for-delivery scan', () => {
    expect(mapTrackingStatus('OUT FOR DELIVERY')).toBe('out_for_delivery');
  });

  it('maps a delivery scan to delivered', () => {
    expect(mapTrackingStatus('DELIVERED')).toBe('delivered');
  });

  it('maps a cancellation', () => {
    expect(mapTrackingStatus('CANCELLED')).toBe('cancelled');
  });

  it('does not guess at an unknown status', () => {
    expect(mapTrackingStatus('SOME NEW PROVIDER STATUS')).toBeNull();
    expect(mapTrackingStatus(undefined)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Shipment creation                                                          */
/* -------------------------------------------------------------------------- */

describe('shipment creation', () => {
  it('refuses to dispatch an order that has not been paid', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    // A COD order is unpaid until it arrives, so it cannot be dispatched
    // ahead of collection. Make the order explicitly online-and-unpaid.
    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentMethod: 'razorpay' } });

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(409);
    expect(failure(response.body).code).toBe('CONFLICT');
  });

  it('refuses to dispatch a cancelled order', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne(
      { _id: order.orderId },
      { $set: { status: 'cancelled', cancelledAt: new Date() } },
    );

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(409);
  });

  it('refuses to dispatch when shipping is not configured', async () => {
    withShiprocket({ SHIPROCKET_PICKUP_LOCATION: undefined });
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(422);
  });

  it('creates a shipment and records the provider identifiers', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(201);
    const shipment = success<{
      id: string;
      status: string;
      providerOrderId: string;
      providerShipmentId: string;
      awbCode: string | null;
      courierName: string | null;
    }>(response.body);

    expect(shipment.status).toBe('created');
    // The provider returns its own numeric order id at the top level.
    expect(shipment.providerOrderId).toBe('16161616');
    expect(shipment.providerShipmentId).toBe('15151515');
    // The provider does not assign a waybill at creation time — that is a
    // separate, explicit step.
    expect(shipment.awbCode).toBeNull();
    expect(shipment.courierName).toBeNull();

    const stored = await ShipmentModel.findById(shipment.id).lean<{
      orderId: { toString(): string };
    }>();
    expect(stored?.orderId.toString()).toBe(order.orderId);
  });

  it('sends the provider a payload that matches the documented contract', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({ note: 'Handle with care' });

    const create = calls.find((call) => call.url.includes('/orders/create/adhoc'));
    expect(create, 'the provider should have been asked to create an order').toBeDefined();

    const body = create!.body!;
    expect(body.order_id).toBe(`AJ-${order.orderNumber}`);
    expect(body.pickup_location).toBe('Primary Warehouse');
    expect(body.billing_pincode).toBe('302001');
    expect(body.payment_method).toBe('COD');
    expect(body.order_items).toHaveLength(1);
    expect((body.order_items as Array<{ sku: string }>)[0]?.sku).toBeTruthy();

    // Dimensions must exceed the documented minimum of 0.5 cm, and the
    // weight must exceed 0 kg, or the provider rejects the order.
    expect(body.length as number).toBeGreaterThan(0.5);
    expect(body.breadth as number).toBeGreaterThan(0.5);
    expect(body.height as number).toBeGreaterThan(0.5);
    expect(body.weight as number).toBeGreaterThan(0);
  });

  it('refuses a second live shipment for the same order', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const first = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    expect(first.status).toBe(201);

    const second = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(second.status).toBe(409);
    expect(failure(second.body).code).toBe('CONFLICT');
  });

  it('records a failed shipment rather than hiding it', async () => {
    withShiprocket();
    stubShiprocket(
      [
        {
          match: '/auth/login',
          body: { success: true, data: { token: 'shiprocket-test-token' } },
        },
        {
          match: '/orders/create/adhoc',
          body: { success: false, message: 'The pincode is not serviceable.' },
          status: 422,
        },
      ],
      { body: { success: true, data: {} } },
    );

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBeGreaterThanOrEqual(500);

    const shipment = await ShipmentModel.findOne({ orderId: order.orderId }).lean<{
      status: string;
      failureReason: string;
    }>();

    expect(shipment?.status).toBe('failed');
    expect(shipment?.failureReason).toContain('not serviceable');
  });
});

/* -------------------------------------------------------------------------- */
/* AWB, label, pickup                                                         */
/* -------------------------------------------------------------------------- */

describe('AWB, label and pickup', () => {
  it('assigns an AWB and generates the label in one step', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/awb`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(200);
    const updated = success<{ status: string; awbCode: string; labelUrl: string }>(response.body);
    expect(updated.status).toBe('awb_assigned');
    expect(updated.awbCode).toBe('AWB1234567');
    expect(updated.labelUrl).toContain('label.pdf');

    // The documented label endpoint takes an array of shipment ids.
    const labelCall = calls.find((call) => call.url.includes('/courier/generate/label'));
    expect(labelCall?.body).toEqual({ shipment_id: ['15151515'] });
  });

  it('does not mark the order as shipped when a label is generated', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    await api().post(`/v1/admin/shipments/${shipment.id}/awb`).set(bearer(token)).send({});

    const orderDoc = await OrderModel.findById(order.orderId).lean<{ status: string }>();
    expect(orderDoc?.status).not.toBe('shipped');
  });

  it('does not mark the order as shipped when a pickup is requested', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/pickup`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(200);

    const orderDoc = await OrderModel.findById(order.orderId).lean<{ status: string }>();
    expect(orderDoc?.status).not.toBe('shipped');
  });
});

/* -------------------------------------------------------------------------- */
/* Tracking webhook                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Dispatch a shipment so there is something for the webhook to find.
 *
 * The waybill is assigned as well, because the tracking webhook is keyed
 * on the AWB — and because the documented create-order response carries
 * `awb_code: null`, the waybill only exists after the explicit AWB step.
 *
 * At module scope, because the callback-URL tests below live in their own
 * `describe` block and need the same helper.
 */
async function dispatchShipment(): Promise<{ orderId: string; shipmentId: string }> {
  const order = await placeCodOrder();
  const admin = await createAdmin({ role: 'admin' });
  const token = await adminToken(admin.email, admin.password);

  await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

  const created = await api()
    .post(`/v1/admin/shipments/orders/${order.orderId}`)
    .set(bearer(token))
    .send({});
  const shipment = success<{ id: string }>(created.body);

  const awb = await api()
    .post(`/v1/admin/shipments/${shipment.id}/awb`)
    .set(bearer(token))
    .send({});
  expect(awb.status).toBe(200);

  return { orderId: order.orderId, shipmentId: shipment.id };
}

describe('tracking webhook', () => {
  it('ignores a delivery with no API key', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    const response = await api()
      .post('/webhooks/shiprocket')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    expect(response.status).toBe(200);

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).not.toBe('shipped');
  });

  it('ignores a delivery with the wrong API key', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    const response = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'the-wrong-secret')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    expect(response.status).toBe(200);

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).not.toBe('shipped');
  });

  it('ignores every delivery when no webhook secret is configured', async () => {
    withShiprocket({ SHIPROCKET_WEBHOOK_SECRET: undefined });
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    const response = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'anything-at-all')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    expect(response.status).toBe(200);

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).not.toBe('shipped');
  });

  it('promotes the order to shipped when the parcel is actually moving', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    const response = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({
        awb: 'AWB1234567',
        current_status: 'PICKED UP',
        current_status_id: 3,
        etd: '2026-10-27',
        scans: [
          {
            date: '2026-10-24T10:00:00+05:30',
            status: 'PICKED UP',
            activity: 'Picked up',
            location: 'Jaipur',
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(outcome(response.body)).toBe('processed');

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).toBe('shipped');

    const shipment = await ShipmentModel.findOne({ awbCode: 'AWB1234567' }).lean<{
      status: string;
      estimatedDelivery: string;
      trackingStatus: string;
    }>();
    expect(shipment?.status).toBe('shipped');
    expect(shipment?.estimatedDelivery).toBe('2026-10-27');
    expect(shipment?.trackingStatus).toBe('PICKED UP');
  });

  it('completes the order when the parcel is delivered', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'DELIVERED' });

    const orderDoc = await OrderModel.findById(orderId).lean<{
      status: string;
      deliveredAt: Date;
    }>();
    expect(orderDoc?.status).toBe('completed');
    expect(orderDoc?.deliveredAt).toBeTruthy();
  });

  it('never walks a delivered parcel backwards', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'DELIVERED' });

    // A late, out-of-order scan arrives after the delivery.
    await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    const shipment = await ShipmentModel.findOne({ awbCode: 'AWB1234567' }).lean<{
      status: string;
    }>();
    expect(shipment?.status).toBe('delivered');

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).toBe('completed');
  });

  it('completes an order that was already marked shipped', async () => {
    /*
     * Regression test.
     *
     * The promotion filter only allowed `placed` and `processing` as source
     * statuses, so an order that had already been moved to `shipped` by an
     * earlier scan could **never** be moved to `completed`. The parcel
     * would arrive and the order would sit at `shipped` for ever — the
     * customer would never see the order as delivered, and the delivery
     * timestamp would never be set.
     */
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    // First scan: the parcel is moving.
    await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    const afterTransit = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(afterTransit?.status).toBe('shipped');

    // Second scan: the parcel is delivered.
    await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'DELIVERED' });

    const afterDelivery = await OrderModel.findById(orderId).lean<{
      status: string;
      deliveredAt: Date | null;
    }>();
    expect(afterDelivery?.status).toBe('completed');
    expect(afterDelivery?.deliveredAt).toBeTruthy();
  });

  it('records the outcome of every delivery', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    await dispatchShipment();

    await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    const event = await WebhookEventModel.findOne({
      provider: 'shiprocket',
      eventId: 'AWB1234567',
    }).lean<{ outcome: string }>();

    expect(event?.outcome).toBe('processed');
  });

  it('acknowledges an unrecognised payload without failing', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const response = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ something: 'entirely unexpected' });

    // The provider requires a 200; anything else causes an endless retry.
    expect(response.status).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* The callback URL rule                                                      */
/* -------------------------------------------------------------------------- */

describe('Shiprocket tracking webhook URL', () => {
  /*
   * Shiprocket's own documentation says, verbatim:
   *
   *   "Please do not use keywords like shiprocket, kartrocket, sr, or kr in
   *    your webhook URL."
   *
   * A callback URL containing any of those substrings is rejected by the
   * provider, so the platform's obvious path — `/webhooks/shiprocket` — can
   * never be the one configured in the dashboard. If it were the only path
   * mounted, tracking would silently never arrive.
   *
   * These tests pin the canonical path and the rule itself, so a future
   * refactor cannot quietly reintroduce a forbidden path.
   */

  it('serves the canonical tracking path, which contains no forbidden keyword', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    const response = await api()
      .post('/webhooks/carrier/track')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    expect(response.status).toBe(200);

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).toBe('shipped');
  });

  it('the canonical path contains none of the substrings Shiprocket forbids', () => {
    const forbidden = ['shiprocket', 'kartrocket', 'sr', 'kr'];

    for (const keyword of forbidden) {
      expect(SHIPROCKET_WEBHOOK_PATH.toLowerCase()).not.toContain(keyword);
    }
  });

  it('keeps the legacy path working for an environment configured before the rule', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const { orderId } = await dispatchShipment();

    const response = await api()
      .post('/webhooks/shiprocket')
      .set('x-api-key', 'shiprocket-webhook-secret')
      .send({ awb: 'AWB1234567', current_status: 'IN TRANSIT' });

    expect(response.status).toBe(200);

    const orderDoc = await OrderModel.findById(orderId).lean<{ status: string }>();
    expect(orderDoc?.status).toBe('shipped');
  });
});

/* -------------------------------------------------------------------------- */
/* Cancellation                                                               */
/* -------------------------------------------------------------------------- */

describe('shipment cancellation', () => {
  it('cancels through the carrier and records the reason', async () => {
    withShiprocket();
    stubShiprocket([
      ...providerHappyPath(),
      {
        match: '/orders/cancel',
        body: { success: true, data: { message: 'Order cancelled' } },
      },
    ]);

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/cancel`)
      .set(bearer(token))
      .send({ reason: 'Customer changed their mind' });

    expect(response.status).toBe(200);
    expect(success<{ status: string }>(response.body).status).toBe('cancelled');

    const cancelCall = calls.find((call) => call.url.includes('/orders/cancel'));
    // The documented body is `{ ids: [<shiprocket_order_id>] }` — an array of
    // the provider's own numeric order id.
    expect(cancelCall?.body).toEqual({
      ids: [16161616],
      cancel_reason: 'Customer changed their mind',
    });
  });

  it('leaves the local state alone when the carrier refuses', async () => {
    withShiprocket();
    stubShiprocket([
      ...providerHappyPath(),
      {
        match: '/orders/cancel',
        body: { success: false, message: 'The shipment has already been picked up.' },
        status: 422,
      },
    ]);

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/cancel`)
      .set(bearer(token))
      .send({ reason: 'Customer changed their mind' });

    expect(response.status).toBe(409);

    const stored = await ShipmentModel.findById(shipment.id).lean<{
      status: string;
      failureReason: string;
    }>();
    expect(stored?.status).not.toBe('cancelled');
    expect(stored?.failureReason).toContain('already been picked up');
  });

  it('requires a reason', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/cancel`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

describe('reading shipments', () => {
  it('lets a customer read their own shipment', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const adminAuth = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    await api().post(`/v1/admin/shipments/orders/${order.orderId}`).set(bearer(adminAuth)).send({});

    const response = await api()
      .get(`/v1/shipments/orders/${order.orderId}/shipment`)
      .set(bearer(order.token));

    expect(response.status).toBe(200);
    expect(success<{ orderNumber: string }>(response.body).orderNumber).toBe(order.orderNumber);
  });

  it('does not let a customer read another customer’s shipment', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const adminAuth = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    await api().post(`/v1/admin/shipments/orders/${order.orderId}`).set(bearer(adminAuth)).send({});

    const other = await createCustomer();
    const otherToken = await customerToken(other.email, other.password);

    const response = await api()
      .get(`/v1/shipments/orders/${order.orderId}/shipment`)
      .set(bearer(otherToken));

    // 404 rather than 403: a valid id must never be confirmed.
    expect(response.status).toBe(404);
  });

  it('refuses a customer token on an admin shipment route', async () => {
    const order = await placeCodOrder();

    const response = await api().get('/v1/admin/shipments').set(bearer(order.token));

    expect(response.status).toBe(403);
  });

  it('lets support read a shipment but not dispatch one', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const support = await createAdmin({ role: 'support' });
    const token = await adminToken(support.email, support.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const read = await api().get('/v1/admin/shipments').set(bearer(token));
    expect(read.status).toBe(200);

    const write = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    expect(write.status).toBe(403);
  });

  it('lists shipments for an administrator', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    await api().post(`/v1/admin/shipments/orders/${order.orderId}`).set(bearer(token)).send({});

    const response = await api().get('/v1/admin/shipments').set(bearer(token));

    expect(response.status).toBe(200);
    const list = success<{ items: unknown[]; totalItems: number }>(response.body);
    expect(list.totalItems).toBe(1);
  });

  it('rejects an unknown shipment status filter', async () => {
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    const response = await api().get('/v1/admin/shipments?status=teleported').set(bearer(token));

    expect(response.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* Provider transport                                                         */
/* -------------------------------------------------------------------------- */

describe('provider transport', () => {
  it('authenticates once and reuses the token', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    await api().post(`/v1/admin/shipments/orders/${order.orderId}`).set(bearer(token)).send({});

    const logins = calls.filter((call) => call.url.includes('/auth/login'));
    expect(logins).toHaveLength(1);
  });

  it('re-authenticates exactly once after a 401', async () => {
    withShiprocket();

    let firstCall = true;
    const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null,
      });

      if (url.includes('/auth/login')) {
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ success: true, data: { token: 'tok' } })),
        };
      }

      // The first authenticated call is rejected as if the token expired.
      if (firstCall) {
        firstCall = false;
        return {
          ok: false,
          status: 401,
          text: () => Promise.resolve(JSON.stringify({ message: 'Token expired' })),
        };
      }

      return {
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              order_id: 16161616,
              shipment_id: 15151515,
              status: 'NEW',
              status_code: 1,
            }),
          ),
      };
    });
    vi.stubGlobal('fetch', mock);

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(201);

    // One login before the 401, one after it — never a loop.
    const logins = calls.filter((call) => call.url.includes('/auth/login'));
    expect(logins).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Documented provider contract                                                */
/* -------------------------------------------------------------------------- */

/**
 * Shiprocket's response envelope is **not** uniform, and every one of these
 * shapes is documented. Each one is a place where reading the wrong level
 * silently produced an empty result — an order created with no waybill, a
 * courier list that was always empty, or a cancellation the carrier never
 * received.
 */
describe('documented shiprocket response shapes', () => {
  it('reads the token from a top-level login response', async () => {
    withShiprocket();

    /*
     * Some Shiprocket accounts return the login payload at the top level
     * rather than under `data`. Reading only `data.token` made every call
     * against those accounts fail with "did not return an access token".
     */
    stubShiprocket([
      { match: '/auth/login', body: { success: true, token: 'top-level-token' } },
      {
        match: '/orders/create/adhoc',
        body: { order_id: 16161616, shipment_id: 15151515, status: 'NEW', status_code: 1 },
      },
    ]);

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const response = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(201);
  });

  it('reads the waybill from the nested AWB assignment response', async () => {
    withShiprocket();

    /*
     * The documented AWB response is `{ awb_assign_status, response: { data } }`
     * — the payload is a **third** level down. Reading only `data` returned
     * nothing, so the shipment was created and never given a waybill.
     */
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/awb`)
      .set(bearer(token))
      .send({});

    expect(response.status).toBe(200);
    expect(success<{ awbCode: string }>(response.body).awbCode).toBe('AWB1234567');
  });

  it('treats a failed waybill assignment as a failure, not a success', async () => {
    withShiprocket();

    /*
     * The documented failure body is
     * `{ awb_assign_status: 0, response: { data: { awb_assign_error } } }`
     * — and it arrives with HTTP 200. Without the status check, the shipment
     * was left with no waybill while the operator was told it had one.
     */
    stubShiprocket([
      {
        // Placed first: the stub matches the **first** route whose fragment
        // appears in the URL, so this override must precede the happy path.
        match: '/courier/assign/awb',
        body: {
          awb_assign_status: 0,
          response: { data: { awb_assign_error: 'Awb Assignment Failed' } },
        },
      },
      ...providerHappyPath(),
    ]);

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    const response = await api()
      .post(`/v1/admin/shipments/${shipment.id}/awb`)
      .set(bearer(token))
      .send({});

    expect(response.status).not.toBe(200);

    const stored = await ShipmentModel.findById(shipment.id).lean<{
      awbCode: string | null;
      status: string;
    }>();
    expect(stored?.awbCode ?? null).toBeNull();
    expect(stored?.status).not.toBe('awb_assigned');
  });

  it('sends the pickup request as the documented single-element array', async () => {
    withShiprocket();
    stubShiprocket(providerHappyPath());

    const order = await placeCodOrder();
    const admin = await createAdmin({ role: 'admin' });
    const token = await adminToken(admin.email, admin.password);

    await OrderModel.updateOne({ _id: order.orderId }, { $set: { paymentStatus: 'paid' } });

    const created = await api()
      .post(`/v1/admin/shipments/orders/${order.orderId}`)
      .set(bearer(token))
      .send({});
    const shipment = success<{ id: string }>(created.body);

    await api().post(`/v1/admin/shipments/${shipment.id}/pickup`).set(bearer(token)).send({});

    const pickup = calls.find((call) => call.url.includes('/courier/generate/pickup'));
    // The documented body is `{ shipment_id: [<id>] }`.
    expect(pickup?.body).toEqual({ shipment_id: ['15151515'] });
  });

  it('reads the serviceable couriers from the documented key', async () => {
    withShiprocket();

    /*
     * The documented key is `data.available_courier_companies`, and the
     * courier id is `courier_company_id` — the response's own `id` is a
     * per-quote identifier, not the courier id.
     */
    stubShiprocket([
      { match: '/auth/login', body: { success: true, data: { token: 'tok' } } },
      {
        match: '/courier/serviceability',
        body: {
          success: true,
          data: {
            available_courier_companies: [
              {
                courier_company_id: 43,
                id: 459245934,
                courier_name: 'Delhivery Surface',
                freight_charge: 54,
                rate: 54,
                estimated_delivery_days: '4',
              },
            ],
          },
        },
      },
    ]);

    const { checkServiceability } = await import('../src/services/shiprocket.service.js');
    const couriers = await checkServiceability({
      pickupPostcode: '302001',
      deliveryPostcode: '302001',
      cod: true,
      weight: 0.8,
    });

    expect(couriers).toHaveLength(1);
    expect(couriers[0]!.courier_company_id).toBe(43);
    expect(couriers[0]!.courier_name).toBe('Delhivery Surface');
  });
});
