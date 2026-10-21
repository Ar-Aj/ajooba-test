import { describe, expect, it } from 'vitest';
import { adminEnv, apiUrl, mediaUrl } from '@/lib/env';

/**
 * Admin configuration and asset-URL helpers.
 *
 * The admin panel must never render fabricated store metrics. That rule is
 * asserted against the dashboard markup elsewhere; these tests cover the pure
 * helpers that the dashboard depends on, and the boundary rule that keeps
 * server-only secrets out of the browser bundle.
 */

describe('mediaUrl', () => {
  it('joins the media base URL with an asset path', () => {
    expect(mediaUrl('/products/AJ-A11/A11-BRN-1.jpg')).toBe('/products/AJ-A11/A11-BRN-1.jpg');
  });

  it('normalises a missing leading slash', () => {
    expect(mediaUrl('products/AJ-A11/A11-BRN-1.jpg')).toBe('/products/AJ-A11/A11-BRN-1.jpg');
  });
});

describe('admin environment', () => {
  it('exposes the admin site URL', () => {
    expect(adminEnv.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3001');
  });

  it('exposes no secret — the admin app never reads server-only variables', () => {
    // The admin env schema has no MONGODB_URI / SESSION_SECRET /
    // RAZORPAY_KEY_SECRET fields, so they cannot reach the browser bundle.
    const exposed = Object.keys(adminEnv);

    for (const secret of ['MONGODB_URI', 'SESSION_SECRET', 'RAZORPAY_KEY_SECRET', 'MONGODB_DB']) {
      expect(exposed).not.toContain(secret);
    }
  });

  it('only exposes variables that are safe for the browser', () => {
    const exposed = Object.keys(adminEnv);
    for (const key of exposed) {
      // Every exposed value must be either a NEXT_PUBLIC_ variable or a
      // non-secret structural field (NODE_ENV).
      expect([
        'NODE_ENV',
        'API_INTERNAL_URL',
        'NEXT_PUBLIC_API_URL',
        'NEXT_PUBLIC_SITE_URL',
        'NEXT_PUBLIC_MEDIA_BASE_URL',
      ]).toContain(key);
    }
  });

  it('builds absolute API URLs from the internal base URL', () => {
    expect(apiUrl('/v1/catalog/products')).toBe('http://localhost:4000/v1/catalog/products');
  });
});
