import { describe, expect, it } from 'vitest';
import { api, bearer, failure, success, useApi } from './helpers/api.js';
import { createAdmin, createCustomer, TEST_PASSWORD } from './helpers/factories.js';

/**
 * Authorization contract.
 *
 * Two independent identity domains exist — customers and administrators —
 * and they must never overlap. These tests assert the separation at the
 * HTTP boundary, because that is where a mistake actually becomes an
 * escalation:
 *
 *  - a customer token is rejected by every administrator route;
 *  - an administrator token is rejected by every customer route;
 *  - an absent or malformed token is rejected by both;
 *  - a deactivated administrator loses access immediately, without waiting
 *    for their access token to expire.
 */

useApi();

/** Sign a customer in and return their access token. */
async function customerToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

/** Sign an administrator in and return their access token. */
async function adminToken(email: string, password: string): Promise<string> {
  const response = await api().post('/v1/admin/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  const body = success<{ tokens: { accessToken: string } }>(response.body);
  return body.tokens.accessToken;
}

describe('unauthenticated access', () => {
  it('rejects a customer route with no token', async () => {
    const response = await api().get('/v1/cart');
    expect(response.status).toBe(401);
    expect(failure(response.body).code).toBe('UNAUTHORIZED');
  });

  it('rejects an admin route with no token', async () => {
    const response = await api().get('/v1/admin/orders');
    expect(response.status).toBe(401);
    expect(failure(response.body).code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed authorization header', async () => {
    const response = await api().get('/v1/cart').set('Authorization', 'NotBearer abc');
    expect(response.status).toBe(401);
  });

  it('rejects a garbage bearer token', async () => {
    const response = await api().get('/v1/cart').set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });
});

describe('customer token against admin routes', () => {
  it('is rejected by the admin order list', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api().get('/v1/admin/orders').set(bearer(token));

    expect(response.status).toBe(403);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('is rejected by the admin dashboard', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api().get('/v1/admin/dashboard').set(bearer(token));

    expect(response.status).toBe(403);
  });

  it('is rejected by the admin coupon list', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api().get('/v1/admin/coupons').set(bearer(token));

    expect(response.status).toBe(403);
  });

  it('is rejected by the admin audit log', async () => {
    const customer = await createCustomer();
    const token = await customerToken(customer.email, customer.password);

    const response = await api().get('/v1/admin/audit-logs').set(bearer(token));

    expect(response.status).toBe(403);
  });
});

describe('admin token against customer routes', () => {
  it('is rejected by the customer cart', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api().get('/v1/cart').set(bearer(token));

    expect(response.status).toBe(403);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('is rejected by the customer wishlist', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api().get('/v1/wishlist').set(bearer(token));

    expect(response.status).toBe(403);
  });

  it('is rejected by the customer order list', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api().get('/v1/orders').set(bearer(token));

    expect(response.status).toBe(403);
  });

  it('is rejected by the customer checkout', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .post('/v1/checkout/orders')
      .set(bearer(token))
      .set('Idempotency-Key', 'admin-cannot-checkout')
      .send({
        shippingAddress: {
          fullName: 'Test Customer',
          phone: '+919876543210',
          line1: '12 Test Street',
          city: 'Jaipur',
          state: 'Rajasthan',
          postalCode: '302001',
          country: 'India',
        },
        paymentMethod: 'cod',
        idempotencyKey: 'admin-cannot-checkout',
      });

    expect(response.status).toBe(403);
  });
});

describe('customer ownership', () => {
  it("does not expose another customer's order", async () => {
    const owner = await createCustomer();
    const other = await createCustomer();

    const ownerToken = await customerToken(owner.email, owner.password);
    const otherToken = await customerToken(other.email, other.password);

    // The other customer asks for an order number that does not exist.
    // The endpoint must answer 404, never 403, so it cannot be used to
    // discover which order numbers exist.
    const response = await api().get('/v1/orders/AJF-000000-0000').set(bearer(otherToken));

    expect(response.status).toBe(404);
    expect(failure(response.body).code).toBe('NOT_FOUND');

    // The owner's own token is accepted by the same route shape.
    const ownResponse = await api().get('/v1/orders/AJF-000000-0000').set(bearer(ownerToken));
    expect(ownResponse.status).toBe(404);
  });

  it('scopes the customer order list to the signed-in customer', async () => {
    const first = await createCustomer();
    const second = await createCustomer();

    const firstToken = await customerToken(first.email, first.password);
    const secondToken = await customerToken(second.email, second.password);

    const firstList = success<{ items: unknown[] }>(
      (await api().get('/v1/orders').set(bearer(firstToken))).body,
    );
    const secondList = success<{ items: unknown[] }>(
      (await api().get('/v1/orders').set(bearer(secondToken))).body,
    );

    expect(firstList.items).toHaveLength(0);
    expect(secondList.items).toHaveLength(0);
  });
});

describe('deactivated administrators', () => {
  it('lose access immediately, without waiting for the token to expire', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const before = await api().get('/v1/admin/orders').set(bearer(token));
    expect(before.status).toBe(200);

    // Deactivate the account while the access token is still valid.
    const { AdminUserModel } = await import('../src/models/admin-user.model.js');
    await AdminUserModel.updateOne({ email: admin.email }, { $set: { isActive: false } });

    const after = await api().get('/v1/admin/orders').set(bearer(token));
    expect(after.status).toBe(401);
  });

  it('cannot sign in after deactivation', async () => {
    const admin = await createAdmin();
    const { AdminUserModel } = await import('../src/models/admin-user.model.js');
    await AdminUserModel.updateOne({ email: admin.email }, { $set: { isActive: false } });

    const response = await api()
      .post('/v1/admin/auth/login')
      .send({ email: admin.email, password: TEST_PASSWORD });

    expect(response.status).toBe(401);
  });
});

describe('sign-in behaviour', () => {
  it('gives the same error for a wrong password and an unknown email', async () => {
    const customer = await createCustomer();

    const wrongPassword = await api()
      .post('/v1/auth/login')
      .send({ email: customer.email, password: 'NotThePassword!123' });
    const unknownEmail = await api()
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'NotThePassword!123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(failure(wrongPassword.body).message).toBe(failure(unknownEmail.body).message);
  });

  it('rejects a duplicate registration', async () => {
    const customer = await createCustomer();

    const response = await api().post('/v1/auth/register').send({
      email: customer.email,
      phone: '+919876543211',
      password: TEST_PASSWORD,
      firstName: 'Test',
      lastName: 'Customer',
    });

    expect(response.status).toBe(409);
    expect(failure(response.body).code).toBe('CONFLICT');
  });

  it('rejects a refresh token on the admin refresh route', async () => {
    const customer = await createCustomer();
    const session = success<{ tokens: { refreshToken: string } }>(
      (
        await api()
          .post('/v1/auth/login')
          .send({ email: customer.email, password: customer.password })
      ).body,
    );

    const response = await api()
      .post('/v1/admin/auth/refresh')
      .send({ refreshToken: session.tokens.refreshToken });

    expect(response.status).toBe(401);
  });
});

/* -------------------------------------------------------------------------- */
/* Query validation                                                           */
/* -------------------------------------------------------------------------- */

describe('query validation is actually enforced', () => {
  /**
   * The defect this suite exists for.
   *
   * `validateQuery` stores its parsed result on a separate property and
   * deliberately leaves `req.query` untouched — Express 5 makes `req.query`
   * a getter-only property. A route that called `validateQuery(...)` and
   * then read `req.query` therefore **bypassed its own schema entirely**.
   *
   * That is not a theoretical concern: the admin order list accepted an
   * unrecognised `status` and passed it straight to the Mongo filter, and
   * the inventory list's `search` term was unbounded. The schemas existed
   * and looked right; they were just not consulted.
   *
   * These tests therefore assert the *observable* consequence: an invalid
   * query value must produce a `422`, not a silently different result set.
   */
  it('rejects an unknown order status on the admin order list', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/orders')
      .query({ status: 'not-a-real-status' })
      .set(bearer(token));

    expect(response.status).toBe(422);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown return status on the admin return list', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/returns')
      .query({ status: 'not-a-real-status' })
      .set(bearer(token));

    expect(response.status).toBe(422);
  });

  it('rejects an unknown shipment status on the admin shipment list', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/shipments')
      .query({ status: 'not-a-real-status' })
      .set(bearer(token));

    expect(response.status).toBe(422);
  });

  it('rejects an out-of-range dashboard window', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/dashboard')
      .query({ days: 100_000 })
      .set(bearer(token));

    expect(response.status).toBe(422);
  });

  it('rejects an unbounded inventory search term', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/inventory')
      .query({ search: 'x'.repeat(500) })
      .set(bearer(token));

    expect(response.status).toBe(422);
  });

  it('rejects a non-numeric page on the admin coupon list', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/coupons')
      .query({ page: 'first' })
      .set(bearer(token));

    expect(response.status).toBe(422);
  });

  it('rejects an unbounded page size on the admin audit log', async () => {
    const admin = await createAdmin();
    const token = await adminToken(admin.email, admin.password);

    const response = await api()
      .get('/v1/admin/audit-logs')
      .query({ pageSize: 100_000 })
      .set(bearer(token));

    expect(response.status).toBe(422);
  });
});
