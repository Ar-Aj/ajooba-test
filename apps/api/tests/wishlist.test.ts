import { describe, expect, it } from 'vitest';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { createCustomer, createProduct } from './helpers/factories.js';

useApi();

async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

interface WishlistProductItem {
  id: string;
  code: string;
  slug: string;
  title: string;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
}

describe('customer wishlist (/v1/wishlist)', () => {
  it('adds, lists with normalized id, deduplicates, and removes products for the signed-in customer', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);
    const productOne = await createProduct({ code: 'A41', title: 'Royal Mojri' });
    const productTwo = await createProduct({ code: 'A42', title: 'Classic Sandal' });

    const addOne = await api()
      .post('/v1/wishlist')
      .set(bearer(token))
      .send({ productId: productOne.id });
    expect(addOne.status).toBe(200);
    expect(success<{ items: string[]; count: number }>(addOne.body)).toEqual({
      items: [productOne.id],
      count: 1,
    });

    // Adding the same product twice is idempotent.
    const addDup = await api()
      .post('/v1/wishlist')
      .set(bearer(token))
      .send({ productId: productOne.id });
    expect(addDup.status).toBe(200);
    expect(success<{ items: string[]; count: number }>(addDup.body).count).toBe(1);

    await api()
      .post('/v1/wishlist')
      .set(bearer(token))
      .send({ productId: productTwo.id })
      .expect(200);

    const listRes = await api().get('/v1/wishlist').set(bearer(token));
    expect(listRes.status).toBe(200);
    const listBody = success<{ items: WishlistProductItem[]; count: number }>(listRes.body);
    expect(listBody.count).toBe(2);
    expect(listBody.items.map((item) => item.id)).toEqual([productOne.id, productTwo.id]);
    expect(listBody.items[0]?.title).toBe('Royal Mojri');

    const delRes = await api().delete(`/v1/wishlist/${productOne.id}`).set(bearer(token));
    expect(delRes.status).toBe(200);
    expect(success<{ items: string[]; count: number }>(delRes.body)).toEqual({
      items: [productTwo.id],
      count: 1,
    });
  });

  it('returns 404 when adding a non-existent product and 422 on malformed productId', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const missing = await api()
      .post('/v1/wishlist')
      .set(bearer(token))
      .send({ productId: '000000000000000000000000' });
    expect(missing.status).toBe(404);
    expect(failure(missing.body).code).toBe('NOT_FOUND');

    const invalidDelete = await api().delete('/v1/wishlist/not-an-object-id').set(bearer(token));
    expect(invalidDelete.status).toBe(422);
  });
});
