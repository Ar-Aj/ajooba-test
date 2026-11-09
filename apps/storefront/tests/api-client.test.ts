import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiRequestError, fetchProductBySlug, fetchProducts, fetchStoreSettings } from '@/lib/api';

/**
 * The storefront must distinguish three catalogue states:
 *
 *   1. empty catalogue      -> an empty grid, not an error
 *   2. product does not exist -> 404
 *   3. API unreachable       -> "temporarily unavailable", NOT a 404
 *
 * Conflating (2) and (3) would tell a customer that a real product does not
 * exist when the truth is that our service is down. These tests pin the
 * distinction down.
 */

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Build a Response-like object for the mocked fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('fetchProducts', () => {
  it('returns an empty result when the catalogue is empty', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: { items: [], totalItems: 0, page: 1, pageSize: 24, totalPages: 0 },
        meta: { requestId: 'r1', timestamp: '2026-01-01T00:00:00.000Z' },
      }),
    );

    const result = await fetchProducts();
    expect(result.items).toEqual([]);
    expect(result.totalItems).toBe(0);
  });

  it('throws an "unavailable" error when the API cannot be reached', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchProducts()).rejects.toMatchObject({
      kind: 'unavailable',
      isUnavailable: true,
    });
  });

  it('throws an "unavailable" error on a 5xx response', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(503, {
        ok: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Database down.' },
      }),
    );

    await expect(fetchProducts()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('throws an "invalid_response" error when the envelope is malformed', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    await expect(fetchProducts()).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

describe('fetchProductBySlug', () => {
  it('returns null when the API confirms the product does not exist', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(404, {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Product not found.' },
      }),
    );

    await expect(fetchProductBySlug('does-not-exist')).resolves.toBeNull();
  });

  it('throws rather than returning null when the API is unreachable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    // A 404 here would be a lie: the product may well exist.
    await expect(fetchProductBySlug('ajooba-a11')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('does not swallow a non-404 client error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(422, {
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Bad slug.' },
      }),
    );

    await expect(fetchProductBySlug('!!!')).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('fetchStoreSettings', () => {
  it('returns store settings when the API responds with a valid envelope', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        data: {
          storeName: 'Ajooba Footwear',
          tagline: 'Footwear for celebrations and daily wear',
          supportEmail: 'help@ajoobafootwear.com',
          supportPhone: '+919988776655',
          currency: 'INR',
          freeShippingThreshold: 1999,
          shippingFee: 99,
          taxRatePercent: 12,
          isCodEnabled: true,
          socialLinks: {},
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    );

    const settings = await fetchStoreSettings();
    expect(settings?.supportEmail).toBe('help@ajoobafootwear.com');
    expect(settings?.freeShippingThreshold).toBe(1999);
    expect(settings?.isCodEnabled).toBe(true);
  });

  it('degrades to null instead of throwing when the API is unreachable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchStoreSettings()).resolves.toBeNull();
  });
});
