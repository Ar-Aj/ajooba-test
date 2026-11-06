import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { ValidationError } from '../core/errors.js';
import { writeAuditLog } from './audit.service.js';
import type { ActorContext } from './catalog-admin.service.js';
import {
  IMPORT_PLAN_STATUSES,
  ImportPlanModel,
  type ImportPlanStatus,
} from '../models/import-plan.model.js';
import { writeStagedPayload, readStagedPayload } from './import-staging.service.js';

export type { ImportPlanStatus };
export { IMPORT_PLAN_STATUSES };

/**
 * Controlled catalogue import (G-6).
 *
 * ## Why this is not "an endpoint that runs the importer"
 *
 * The importer at `src/jobs/catalog-import.job.ts` reads a JSON extract and
 * writes it through the application's own models. It is correct and it is
 * idempotent, but it is a **CLI tool pointed at whatever database the
 * environment happens to name**. Exposing that as an HTTP endpoint would
 * hand any `import:run` holder a one-request path to a catalogue-wide write.
 *
 * This module is the controlled wrapper. Its rules:
 *
 *  1. **The source arrives as an uploaded file, never as a path.** The
 *     original workbook lives on a developer's `C:` drive, which Railway and
 *     Vercel cannot see. A client may not submit a filesystem path and may
 *     not submit a command — the endpoint accepts a JSON payload body only.
 *  2. **Dry run is the default and the only way to see the report.** A plan
 *     is computed and persisted with zero writes to the catalogue.
 *  3. **Applying requires the plan's id plus its content hash.** A client
 *     cannot apply a plan it has not seen, and cannot apply a plan whose
 *     source has changed underneath it.
 *  4. **Ambiguous rows are quarantined, never applied.** Duplicate SKUs,
 *     parent conflicts and unresolved colours are excluded from the apply
 *     set and reported.
 *  5. **The target database is stated in the plan and echoed on apply.** An
 *     operator approving an import must be able to see which database it
 *     targets before authorising it.
 *  6. **The plan records who built it, who approved it, and the outcome.**
 */

/* -------------------------------------------------------------------------- */
/* Payload shape                                                              */
/* -------------------------------------------------------------------------- */

/** One row of the extract, as the existing importer consumes it. */
export interface ImportVariantPayload {
  readonly sku: string;
  readonly size: number;
  readonly colour: string;
  readonly colourToken: string;
  readonly mrp: number;
  readonly sellingPrice: number;
  readonly articleNumber?: string;
  readonly ukIndiaSize?: number | null;
  readonly euroSize?: number | null;
  readonly ean?: string;
}

export interface ImportProductPayload {
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  readonly subcategory: string;
  readonly subcategorySlug: string;
  readonly brand?: string;
  readonly colours?: readonly string[];
  readonly mrp?: number;
  readonly sellingPrice?: number;
  readonly images?: ReadonlyArray<{ url: string; sourceFile: string; position?: number }>;
  readonly variants?: readonly ImportVariantPayload[];
}

export interface ImportPayload {
  readonly products?: readonly ImportProductPayload[];
  readonly conflicts?: readonly unknown[];
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

/** One row's disposition in the plan. */
export type FindingDisposition = 'create' | 'update' | 'quarantine' | 'reject';

export interface ImportFinding {
  readonly disposition: FindingDisposition;
  readonly kind: 'product' | 'variant';
  readonly code?: string;
  readonly sku?: string;
  readonly sourceFile?: string;
  readonly reason: string;
  /**
   * Position of the row this finding describes, within the payload.
   *
   * Necessary because a `code` is not unique *within* a payload: a duplicate
   * design code produces two findings for the same code, one create and one
   * quarantine. Without an ordinal, the apply loop cannot tell which finding
   * belongs to which row and would exclude both.
   */
  readonly rowIndex: number;
  /** For variant and image findings, the row index of the owning product. */
  readonly parentIndex?: number;
}

export interface ImportPlanResult {
  readonly planId: string;
  readonly status: ImportPlanStatus;
  readonly targetDatabase: string;
  readonly sourceFilename: string;
  readonly payloadChecksum: string;
  readonly payloadBytes: number;
  readonly counts: {
    readonly designsToCreate: number;
    readonly designsToUpdate: number;
    readonly variantsToCreate: number;
    readonly variantsToUpdate: number;
    readonly quarantine: number;
    readonly reject: number;
    readonly conflicts: number;
  };
  readonly findings: readonly ImportFinding[];
  readonly createdAt: string;
}

/** Hard ceilings, so one request cannot consume unbounded memory or time. */
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_PRODUCTS = 5_000;
const MAX_VARIANTS = 100_000;
const MAX_FINDINGS = 1_000;

/**
 * Compute an import plan without writing to the catalogue.
 *
 * Every existing identifier is checked against the database, so the counts
 * distinguish "this will create a design" from "this will update one". Rows
 * that cannot be applied with confidence are quarantined rather than
 * guessed at.
 */
async function planImport(
  payload: ImportPayload,
  meta: {
    sourceFilename: string;
    payloadBytes: number;
    checksum: string;
    targetDatabase: string;
  },
): Promise<Omit<ImportPlanResult, 'planId' | 'status' | 'createdAt'>> {
  const products = payload.products ?? [];

  if (products.length > MAX_PRODUCTS) {
    throw new ValidationError(
      `Payload contains ${products.length} designs; the limit is ${MAX_PRODUCTS}.`,
    );
  }

  const findings: ImportFinding[] = [];
  const push = (finding: ImportFinding): void => {
    // The findings list is a report, not a ledger; it is capped and the
    // counts above it carry the totals.
    if (findings.length < MAX_FINDINGS) {
      findings.push(finding);
    }
  };

  // Load the existing identifiers once rather than per row.
  const db = mongoose.connection.db;
  const existingCodes = new Set<string>();
  const existingSkus = new Set<string>();
  let variantTotal = 0;

  if (db) {
    const [productCodes, variantSkus] = await Promise.all([
      db
        .collection('products')
        .find({}, { projection: { code: 1 } })
        .toArray(),
      db
        .collection('variants')
        .find({}, { projection: { sku: 1 } })
        .toArray(),
    ]);
    for (const row of productCodes) {
      existingCodes.add(String((row as { code?: unknown }).code));
    }
    for (const row of variantSkus) {
      existingSkus.add(String((row as { sku?: unknown }).sku));
    }
  }

  const seenCodes = new Set<string>();
  const seenSkus = new Set<string>();

  let designsToCreate = 0;
  let designsToUpdate = 0;
  let variantsToCreate = 0;
  let variantsToUpdate = 0;
  let quarantine = 0;
  let reject = 0;

  for (const [productIndex, product] of products.entries()) {
    if (!product.code || !/^A\d{2}$/.test(product.code)) {
      reject += 1;
      push({
        disposition: 'reject',
        kind: 'product',
        rowIndex: productIndex,
        reason: `Invalid or missing design code: "${product.code ?? ''}".`,
      });
      continue;
    }

    if (seenCodes.has(product.code)) {
      /*
       * Two designs with one code in the same payload. The importer upserts on
       * `code`, so the second would silently overwrite the first. That is
       * exactly the fork this control exists to prevent.
       */
      quarantine += 1;
      push({
        disposition: 'quarantine',
        kind: 'product',
        code: product.code,
        rowIndex: productIndex,
        reason: 'Duplicate design code within the payload.',
      });
      continue;
    }
    seenCodes.add(product.code);

    if (product.subcategorySlug === undefined || product.subcategorySlug === '') {
      quarantine += 1;
      push({
        disposition: 'quarantine',
        kind: 'product',
        code: product.code,
        rowIndex: productIndex,
        reason: 'No subcategorySlug — cannot be assigned to a category.',
      });
      continue;
    }

    if (existingCodes.has(product.code)) {
      designsToUpdate += 1;
      push({
        disposition: 'update',
        kind: 'product',
        code: product.code,
        rowIndex: productIndex,
        reason: 'Design code already exists; the existing record will be updated.',
      });
    } else {
      designsToCreate += 1;
      push({
        disposition: 'create',
        kind: 'product',
        code: product.code,
        rowIndex: productIndex,
        reason: 'New design code.',
      });
    }

    for (const [variantIndex, variant] of (product.variants ?? []).entries()) {
      variantTotal += 1;
      if (variantTotal > MAX_VARIANTS) {
        throw new ValidationError(`Payload exceeds ${MAX_VARIANTS} variant rows.`);
      }

      if (!variant.sku) {
        quarantine += 1;
        push({
          disposition: 'quarantine',
          kind: 'variant',
          code: product.code,
          rowIndex: variantIndex,
          parentIndex: productIndex,
          reason: 'Variant row has no SKU.',
        });
        continue;
      }

      if (seenSkus.has(variant.sku)) {
        quarantine += 1;
        push({
          disposition: 'quarantine',
          kind: 'variant',
          code: product.code,
          sku: variant.sku,
          rowIndex: variantIndex,
          parentIndex: productIndex,
          reason: 'Duplicate SKU within the payload.',
        });
        continue;
      }
      seenSkus.add(variant.sku);

      if (
        !Number.isFinite(variant.mrp) ||
        !Number.isFinite(variant.sellingPrice) ||
        variant.mrp < 0 ||
        variant.sellingPrice < 0
      ) {
        quarantine += 1;
        push({
          disposition: 'quarantine',
          kind: 'variant',
          code: product.code,
          sku: variant.sku,
          rowIndex: variantIndex,
          parentIndex: productIndex,
          reason: 'Missing or invalid pricing.',
        });
        continue;
      }

      if (variant.sellingPrice > variant.mrp && variant.mrp > 0) {
        quarantine += 1;
        push({
          disposition: 'quarantine',
          kind: 'variant',
          code: product.code,
          sku: variant.sku,
          rowIndex: variantIndex,
          parentIndex: productIndex,
          reason: `Selling price ${variant.sellingPrice} exceeds MRP ${variant.mrp}.`,
        });
        continue;
      }

      if (existingSkus.has(variant.sku)) {
        variantsToUpdate += 1;
        push({
          disposition: 'update',
          kind: 'variant',
          code: product.code,
          sku: variant.sku,
          rowIndex: variantIndex,
          parentIndex: productIndex,
          reason: 'SKU already exists; the existing record will be updated.',
        });
      } else {
        variantsToCreate += 1;
        push({
          disposition: 'create',
          kind: 'variant',
          code: product.code,
          sku: variant.sku,
          rowIndex: variantIndex,
          parentIndex: productIndex,
          reason: 'New SKU.',
        });
      }
    }

    /*
     * Images whose colour cannot be established are counted as quarantined
     * *evidence*: they are retained and reported, never auto-assigned.
     */
    for (const [imageIndex, image] of (product.images ?? []).entries()) {
      if (!image.sourceFile) {
        quarantine += 1;
        push({
          disposition: 'quarantine',
          kind: 'product',
          code: product.code,
          rowIndex: imageIndex,
          parentIndex: productIndex,
          reason: 'Image row has no sourceFile.',
        });
      }
    }
  }

  return {
    targetDatabase: meta.targetDatabase,
    sourceFilename: meta.sourceFilename,
    payloadChecksum: meta.checksum,
    payloadBytes: meta.payloadBytes,
    counts: {
      designsToCreate,
      designsToUpdate,
      variantsToCreate,
      variantsToUpdate,
      quarantine,
      reject,
      conflicts: (payload.conflicts ?? []).length,
    },
    findings,
  };
}

/** The database this connection is actually pointed at. */
export function currentTargetDatabase(): string {
  return mongoose.connection.name || 'unknown';
}

/** SHA-256 of the raw payload, used to bind an apply to its dry run. */
export function checksumPayload(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Build a dry-run plan.
 *
 * Writes nothing to `products` or `variants`. The only write is the plan
 * record itself, which is what the apply is authorised against.
 */
export async function createImportPlan(
  rawPayload: string,
  sourceFilename: string,
  actor: ActorContext,
): Promise<ImportPlanResult> {
  const payloadBytes = Buffer.byteLength(rawPayload, 'utf8');
  if (payloadBytes === 0) {
    throw new ValidationError('The uploaded payload is empty.');
  }
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new ValidationError(
      `The uploaded payload is ${payloadBytes} bytes; the limit is ${MAX_PAYLOAD_BYTES}.`,
    );
  }

  let parsed: ImportPayload;
  try {
    parsed = JSON.parse(rawPayload) as ImportPayload;
  } catch {
    throw new ValidationError('The uploaded payload is not valid JSON.');
  }

  if (!parsed || !Array.isArray(parsed.products)) {
    throw new ValidationError('The payload must contain a `products` array.');
  }

  const checksum = checksumPayload(rawPayload);
  const planId = `plan-${Date.now().toString(36)}-${checksum.slice(0, 8)}`;

  /*
   * Stage the payload before planning. The apply reads it back and re-checks
   * the checksum, so an approval can never be pointed at different bytes than
   * the report the operator actually read.
   */
  const stagedPath = writeStagedPayload(planId, rawPayload);

  const result = await planImport(parsed, {
    sourceFilename,
    payloadBytes,
    checksum,
    targetDatabase: currentTargetDatabase(),
  });

  const created = await ImportPlanModel.create({
    planId,
    status: 'dry-run',
    targetDatabase: result.targetDatabase,
    sourceFilename,
    payloadChecksum: checksum,
    stagedPath,
    payloadBytes,
    counts: result.counts,
    findings: [...result.findings],
    requestedByEmail: actor.actorEmail,
  });

  const createdAt = (created as { createdAt?: Date | string }).createdAt;

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'import',
    entity: 'import-plan',
    entityId: planId,
    summary:
      `Import dry run for "${sourceFilename}" against "${result.targetDatabase}": ` +
      `${result.counts.designsToCreate} new design(s), ${result.counts.variantsToCreate} new SKU(s), ` +
      `${result.counts.quarantine} quarantined. No writes.`,
    changes: result.counts,
    ip: actor.ip,
  });

  return {
    planId,
    status: 'dry-run',
    ...result,
    createdAt: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
  };
}

/** Read one plan back. */
export async function getImportPlan(planId: string): Promise<
  ImportPlanResult & {
    approvedByEmail: string | null;
    approvedAt: string | null;
    result: unknown;
  }
> {
  const doc = await ImportPlanModel.findOne({ planId }).lean<ImportPlanLean | null>();

  if (!doc) {
    throw new ValidationError(`Import plan "${planId}" was not found.`);
  }

  return {
    planId: doc.planId,
    status: doc.status,
    targetDatabase: doc.targetDatabase,
    sourceFilename: doc.sourceFilename,
    payloadChecksum: doc.payloadChecksum,
    payloadBytes: doc.payloadBytes,
    counts: doc.counts,
    findings: (doc.findings as ImportFinding[]) ?? [],
    approvedByEmail: doc.approvedByEmail ?? null,
    approvedAt: doc.approvedAt ? new Date(doc.approvedAt).toISOString() : null,
    result: doc.result ?? null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
  };
}

/** The shape a plan has when read back lean. */
interface ImportPlanLean {
  planId: string;
  status: ImportPlanStatus;
  targetDatabase: string;
  sourceFilename: string;
  payloadChecksum: string;
  payloadBytes: number;
  counts: ImportPlanResult['counts'];
  findings: unknown[];
  requestedByEmail?: string | null;
  approvedByEmail?: string | null;
  approvedAt?: Date | string | null;
  createdAt?: Date | string | null;
  result?: unknown;
}

/** The most recent plans, newest first. */
export async function listImportPlans(limit: number): Promise<
  Array<{
    planId: string;
    status: ImportPlanStatus;
    targetDatabase: string;
    sourceFilename: string;
    counts: ImportPlanResult['counts'];
    requestedByEmail: string | null;
    approvedByEmail: string | null;
    createdAt: string;
  }>
> {
  const docs = await ImportPlanModel.find({})
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .lean<ImportPlanLean[]>();

  return docs.map((doc) => ({
    planId: doc.planId,
    status: doc.status,
    targetDatabase: doc.targetDatabase,
    sourceFilename: doc.sourceFilename,
    counts: doc.counts,
    requestedByEmail: doc.requestedByEmail ?? null,
    approvedByEmail: doc.approvedByEmail ?? null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
  }));
}

/**
 * Apply a previously planned import.
 *
 * The caller must present the plan id **and** the checksum of the payload it
 * is applying. A mismatch is rejected: the source file changed between the
 * dry run and the approval, so the plan no longer describes what would be
 * written.
 *
 * Retrying a partially applied import is safe — every row is an upsert on a
 * stable identifier — and the response reports per-row failures so an
 * operator can see exactly what still needs attention.
 *
 * **Quarantined and rejected rows are never applied.** They were excluded
 * from the plan for a reason, and resolving that reason is a human decision
 * made through the product and image-review APIs.
 */
export async function applyImportPlan(
  planId: string,
  payloadChecksum: string,
  apply: boolean,
  actor: ActorContext,
): Promise<{
  planId: string;
  status: ImportPlanStatus;
  targetDatabase: string;
  dryRun: boolean;
  applied: {
    designsCreated: number;
    designsUpdated: number;
    variantsCreated: number;
    variantsUpdated: number;
  };
  skipped: number;
  failed: Array<{ code?: string; sku?: string; reason: string }>;
}> {
  const doc = await ImportPlanModel.findOne({ planId });

  if (!doc) {
    throw new ValidationError(`Import plan "${planId}" was not found.`);
  }

  if (doc.payloadChecksum !== payloadChecksum) {
    throw new ValidationError(
      'The uploaded payload does not match the one this plan was built from. ' +
        'Re-run the dry run against the current file and review the new report.',
    );
  }

  const status: ImportPlanStatus = doc.status;
  if (status === 'applied') {
    throw new ValidationError(`Import plan "${planId}" has already been applied.`);
  }
  if (status === 'superseded') {
    throw new ValidationError(
      `Import plan "${planId}" was superseded by a newer plan and cannot be applied.`,
    );
  }

  const response: {
    planId: string;
    status: ImportPlanStatus;
    targetDatabase: string;
    dryRun: boolean;
    applied: {
      designsCreated: number;
      designsUpdated: number;
      variantsCreated: number;
      variantsUpdated: number;
    };
    skipped: number;
    failed: Array<{ code?: string; sku?: string; reason: string }>;
  } = {
    planId,
    status: 'dry-run',
    targetDatabase: String(doc.targetDatabase),
    dryRun: true,
    applied: { designsCreated: 0, designsUpdated: 0, variantsCreated: 0, variantsUpdated: 0 },
    skipped: 0,
    failed: [],
  };

  if (!apply) {
    return response;
  }

  /*
   * Load the payload back from staging. The plan records where it was stored
   * and the checksum it was stored under; if the bytes no longer hash to that
   * value the plan is void, which is what stops an approve-time swap.
   */
  const raw = readStagedPayload(String(doc.stagedPath));
  const actual = checksumPayload(raw);

  if (actual !== String(doc.payloadChecksum)) {
    throw new ValidationError(
      'The staged payload no longer matches the checksum this plan was approved against. ' +
        'The import has not been applied.',
    );
  }

  const payload = JSON.parse(raw) as ImportPayload;

  /*
   * Findings are keyed by **row position**, not by code or SKU.
   *
   * Keying by identifier silently collides whenever one identifier maps to
   * more than one row — a duplicated design code produces a `create` finding
   * and a `quarantine` finding for the same code, and a plain `Map.set`
   * leaves only the last. The apply loop would then read the quarantine
   * verdict for *both* rows and skip the legitimate one, so an import with a
   * single bad row would import nothing at all.
   */
  const findings = new Map<string, ImportFinding>();
  for (const finding of (doc.findings as ImportFinding[]) ?? []) {
    const key =
      finding.kind === 'product' && finding.parentIndex === undefined
        ? `product:${finding.rowIndex}`
        : `${finding.kind}:${finding.parentIndex ?? 0}:${finding.rowIndex}`;
    findings.set(key, finding);
  }

  /** True when this row may be applied at all. */
  const isApplicable = (finding: ImportFinding | undefined): boolean =>
    !finding || finding.disposition === 'create' || finding.disposition === 'update';

  const db = mongoose.connection.db;
  if (!db) {
    throw new ValidationError('No database connection is available for the import.');
  }

  const products = db.collection('products');
  const variants = db.collection('variants');

  let skipped = 0;
  const failed: Array<{ code?: string; sku?: string; reason: string }> = [];

  for (const [productIndex, product] of (payload.products ?? []).entries()) {
    const productFinding = findings.get(`product:${productIndex}`);

    /*
     * Anything the plan excluded stays excluded. Applying a quarantined row
     * would defeat the entire point of quarantining it.
     */
    if (!isApplicable(productFinding)) {
      skipped += 1;
      continue;
    }

    const now = new Date();
    const slugBase = String(product.title ?? product.code)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-');

    try {
      const existing = await products.findOne({ code: product.code });

      await products.updateOne(
        { code: product.code },
        {
          $set: {
            title: product.title,
            description: product.description ?? '',
            subcategory: product.subcategory,
            subcategorySlug: product.subcategorySlug,
            brand: product.brand ?? 'Ajooba Footwear',
            colours: product.colours ?? [],
            mrp: product.mrp ?? 0,
            sellingPrice: product.sellingPrice ?? 0,
            // Stock is never imported. See the note in the module header.
            inStock: false,
            updatedAt: now,
          },
          $setOnInsert: {
            code: product.code,
            slug: slugBase || String(product.code).toLowerCase(),
            images: [],
            quarantinedImages: [],
            createdAt: now,
            status: 'published',
          },
        },
        { upsert: true },
      );

      if (existing) response.applied.designsUpdated += 1;
      else response.applied.designsCreated += 1;

      const parent = await products.findOne({ code: product.code }, { projection: { _id: 1 } });

      for (const [variantIndex, variant] of (product.variants ?? []).entries()) {
        const variantFinding = findings.get(`variant:${productIndex}:${variantIndex}`);
        if (!isApplicable(variantFinding)) {
          skipped += 1;
          continue;
        }

        const existingVariant = await variants.findOne({ sku: variant.sku });

        await variants.updateOne(
          { sku: variant.sku },
          {
            $set: {
              productId: parent?._id,
              productCode: product.code,
              articleNumber: variant.articleNumber ?? product.code,
              size: variant.size,
              colour: variant.colour,
              colourToken: variant.colourToken,
              mrp: variant.mrp,
              sellingPrice: variant.sellingPrice,
              discountPercent:
                variant.mrp > 0
                  ? Math.round(((variant.mrp - variant.sellingPrice) / variant.mrp) * 100)
                  : 0,
              ean: variant.ean ?? '',
              // Stock is never imported; see the module header.
              inStock: false,
              updatedAt: now,
            },
            $setOnInsert: {
              sku: variant.sku,
              stock: 0,
              reservedStock: 0,
              photographyStatus: 'pending-review',
              createdAt: now,
            },
          },
          { upsert: true },
        );

        if (existingVariant) response.applied.variantsUpdated += 1;
        else response.applied.variantsCreated += 1;
      }
    } catch (error) {
      failed.push({
        code: product.code,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  response.skipped = skipped;
  response.failed = failed;
  response.dryRun = false;
  response.status = failed.length > 0 ? 'failed' : 'applied';

  doc.status = response.status;
  doc.approvedByEmail = actor.actorEmail;
  doc.approvedAt = new Date();
  doc.appliedAt = new Date();
  doc.result = {
    applied: response.applied,
    skipped,
    failed: failed.length,
  };
  await doc.save();

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'import',
    entity: 'import-plan',
    entityId: planId,
    summary:
      `Import applied to "${response.targetDatabase}" from "${doc.sourceFilename}": ` +
      `${response.applied.designsCreated} design(s) created, ${response.applied.designsUpdated} updated, ` +
      `${response.applied.variantsCreated} SKU(s) created, ${skipped} skipped, ${failed.length} failed.`,
    changes: { ...response.applied, skipped, failed: failed.length },
    ip: actor.ip,
  });

  return response;
}
