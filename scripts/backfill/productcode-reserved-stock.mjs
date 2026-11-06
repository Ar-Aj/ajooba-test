/**
 * Phase 1 — additive backfill for `variants.productCode` and
 * `variants.reservedStock`.
 *
 * This script is SAFE BY CONSTRUCTION:
 *
 *   - It never drops a collection, never resets the catalogue, never writes
 *     outside `variants`, and never touches any database other than the one
 *     named by MONGODB_DB (default: ajooba_development).
 *   - It refuses to run unless a verified, readable backup exists.
 *   - It refuses to run if any order is in a non-terminal status, because a
 *     live reservation would be lost by writing `reservedStock: 0`.
 *   - `--apply` is required for writes. Without it the script only produces
 *     the dry-run report.
 *
 * Usage:
 *   node scripts/backfill/productcode-reserved-stock.mjs             # dry run
 *   node scripts/backfill/productcode-reserved-stock.mjs --backup     # backup only
 *   node scripts/backfill/productcode-reserved-stock.mjs --apply      # execute
 *
 * Additive semantics:
 *   - `productCode`    -> set ONLY where missing, from the canonical parent
 *                         `products.code`. Cross-checked against the variant's
 *                         `articleNumber`; any mismatch is QUARANTINED
 *                         (reported, never written).
 *   - `reservedStock`  -> set to 0 ONLY where the field is missing, and only
 *                         after confirming no active reservation exists.
 *                         Existing populated values are never touched.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BACKUP_DIR = resolve(ROOT, 'backups', 'catalog');

/**
 * The `mongodb` driver is a dependency of the API workspace, not the repo
 * root, so it is resolved from the pnpm store rather than by bare specifier.
 * Resolving it explicitly keeps this script runnable from the repo root.
 */
const PNPM_STORE = resolve(ROOT, 'node_modules', '.pnpm');
async function loadMongoDriver() {
  const dirs = readdirSync(PNPM_STORE).filter((d) => /^mongodb@/.test(d)).sort();
  for (const d of dirs.reverse()) {
    const p = resolve(PNPM_STORE, d, 'node_modules', 'mongodb', 'lib', 'index.js');
    if (existsSync(p)) return import(`file:///${p.replace(/\\/g, '/')}`);
  }
  throw new Error('Could not locate the mongodb driver in the pnpm store.');
}
const { MongoClient } = await loadMongoDriver();

/** `bson` ships inside the mongodb driver's own dependency tree. */
async function loadBson() {
  const candidates = [];
  const mongodbDirs = readdirSync(PNPM_STORE)
    .filter((d) => /^mongodb@/.test(d))
    .sort();
  // Standalone build first, then each driver's nested copy.
  candidates.push(
    resolve(PNPM_STORE, 'bson@7.3.3', 'node_modules', 'bson', 'lib', 'bson.mjs'),
  );
  for (const d of mongodbDirs.reverse()) {
    candidates.push(resolve(PNPM_STORE, d, 'node_modules', 'bson', 'lib', 'bson.mjs'));
    candidates.push(resolve(PNPM_STORE, d, 'node_modules', 'bson', 'lib', 'bson.bundle.js'));
  }
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const mod = await import(`file:///${p.replace(/\\/g, '/')}`);
    if (typeof mod.serialize === 'function') return mod;
  }
  throw new Error('Could not locate a working bson module in the pnpm store.');
}
const bsonMod = await loadBson();
const { serialize, deserialize } = bsonMod;

/** Order statuses that still hold a stock reservation. */
const ACTIVE_ORDER_STATUSES = ['placed', 'processing', 'shipped'];

function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let value = line.substring(eq + 1).trim();
    const first = value[0];
    if ((first === '"' && value.endsWith('"')) || (first === "'" && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const ENV = {
  ...loadEnvFile(resolve(ROOT, 'apps', 'api', '.env.local')),
  ...loadEnvFile(resolve(ROOT, 'apps', 'api', '.env')),
};

const URI = ENV.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
const DB_NAME = ENV.MONGODB_DB ?? 'ajooba_development';

const APPLY = process.argv.includes('--apply');
const BACKUP_ONLY = process.argv.includes('--backup');

/** Guard: never run this against a non-development database. */
function assertSafeTarget(dbName, uri) {
  if (!/development|dev|test/i.test(dbName)) {
    throw new Error(
      `REFUSING TO RUN: target database "${dbName}" does not look like a development database.`,
    );
  }
  if (/\b(prod|production|atlas)/i.test(uri) && !process.argv.includes('--i-know-what-i-am-doing')) {
    throw new Error(`REFUSING TO RUN: URI "${uri}" looks like a production/Atlas host.`);
  }
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  assertSafeTarget(DB_NAME, URI);
  console.log(`Target database : ${DB_NAME}`);
  console.log(`URI host        : ${new URL(URI).host}`);
  console.log(`Mode            : ${BACKUP_ONLY ? 'backup-only' : APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);
  console.log('');

  const client = new MongoClient(URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    /* ---------------------------------------------------------------- */
    /* 0. Preconditions                                                 */
    /* ---------------------------------------------------------------- */

    // Never write reservedStock: 0 while an order still holds units.
    const activeOrders = await db
      .collection('orders')
      .countDocuments({ status: { $in: ACTIVE_ORDER_STATUSES } });
    if (activeOrders > 0) {
      throw new Error(
        `REFUSING TO RUN: ${activeOrders} order(s) are in an active status ` +
          `(${ACTIVE_ORDER_STATUSES.join(', ')}). Their reservations would be lost.`,
      );
    }
    console.log(`Precondition OK : 0 active reservations (no orders in active status).`);

    // Non-zero reservedStock anywhere would mean a reservation we cannot see.
    const nonZeroReserved = await db
      .collection('variants')
      .countDocuments({ reservedStock: { $gt: 0 } });
    if (nonZeroReserved > 0) {
      throw new Error(
        `REFUSING TO RUN: ${nonZeroReserved} variant(s) already have reservedStock > 0.`,
      );
    }
    console.log(`Precondition OK : no variant has reservedStock > 0.`);

    const liveCounts = {
      products: await db.collection('products').countDocuments({}),
      variants: await db.collection('variants').countDocuments({}),
    };
    console.log(`Live counts     : products=${liveCounts.products} variants=${liveCounts.variants}`);
    console.log('');

    /* ---------------------------------------------------------------- */
    /* 1. Backup (always taken before any write)                       */
    /* ---------------------------------------------------------------- */

    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = ts();
    const backupPath = resolve(BACKUP_DIR, `catalog-backup-${stamp}.bson`);

    // BSON preserves ObjectId, Date and Decimal128 exactly — unlike JSON.
    const backups = {};
    for (const name of ['products', 'variants']) {
      const cursor = db.collection(name).find({});
      const chunks = [];
      for await (const doc of cursor) chunks.push(doc);
      backups[name] = chunks;
    }

    // Serialise via the native BSON encoder so types survive the round trip.
    const out = [];
    for (const name of ['products', 'variants']) {
      for (const doc of backups[name]) {
        out.push(serialize({ __collection: name, doc }));
      }
    }
    writeFileSync(backupPath, Buffer.concat(out));

    // Verify the backup by reading the FILE back off disk and comparing the
    // decoded document count against the live counts. Reading the live
    // database here would only prove the database still exists — the point is
    // to prove the bytes we wrote are a faithful, restorable copy.
    const { deserialize } = bsonMod;
    const raw = readFileSync(backupPath);
    const backupCounts = { products: 0, variants: 0 };
    let offset = 0;
    while (offset < raw.length) {
      /*
       * Each record is a standalone BSON document: a 4-byte little-endian
       * length prefix followed by the document. That prefix is what lets the
       * concatenated file be walked record by record, and it round-trips the
       * ObjectId/Date types without lossy JSON stringification.
       */
      const size = raw.readInt32LE(offset);
      if (size <= 0 || offset + size > raw.length) {
        throw new Error(
          `Corrupt backup: bad record length ${size} at byte offset ${offset}. Aborting.`,
        );
      }
      const doc = deserialize(raw.subarray(offset, offset + size));
      offset += size;
      if (doc.__collection === 'products') backupCounts.products += 1;
      else if (doc.__collection === 'variants') backupCounts.variants += 1;
    }

    const fileBytes = statSync(backupPath).size;

    console.log('Backup written  :', backupPath);
    console.log(`Backup size     : ${fileBytes} bytes`);
    console.log(
      `Backup verify   : products ${backupCounts.products}/${liveCounts.products}, ` +
        `variants ${backupCounts.variants}/${liveCounts.variants}`,
    );
    const ok =
      backupCounts.products === liveCounts.products &&
      backupCounts.variants === liveCounts.variants;
    console.log(`Backup integrity: ${ok ? 'VERIFIED' : 'FAILED'}`);
    if (!ok) throw new Error('Backup integrity check FAILED. Aborting; nothing will be written.');
    console.log('');

    if (BACKUP_ONLY) {
      console.log('Backup-only mode complete. No writes performed.');
      return;
    }

    /* ---------------------------------------------------------------- */
    /* 2. Plan the changes                                              */
    /* ---------------------------------------------------------------- */

    const products = await db.collection('products').find({}).toArray();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const variants = await db.collection('variants').find({}).toArray();

    const setProductCode = [];
    const setReservedStock = [];
    const quarantined = [];
    const skippedExistingCode = [];
    const skippedExistingReserved = [];

    for (const v of variants) {
      const parent = byId.get(String(v.productId));
      if (!parent) {
        quarantined.push({ sku: v.sku, reason: 'parent product not found', productId: String(v.productId) });
        continue;
      }

      // --- reservedStock ---
      const hasReserved = v.reservedStock !== undefined && v.reservedStock !== null;
      if (hasReserved) {
        skippedExistingReserved.push(v.sku);
      } else {
        setReservedStock.push(v._id);
      }

      // --- productCode ---
      if (v.productCode !== undefined && v.productCode !== null && v.productCode !== '') {
        // Already populated: cross-check it, but never overwrite.
        if (v.productCode !== parent.code) {
          quarantined.push({
            sku: v.sku,
            reason: 'existing productCode disagrees with parent',
            existing: v.productCode,
            expected: parent.code,
          });
        } else {
          skippedExistingCode.push(v.sku);
        }
        continue;
      }

      // Cross-check the denormalised code against articleNumber.
      if (v.articleNumber && v.articleNumber !== parent.code) {
        quarantined.push({
          sku: v.sku,
          reason: 'articleNumber disagrees with parent code',
          articleNumber: v.articleNumber,
          expected: parent.code,
        });
        continue;
      }

      setProductCode.push({ _id: v._id, sku: v.sku, productCode: parent.code });
    }

    /* ---------------------------------------------------------------- */
    /* 3. Report                                                        */
    /* ---------------------------------------------------------------- */

    const report = {
      generatedAt: new Date().toISOString(),
      database: DB_NAME,
      mode: APPLY ? 'APPLY' : 'DRY-RUN',
      backupFile: backupPath,
      before: {
        products: liveCounts.products,
        variants: liveCounts.variants,
        variantsWithProductCode: variants.filter((v) => v.productCode).length,
        variantsWithReservedStock: variants.filter((v) => v.reservedStock !== undefined && v.reservedStock !== null).length,
      },
      proposed: {
        setProductCode: setProductCode.length,
        setReservedStock: setReservedStock.length,
        skippedExistingProductCode: skippedExistingCode.length,
        skippedExistingReservedStock: skippedExistingReserved.length,
        quarantined: quarantined.length,
      },
      mappingSample: setProductCode.slice(0, 25),
      quarantinedSample: quarantined.slice(0, 25),
    };

    const reportPath = resolve(BACKUP_DIR, `backfill-report-${stamp}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log('=== DRY-RUN REPORT ===');
    console.log(JSON.stringify(report, null, 2));
    console.log('');
    console.log('Report written  :', reportPath);

    if (!APPLY) {
      console.log('');
      console.log('>>> NOTHING WAS WRITTEN. Review the report above, then re-run with --apply.');
      return;
    }

    /* ---------------------------------------------------------------- */
    /* 4. Execute                                                        */
    /* ---------------------------------------------------------------- */

    const ids = setProductCode.map((d) => d._id);
    if (ids.length) {
      await db.collection('variants').bulkWrite(
        setProductCode.map((d) => ({
          updateOne: {
            filter: { _id: d._id, $or: [{ productCode: { $exists: false } }, { productCode: null }, { productCode: '' }] },
            update: { $set: { productCode: d.productCode } },
          },
        })),
        { ordered: false },
      );
    }

    if (setReservedStock.length) {
      await db.collection('variants').bulkWrite(
        setReservedStock.map((id) => ({
          updateOne: {
            filter: { _id: id, reservedStock: { $exists: false } },
            update: { $set: { reservedStock: 0 } },
          },
        })),
        { ordered: false },
      );
    }

    const after = {
      variantsWithProductCode: await db.collection('variants').countDocuments({ productCode: { $exists: true } }),
      variantsWithReservedStock: await db.collection('variants').countDocuments({ reservedStock: { $exists: true } }),
      quarantinedUnchanged: quarantined.length,
    };
    console.log('');
    console.log('=== APPLIED ===');
    console.log(JSON.stringify(after, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('\nABORTED:', err.message);
  process.exit(1);
});