import { describe, expect, it } from 'vitest';
import { apiEnvSchema, catalogQuerySchema, productSchema, sellerSkuId } from '../src/index.js';

/**
 * A valid API environment, used as the base for the env schema tests.
 * These values mirror `apps/api/.env.example` — none of them is a secret and
 * none of them is a production URL.
 */
const validApiEnv = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/ajooba_dev',
  API_PUBLIC_URL: 'http://localhost:4000',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
  STOREFRONT_PUBLIC_URL: 'http://localhost:3000',
  ADMIN_PUBLIC_URL: 'http://localhost:3001',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
  JWT_SECRET: 'fedcba9876543210fedcba9876543210fedcba9876543210',
};

describe('apiEnvSchema', () => {
  it('accepts a valid development environment', () => {
    expect(apiEnvSchema.safeParse(validApiEnv).success).toBe(true);
  });

  it('rejects a missing secret', () => {
    const { SESSION_SECRET: _omitted, ...withoutSecret } = validApiEnv;
    expect(apiEnvSchema.safeParse(withoutSecret).success).toBe(false);
  });

  it('rejects a missing token secret', () => {
    const { JWT_SECRET: _omitted, ...withoutTokenSecret } = validApiEnv;
    expect(apiEnvSchema.safeParse(withoutTokenSecret).success).toBe(false);
  });

  it('rejects a short secret', () => {
    expect(apiEnvSchema.safeParse({ ...validApiEnv, SESSION_SECRET: 'too-short' }).success).toBe(
      false,
    );
  });

  it('rejects a missing database connection string', () => {
    const { MONGODB_URI: _omitted, ...withoutDb } = validApiEnv;
    expect(apiEnvSchema.safeParse(withoutDb).success).toBe(false);
  });

  it('rejects a non-URL public URL', () => {
    expect(apiEnvSchema.safeParse({ ...validApiEnv, API_PUBLIC_URL: 'not-a-url' }).success).toBe(
      false,
    );
  });

  it('treats a blank optional secret as "not configured"', () => {
    // Deployment templates ship the Razorpay keys as empty placeholders.
    const parsed = apiEnvSchema.safeParse({
      ...validApiEnv,
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.RAZORPAY_KEY_ID).toBeUndefined();
      expect(parsed.data.RAZORPAY_KEY_SECRET).toBeUndefined();
    }
  });

  it('treats a blank optional database name as "not configured"', () => {
    const parsed = apiEnvSchema.safeParse({ ...validApiEnv, MONGODB_DB: '  ' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.MONGODB_DB).toBeUndefined();
    }
  });
});

describe('sellerSkuId', () => {
  it('accepts SKUs observed in the real catalogue', () => {
    for (const sku of ['AJ-A01-OW-06', 'AJ-A11-BRN-08', 'AJ-A14-WHT-13', 'AJ-A57-OLV-10']) {
      expect(sellerSkuId.safeParse(sku).success).toBe(true);
    }
  });

  it('rejects malformed SKUs', () => {
    for (const sku of ['AJOBA-1', 'AJ-A1-OW-6', 'AJ-A01-OW', 'AJ-A01-OW-06-EXTRA']) {
      expect(sellerSkuId.safeParse(sku).success).toBe(false);
    }
  });
});

describe('catalogQuerySchema', () => {
  it('applies documented defaults', () => {
    const parsed = catalogQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(24);
    expect(parsed.sort).toBe('newest');
  });

  it('coerces numeric query strings', () => {
    const parsed = catalogQuerySchema.parse({ page: '3', pageSize: '12', size: '8' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(12);
    expect(parsed.size).toBe(8);
  });

  it('rejects an out-of-range size', () => {
    expect(catalogQuerySchema.safeParse({ size: '99' }).success).toBe(false);
  });

  it('rejects an out-of-range pageSize', () => {
    expect(catalogQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });
});

describe('productSchema', () => {
  it('rejects a product whose variant price is negative', () => {
    const result = productSchema.safeParse({
      id: 'p1',
      code: 'A11',
      slug: 'ajooba-mojri',
      title: 'AJOOBA Mojri',
      description: 'desc',
      subcategory: 'Mojri / Jutti',
      subcategorySlug: 'mojri-jutti',
      brand: 'Ajooba Footwear',
      colours: ['Ivory'],
      images: [],
      variants: [
        {
          sku: 'AJ-A11-BRN-08',
          productId: 'p1',
          size: 8,
          colour: 'Ivory',
          colourToken: 'IVY',
          mrp: 1999,
          sellingPrice: -1,
          discountPercent: 0,
          stock: 1,
          inStock: true,
        },
      ],
      mrp: 1999,
      sellingPrice: 1399,
      inStock: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});
