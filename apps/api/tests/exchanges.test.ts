import { Types } from 'mongoose';
import { afterEach, describe, expect, it } from 'vitest';
import { ExchangeRequestModel } from '../src/models/exchange-request.model.js';
import { OrderModel } from '../src/models/order.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import {
  createAdmin,
  createCustomer,
  createVariant,
  createProductWithVariant,
  TEST_ADDRESS,
} from './helpers/factories.js';

useApi();

afterEach(() => {
  // Models are reset by useApi; this hook keeps test setup explicit for this new collection.
});

async function loginCustomer(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

async function loginAdmin(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/admin/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return success<{ tokens: { accessToken: string } }>(response.body).tokens.accessToken;
}

async function makeDeliveredOrder(input: {
  customerId: string;
  email: string;
  productId: string;
  variantId: string;
  size: number;
  price: number;
  orderNumber?: string;
  deliveredAt?: Date;
}) {
  const lineTotal = input.price;
  return OrderModel.create({
    orderNumber: input.orderNumber ?? `EX-TEST-${new Types.ObjectId().toString().slice(-8)}`,
    customerId: new Types.ObjectId(input.customerId),
    customerName: 'Test Customer',
    customerEmail: input.email,
    customerPhone: TEST_ADDRESS.phone,
    items: [
      {
        productId: new Types.ObjectId(input.productId),
        variantId: new Types.ObjectId(input.variantId),
        sku: 'AJ-EX-ORIGINAL',
        title: 'Test Exchange Shoe',
        colour: 'Black',
        size: input.size,
        unitPrice: input.price,
        mrp: 2000,
        quantity: 1,
        lineTotal,
      },
    ],
    subtotal: lineTotal,
    shippingFee: 0,
    taxAmount: 0,
    discountAmount: 0,
    totalAmount: lineTotal,
    currency: 'INR',
    status: 'completed',
    paymentStatus: 'paid',
    couponCode: '',
    shippingAddress: TEST_ADDRESS,
    billingAddress: TEST_ADDRESS,
    paymentMethod: 'razorpay',
    placedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    deliveredAt: input.deliveredAt ?? new Date(),
  });
}

describe('size exchange workflow', () => {
  it('keeps customer requests separate and reserves replacement stock exactly once', async () => {
    const customer = await createCustomer();
    const customerJwt = await loginCustomer(customer.email, customer.password);
    const admin = await createAdmin({ role: 'owner' });
    const adminJwt = await loginAdmin(admin.email, admin.password);
    const { product, variant: original } = await createProductWithVariant(
      { code: 'EX01', title: 'Test Exchange Shoe', colours: ['Black'] },
      { size: 8, colour: 'Black', stock: 0 },
    );
    const replacement = await createVariant({
      productId: product.id,
      productCode: product.code,
      size: 9,
      colour: 'Black',
      colourToken: 'BLK',
      stock: 1,
    });
    const order = await makeDeliveredOrder({
      customerId: customer.id,
      email: customer.email,
      productId: product.id,
      variantId: original.id,
      size: 8,
      price: original.sellingPrice,
    });

    const optionsResponse = await api()
      .get(`/v1/exchanges/options?orderId=${order._id.toString()}&originalVariantId=${original.id}`)
      .set(bearer(customerJwt));
    expect(optionsResponse.status).toBe(200);
    expect(
      success<{ items: Array<{ variantId: string; available: boolean }> }>(optionsResponse.body)
        .items,
    ).toEqual([
      {
        variantId: replacement.id,
        size: 9,
        available: true,
        sellingPrice: 1500,
        mrp: 2000,
        unavailableReason: null,
      },
    ]);

    const createdResponse = await api().post('/v1/exchanges').set(bearer(customerJwt)).send({
      orderId: order._id.toString(),
      originalVariantId: original.id,
      replacementVariantId: replacement.id,
      quantity: 1,
      reasonNote: 'Need the next size.',
    });
    expect(createdResponse.status).toBe(201);
    const created = success<{ id: string; status: string }>(createdResponse.body);
    expect(created.status).toBe('requested');

    const approved = await api()
      .patch(`/v1/admin/exchanges/${created.id}`)
      .set(bearer(adminJwt))
      .send({ status: 'approved', note: '' });
    expect(approved.status).toBe(200);

    let stock = await VariantModel.findById(replacement.id).lean<{
      stock: number;
      reservedStock: number;
      exchangeReservations: string[];
    }>();
    expect(stock).toMatchObject({ stock: 0, reservedStock: 1, exchangeReservations: [created.id] });

    const repeatedApproval = await api()
      .patch(`/v1/admin/exchanges/${created.id}`)
      .set(bearer(adminJwt))
      .send({ status: 'approved', note: '' });
    expect(repeatedApproval.status).toBe(200);
    stock = await VariantModel.findById(replacement.id).lean<{
      stock: number;
      reservedStock: number;
      exchangeReservations: string[];
    }>();
    expect(stock).toMatchObject({ stock: 0, reservedStock: 1, exchangeReservations: [created.id] });

    for (const status of ['received', 'replacement-shipped', 'completed']) {
      const response = await api()
        .patch(`/v1/admin/exchanges/${created.id}`)
        .set(bearer(adminJwt))
        .send({ status, note: '' });
      expect(response.status).toBe(200);
    }
    stock = await VariantModel.findById(replacement.id).lean<{
      stock: number;
      reservedStock: number;
      exchangeReservations: string[];
    }>();
    expect(stock).toMatchObject({ stock: 0, reservedStock: 0, exchangeReservations: [] });
  });

  it('refuses a price mismatch, an expired order, and a request for another customer', async () => {
    const customer = await createCustomer();
    const token = await loginCustomer(customer.email, customer.password);
    const otherCustomer = await createCustomer();
    const { product, variant: original } = await createProductWithVariant(
      { code: 'EX02', title: 'Test Exchange Shoe', colours: ['Black'] },
      { size: 8, colour: 'Black', stock: 0 },
    );
    const replacement = await createVariant({
      productId: product.id,
      productCode: product.code,
      size: 9,
      colour: 'Black',
      stock: 2,
      sellingPrice: original.sellingPrice + 100,
    });
    const expired = await makeDeliveredOrder({
      customerId: customer.id,
      email: customer.email,
      productId: product.id,
      variantId: original.id,
      size: 8,
      price: original.sellingPrice,
      deliveredAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000),
    });
    const foreignOrder = await makeDeliveredOrder({
      customerId: otherCustomer.id,
      email: otherCustomer.email,
      productId: product.id,
      variantId: original.id,
      size: 8,
      price: original.sellingPrice,
    });

    const expiredResponse = await api()
      .get(
        `/v1/exchanges/options?orderId=${expired._id.toString()}&originalVariantId=${original.id}`,
      )
      .set(bearer(token));
    expect(expiredResponse.status).toBe(409);

    const foreignResponse = await api()
      .get(
        `/v1/exchanges/options?orderId=${foreignOrder._id.toString()}&originalVariantId=${original.id}`,
      )
      .set(bearer(token));
    expect(foreignResponse.status).toBe(409);

    const options = await api()
      .get(
        `/v1/exchanges/options?orderId=${foreignOrder._id.toString()}&originalVariantId=${original.id}`,
      )
      .set(bearer(await loginCustomer(otherCustomer.email, otherCustomer.password)));
    expect(
      success<{
        items: Array<{ variantId: string; available: boolean; unavailableReason: string }>;
      }>(options.body).items,
    ).toEqual([
      {
        variantId: replacement.id,
        size: 9,
        available: false,
        sellingPrice: original.sellingPrice + 100,
        mrp: 2000,
        unavailableReason: 'price-difference',
      },
    ]);

    const createMismatch = await api()
      .post('/v1/exchanges')
      .set(bearer(await loginCustomer(otherCustomer.email, otherCustomer.password)))
      .send({
        orderId: foreignOrder._id.toString(),
        originalVariantId: original.id,
        replacementVariantId: replacement.id,
        quantity: 1,
        reasonNote: '',
      });
    expect(createMismatch.status).toBe(409);
    expect(failure(createMismatch.body).message).toContain('different price');
    expect(await ExchangeRequestModel.countDocuments()).toBe(0);
  });
});
