import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { ApiFailure, ApiSuccess } from '@ajooba/contracts';
import { createApp } from '../src/app.js';

/** The route index as `/health` publishes it. */
type RouteIndex = Record<string, readonly string[]>;

/** The only part of the envelope these tests read. */
interface ErrorEnvelope {
  readonly error?: { readonly message?: string };
}

/**
 * Read the published route index.
 *
 * `supertest` types `response.body` as `any`; every read is funnelled through
 * this one helper so the untyped value is confined to a single place and the
 * casts are explicit.
 */
async function fetchRouteIndex(app: ReturnType<typeof createApp>): Promise<RouteIndex> {
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);

  const body = response.body as ApiSuccess<{ endpoints: RouteIndex }>;
  return body.data.endpoints;
}

/**
 * The health index is a promise to callers about what this service can do.
 *
 * If the index drifts from the mounted routers, a caller treats a 404 as
 * "never implemented" and the drift becomes invisible forever. These tests pin
 * the index against the routes that actually exist.
 */
describe('health route index', () => {
  /**
   * Every router group mounted in `v1.routes.ts` / `health.routes.ts`.
   *
   * This list is the contract. A group that is mounted but not listed here is
   * a group a caller cannot discover from the published index, which is the
   * exact drift this test exists to prevent.
   */
  const groups = [
    'health',
    'catalog',
    'content',
    'coupons',
    'analytics',
    'auth',
    'cart',
    'wishlist',
    'checkout',
    'orders',
    'returns',
    'payments',
    'shipments',
    'adminAuth',
    'adminContent',
    'adminCatalog',
    'adminOrders',
    'adminReturns',
    'adminPayments',
    'adminShipments',
    'adminAnalytics',
    'admin',
    'webhooks',
  ];

  it('lists a group for every mounted router', async () => {
    const endpoints = await fetchRouteIndex(createApp());

    expect(Object.keys(endpoints).sort()).toEqual([...groups].sort());
  });

  it('advertises no route that is not actually mounted', async () => {
    const app = createApp();
    const endpoints = await fetchRouteIndex(app);

    /*
     * An unmatched path is answered by `notFoundHandler`, which builds
     * `NotFoundError(`Route ${method} ${path}`)`. A route that IS mounted but
     * rejects the request for another reason (401, 403, 409, 422 …) produces a
     * message about the *domain*, never the literal string "Route …".
     *
     * That message text is therefore a reliable discriminator between "this
     * route exists" and "this route does not exist". A status code alone cannot
     * distinguish them, which is why the status is not the signal here.
     */
    const unrouted: string[] = [];

    // Probes run concurrently — 68 sequential round trips would exceed the
    // per-test timeout for no reason.
    const probes = Object.values(endpoints).flatMap((routes) =>
      routes.map(async (route) => {
        const [method, template] = route.split(' ');
        if (!method || !template) {
          return null;
        }

        // Path parameters are filled with a syntactically valid ObjectId so a
        // mounted route reaches its own handler rather than the 404 catch-all.
        const path = template.replace(/:[A-Za-z]+/g, '000000000000000000000000');

        const send = (
          request(app) as unknown as Record<string, ((target: string) => request.Test) | undefined>
        )[method.toLowerCase()];

        const response = await send?.(path);
        const body = (response?.body ?? {}) as ErrorEnvelope;

        return body.error?.message?.startsWith('Route ') === true ? route : null;
      }),
    );

    for (const result of await Promise.all(probes)) {
      if (result !== null) {
        unrouted.push(result);
      }
    }

    expect(unrouted).toEqual([]);
  }, 60_000);

  it('reports an unmounted path with the catch-all message', async () => {
    /*
     * Stated explicitly so the discriminator above cannot pass merely because
     * it never fires — this pins the exact shape it keys on.
     */
    const response = await request(createApp()).get('/v1/definitely-not-a-route');
    const body = response.body as ApiFailure;

    expect(response.status).toBe(404);
    expect(body.error.message).toMatch(/^Route GET \/v1\/definitely-not-a-route/);
  });
});
