import mongoose from 'mongoose';
import { ProductModel } from '../src/models/product.model.js';
import { VariantModel } from '../src/models/variant.model.js';
import { StoreSettingsModel } from '../src/models/store-settings.model.js';
import { AdminUserModel } from '../src/models/admin-user.model.js';
import { hashPassword } from '../src/services/password.service.js';

/**
 * Seed the synthetic catalogue for the end-to-end suite.
 *
 * WHY THIS IS A SCRIPT IN `apps/api` AND NOT A LOOP IN THE PLAYWRIGHT SETUP
 * -------------------------------------------------------------------------
 * The fixtures must be written through the **application's own Mongoose
 * models**, so they carry the real schema defaults, the real field names and
 * the real index definitions. Importing those models from the repository
 * root, however, means resolving `mongoose` from the root `node_modules`
 * while the models themselves resolve it from `apps/api/node_modules` — two
 * different Mongoose copies, two different `instance.models` registries, and
 * a model that is registered against a connection the seeding code cannot
 * see.
 *
 * Running the seeding **inside this package** removes that entirely: there
 * is one Mongoose, one model registry and one connection.
 *
 * It also keeps the application environment validation intact. The models and
 * `password.service.ts` import `src/config/env.js`, which validates the
 * environment once at import time and refuses to boot on a missing
 * variable. Inside this package the process is started with a complete,
 * explicit environment (see `tests/e2e/global-setup.ts`), so validation
 * passes exactly as it does for the real server.
 *
 * WHAT IT WRITES
 * --------------
 * Synthetic records only, into the throwaway database named by
 * `MONGODB_DB`. The names are prefixed `E2E` so a failure can never be
 * mistaken for a real catalogue problem. The production catalogue is never
 * touched: this script refuses to run against a database whose name looks
 * like production.
 *
 * The stock quantity below is a **fixture**, not inventory. It exists so the
 * browser suite can exercise the buy path at all; the real catalogue's
 * zero-stock state is untouched by this script.
 */

/** The administrator's password. Only ever valid against a throwaway database. */
const E2E_ADMIN_PASSWORD = 'E2ePassword!2026';

/** The colourway that has stock but no verified photography. */
const PENDING_REVIEW_COLOUR = 'Brown';

/**
 * Refuse to seed anything that might be a real database.
 *
 * A safety net, not a permission — the same stance the catalogue importer
 * takes. The E2E database is `ajooba_e2e`, which never matches.
 */
function looksLikeProduction(name: string): boolean {
  return /(prod|live)/i.test(name);
}

async function seed(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  if (!uri || !dbName) {
    throw new Error('MONGODB_URI and MONGODB_DB must be set to seed the E2E fixtures.');
  }

  if (looksLikeProduction(dbName)) {
    throw new Error(
      `Refusing to seed E2E fixtures into "${dbName}" - the name looks like a production database.`,
    );
  }

  await mongoose.connect(uri, { dbName });

  /*
   * Idempotent: the E2E suite may be re-run against a database that was not
   * torn down cleanly. The unique index on `code` / `slug` / `sku` would
   * otherwise throw a duplicate-key error on the second run.
   */
  await Promise.all([
    ProductModel.deleteMany({ code: 'AE2E' }),
    VariantModel.deleteMany({ productCode: 'AE2E' }),
    AdminUserModel.deleteMany({ email: 'e2e-admin@example.test' }),
  ]);

  const product = await ProductModel.create({
    code: 'AE2E',
    slug: 'e2e-test-mojari',
    title: 'E2E Test Mojari',
    description: 'A synthetic product used only by the end-to-end suite.',
    subcategory: 'Mojari',
    subcategorySlug: 'mojari',
    brand: 'Ajooba Footwear',
    colours: ['Black', PENDING_REVIEW_COLOUR],
    images: [
      {
        url: '/products/AE2E/AE2E - 1.jpg',
        alt: 'E2E Test Mojari',
        position: 0,
        sourceFile: 'AE2E - 1.jpg',
        colour: 'Black',
        colourToken: 'BLK',
        storage: 'local',
      },
      /*
       * The Brown photograph is **quarantined**: its colour could not be
       * verified against a colour this design sells, so it is retained for the
       * review queue and deliberately absent from `images`. The storefront
       * therefore never sees it at all, which is exactly what the colour-
       * image verification rule requires.
       */
    ],
    quarantinedImages: ['AE2E - 2.jpg'],
    mrp: 2000,
    sellingPrice: 1500,
    inStock: true,
    status: 'published',
  });

  /*
   * Two colours, so the "only that colour's images are displayed" rule can
   * actually be exercised.
   *
   * The Brown variant deliberately has NO verified photography. The API's
   * read layer withholds a `pending-review` variant from sale even though it
   * has stock, so this fixture proves that gate holds. It must NOT be
   * bypassed by giving the variant `verified` photography — the whole point
   * of the fixture is to show the gate works.
   */
  await VariantModel.create([
    {
      sku: 'AJ-E2E-BLK-08',
      productId: product._id,
      productCode: 'AE2E',
      articleNumber: 'AE2E',
      size: 8,
      ukIndiaSize: 8,
      euroSize: 42,
      colour: 'Black',
      colourToken: 'BLK',
      mrp: 2000,
      sellingPrice: 1500,
      discountPercent: 25,
      stock: 5,
      inStock: true,
      reservedStock: 0,
      ean: '',
      photographyStatus: 'verified',
      variantTitle: 'E2E Test Mojari - Black',
      imageUrl: '/products/AE2E/AE2E - 1.jpg',
    },
    {
      sku: 'AJ-E2E-BLK-09',
      productId: product._id,
      productCode: 'AE2E',
      articleNumber: 'AE2E',
      size: 9,
      ukIndiaSize: 9,
      euroSize: 43,
      colour: 'Black',
      colourToken: 'BLK',
      mrp: 2000,
      sellingPrice: 1500,
      discountPercent: 25,
      stock: 3,
      inStock: true,
      reservedStock: 0,
      ean: '',
      photographyStatus: 'verified',
      variantTitle: 'E2E Test Mojari - Black',
      imageUrl: '/products/AE2E/AE2E - 1.jpg',
    },
    {
      sku: 'AJ-E2E-BRN-08',
      productId: product._id,
      productCode: 'AE2E',
      articleNumber: 'AE2E',
      size: 8,
      ukIndiaSize: 8,
      euroSize: 42,
      colour: PENDING_REVIEW_COLOUR,
      colourToken: 'BRN',
      mrp: 2000,
      sellingPrice: 1500,
      discountPercent: 25,
      stock: 5,
      inStock: true,
      reservedStock: 0,
      ean: '',
      photographyStatus: 'pending-review',
      variantTitle: 'E2E Test Mojari - Brown',
      imageUrl: '/products/AE2E/AE2E - 2.jpg',
    },
  ]);

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
        key: 'default',
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  await AdminUserModel.create({
    email: 'e2e-admin@example.test',
    name: 'E2E Administrator',
    passwordHash: await hashPassword(E2E_ADMIN_PASSWORD),
    role: 'owner',
    isActive: true,
  });

  await mongoose.disconnect();

  process.stdout.write(
    '[e2e-seed] Fixtures seeded (synthetic product, variants, settings, admin).\n',
  );
}

seed().catch(async (error: unknown) => {
  process.stderr.write(
    `[e2e-seed] Failed to seed the E2E fixtures: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  try {
    await mongoose.disconnect();
  } catch {
    // The connection may never have opened.
  }
  process.exit(1);
});
