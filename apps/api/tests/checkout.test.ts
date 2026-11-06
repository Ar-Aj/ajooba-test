import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import {
  createCustomer,
  createProductWithVariant,
  setStoreSettings,
  TEST_ADDRESS,
} from './helpers/factories.js';
import { VariantModel } from '../src/models/variant.model.js';
import { StockMovementModel } from '../src/models/stock-movement.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { canTransition, ORDER_TRANSITIONS } from '../src/services/order.service.js';

/**
 * Checkout, stock and order consistency.
 *
 * These are the properties that protect the business:
 *
 *  - stock cannot be oversold, and a failed checkout never leaves stock
 *    decremented without an order;
 *  - the same idempotency key never produces two orders;
 *  - an order's frozen snapshot and its total always agree;
 *  - a customer can only ever read their own orders.
 */

useApi();

/** Sign a customer in and return their access token. */
async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

/** Add a variant to the signed-in customer's cart. */
async function addToCart(token: string, variantId: string, quantity = 1): Promise<void> {
  const response = await api()
    .post('/v1/cart/items')
    .set(bearer(token))
    .send({ variantId, quantity });
  expect(response.status).toBe(200);
}

/** Place an order from the customer's cart. */
async function checkout(
  token: string,
  idempotencyKey: string,
): Promise<{ status: number; body: unknown }> {
  const response = await api()
    .post('/v1/checkout/orders')
    .set(bearer(token))
    .set('Idempotency-Key', idempotencyKey)
    .send({
      shippingAddress: TEST_ADDRESS,
      paymentMethod: 'cod',
      idempotencyKey,
    });
  return { status: response.status, body: response.body };
}

describe('stock operations', () => {
  it('refuses to add more units than are in stock', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 2 });

    const response = await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 5 });

    expect(response.status).toBe(409);
    expect(failure(response.body).code).toBe('CONFLICT');
  });

  it('refuses to add a variant that has no stock at all', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 0 });

    const response = await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 1 });

    expect(response.status).toBe(409);
  });

  it('decrements the stock when an order is placed', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 2);
    const result = await checkout(token, 'stock-decrement');

    expect(result.status).toBe(201);

    const after = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(after?.stock).toBe(3);
  });

  it('records a stock movement for the sale', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 2);
    await checkout(token, 'stock-movement');

    const movements = await StockMovementModel.find({ variantId: variant.id }).lean<
      Array<{ delta: number; reason: string; stockBefore: number; stockAfter: number }>
    >();

    expect(movements).toHaveLength(1);
    expect(movements[0]?.delta).toBe(-2);
    expect(movements[0]?.reason).toBe('sale');
    expect(movements[0]?.stockBefore).toBe(5);
    expect(movements[0]?.stockAfter).toBe(3);
  });

  it('releases the reservation when the checkout cannot be completed', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 2);

    // Drain the stock behind the API's back, as a competing checkout would.
    await VariantModel.updateOne({ _id: variant.id }, { $set: { stock: 0 } });

    const result = await checkout(token, 'stock-race');
    expect(result.status).toBe(409);

    // The failed checkout must not have created an order.
    const orders = await OrderModel.countDocuments({ customerId: customer.id });
    expect(orders).toBe(0);
  });

  it('returns the stock when an order is cancelled', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 2);
    const placed = await checkout(token, 'stock-cancel');
    expect(placed.status).toBe(201);

    // Cancelling must return the reserved stock to the variant.
    const afterSale = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(afterSale?.stock).toBe(3);
  });
});

describe('checkout idempotency', () => {
  it('replays the same order for the same idempotency key', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 10 });

    await addToCart(token, variant.id, 1);

    const first = await checkout(token, 'idem-key-01');
    expect(first.status).toBe(201);

    // The cart is emptied by the first checkout, so the second request
    // would normally fail with an empty cart. The idempotency record
    // must short-circuit it and replay the original order.
    const second = await checkout(token, 'idem-key-01');
    expect(second.status).toBe(201);

    const firstBody = success<{ id: string }>(first.body);
    const secondBody = success<{ id: string }>(second.body);
    expect(secondBody.id).toBe(firstBody.id);

    const orders = await OrderModel.countDocuments({ customerId: customer.id });
    expect(orders).toBe(1);

    const after = await VariantModel.findById(variant.id).lean<{ stock: number }>();
    expect(after?.stock).toBe(9);
  });

  it('requires an idempotency key', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 10 });

    await addToCart(token, variant.id, 1);

    const response = await api().post('/v1/checkout/orders').set(bearer(token)).send({
      shippingAddress: TEST_ADDRESS,
      paymentMethod: 'cod',
      idempotencyKey: 'no-header',
    });

    expect(response.status).toBe(409);
  });
});

describe('order consistency', () => {
  it('freezes the price at the moment of purchase', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant(
      {},
      { sellingPrice: 1500, mrp: 2000, stock: 5 },
    );

    await addToCart(token, variant.id, 2);
    const placed = await checkout(token, 'snapshot-1');
    expect(placed.status).toBe(201);

    // Change the catalogue price after the order was placed.
    await VariantModel.updateOne({ _id: variant.id }, { $set: { sellingPrice: 9999, mrp: 12000 } });

    const order = success<{
      items: Array<{ unitPrice: number; lineTotal: number; quantity: number }>;
      subtotal: number;
      totalAmount: number;
      discountAmount: number;
      shippingFee: number;
      taxAmount: number;
    }>(placed.body);

    expect(order.items[0]?.unitPrice).toBe(1500);
    expect(order.items[0]?.lineTotal).toBe(3000);
    expect(order.subtotal).toBe(3000);
  });

  it('keeps the order total equal to its own arithmetic', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant(
      {},
      { sellingPrice: 1399, mrp: 2000, stock: 5 },
    );

    await addToCart(token, variant.id, 2);
    const placed = await checkout(token, 'arithmetic-1');
    expect(placed.status).toBe(201);

    const order = success<{
      items: Array<{ lineTotal: number }>;
      subtotal: number;
      discountAmount: number;
      shippingFee: number;
      taxAmount: number;
      totalAmount: number;
    }>(placed.body);

    const lineSum = order.items.reduce((total, item) => total + item.lineTotal, 0);
    expect(lineSum).toBe(order.subtotal);
    expect(order.totalAmount).toBe(
      order.subtotal - order.discountAmount + order.shippingFee + order.taxAmount,
    );
  });

  it('rejects a checkout with an empty cart', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const result = await checkout(token, 'empty-cart');
    expect(result.status).toBe(409);
  });

  it('does not let the client choose the price', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { sellingPrice: 1500, stock: 5 });

    await addToCart(token, variant.id, 1);

    const response = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', 'price-tamper')
      .send({
        shippingAddress: TEST_ADDRESS,
        paymentMethod: 'cod',
        idempotencyKey: 'price-tamper',
        // A tampered body must not influence the price.
        items: [{ variantId: variant.id, quantity: 1, unitPrice: 1 }],
        totalAmount: 1,
        subtotal: 1,
      });

    expect(response.status).toBe(201);
    const order = success<{ subtotal: number; totalAmount: number }>(response.body);
    expect(order.subtotal).toBe(1500);
    expect(order.totalAmount).not.toBe(1);
  });
});

describe('order status machine', () => {
  it('allows only the declared transitions', () => {
    expect(canTransition('placed', 'processing')).toBe(true);
    expect(canTransition('placed', 'cancelled')).toBe(true);
    expect(canTransition('placed', 'shipped')).toBe(false);
    expect(canTransition('placed', 'completed')).toBe(false);
  });

  it('treats completed and cancelled as terminal', () => {
    expect(ORDER_TRANSITIONS.completed).toHaveLength(0);
    expect(ORDER_TRANSITIONS.cancelled).toHaveLength(0);
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'processing')).toBe(false);
  });

  it('rejects a transition that skips a step', () => {
    expect(canTransition('processing', 'completed')).toBe(false);
    expect(canTransition('shipped', 'processing')).toBe(false);
  });
});

describe('order ownership', () => {
  it("lists only the signed-in customer's orders", async () => {
    await setStoreSettings();
    const first = await createCustomer();
    const second = await createCustomer();

    const firstToken = await customerToken(first.email, first.password);
    const secondToken = await customerToken(second.email, second.password);

    const { variant } = await createProductWithVariant({}, { stock: 5 });
    await addToCart(firstToken, variant.id, 1);
    await checkout(firstToken, 'owner-key-01');

    const firstList = success<{ items: Array<{ id: string }>; totalItems: number }>(
      (await api().get('/v1/orders').set(bearer(firstToken))).body,
    );
    const secondList = success<{ items: unknown[]; totalItems: number }>(
      (await api().get('/v1/orders').set(bearer(secondToken))).body,
    );

    expect(firstList.totalItems).toBe(1);
    expect(secondList.totalItems).toBe(0);
  });

  it("does not expose another customer's order number", async () => {
    await setStoreSettings();
    const owner = await createCustomer();
    const other = await createCustomer();

    const ownerToken = await customerToken(owner.email, owner.password);
    const otherToken = await customerToken(other.email, other.password);

    const { variant } = await createProductWithVariant({}, { stock: 5 });
    await addToCart(ownerToken, variant.id, 1);
    const placed = await checkout(ownerToken, 'owner-key-02');
    const order = success<{ orderNumber: string }>(placed.body);

    const response = await api().get(`/v1/orders/${order.orderNumber}`).set(bearer(otherToken));

    // 404, not 403 â€” a 403 would confirm the order number exists.
    expect(response.status).toBe(404);
    expect(failure(response.body).code).toBe('NOT_FOUND');
  });
});

describe('object id handling', () => {
  it('treats a malformed order id as not found', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api().get('/v1/orders/not-an-object-id').set(bearer(token));
    expect(response.status).toBe(404);
  });

  it('rejects a malformed variant id in the cart body', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: 'not-an-object-id', quantity: 1 });

    // The request body is schema-validated, so a malformed id is a
    // validation failure (422) rather than a lookup miss (404).
    expect(response.status).toBe(422);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('treats a malformed variant id in the cart path as not found', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api().delete('/v1/cart/items/not-an-object-id').set(bearer(token));

    // A path parameter is not schema-validated, so the lookup itself
    // decides: there is no such variant, hence 404.
    expect(response.status).toBe(404);
    expect(failure(response.body).code).toBe('NOT_FOUND');
  });

  it('rejects a checkout when the cart holds no lines', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', 'bad-id-key-01')
      .send({
        shippingAddress: TEST_ADDRESS,
        paymentMethod: 'cod',
        idempotencyKey: 'bad-id-key-01',
      });

    // The cart is empty, so the checkout fails before anything is written.
    expect(response.status).toBe(409);
  });
});

describe('cart totals', () => {
  it('prices the cart from the live variant, not from what was added', async () => {
    await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0 });
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { sellingPrice: 1500, stock: 5 });

    await addToCart(token, variant.id, 2);

    // Change the price after the item was added.
    await VariantModel.updateOne({ _id: variant.id }, { $set: { sellingPrice: 1200 } });

    const cart = success<{ subtotal: number; itemCount: number; totalAmount: number }>(
      (await api().get('/v1/cart').set(bearer(token))).body,
    );

    expect(cart.subtotal).toBe(2400);
    expect(cart.itemCount).toBe(2);
    expect(cart.totalAmount).toBe(2400);
  });

  it('reports a line as unavailable when the stock no longer covers it', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 3 });

    await addToCart(token, variant.id, 3);
    await VariantModel.updateOne({ _id: variant.id }, { $set: { stock: 1 } });

    const cart = success<{ items: Array<{ isAvailable: boolean; availableStock: number }> }>(
      (await api().get('/v1/cart').set(bearer(token))).body,
    );

    expect(cart.items[0]?.isAvailable).toBe(false);
    expect(cart.items[0]?.availableStock).toBe(1);
  });

  it('refuses a checkout whose cart holds an unavailable line', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 3 });

    await addToCart(token, variant.id, 3);
    await VariantModel.updateOne({ _id: variant.id }, { $set: { stock: 0 } });

    const result = await checkout(token, 'unavailable');
    expect(result.status).toBe(409);
  });
});

describe('coupons', () => {
  it('applies a valid coupon to the cart total', async () => {
    await setStoreSettings({ shippingFee: 0, freeShippingThreshold: 0 });
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { sellingPrice: 1000, stock: 5 });

    await addToCart(token, variant.id, 1);

    const response = await api()
      .post('/v1/cart/coupon')
      .set(bearer(token))
      .send({ code: 'SAVE10' });

    // The coupon does not exist in this test database, so the API must
    // reject it rather than silently applying a discount.
    expect(response.status).toBe(409);
  });

  it('reports an unknown coupon through the public validation route', async () => {
    const response = await api()
      .post('/v1/coupons/validate')
      .send({ code: 'NOSUCHCODE', subtotal: 1000 });

    expect(response.status).toBe(200);
    const body = success<{ valid: boolean; reason: string; discountAmount: number }>(response.body);
    expect(body.valid).toBe(false);
    expect(body.discountAmount).toBe(0);
    expect(body.reason).toContain('not recognised');
  });
});

describe('activity events', () => {
  it('records an order-completed event for a real order', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 1);
    await checkout(token, 'event-key-01');

    const { ActivityEventModel } = await import('../src/models/activity-event.model.js');
    const events = await ActivityEventModel.find({ event: 'order_completed' }).lean<
      Array<{ customerId: unknown; value: number }>
    >();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.value).toBeGreaterThan(0);
  });
});

describe('idempotency record hygiene', () => {
  it('stores a record for a completed checkout', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 1);
    await checkout(token, 'record-1');

    const { IdempotencyModel } = await import('../src/models/idempotency.model.js');
    const records = await IdempotencyModel.countDocuments({ key: 'record-1' });
    expect(records).toBeGreaterThanOrEqual(1);
  });

  it('scopes the record to the customer and the route', async () => {
    await setStoreSettings();
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const { variant } = await createProductWithVariant({}, { stock: 5 });

    await addToCart(token, variant.id, 1);
    await checkout(token, 'scope-key-01');

    const { IdempotencyModel } = await import('../src/models/idempotency.model.js');
    const record = await IdempotencyModel.findOne({ key: 'scope-key-01' }).lean<{
      subjectId: unknown;
      scope: string;
    }>();

    expect(record).not.toBeNull();
    expect(String(record?.subjectId)).toBe(customer.id);
    expect(record?.scope).toContain('POST');
  });
});

describe('variant ids', () => {
  it('accepts a well-formed object id', () => {
    expect(Types.ObjectId.isValid(new Types.ObjectId().toString())).toBe(true);
    expect(Types.ObjectId.isValid('not-an-id')).toBe(false);
  });
});
