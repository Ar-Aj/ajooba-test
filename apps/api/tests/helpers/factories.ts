import mongoose, { Types } from 'mongoose';
import type { AdminRole } from '@ajooba/contracts';
import { AdminUserModel } from '../../src/models/admin-user.model.js';
import { CouponModel } from '../../src/models/coupon.model.js';
import { ProductModel } from '../../src/models/product.model.js';
import { BannerModel } from '../../src/models/banner.model.js';
import { StoreSettingsModel } from '../../src/models/store-settings.model.js';
import { UserModel } from '../../src/models/user.model.js';
import { VariantModel } from '../../src/models/variant.model.js';
import { hashPassword } from '../../src/services/password.service.js';

/**
 * Test data factories.
 *
 * Every factory creates a **real** document in the throwaway test database,
 * using the application's own Mongoose models. Nothing is stubbed and
 * nothing is seeded from a fixture file — the tests exercise the real
 * schemas, the real indexes and the real default values, which is the only
 * way a test can catch a schema drift.
 *
 * The values are deliberately small, self-consistent and obviously
 * synthetic (e.g. `Test Product A01`). They are clearly not catalogue data,
 * so a test failure can never be mistaken for a real catalogue problem.
 */

/** A counter that keeps generated identifiers unique within a test file. */
let sequence = 0;

/** A fresh, unique suffix. */
function next(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence.toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProductOverrides {
  readonly code?: string;
  readonly slug?: string;
  readonly title?: string;
  readonly subcategory?: string;
  readonly subcategorySlug?: string;
  readonly colours?: string[];
  readonly mrp?: number;
  readonly sellingPrice?: number;
  readonly inStock?: boolean;
  /** Verified, colour-tagged imagery. Without these a colour tile cannot show. */
  readonly images?: Array<{
    url: string;
    alt: string;
    position: number;
    colour?: string;
  }>;
}

export interface CreatedProduct {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  /**
   * The taxonomy of the fixture design.
   *
   * `ProductModel` stores both the display name and the slug, and several
   * analytics assertions need them: an interaction event records the category it
   * happened in, so a test that checks attribution has to know which category it
   * seeded.
   */
  readonly subcategory: string;
  readonly subcategorySlug: string;
}

/** Create a product design. */
export async function createProduct(overrides: ProductOverrides = {}): Promise<CreatedProduct> {
  const code = overrides.code ?? `A${(sequence % 90) + 10}`;
  const slug = overrides.slug ?? `test-product-${next()}`;

  const created = await ProductModel.create({
    code,
    slug,
    title: overrides.title ?? `Test Product ${code}`,
    description: 'A synthetic product used by the test suite.',
    subcategory: overrides.subcategory ?? 'shoe',
    subcategorySlug: overrides.subcategorySlug ?? 'shoe',
    brand: 'Ajooba Footwear',
    colours: overrides.colours ?? ['Black'],
    images: (overrides.images ?? []).map((image) => ({
      sourceFile: image.url.split('/').pop() ?? 'test-image.jpeg',
      colourToken: (image.colour ?? '').slice(0, 3).toUpperCase(),
      storage: 'local',
      ...image,
    })),
    mrp: overrides.mrp ?? 2000,
    sellingPrice: overrides.sellingPrice ?? 1500,
    inStock: overrides.inStock ?? true,
  });

  return {
    id: created._id.toString(),
    code: created.code,
    slug: created.slug,
    title: created.title,
    subcategory: created.subcategory,
    subcategorySlug: created.subcategorySlug,
  };
}

export interface VariantOverrides {
  readonly productId: string;
  readonly sku?: string;
  readonly size?: number;
  readonly colour?: string;
  readonly colourToken?: string;
  readonly mrp?: number;
  readonly sellingPrice?: number;
  readonly stock?: number;
  readonly reservedStock?: number;
  readonly inStock?: boolean;
  readonly productCode?: string;
  /** Set to `pending-review` to simulate a colour awaiting photography review. */
  readonly photographyStatus?: 'verified' | 'pending-review';
}

export interface CreatedVariant {
  readonly id: string;
  readonly sku: string;
  readonly stock: number;
  readonly sellingPrice: number;
}

/** Create a purchasable variant of a product. */
export async function createVariant(overrides: VariantOverrides): Promise<CreatedVariant> {
  const stock = overrides.stock ?? 10;
  const mrp = overrides.mrp ?? 2000;
  const sellingPrice = overrides.sellingPrice ?? 1500;

  const created = await VariantModel.create({
    sku: overrides.sku ?? `AJ-TEST-${next().toUpperCase()}`,
    productId: new Types.ObjectId(overrides.productId),
    productCode: overrides.productCode ?? 'A00',
    articleNumber: 'A00',
    size: overrides.size ?? 8,
    ukIndiaSize: overrides.size ?? 8,
    euroSize: overrides.size ?? 42,
    colour: overrides.colour ?? 'Black',
    colourToken: overrides.colourToken ?? 'BLK',
    mrp,
    sellingPrice,
    discountPercent: mrp > 0 ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0,
    stock,
    reservedStock: overrides.reservedStock ?? 0,
    inStock: overrides.inStock ?? stock > 0,
    ean: '',
    ...(overrides.photographyStatus ? { photographyStatus: overrides.photographyStatus } : {}),
  });

  return {
    id: created._id.toString(),
    sku: created.sku,
    stock: created.stock,
    sellingPrice: created.sellingPrice,
  };
}

/**
 * Create a homepage banner.
 *
 * The default image URL deliberately points at a real 16:9 asset so the
 * tests exercise the same aspect ratio the storefront enforces.
 */
export async function createBanner(
  overrides: {
    title?: string;
    imageUrl?: string;
    linkUrl?: string;
    placement?: 'home-hero' | 'home-mid' | 'home-footer' | 'category-top';
    position?: number;
    isActive?: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
  } = {},
): Promise<string> {
  const created = await BannerModel.create({
    title: overrides.title ?? `Test Banner ${next()}`,
    subtitle: '',
    imageUrl: overrides.imageUrl ?? '/banner/banner home hero 1.png',
    mobileImageUrl: null,
    linkUrl: overrides.linkUrl ?? '/products',
    placement: overrides.placement ?? 'home-hero',
    position: overrides.position ?? 0,
    isActive: overrides.isActive ?? true,
    startsAt: overrides.startsAt ?? null,
    endsAt: overrides.endsAt ?? null,
  });
  return created._id.toString();
}

/**
 * Create a product together with one in-stock variant.
 *
 * The common case for most tests, so it is a single call.
 */
export async function createProductWithVariant(
  productOverrides: ProductOverrides = {},
  variantOverrides: Partial<VariantOverrides> = {},
): Promise<{ product: CreatedProduct; variant: CreatedVariant }> {
  const product = await createProduct(productOverrides);
  const variant = await createVariant({
    ...variantOverrides,
    productId: product.id,
    productCode: product.code,
  });
  return { product, variant };
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreatedCustomer {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

/** A password that satisfies the platform's policy. */
export const TEST_PASSWORD = 'TestPassw0rd!2026';

/** Create a customer account with a known password. */
export async function createCustomer(
  overrides: { email?: string; phone?: string } = {},
): Promise<CreatedCustomer> {
  const email = overrides.email ?? `customer-${next()}@example.test`;
  const phone = overrides.phone ?? `+9198${String(10000000 + (sequence % 90000000))}`;

  const created = await UserModel.create({
    email,
    phone,
    passwordHash: await hashPassword(TEST_PASSWORD),
    firstName: 'Test',
    lastName: 'Customer',
  });

  return { id: created._id.toString(), email, password: TEST_PASSWORD };
}

export interface CreatedAdmin {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly role: AdminRole;
}

/** Create an administrator account with a known password. */
export async function createAdmin(
  overrides: { email?: string; role?: AdminRole; isActive?: boolean } = {},
): Promise<CreatedAdmin> {
  const email = overrides.email ?? `admin-${next()}@example.test`;
  const role = overrides.role ?? 'owner';

  const created = await AdminUserModel.create({
    email,
    name: 'Test Administrator',
    passwordHash: await hashPassword(TEST_PASSWORD),
    role,
    isActive: overrides.isActive ?? true,
  });

  return { id: created._id.toString(), email, password: TEST_PASSWORD, role };
}

/* -------------------------------------------------------------------------- */
/* Commerce                                                                   */
/* -------------------------------------------------------------------------- */

export interface CouponOverrides {
  readonly code?: string;
  readonly type?: 'percentage' | 'fixed';
  readonly value?: number;
  readonly minOrderAmount?: number;
  readonly maxDiscountAmount?: number | null;
  readonly startsAt?: Date;
  readonly endsAt?: Date | null;
  readonly usageLimit?: number | null;
  readonly usedCount?: number;
  readonly isActive?: boolean;
}

/** Create a coupon. */
export async function createCoupon(overrides: CouponOverrides = {}): Promise<string> {
  const code = (overrides.code ?? `TEST${next().toUpperCase()}`).toUpperCase();

  const created = await CouponModel.create({
    code,
    type: overrides.type ?? 'percentage',
    value: overrides.value ?? 10,
    minOrderAmount: overrides.minOrderAmount ?? 0,
    maxDiscountAmount: overrides.maxDiscountAmount ?? null,
    startsAt: overrides.startsAt ?? new Date(Date.now() - 60_000),
    endsAt: overrides.endsAt ?? null,
    usageLimit: overrides.usageLimit ?? null,
    usedCount: overrides.usedCount ?? 0,
    isActive: overrides.isActive ?? true,
    description: 'A synthetic coupon used by the test suite.',
  });

  return created.code;
}

/**
 * A delivery address, matching the shape the API accepts.
 *
 * It satisfies `addressInputSchema` exactly — `label` and `isDefault` are
 * part of that schema, so an address without them is a 422, not a default.
 */
export const TEST_ADDRESS = {
  label: 'Home',
  fullName: 'Test Customer',
  phone: '+919876543210',
  line1: '12 Test Street',
  line2: 'Near Test Junction',
  city: 'Jaipur',
  state: 'Rajasthan',
  postalCode: '302001',
  country: 'India',
  isDefault: true,
} as const;

/** Write the store settings singleton. */
export async function setStoreSettings(
  overrides: Partial<{
    shippingFee: number;
    freeShippingThreshold: number;
    taxRateBps: number;
    taxInclusive: boolean;
    isCodEnabled: boolean;
    announcement: string;
  }> = {},
): Promise<void> {
  await StoreSettingsModel.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        storeName: 'Ajooba Footwear',
        supportEmail: 'support@example.test',
        supportPhone: '+919876543210',
        currency: 'INR',
        shippingFee: 99,
        freeShippingThreshold: 1499,
        taxRateBps: 0,
        taxInclusive: false,
        isCodEnabled: true,
        announcement: '',
        ...overrides,
        key: 'default',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every collection the application uses.
 *
 * Listed explicitly rather than derived from `mongoose.connection.db`
 * so that a newly added model is not silently left behind with stale
 * documents between test files.
 */
const COLLECTIONS = [
  'products',
  'variants',
  'users',
  'admin_users',
  'refresh_tokens',
  'carts',
  'orders',
  'returns',
  'payments',
  'coupons',
  'banners',
  'content_blocks',
  'store_settings',
  'stock_movements',
  'audit_logs',
  'activity_events',
  'idempotency_records',
  'import-reports',
  'homepage_sections',
  'categories',
  'image_reviews',
  'import-plans',
  'webhook_events',
  'email_logs',
  'shipments',
  'password_reset_tokens',
] as const;

/**
 * Remove every document from every application collection.
 *
 * Called between test files so each file starts from a known-empty
 * database. The throwaway server is destroyed entirely at the end of the
 * run, so nothing survives it either way.
 */
export async function resetDatabase(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    return;
  }

  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  await Promise.all(
    COLLECTIONS.filter((name) => existing.has(name)).map((name) =>
      db.collection(name).deleteMany({}),
    ),
  );
}
