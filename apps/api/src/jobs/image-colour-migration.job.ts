/**
 * Migrate product images into per-colour galleries (Option A — quarantine).
 *
 * ## What this does
 *
 * Each product design is photographed into one flat folder, but the storefront
 * gallery is keyed on the selected colour. This migration reads every product,
 * joins each image's filename colour token against the colour tokens that
 * design actually sells, and stamps each image with the colour it was verified
 * as belonging to.
 *
 * Any image whose colour cannot be verified is **quarantined**: it keeps its
 * `sourceFile`, it is recorded in `Product.quarantinedImages` for the review
 * queue, and it is not assigned to a colour or displayed for any colour.
 * Nothing is deleted and no source asset is touched.
 *
 * ## Why this is additive
 *
 * - `Product.images` keeps every element; only two optional fields are added.
 * - `Product.slug` is never written, so live product URLs are preserved.
 * - `Order` snapshots `sku`/`colour`/`size`/`imageUrl` at purchase and is not
 *   referenced by this script, so order history is untouched.
 *
 * ## Usage
 *
 *   # 1. Dry run — reads everything, writes nothing. Always run this first.
 *   tsx src/jobs/image-colour-migration.job.ts --dry-run
 *
 *   # 2. Apply, only after the dry-run report has been reviewed.
 *   tsx src/jobs/image-colour-migration.job.ts --apply
 *
 * The script refuses to run against a database whose name contains
 * `prod`, `production` or `live` (decision C-4, see docs/CATALOG_CONFLICTS.md).
 */

import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';
import { buildColourTokenMap, resolveImageColour } from '@ajooba/contracts';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const APPLY = argv.includes('--apply');
const LIMIT_CODES = readCodeArg(argv);

/**
 * Parse the `--codes` list.
 *
 * Splits on commas *and* whitespace: PowerShell rewrites a bare
 * `--codes A46,A14,A30` into a single space-separated argument
 * (`--codes "A46 A14 A30"`), so a comma-only split silently yields one
 * bogus code that matches nothing — the run then reports "Designs read: 0"
 * rather than failing. Accepting both separators makes the filter behave the
 * same from PowerShell, cmd and bash.
 */
function readCodeArg(args: readonly string[]): string[] | null {
  const idx = args.indexOf('--codes');
  if (idx === -1) return null;
  const value = args.slice(idx + 1).join(' ');
  if (!value.trim()) return null;
  const codes = value
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);

  // A code is `A` + digits. Anything else means the list was malformed, and
  // failing loudly is far safer than quietly matching zero designs.
  const bad = codes.filter((code) => !/^A\d{1,2}$/.test(code));
  if (bad.length > 0) {
    console.error(`Invalid design code(s) in --codes: ${bad.join(', ')}`);
    console.error('Expected A<NN>, e.g. --codes A46,A14,A30');
    process.exit(2);
  }
  return codes.length > 0 ? codes : null;
}

if (DRY_RUN === APPLY) {
  console.error(
    'Specify exactly one mode:\n' +
      '  --dry-run   read everything, write nothing (safe to repeat)\n' +
      '  --apply     stamp the verified colour onto each image\n',
  );
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* Report model                                                               */
/* -------------------------------------------------------------------------- */

interface DesignReport {
  code: string;
  title: string;
  soldColours: string[];
  tokenMap: Record<string, string>;
  assigned: Record<string, string[]>;
  quarantined: Array<{ sourceFile: string; reason: string; token: string | null }>;
  /** Colourways sold but with no verified photography — their SKUs are withheld. */
  withheldColours: string[];
}

const reports: DesignReport[] = [];

const isProd = (dbName: string): boolean => /prod|production|live/i.test(dbName);

async function main(): Promise<void> {
  const dbName = process.env.MONGODB_DB ?? 'ajooba_development';
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';

  if (isProd(dbName)) {
    console.error(`Refusing to run: target database "${dbName}" looks like production.`);
    process.exit(1);
  }

  loadEnv();

  await mongoose.connect(uri, { dbName });
  console.log(`Connected to "${dbName}" (${DRY_RUN ? 'dry run' : 'APPLY'})`);

  const filter = LIMIT_CODES ? { code: { $in: LIMIT_CODES } } : {};
  const products = await ProductModel.find(filter).select('code title colours images').lean<
    Array<{
      code: string;
      title: string;
      colours: string[];
      images: Array<{ sourceFile: string; url: string; colour?: string; colourToken?: string }>;
    }>
  >();

  console.log(`Designs read: ${products.length}\n`);

  /*
   * A `--codes` list that matches nothing is far more likely to be a typo or a
   * malformed argument than an empty result. Without this guard the script
   * prints a clean-looking report having written nothing, which reads as
   * success. Failing here means an empty report can never be mistaken for a
   * no-op.
   */
  if (products.length === 0) {
    console.error(
      LIMIT_CODES
        ? `No designs matched --codes ${LIMIT_CODES.join(', ')} in "${dbName}". Aborting; nothing was written.`
        : `No designs found in "${dbName}". Aborting; nothing was written.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (LIMIT_CODES && products.length !== LIMIT_CODES.length) {
    console.error(
      `Matched ${products.length} of ${LIMIT_CODES.length} requested designs ` +
        `(${products.map((p) => p.code).join(', ')}). Aborting; nothing was written.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  let totalAssigned = 0;
  let totalQuarantined = 0;
  let designsTouched = 0;
  let withheldColourways = 0;

  for (const product of products) {
    /*
     * The variant rows are the authority on what a design is sold in — not the
     * filename and not the denormalised `colours` array. They live in their own
     * collection, which is where the colour↔token pairs come from.
     */
    const productId = await ProductModel.findOne({ code: product.code })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId }>();
    if (!productId) continue;

    const variants = await VariantModel.find({ productId: productId._id })
      .select('colour colourToken')
      .lean<Array<{ colour: string; colourToken: string }>>();

    const soldColours = variants.length
      ? [...new Set(variants.map((v) => v.colour))]
      : product.colours;

    const tokenMap = buildColourTokenMap(variants);
    const assigned: Record<string, string[]> = {};
    for (const colour of soldColours) assigned[colour] = [];
    const quarantined: DesignReport['quarantined'] = [];

    for (const image of product.images) {
      const resolution = resolveImageColour(image.sourceFile, tokenMap, soldColours);
      if (resolution.kind === 'assigned') {
        assigned[resolution.colour]?.push(image.url);
      } else {
        quarantined.push({
          sourceFile: image.sourceFile,
          reason: resolution.reason,
          token: resolution.token,
        });
      }
    }

    /*
     * The withheld SKUs. A colourway is withheld exactly when the design sells
     * it but no image could be verified for it — the shopper would have nothing
     * truthful to look at. Colours that do have verified photography are left
     * alone so the rest of the design stays sellable once stock is loaded.
     */
    const withheldColours = soldColours.filter((colour) => (assigned[colour]?.length ?? 0) === 0);

    reports.push({
      code: product.code,
      title: product.title,
      soldColours,
      tokenMap: Object.fromEntries(tokenMap),
      assigned,
      quarantined,
      withheldColours,
    });

    totalAssigned += product.images.length - quarantined.length;
    totalQuarantined += quarantined.length;
    if (quarantined.length > 0) designsTouched += 1;
    // Counted in both modes: the dry run must show the real withholding plan.
    withheldColourways += withheldColours.length;

    if (APPLY) {
      /*
       * Write per image in one bulkWrite per design. `arrayFilters` target each
       * image by its `sourceFile`, so the update is surgical: untouched fields,
       * `slug` included, are never rewritten.
       */
      const bulk = product.images.map((image) => {
        const resolution = resolveImageColour(image.sourceFile, tokenMap, soldColours);
        const setFields: Record<string, string> =
          resolution.kind === 'assigned'
            ? {
                'images.$[img].colour': resolution.colour,
                // A single-colour design may have no token in its filename; the
                // colour is the authority there, so the token stays blank.
                'images.$[img].colourToken': resolution.token ?? '',
              }
            : // Quarantined: explicitly blanked so no stale colour survives a re-run.
              { 'images.$[img].colour': '', 'images.$[img].colourToken': '' };
        return {
          updateOne: {
            filter: { code: product.code },
            update: { $set: setFields },
            arrayFilters: [{ 'img.sourceFile': image.sourceFile }],
          },
        };
      });

      await ProductModel.bulkWrite(bulk, { ordered: false });
      await ProductModel.updateOne(
        { code: product.code },
        { $set: { quarantinedImages: quarantined.map((q) => q.sourceFile) } },
      );

      /*
       * Flag the withheld colourways. Scoped to this product's variants, and
       * colour-scoped, so a sibling colourway with verified photography keeps
       * selling. `stock`, `inStock` and `reservedStock` are never touched —
       * this is a review gate, not a stock edit.
       */
      await VariantModel.updateMany(
        {
          productId: productId._id,
          ...(withheldColours.length > 0 ? { colour: { $in: withheldColours } } : {}),
        },
        {
          $set: {
            photographyStatus: withheldColours.length > 0 ? 'pending-review' : 'verified',
          },
        },
      );
    }
  }

  printReport({
    totalAssigned,
    totalQuarantined,
    designsTouched,
    withheldColourways,
    products,
  });
  await mongoose.disconnect();
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function printReport(summary: {
  totalAssigned: number;
  totalQuarantined: number;
  designsTouched: number;
  withheldColourways: number;
  products: Array<{ images: unknown[] }>;
}): void {
  const { totalAssigned, totalQuarantined, designsTouched, withheldColourways, products } = summary;
  const totalImages = products.reduce((sum, p) => sum + p.images.length, 0);

  console.log('='.repeat(72));
  console.log('  IMAGE → COLOUR MIGRATION REPORT');
  console.log('='.repeat(72));
  console.log(`mode             ${DRY_RUN ? 'dry run (no writes)' : 'APPLY (writes performed)'}`);
  console.log(`designs read     ${products.length}`);
  console.log(`images read      ${totalImages}`);
  console.log(`assigned         ${totalAssigned}`);
  console.log(`quarantined      ${totalQuarantined}`);
  console.log(`designs affected ${designsTouched}`);
  console.log(`colourways held ${withheldColourways}`);
  console.log('='.repeat(72));

  const withheld = reports.filter((r) => r.withheldColours.length > 0);
  if (withheld.length > 0) {
    console.log('\nWITHHELD FROM SALE — colourways sold but not yet photographed:\n');
    for (const report of withheld) {
      console.log(`  ${report.code}  ${report.withheldColours.join(', ')}`);
    }
  }

  const affected = reports.filter((r) => r.quarantined.length > 0);
  if (affected.length > 0) {
    console.log('\nQUARANTINED — images held back pending review:\n');
    for (const report of affected) {
      console.log(`  ${report.code}  ${report.title}`);
      console.log(`    sells      ${report.soldColours.join(', ')}`);
      for (const q of report.quarantined) {
        const why =
          q.reason === 'untokened'
            ? 'filename carries no colour token'
            : q.reason === 'token-not-sold'
              ? `token "${q.token}" is not a colour this design sells`
              : 'filename does not match the asset naming convention';
        console.log(`    held       ${q.sourceFile}  (${why})`);
      }
      console.log('');
    }
  }

  const multi = reports.filter((r) => r.soldColours.length > 1);
  console.log(`\nPER-COLOUR GALLERIES (${multi.length} multi-colour designs):\n`);
  for (const report of multi) {
    const parts = report.soldColours.map((c) => `${c}=${report.assigned[c]?.length ?? 0}`);
    console.log(`  ${report.code}  ${parts.join('  ')}`);
  }

  console.log('\n' + '='.repeat(72));
  if (DRY_RUN) {
    console.log('Dry run complete. Nothing was written.');
    console.log('Review the report, then re-run with --apply.');
  } else {
    console.log('Apply complete.');
  }
  console.log('='.repeat(72));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
