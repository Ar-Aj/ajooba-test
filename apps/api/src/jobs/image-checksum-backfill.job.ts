/**
 * Backfill `products.images[].checksum` — the duplicate-photograph guard's input.
 *
 * ## Why this exists
 *
 * `assignImage` refuses to place a photograph in a colour gallery when its
 * bytes are already on display for another colour. That guard reads
 * `products.images[].checksum`, but the images imported before Cloudinary
 * integration carry no checksum: they were stamped with a colour by
 * `image-colour-migration.job.ts`, which never hashed the file. So on the
 * live development database **every one of the 685 images has a null
 * checksum**, and the guard was silently inert — it could not block anything.
 *
 * The audit already proves duplicate bytes exist: `A10-7(1).jpg` and
 * `A10-7.jpg` are one photograph under two names (§6.4).
 *
 * ## What this does
 *
 * Reads each image's file from `MEDIA_STATIC_DIR`, computes its SHA-256, and
 * writes it to `products.images[].checksum`. Nothing else is touched: no
 * colour, no `sourceFile`, no `url`, no slug, no variant.
 *
 * Additive, idempotent, and reversible — the field was optional and unused
 * before this, so clearing it restores the previous state exactly.
 *
 * ## Usage
 *
 *   # 1. Dry run — hashes everything, writes nothing. Always run first.
 *   tsx src/jobs/image-checksum-backfill.job.ts --dry-run
 *
 *   # 2. Apply, only after the report has been reviewed.
 *   tsx src/jobs/image-checksum-backfill.job.ts --apply
 *
 * ## Safety
 *
 * - Refuses to run against a database whose name looks like production.
 * - Refuses to run if `MEDIA_STATIC_DIR` is unset — without the source files
 *   there is nothing to hash, and writing a checksum derived from anything
 *   else would be worse than leaving the field null.
 * - An image whose file is missing is **reported and skipped**, never given a
 *   fabricated checksum and never deleted from the catalogue.
 * - `--limit` bounds a trial run.
 */

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { checksumFile } from '../services/media.service.js';
import { ProductModel } from '../models/product.model.js';

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const APPLY = argv.includes('--apply');
const LIMIT = readIntArg(argv, '--limit');

function readIntArg(args: readonly string[], name: string): number | null {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const value = Number(args[idx + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`Invalid value for ${name}: expected a positive integer.`);
    process.exit(2);
  }
  return value;
}

if (DRY_RUN === APPLY) {
  console.error(
    'Specify exactly one mode:\n' +
      '  --dry-run   hash every image, write nothing (safe to repeat)\n' +
      '  --apply     write the SHA-256 onto each image\n' +
      '  --limit N   only process the first N designs (trial runs)\n',
  );
  process.exit(2);
}

const isProd = (dbName: string): boolean => /prod|production|live/i.test(dbName);

interface ImageRow {
  sourceFile: string;
  url: string;
  checksum?: string;
  colour?: string;
}

interface DesignReport {
  code: string;
  title: string;
  hashed: number;
  alreadyStamped: number;
  missing: string[];
  /** Distinct checksums seen more than once inside this design. */
  duplicateGroups: string[][];
}

const reports: DesignReport[] = [];

async function main(): Promise<void> {
  const dbName = process.env.MONGODB_DB ?? 'ajooba_development';
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';

  if (isProd(dbName)) {
    console.error(`Refusing to run: target database "${dbName}" looks like production.`);
    process.exit(1);
  }

  loadEnv();

  /*
   * The images are only readable from the machine that holds them. In a
   * deployment where the CDN serves them, this job correctly refuses rather
   * than writing checksums it cannot compute.
   */
  const mediaRoot = process.env.MEDIA_STATIC_DIR;
  if (!mediaRoot || !existsSync(mediaRoot)) {
    console.error(
      'MEDIA_STATIC_DIR is not set to an existing directory.\n' +
        'This job hashes the source files on disk, so it can only run where the\n' +
        'catalogue media is present. Nothing was written.',
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName });
  console.log(`Connected to "${dbName}" (${APPLY ? 'APPLY' : 'dry run'})`);
  console.log(`Media root: ${mediaRoot}\n`);

  const products = await ProductModel.find({})
    .select('code title images')
    .limit(LIMIT ?? 0)
    .lean<Array<{ code: string; title: string; images: ImageRow[] }>>();

  if (products.length === 0) {
    console.error(`No designs found in "${dbName}". Aborting; nothing was written.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  let totalHashed = 0;
  let totalAlready = 0;
  let totalMissing = 0;
  /** Global checksum → every (design, file) that holds those bytes. */
  const checksumIndex = new Map<string, string[]>();

  for (const product of products) {
    const report: DesignReport = {
      code: product.code,
      title: product.title,
      hashed: 0,
      alreadyStamped: 0,
      missing: [],
      duplicateGroups: [],
    };

    const withinDesign = new Map<string, string[]>();
    const updates: Array<{
      updateOne: {
        filter: { code: string };
        update: { $set: Record<string, string> };
        arrayFilters: Array<Record<string, string>>;
      };
    }> = [];

    for (const image of product.images) {
      if (image.checksum) {
        report.alreadyStamped += 1;
        const seen = withinDesign.get(image.checksum) ?? [];
        seen.push(image.sourceFile);
        withinDesign.set(image.checksum, seen);
        const globalSeen = checksumIndex.get(image.checksum) ?? [];
        globalSeen.push(`${product.code}:${image.sourceFile}`);
        checksumIndex.set(image.checksum, globalSeen);
        continue;
      }

      /*
       * `url` is the root-relative public path (`/products/AJ-A46/…`), which
       * is exactly the layout under MEDIA_STATIC_DIR.
       */
      const relative = (image.url ?? '').replace(/^\/+/, '');
      const absolute = join(mediaRoot, relative);

      if (!relative || !existsSync(absolute)) {
        report.missing.push(image.sourceFile);
        continue;
      }

      let checksum: string;
      try {
        checksum = await checksumFile(absolute);
      } catch {
        report.missing.push(image.sourceFile);
        continue;
      }

      report.hashed += 1;
      const seen = withinDesign.get(checksum) ?? [];
      seen.push(image.sourceFile);
      withinDesign.set(checksum, seen);

      const globalSeen = checksumIndex.get(checksum) ?? [];
      globalSeen.push(`${product.code}:${image.sourceFile}`);
      checksumIndex.set(checksum, globalSeen);

      updates.push({
        updateOne: {
          filter: { code: product.code },
          update: { $set: { 'images.$[img].checksum': checksum } },
          // Targeted by sourceFile, so every other field on the array — colour
          // included — is left exactly as it is.
          arrayFilters: [{ 'img.sourceFile': image.sourceFile }],
        },
      });
    }

    report.duplicateGroups = [...withinDesign.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([, files]) => files);

    reports.push(report);
    totalHashed += report.hashed;
    totalAlready += report.alreadyStamped;
    totalMissing += report.missing.length;

    if (APPLY && updates.length > 0) {
      await ProductModel.bulkWrite(updates, { ordered: false });
    }
  }

  printReport({ totalHashed, totalAlready, totalMissing, checksumIndex });
  await mongoose.disconnect();
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function printReport(summary: {
  totalHashed: number;
  totalAlready: number;
  totalMissing: number;
  checksumIndex: Map<string, string[]>;
}): void {
  const { totalHashed, totalAlready, totalMissing, checksumIndex } = summary;
  const totalImages = reports.reduce((sum, r) => sum + r.hashed + r.alreadyStamped, 0);

  console.log('='.repeat(72));
  console.log('  IMAGE CHECKSUM BACKFILL REPORT');
  console.log('='.repeat(72));
  console.log(`mode             ${APPLY ? 'APPLY (writes performed)' : 'dry run (no writes)'}`);
  console.log(`designs read     ${reports.length}`);
  console.log(`images read      ${totalImages}`);
  console.log(`hashed           ${totalHashed}`);
  console.log(`already stamped  ${totalAlready}`);
  console.log(`file missing     ${totalMissing}`);
  console.log('='.repeat(72));

  /*
   * This is the actual output of the run: the duplicate groups the guard now
   * has enough information to refuse. Reporting them here is what turns an
   * inert safety check into an actionable review list.
   */
  const crossDesign = [...checksumIndex.entries()].filter(([, files]) => files.length > 1);

  console.log('\nDUPLICATE BYTES — one photograph under several names:\n');
  if (crossDesign.length === 0) {
    console.log('  none');
  } else {
    for (const [checksum, files] of crossDesign) {
      console.log(`  ${checksum.slice(0, 12)}…  ${files.join('  ')}`);
    }
  }

  const missing = reports.filter((r) => r.missing.length > 0);
  if (missing.length > 0) {
    console.log('\nSOURCE FILES NOT FOUND — skipped, left with a null checksum:\n');
    for (const report of missing) {
      console.log(`  ${report.code}  ${report.missing.join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(72));
  if (DRY_RUN) {
    console.log('Dry run complete. Nothing was written.');
    console.log('Review the report, then re-run with --apply.');
  } else {
    console.log('Apply complete.');
    console.log(
      'Run again to confirm idempotency: "already stamped" should equal the image count.',
    );
  }
  console.log('='.repeat(72));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
