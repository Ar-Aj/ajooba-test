import { describe, expect, it } from 'vitest';
import type { CustomerAddress } from '@ajooba/contracts';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { createCustomer, createProduct, createVariant } from './helpers/factories.js';

useApi();

async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

const sampleAddress = {
  label: 'Home',
  fullName: 'Aarav Sharma',
  phone: '+919876543210',
  line1: '14 Johari Bazar',
  line2: 'Near Hawa Mahal',
  city: 'Jaipur',
  state: 'Rajasthan',
  postalCode: '302003',
  country: 'India',
};

describe('customer address book (/v1/addresses)', () => {
  it('starts empty, promotes first address to default, and switches default cleanly', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const initial = await api().get('/v1/addresses').set(bearer(token));
    expect(initial.status).toBe(200);
    expect(success<{ items: CustomerAddress[]; count: number }>(initial.body)).toEqual({
      items: [],
      count: 0,
    });

    // First address becomes default even when isDefault is false.
    const createOne = await api()
      .post('/v1/addresses')
      .set(bearer(token))
      .send({ ...sampleAddress, isDefault: false });
    expect(createOne.status).toBe(201);
    const first = success<CustomerAddress>(createOne.body);
    expect(first.label).toBe('Home');
    expect(first.isDefault).toBe(true);
    expect(first.id).toMatch(/^[0-9a-f]{24}$/);

    // Second address with isDefault: true takes over default status.
    const createTwo = await api()
      .post('/v1/addresses')
      .set(bearer(token))
      .send({
        ...sampleAddress,
        label: 'Studio',
        line1: '88 MI Road',
        postalCode: '302001',
        isDefault: true,
      });
    expect(createTwo.status).toBe(201);
    const second = success<CustomerAddress>(createTwo.body);
    expect(second.isDefault).toBe(true);

    const list = success<{ items: CustomerAddress[]; count: number }>(
      (await api().get('/v1/addresses').set(bearer(token))).body,
    );
    expect(list.count).toBe(2);
    expect(list.items[0]?.id).toBe(second.id);
    expect(list.items[0]?.isDefault).toBe(true);
    expect(list.items[1]?.id).toBe(first.id);
    expect(list.items[1]?.isDefault).toBe(false);
  });

  it('updates individual fields without resetting omitted defaults (line2, isDefault)', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const created = success<CustomerAddress>(
      (
        await api()
          .post('/v1/addresses')
          .set(bearer(token))
          .send({ ...sampleAddress, isDefault: true })
      ).body,
    );

    const patched = await api()
      .patch(`/v1/addresses/${created.id}`)
      .set(bearer(token))
      .send({ label: 'Parents Home' });
    expect(patched.status).toBe(200);
    const updated = success<CustomerAddress>(patched.body);
    expect(updated.label).toBe('Parents Home');
    expect(updated.line2).toBe('Near Hawa Mahal');
    expect(updated.isDefault).toBe(true);
  });

  it('promotes the remaining address to default when the default address is deleted', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const first = success<CustomerAddress>(
      (
        await api()
          .post('/v1/addresses')
          .set(bearer(token))
          .send({ ...sampleAddress, label: 'Home', isDefault: true })
      ).body,
    );
    const second = success<CustomerAddress>(
      (
        await api()
          .post('/v1/addresses')
          .set(bearer(token))
          .send({ ...sampleAddress, label: 'Office', isDefault: false })
      ).body,
    );

    const del = await api().delete(`/v1/addresses/${first.id}`).set(bearer(token));
    expect(del.status).toBe(200);
    const body = success<{ deleted: boolean; items: CustomerAddress[]; count: number }>(del.body);
    expect(body.deleted).toBe(true);
    expect(body.count).toBe(1);
    expect(body.items[0]?.id).toBe(second.id);
    expect(body.items[0]?.isDefault).toBe(true);
  });

  it('prevents a customer from modifying or deleting another customer address', async () => {
    const owner = await createCustomer();
    const other = await createCustomer();
    const ownerToken = await customerToken(owner.email, owner.password);
    const otherToken = await customerToken(other.email, other.password);

    const created = success<CustomerAddress>(
      (await api().post('/v1/addresses').set(bearer(ownerToken)).send(sampleAddress)).body,
    );

    const patchAttempt = await api()
      .patch(`/v1/addresses/${created.id}`)
      .set(bearer(otherToken))
      .send({ label: 'Hijacked' });
    expect(patchAttempt.status).toBe(404);
    expect(failure(patchAttempt.body).code).toBe('NOT_FOUND');

    const deleteAttempt = await api().delete(`/v1/addresses/${created.id}`).set(bearer(otherToken));
    expect(deleteAttempt.status).toBe(404);
  });

  it('integrates saved address id directly with POST /v1/checkout/orders', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const product = await createProduct({ sellingPrice: 1299, mrp: 1699 });
    const variant = await createVariant({
      productId: product.id,
      sellingPrice: 1299,
      mrp: 1699,
      stock: 5,
    });

    const createdAddress = success<CustomerAddress>(
      (await api().post('/v1/addresses').set(bearer(token)).send(sampleAddress)).body,
    );

    await api()
      .post('/v1/cart/items')
      .set(bearer(token))
      .send({ variantId: variant.id, quantity: 1 })
      .expect(200);

    const orderRes = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', 'saved-addr-checkout-1')
      .send({
        shippingAddressId: createdAddress.id,
        paymentMethod: 'cod',
        idempotencyKey: 'saved-addr-checkout-1',
      });
    expect(orderRes.status).toBe(201);
    const order = success<{ shippingAddress: { line1: string; postalCode: string } }>(
      orderRes.body,
    );
    expect(order.shippingAddress.line1).toBe(sampleAddress.line1);
    expect(order.shippingAddress.postalCode).toBe(sampleAddress.postalCode);
  });
});
