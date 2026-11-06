import mongoose from 'mongoose';

/**
 * Reconcile a database's indexes with the schemas.
 *
 *   pnpm indexes:check       # read-only report
 *   pnpm indexes:reconcile   # drop the stale ones and let boot recreate them
 *
 * WHY THIS EXISTS
 * ---------------
 * Mongoose's `autoIndex` starts building indexes in the background and does
 * not wait for them, and **a unique index that fails to build is not an
 * error** — writes keep succeeding, they just stop being deduplicated. A
 * schema can therefore declare `unique: true` for months while the database
 * holds an ordinary index on the same key. The application looks healthy and
 * the guarantee is absent.
 *
 * Three were found this way on 23 Oct 2026, all of them correctness
 * constraints rather than performance hints:
 *
 *   carts.customerId          one cart per signed-in customer
 *   carts.sessionId           one cart per guest session
 *   payments.idempotencyKey   one payment record per client retry
 *
 * The cause in each case is the same: an earlier schema revision created a
 * plain index via `index: true` on the field, and a later revision added a
 * `schema.index(...)` with the same auto-generated name and `unique: true`.
 * MongoDB refuses that combination with `IndexKeySpecsConflict` (code 86),
 * because two different specs cannot share a name.
 *
 * WHAT IT DOES
 * ------------
 * Drops an index whose *name* matches a declared index but whose *options*
 * differ, then lets the application's own boot-time provisioning recreate it
 * correctly.
 *
 * SAFETY
 * ------
 *  - Read-only unless `--apply` is passed.
 *  - Refuses a database whose name looks like production unless
 *    `--force-production` is also given, mirroring the importer's
 *    `assertNotProductionDatabase`.
 *  - Before dropping, it proves no existing document violates the new
 *    uniqueness. If one does, it stops and prints the offending groups
 *    instead of dropping anything — a failed build is recoverable, deleted
 *    carts are not.
 */

const APPLY = process.argv.includes('--apply');
const CHECK_ONLY = process.argv.includes('--check') || !APPLY;
const FORCE_PRODUCTION = process.argv.includes('--force-production');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

if (!uri || !dbName) {
  console.error(
    'MONGODB_URI and MONGODB_DB must be set. Run through the package script so the\n' +
      'environment is loaded:\n' +
      '  pnpm --filter @ajooba/api indexes:check',
  );
  process.exit(2);
}

/**
 * Anything whose name suggests real customers stops here.
 *
 * A safety net, not a permission — the same stance the catalogue importer
 * takes. Deliberately broad: `prod`, `production`, `live`.
 */
function looksLikeProduction(name: string): boolean {
  return /(prod|live)/i.test(name);
}

if (looksLikeProduction(dbName) && !FORCE_PRODUCTION) {
  console.error(
    `Refusing to reconcile indexes on "${dbName}" - the name looks like a production database.\n` +
      'Re-run with --force-production if you are certain, and take a backup first.',
  );
  process.exit(2);
}

/** MongoDB's default index naming: `<field>_<direction>`. */
function autoName(fields: Record<string, 1>): string {
  return Object.entries(fields)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

/** A document group that would violate a new unique index. */
interface Violation {
  _id: unknown;
  count: number;
}

/**
 * Groups of documents sharing one value of `field`.
 *
 * A unique index can only be built when this is empty, so it is the check
 * that decides whether dropping the old index is safe.
 */
async function findViolations(
  collection: mongoose.Collection,
  field: string,
): Promise<Violation[]> {
  return collection
    .aggregate<Violation>([
      { $match: { [field]: { $type: ['objectId', 'string'] } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ])
    .toArray();
}

await mongoose.connect(uri, { dbName });
await import('../src/db/models.js');

const models = Object.values(mongoose.models);

console.log(`\nIndex reconciliation - ${dbName} (${models.length} models)`);
console.log(CHECK_ONLY ? 'Mode: CHECK (nothing will be changed)\n' : 'Mode: APPLY\n');
console.log(`${'='.repeat(70)}\n`);

let dropped = 0;
let blocked = 0;
let clean = 0;

for (const model of models) {
  let actual: Array<{ name: string; unique?: boolean; partialFilterExpression?: unknown }>;
  try {
    actual = (await model.collection.indexes()) as typeof actual;
  } catch {
    // The collection does not exist yet. Boot-time provisioning will create
    // it; there is nothing to reconcile.
    continue;
  }

  for (const entry of model.schema.indexes()) {
    const fields = entry[0] as Record<string, 1>;
    const options = entry[1] ?? {};
    const name = options.name ?? autoName(fields);
    const existing = actual.find((index) => index.name === name);

    /*
     * Only an index with the same NAME but different OPTIONS is a conflict.
     * A missing index is not this script's job: boot-time provisioning
     * creates those, and doing it here would mask a boot regression.
     */
    if (!existing) continue;

    const wantUnique = options.unique === true;
    const haveUnique = existing.unique === true;
    const wantPartial = JSON.stringify(options.partialFilterExpression ?? null);
    const havePartial = JSON.stringify(existing.partialFilterExpression ?? null);

    if (wantUnique === haveUnique && wantPartial === havePartial) {
      clean += 1;
      continue;
    }

    console.log(`${model.modelName}.${name}`);
    console.log(`   declared: unique=${wantUnique} partial=${wantPartial}`);
    console.log(`   actual:   unique=${haveUnique} partial=${havePartial}`);

    if (!wantUnique) {
      /*
       * The schema now wants a PLAIN index but the database holds a unique
       * one. Dropping uniqueness would weaken a guarantee, so this needs a
       * human decision and is reported rather than changed.
       */
      console.log('   -> SKIPPED: the schema is weaker than the database. Human decision needed.');
      blocked += 1;
      console.log('');
      continue;
    }

    // Before dropping, prove no existing document violates the constraint.
    const field = Object.keys(fields)[0];
    if (field === undefined) continue;

    const violations = await findViolations(model.collection, field);

    if (violations.length > 0) {
      console.log(
        `   -> BLOCKED: ${violations.length}+ existing document group(s) violate uniqueness on "${field}".`,
      );
      console.log('      Resolve the duplicates first, then re-run. Nothing was dropped.');
      blocked += 1;
      console.log('');
      continue;
    }

    if (CHECK_ONLY) {
      console.log('   -> would drop and recreate');
      blocked += 1;
      console.log('');
      continue;
    }

    await model.collection.dropIndex(name);
    console.log('   -> dropped; the next boot recreates it correctly');
    dropped += 1;
    console.log('');
  }
}

console.log(`${'='.repeat(70)}`);
console.log(`${clean} index/indices already match their schema.`);
console.log(`${dropped} dropped and will be recreated at boot.`);
console.log(`${blocked} need attention.`);

if (CHECK_ONLY && blocked > 0) {
  console.log('\nRe-run with --apply to fix the ones that are safe to fix automatically.');
}

await mongoose.disconnect();
