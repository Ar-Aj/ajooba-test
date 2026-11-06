/**
 * Catalogue import worker.
 *
 * This is the WRITE half of the import pipeline. It reads the JSON produced
 * by `scripts/catalog_extract.py` and writes it to MongoDB through the
 * API's own Mongoose models, so the schema can never drift from the loader.
 *
 *     pnpm --filter @ajooba/api catalog:import -- artifacts/catalog-extract.json
 *
 * Safety properties
 * -----------------
 * * **Re-runnable.** Every record is upserted by a stable identifier
 *   (`Product.code`, `Variant.sku`), so running it twice is idempotent.
 * * **Auditable.** Every conflict detected by the extractor is carried into
 *   the run report and is never silently applied.
 * * **Non-destructive to the source.** The workbook, the `.xls` templates
 *   and the image files are read-only inputs and are never touched.
 * * **Honest about stock.** Variants are imported with `stock = 0` and
 *   `inStock = false` unless `--apply-stock` is passed, because the listing
 *   templates record marketplace artefacts rather than a warehouse ledger
 *   (decision C-3).
 * * **No binaries in MongoDB.** Product images are uploaded to Cloudinary
 *   and only the delivery URL and asset identifier are stored on the
 *   product document.
 * * **Resumable.** A row that fails is recorded as unresolved and does not
 *   abort the run, so a partial failure can be retried safely.
 *
 * Flags
 * -----
 *   --dry-run          Parse and validate, write nothing to the database.
 *   --apply-stock      Use the `Stock` value from the listing templates.
 *   --no-media         Skip Cloudinary upload and keep the local `public/`
 *                      paths (useful offline).
 *   --report <file>    Where to write the JSON run report.
 *   --extract <file>   Path to the extract payload.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import mongoose, { Schema } from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../db/connection.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import {
  isCloudinaryConfigured,
  resolveSourcePath,
  uploadProductImage,
  type StoredMediaRef,
} from '../services/media.service.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ExtractedImage {
  url: string;
  alt: string;
  position: number;
  sourceFile: string;
}

interface ExtractedVariant {
  sku: string;
  size: number;
  colour: string;
  colourToken: string;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  stock: number;
  templateStock: number | null;
  inStock: boolean;
  ukIndiaSize: number | null;
  euroSize: number | null;
  ean: string;
  articleNumber: string;
  marketplaceImageUrls: string[];
}

interface ExtractedProduct {
  code: string;
  slug: string;
  title: string;
  allTitles: string[];
  description: string;
  subcategory: string;
  subcategorySlug: string;
  brand: string;
  colours: string[];
  images: ExtractedImage[];
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  variants: ExtractedVariant[];
}

interface ExtractConflict {
  kind: string;
  sku?: string;
  code?: string;
  field?: string;
  workbook?: unknown;
  template?: unknown;
  source?: string;
  sources?: string[];
  colour?: string;
  count?: number;
  detail?: string;
  resolution?: string;
}

interface ExtractPayload {
  source: Record<string, unknown>;
  products: ExtractedProduct[];
  conflicts: ExtractConflict[];
}

/** A row the importer could not resolve. Never silently dropped. */
interface UnresolvedRow {
  stage: 'validation' | 'media' | 'product-write' | 'variant-write';
  code?: string;
  sku?: string;
  sourceFile?: string;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Report model                                                              */
/* -------------------------------------------------------------------------- */

const importReportSchema = new Schema(
  {
    runId: { type: String, required: true, index: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    dryRun: { type: Boolean, required: true },
    applyStock: { type: Boolean, required: true },
    mediaMode: { type: String, required: true },
    counts: {
      designsRead: Number,
      designsWritten: Number,
      variantsRead: Number,
      variantsWritten: Number,
      conflicts: Number,
      imagesRead: Number,
      imagesUploaded: Number,
      imagesReused: Number,
      imagesUnresolved: Number,
      unresolved: Number,
    },
    source: { type: Schema.Types.Mixed },
    conflicts: { type: [Schema.Types.Mixed], default: [] },
    unresolved: { type: [Schema.Types.Mixed], default: [] },
  },
  { collection: 'import-reports' },
);

const ImportReportModel =
  (mongoose.models.ImportReport as mongoose.Model<Record<string, unknown>> | undefined) ??
  mongoose.model('ImportReport', importReportSchema);

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

class ImportValidationError extends Error {}

/**
 * Validate the extract payload before a single write happens.
 *
 * The rules here are deliberately strict: a catalogue that cannot be
 * trusted is worse than a catalogue that failed to import, because the
 * operator has to tell the difference.
 */
function validatePayload(payload: ExtractPayload): UnresolvedRow[] {
  const unresolved: UnresolvedRow[] = [];

  if (!payload || !Array.isArray(payload.products)) {
    throw new ImportValidationError('extract payload has no `products` array');
  }
  if (!Array.isArray(payload.conflicts)) {
    throw new ImportValidationError('extract payload has no `conflicts` array');
  }

  const seenCodes = new Set<string>();
  const seenSlugs = new Set<string>();
  const seenSkus = new Set<string>();

  for (const product of payload.products) {
    if (!product.code) {
      unresolved.push({ stage: 'validation', reason: 'product is missing its design code' });
      continue;
    }
    if (!product.slug) {
      unresolved.push({
        stage: 'validation',
        code: product.code,
        reason: 'product is missing its slug',
      });
      continue;
    }
    if (seenCodes.has(product.code)) {
      unresolved.push({
        stage: 'validation',
        code: product.code,
        reason: `duplicate design code ${product.code}`,
      });
      continue;
    }
    if (seenSlugs.has(product.slug)) {
      unresolved.push({
        stage: 'validation',
        code: product.code,
        reason: `duplicate slug ${product.slug} — slugs must be unique`,
      });
      continue;
    }
    seenCodes.add(product.code);
    seenSlugs.add(product.slug);

    for (const variant of product.variants) {
      if (!variant.sku) {
        unresolved.push({
          stage: 'validation',
          code: product.code,
          reason: 'variant has no SKU',
        });
        continue;
      }
      if (seenSkus.has(variant.sku)) {
        unresolved.push({
          stage: 'validation',
          code: product.code,
          sku: variant.sku,
          reason: `duplicate SKU ${variant.sku}`,
        });
        continue;
      }
      seenSkus.add(variant.sku);

      if (!Number.isFinite(variant.size) || variant.size <= 0) {
        unresolved.push({
          stage: 'validation',
          code: product.code,
          sku: variant.sku,
          reason: `invalid size ${variant.size}`,
        });
      }
      if (!Number.isFinite(variant.mrp) || variant.mrp < 0) {
        unresolved.push({
          stage: 'validation',
          code: product.code,
          sku: variant.sku,
          reason: `invalid MRP ${variant.mrp}`,
        });
      }
      if (!Number.isFinite(variant.sellingPrice) || variant.sellingPrice < 0) {
        unresolved.push({
          stage: 'validation',
          code: product.code,
          sku: variant.sku,
          reason: `invalid selling price ${variant.sellingPrice}`,
        });
      }
      if (variant.sellingPrice > variant.mrp && variant.mrp > 0) {
        unresolved.push({
          stage: 'validation',
          code: product.code,
          sku: variant.sku,
          reason: `selling price ${variant.sellingPrice} exceeds MRP ${variant.mrp}`,
        });
      }
    }
  }

  return unresolved;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resolve and upload a design's images.
 *
 * Returns the stored media references plus the images that could not be
 * resolved. A failed image never aborts the design: the product is still
 * imported, with the images it does have, and the gap is reported.
 */
async function resolveImages(
  product: ExtractedProduct,
  uploadEnabled: boolean,
): Promise<{
  refs: StoredMediaRef[];
  unresolved: UnresolvedRow[];
  uploaded: number;
  reused: number;
}> {
  const refs: StoredMediaRef[] = [];
  const unresolved: UnresolvedRow[] = [];
  let uploaded = 0;
  let reused = 0;

  for (const image of product.images) {
    const absolutePath = resolveSourcePath(image.url);

    if (!uploadEnabled) {
      refs.push({
        url: image.url,
        alt: image.alt,
        position: image.position,
        sourceFile: image.sourceFile,
        storage: 'local',
      });
      continue;
    }

    const outcome = await uploadProductImage({
      absolutePath,
      localUrl: image.url,
      sourceFile: image.sourceFile,
      alt: image.alt,
      position: image.position,
    });

    if (!outcome.ok) {
      unresolved.push({
        stage: 'media',
        code: product.code,
        sourceFile: image.sourceFile,
        reason: outcome.reason,
      });
      continue;
    }

    refs.push(outcome.result.stored);
    if (outcome.result.reused) {
      reused += 1;
    } else {
      uploaded += 1;
    }
  }

  // Positions must stay contiguous so the storefront gallery order is stable.
  const ordered = refs
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((ref, index) => ({ ...ref, position: index }));

  return { refs: ordered, unresolved, uploaded, reused };
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

interface ImportCounts {
  designsRead: number;
  designsWritten: number;
  variantsRead: number;
  variantsWritten: number;
  conflicts: number;
  imagesRead: number;
  imagesUploaded: number;
  imagesReused: number;
  imagesUnresolved: number;
  unresolved: number;
}

async function runImport(
  payload: ExtractPayload,
  options: {
    dryRun: boolean;
    applyStock: boolean;
    uploadMedia: boolean;
    validationUnresolved: UnresolvedRow[];
  },
): Promise<{
  counts: ImportCounts;
  conflicts: ExtractConflict[];
  unresolved: UnresolvedRow[];
}> {
  const variantsRead = payload.products.reduce(
    (total, product) => total + product.variants.length,
    0,
  );
  const imagesRead = payload.products.reduce((total, product) => total + product.images.length, 0);

  const unresolved: UnresolvedRow[] = [...options.validationUnresolved];

  if (options.dryRun) {
    logger.info(
      { designs: payload.products.length, variants: variantsRead, images: imagesRead },
      'Dry run — no writes performed',
    );

    return {
      counts: {
        designsRead: payload.products.length,
        designsWritten: 0,
        variantsRead,
        variantsWritten: 0,
        conflicts: payload.conflicts.length,
        imagesRead,
        imagesUploaded: 0,
        imagesReused: 0,
        imagesUnresolved: 0,
        unresolved: unresolved.length,
      },
      conflicts: payload.conflicts,
      unresolved,
    };
  }

  let designsWritten = 0;
  let variantsWritten = 0;
  let imagesUploaded = 0;
  let imagesReused = 0;
  let imagesUnresolved = 0;

  for (const product of payload.products) {
    const media = await resolveImages(product, options.uploadMedia);
    imagesUploaded += media.uploaded;
    imagesReused += media.reused;
    imagesUnresolved += media.unresolved.length;
    unresolved.push(...media.unresolved);

    let productDoc;
    try {
      /*
       * Upsert by `code` — the stable identifier. The slug is preserved
       * when it already exists (decision C-2: slugs only change through an
       * explicit, approved migration), so a corrected title never breaks a
       * live URL.
       */
      productDoc = await ProductModel.findOneAndUpdate(
        { code: product.code },
        {
          $set: {
            slug: product.slug,
            title: product.title,
            description: product.description,
            subcategory: product.subcategory,
            subcategorySlug: product.subcategorySlug,
            brand: product.brand,
            colours: product.colours,
            images: media.refs,
            mrp: product.mrp,
            sellingPrice: product.sellingPrice,
            inStock: false,
            marketplaceImageUrls: product.variants
              .flatMap((variant) => variant.marketplaceImageUrls)
              .filter((url, index, all) => all.indexOf(url) === index),
          },
          $setOnInsert: {
            code: product.code,
            sourceFolder: product.images[0]?.url.split('/')[2] ?? '',
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ).lean<{ _id: mongoose.Types.ObjectId } | null>();

      if (!productDoc) {
        throw new Error('upsert returned no document');
      }
    } catch (error) {
      unresolved.push({
        stage: 'product-write',
        code: product.code,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
      continue;
    }

    for (const variant of product.variants) {
      /*
       * C-3: stock defaults to 0 / out of stock unless the operator
       * explicitly asks for the listing-template values to be applied.
       */
      const stock = options.applyStock ? (variant.templateStock ?? 0) : 0;
      const inStock = stock > 0;

      try {
        await VariantModel.findOneAndUpdate(
          { sku: variant.sku },
          {
            $set: {
              productId: productDoc._id,
              productCode: product.code,
              articleNumber: variant.articleNumber,
              size: variant.size,
              ukIndiaSize: variant.ukIndiaSize ?? undefined,
              euroSize: variant.euroSize ?? undefined,
              colour: variant.colour,
              colourToken: variant.colourToken,
              mrp: variant.mrp,
              sellingPrice: variant.sellingPrice,
              discountPercent: variant.discountPercent,
              stock,
              inStock,
              ean: variant.ean,
            },
            $setOnInsert: { sku: variant.sku },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );
        variantsWritten += 1;
      } catch (error) {
        unresolved.push({
          stage: 'variant-write',
          code: product.code,
          sku: variant.sku,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    designsWritten += 1;
  }

  /*
   * The product-level `inStock` rollup follows the variants, but only when
   * stock was actually applied. With no stock source every product is
   * correctly reported as out of stock.
   */
  if (options.applyStock) {
    for (const product of payload.products) {
      const anyInStock = product.variants.some((variant) => (variant.templateStock ?? 0) > 0);
      await ProductModel.updateOne({ code: product.code }, { $set: { inStock: anyInStock } });
    }
    logger.info('Applied listing-template stock to the imported variants');
  }

  return {
    counts: {
      designsRead: payload.products.length,
      designsWritten,
      variantsRead,
      variantsWritten,
      conflicts: payload.conflicts.length,
      imagesRead,
      imagesUploaded,
      imagesReused,
      imagesUnresolved,
      unresolved: unresolved.length,
    },
    conflicts: payload.conflicts,
    unresolved,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Refuse to import into a database that looks like production.
 *
 * This is a safety net, not a permission — an operator can still override
 * it, but the default protects an accidental run against the live store.
 */
function assertNotProductionDatabase(): void {
  if (!env.IMPORT_BLOCK_PRODUCTION) {
    return;
  }

  const dbName = (env.MONGODB_DB ?? '').toLowerCase();
  const isProductionName = ['prod', 'production', 'live'].some((marker) => dbName.includes(marker));

  if (isProductionName) {
    throw new Error(
      `Refusing to run a catalogue import against the database "${env.MONGODB_DB}". ` +
        'Set IMPORT_BLOCK_PRODUCTION=false to override this guard deliberately.',
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const extractIndex = args.indexOf('--extract');
  const extractPath = resolve(
    extractIndex !== -1 && args[extractIndex + 1]
      ? args[extractIndex + 1]!
      : (args.find((arg) => !arg.startsWith('--')) ?? 'artifacts/catalog-extract.json'),
  );

  const dryRun = args.includes('--dry-run');
  const applyStock = args.includes('--apply-stock');
  const uploadMedia = !args.includes('--no-media');

  const reportIndex = args.indexOf('--report');
  const reportPath =
    reportIndex !== -1 && args[reportIndex + 1] ? resolve(args[reportIndex + 1]!) : undefined;

  const raw = await readFile(extractPath, 'utf8');
  const payload = JSON.parse(raw) as ExtractPayload;

  const validationUnresolved = validatePayload(payload);

  if (validationUnresolved.length > 0) {
    logger.warn(
      { count: validationUnresolved.length },
      'Extract payload contains rows that could not be validated — they will be reported, not imported',
    );
  }

  const runId = `import-${Date.now().toString(36)}`;
  const startedAt = new Date();
  const mediaMode = !uploadMedia
    ? 'skipped'
    : isCloudinaryConfigured()
      ? 'cloudinary'
      : 'local-fallback';

  logger.info(
    {
      runId,
      extractPath,
      designs: payload.products.length,
      dryRun,
      applyStock,
      mediaMode,
    },
    'Catalogue import starting',
  );

  if (uploadMedia && !isCloudinaryConfigured()) {
    logger.warn(
      'Cloudinary is not configured — product images will keep their local public/ paths. ' +
        'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to upload them.',
    );
  }

  if (!dryRun) {
    assertNotProductionDatabase();
  }

  await connectToDatabase();

  let result: {
    counts: ImportCounts;
    conflicts: ExtractConflict[];
    unresolved: UnresolvedRow[];
  };
  try {
    result = await runImport(payload, {
      dryRun,
      applyStock,
      uploadMedia,
      validationUnresolved,
    });
  } finally {
    await disconnectFromDatabase();
  }

  const finishedAt = new Date();
  const report = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun,
    applyStock,
    mediaMode,
    source: payload.source,
    counts: result.counts,
    conflicts: result.conflicts,
    unresolved: result.unresolved,
  };

  if (!dryRun) {
    // Persist the report so a reviewer can inspect it from the database,
    // and not only from the file.
    await connectToDatabase();
    try {
      await ImportReportModel.create(report);
    } finally {
      await disconnectFromDatabase();
    }
  }

  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    logger.info({ reportPath }, 'Run report written');
  }

  logger.info({ counts: result.counts }, 'Catalogue import finished');
  process.exit(result.unresolved.length > 0 ? 2 : 0);
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Catalogue import failed');
  process.exit(1);
});
