import { z } from 'zod';

/**
 * Catalogue administration contracts.
 *
 * These cover the gaps identified in `docs/API_CONTRACT_GAPS.md`: the
 * product / colour-variant / SKU write surface (G-1, G-2, G-3), the
 * category taxonomy (G-4) and the image-review workflow (G-5).
 *
 * ## Addressing rules encoded here
 *
 *  - **Products are addressed by `code` (`A<NN>`), never by `slug` or
 *    title.** The slug is server-derived and changes when the title
 *    changes; the code is the stable identifier the importer upserts on.
 *  - **Variants are addressed by `sku`**, which is the merchant's own
 *    identifier and is stored verbatim from the workbook.
 *  - **Colour is always carried with the token.** `OW`, `IVY` and `IVR`
 *    all mean Ivory, so a colour change is only meaningful alongside the
 *    token it was recorded under.
 *
 * A product name is never an identifier anywhere in this file.
 */

/* -------------------------------------------------------------------------- */
/* G-1 — Products                                                             */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a design. Mirrors "published / archived", never "deleted". */
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Fields an administrator may set when creating a design. */
export const createProductRequestSchema = z.object({
  /** The `A<NN>` design code. Unique across the collection. */
  code: z
    .string()
    .trim()
    .regex(/^A\d{2}$/, 'Design code must look like A01'),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
  /** Workbook `Sub-category` value, verbatim. */
  subcategory: z.string().trim().min(1).max(60),
  /** Normalised slug. Must match an existing category (G-4). */
  subcategorySlug: z.string().trim().min(1).max(60),
  brand: z.string().trim().min(1).max(80).default('Ajooba Footwear'),
  /** Colours this design is sold in. Must be real workbook colours. */
  colours: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  mrp: z.coerce.number().int().nonnegative(),
  sellingPrice: z.coerce.number().int().nonnegative(),
  /** Optional SEO overrides. */
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
  status: z.enum(PRODUCT_STATUSES).default('draft'),
});

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

/**
 * Partial update of a design.
 *
 * `code` is deliberately absent: it is the identity the API addresses the
 * product by, and changing it would fork the catalogue rather than edit it.
 * `slug` is server-derived from the title and cannot be supplied.
 */
export const updateProductRequestSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  subcategory: z.string().trim().min(1).max(60).optional(),
  subcategorySlug: z.string().trim().min(1).max(60).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  colours: z.array(z.string().trim().min(1).max(40)).min(1).max(12).optional(),
  mrp: z.coerce.number().int().nonnegative().optional(),
  sellingPrice: z.coerce.number().int().nonnegative().optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
});

export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

/** Admin listing of designs. */
export const adminProductQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  subcategory: z.string().trim().max(60).optional(),
  /** Include designs with no in-stock variant. Defaults to true for admin. */
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;

/* -------------------------------------------------------------------------- */
/* G-2 / G-3 — Colour variants and SKUs                                       */
/* -------------------------------------------------------------------------- */

/**
 * Create one colourway for an existing design.
 *
 * `stock` is **not** accepted. A new SKU is always created at zero stock:
 * the only legitimate sources of stock are an administrator adjustment
 * (Phase 7) or an approved inventory import, and both append to the stock
 * ledger. A create call that could set stock would be a second, unaudited
 * way to move inventory.
 */
export const createVariantRequestSchema = z.object({
  colour: z.string().trim().min(1).max(40),
  /** Token the SKU encodes for this colour, e.g. `OW` for Ivory. */
  colourToken: z
    .string()
    .trim()
    .min(2)
    .max(5)
    .regex(/^[A-Za-z]+$/, 'Colour token must be letters only'),
  size: z.coerce.number().int().min(1).max(60),
  /** The merchant's own SKU. Stored verbatim; must be unique. */
  sku: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^AJ-A\d{2}-[A-Za-z]{2,5}-\d{1,2}$/, 'Must be a Seller SKU Id, e.g. AJ-A01-OW-06'),
  articleNumber: z.string().trim().min(1).max(40),
  mrp: z.coerce.number().int().nonnegative(),
  sellingPrice: z.coerce.number().int().nonnegative(),
  ukIndiaSize: z.coerce.number().int().min(1).max(60).optional(),
  euroSize: z.coerce.number().int().min(1).max(60).optional(),
  ean: z.string().trim().max(32).optional(),
  variantTitle: z.string().trim().max(200).optional(),
});

export type CreateVariantRequest = z.infer<typeof createVariantRequestSchema>;

/**
 * Partial update of a colourway.
 *
 * `sku`, `productId` and `productCode` are absent by design. The SKU is the
 * merchant's identifier and reassigning it would break every order line that
 * references it; `productId` is the parent link and is not an editable
 * field. Re-parenting is deliberately not offered.
 */
export const updateVariantRequestSchema = z.object({
  size: z.coerce.number().int().min(1).max(60).optional(),
  ukIndiaSize: z.coerce.number().int().min(1).max(60).optional(),
  euroSize: z.coerce.number().int().min(1).max(60).optional(),
  mrp: z.coerce.number().int().nonnegative().optional(),
  sellingPrice: z.coerce.number().int().nonnegative().optional(),
  ean: z.string().trim().max(32).optional(),
  variantTitle: z.string().trim().max(200).optional(),
});

export type UpdateVariantRequest = z.infer<typeof updateVariantRequestSchema>;

/** Admin listing of one design's colourways. */
export const adminVariantQuerySchema = z.object({
  colour: z.string().trim().max(40).optional(),
  colourToken: z.string().trim().max(5).optional(),
  photographyStatus: z.enum(['verified', 'pending-review']).optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type AdminVariantQuery = z.infer<typeof adminVariantQuerySchema>;

/** Batch SKU resolution for reconciliation work. Capped to keep one request sane. */
export const skuLookupRequestSchema = z.object({
  skus: z.array(z.string().trim().min(1).max(80)).min(1).max(500),
});

export type SkuLookupRequest = z.infer<typeof skuLookupRequestSchema>;

/* -------------------------------------------------------------------------- */
/* G-4 — Categories                                                           */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a category. Categories are retired, never hard-deleted. */
export const CATEGORY_STATUSES = ['active', 'retired'] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export const createCategoryRequestSchema = z.object({
  /** URL segment. Unique, and immutable once the category has products. */
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case'),
  /** Human-facing display name. */
  displayName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(''),
  /** Lower renders first. Ties break on slug. */
  position: z.coerce.number().int().min(0).max(999).default(0),
  /** Optional parent, for a two-level taxonomy. Must not create a cycle. */
  parentSlug: z.string().trim().max(60).nullable().default(null),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
});

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  position: z.coerce.number().int().min(0).max(999).optional(),
  parentSlug: z.string().trim().max(60).nullable().optional(),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
  isVisible: z.boolean().optional(),
  status: z.enum(CATEGORY_STATUSES).optional(),
});

export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

/** Bulk reordering of the category tree. */
export const reorderCategoriesRequestSchema = z.object({
  /** The complete ordered list of slugs. Anything omitted is left untouched. */
  orderedSlugs: z.array(z.string().trim().min(1).max(60)).min(1).max(200),
});

export type ReorderCategoriesRequest = z.infer<typeof reorderCategoriesRequestSchema>;

export const categoryQuerySchema = z.object({
  status: z.enum(CATEGORY_STATUSES).optional(),
  includeEmpty: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type CategoryQuery = z.infer<typeof categoryQuerySchema>;

/* -------------------------------------------------------------------------- */
/* G-5 — Image review                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Why an image could not be assigned automatically.
 *
 * These are the exact outcomes of `resolveImageColour` in
 * `@ajooba/contracts`. They are part of the API contract because a reviewer
 * cannot act on "unverified" alone — they need to know whether the filename
 * carried no token, carried a colour the design does not sell, or did not
 * parse at all.
 */
export const IMAGE_REVIEW_REASONS = ['untokened', 'token-not-sold', 'unparsable'] as const;
export type ImageReviewReason = (typeof IMAGE_REVIEW_REASONS)[number];

/** Where an image stands in the review workflow. */
export const IMAGE_REVIEW_STATUSES = ['pending', 'assigned', 'rejected'] as const;
export type ImageReviewStatus = (typeof IMAGE_REVIEW_STATUSES)[number];

/**
 * A stable identifier for one source image.
 *
 * The gap analysis called this out as the main G-5 blocker: images were
 * addressed by bare filename, which is not unique-safe. The identifier is
 * `<designCode>:<sourceFile>` — the design's code plus the exact asset
 * filename — which is stable, URL-safe and unique per design because the
 * importer already treats these two together as the provenance key.
 */
export const imageIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .regex(/^A\d{2}:[^:]+$/, 'Image id must be <designCode>:<sourceFile>');

export type ImageId = z.infer<typeof imageIdSchema>;

/**
 * Assign a quarantined image to a colour.
 *
 * `reason` is **mandatory**. Every image-review action is a human override
 * of an automated safety rule; an unexplained override is exactly how a
 * photograph ends up on the wrong colour gallery. The reason is written to
 * the audit log alongside the administrator who gave it.
 */
export const assignImageRequestSchema = z.object({
  colour: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(10, 'A reason of at least 10 characters is required').max(500),
});

export type AssignImageRequest = z.infer<typeof assignImageRequestSchema>;

export const reviewImageRequestSchema = z.object({
  reason: z.string().trim().min(10, 'A reason of at least 10 characters is required').max(500),
});

export type ReviewImageRequest = z.infer<typeof reviewImageRequestSchema>;

/** Flip a colourway's photography gate. Used by the image-review workflow. */
export const photographyRequestSchema = z.object({
  status: z.enum(['verified', 'pending-review']),
  reason: z.string().trim().min(10, 'A reason of at least 10 characters is required').max(500),
});

export type PhotographyRequest = z.infer<typeof photographyRequestSchema>;

export const imageReviewQuerySchema = z.object({
  /** Restrict to one design. */
  code: z
    .string()
    .trim()
    .regex(/^A\d{2}$/)
    .optional(),
  status: z.enum(IMAGE_REVIEW_STATUSES).optional(),
  /** Only images with no verified photo for the colour they were proposed for. */
  onlyGaps: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type ImageReviewQuery = z.infer<typeof imageReviewQuerySchema>;

/**
 * The import-plan list query.
 *
 * `limit` is bounded here rather than read raw off `req.query`, so a
 * caller cannot ask for an unbounded number of plans and have every one of
 * them serialised into the response.
 */
export const importPlanListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ImportPlanListQuery = z.infer<typeof importPlanListQuerySchema>;

/**
 * The pagination for a category's product list.
 *
 * Bounded here rather than read raw off `req.query`, so `pageSize` cannot
 * be an unbounded value that asks the database for everything.
 */
export const categoryProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type CategoryProductsQuery = z.infer<typeof categoryProductsQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Phase 7 — Inventory                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Reasons an absolute stock level may be set.
 *
 * `audit` and `restock` are the two that legitimately establish a count.
 * `correction` is for fixing a level that is already known to be wrong.
 */
export const STOCK_SET_REASONS = ['audit', 'restock', 'correction'] as const;
export type StockSetReason = (typeof STOCK_SET_REASONS)[number];

/**
 * Set an absolute stock level for one SKU.
 *
 * This is distinct from the existing *adjustment* endpoint on purpose. An
 * adjustment is a delta and is safe to retry; an absolute set is a claim
 * about the physical world, so it carries a mandatory reason and the
 * administrator is asked to confirm the number they observed. Nothing here
 * invents a quantity — the caller states it.
 */
export const setStockRequestSchema = z.object({
  /** The counted quantity. Zero is allowed; it means "none on hand". */
  quantity: z.coerce.number().int().min(0).max(1_000_000),
  reason: z.enum(STOCK_SET_REASONS),
  /**
   * Required for `correction`, which by definition changes a count somebody
   * already took responsibility for.
   */
  note: z.string().trim().max(500).default(''),
  /**
   * The level the administrator currently believes is on hand.
   *
   * Required so a stale tab cannot silently overwrite a newer count. When it
   * does not match the stored level the request is rejected `409`.
   */
  expectedCurrentStock: z.coerce.number().int().min(0).max(1_000_000),
});

export type SetStockRequest = z.infer<typeof setStockRequestSchema>;

/** Bulk stock set, validated against a dry run before anything is applied. */
export const bulkStockSetRequestSchema = z.object({
  /** Rows, each a SKU and the count for it. */
  rows: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(80),
        quantity: z.coerce.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(500),
  reason: z.enum(STOCK_SET_REASONS),
  note: z.string().trim().max(500).default(''),
  /**
   * When true the request only reports what it *would* change and writes
   * nothing. Required by the admin UI before an apply is offered.
   */
  dryRun: z.boolean().default(true),
});

export type BulkStockSetRequest = z.infer<typeof bulkStockSetRequestSchema>;

/* -------------------------------------------------------------------------- */
/* G-6 — Controlled import                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Start a catalogue-import dry run.
 *
 * The source arrives as a **payload in the request body**, never as a
 * filesystem path. The original workbook lives on a developer's machine, which
 * no deployment target can read; accepting a path would let any caller name
 * a file on the server and have it parsed, which is an arbitrary-file-read
 * primitive rather than an import control.
 */
export const createImportPlanRequestSchema = z.object({
  /**
   * The extract JSON. Kept as a raw string so the checksum is computed over
   * exactly the bytes that will later be applied.
   */
  payload: z
    .string()
    .min(1, 'The extract payload is required.')
    .max(32 * 1024 * 1024),
  /** Original filename, recorded for provenance. Never used to build a path. */
  sourceFilename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\\/:*?"<>|]+$/, 'Filename must not contain path separators'),
});

export type CreateImportPlanRequest = z.infer<typeof createImportPlanRequestSchema>;

/**
 * Apply a previously planned import.
 *
 * `payloadChecksum` is mandatory and must match the plan: the source changed
 * between the dry run and the approval, the report the operator approved no
 * longer describes what would be written, and the import is refused.
 */
export const applyImportPlanRequestSchema = z.object({
  payloadChecksum: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a SHA-256 hex digest'),
  /**
   * Must be explicitly `true`.
   *
   * The flag exists so "apply" is never the result of an omitted field.
   */
  confirm: z.literal(true, {
    error: 'Set confirm:true to authorise the import.',
  }),
});

export type ApplyImportPlanRequest = z.infer<typeof applyImportPlanRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* -------------------------------------------------------------------------- */

/** One colourway of a design, with the imagery resolved for that colour. */
export interface AdminVariantView {
  readonly sku: string;
  readonly id: string;
  readonly productId: string;
  readonly productCode: string;
  readonly articleNumber: string;
  readonly size: number;
  readonly ukIndiaSize?: number;
  readonly euroSize?: number;
  readonly colour: string;
  readonly colourToken: string;
  readonly mrp: number;
  readonly sellingPrice: number;
  readonly discountPercent: number;
  readonly stock: number;
  readonly reservedStock: number;
  readonly inStock: boolean;
  /** False when stock exists but photography is unverified. */
  readonly sellable: boolean;
  readonly photographyStatus: 'verified' | 'pending-review';
  readonly ean?: string;
  readonly variantTitle?: string;
  /** Images verified as this exact colour. Empty means "no verified photo yet". */
  readonly images: readonly string[];
}

/** A colourway rollup for one design: one row per colour, not per SKU. */
export interface AdminColourView {
  readonly colour: string;
  readonly colourToken: string;
  readonly sizes: readonly number[];
  readonly skus: readonly string[];
  readonly totalStock: number;
  readonly photographyStatus: 'verified' | 'pending-review';
  readonly verifiedImageCount: number;
  readonly sellable: boolean;
}

export interface AdminProductView {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly subcategory: string;
  readonly subcategorySlug: string;
  readonly brand: string;
  readonly colours: readonly string[];
  readonly status: ProductStatus;
  readonly mrp: number;
  readonly sellingPrice: number;
  readonly inStock: boolean;
  readonly seoTitle?: string;
  readonly seoDescription?: string;
  readonly variantCount: number;
  readonly totalStock: number;
  /** Colourways with no verified photograph. */
  readonly pendingReviewColours: readonly string[];
  readonly quarantinedImageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryView {
  readonly slug: string;
  readonly displayName: string;
  readonly description: string;
  readonly position: number;
  readonly parentSlug: string | null;
  readonly isVisible: boolean;
  readonly status: CategoryStatus;
  readonly seoTitle?: string;
  readonly seoDescription?: string;
  /** Denormalised read copy, kept in step with `subcategorySlug`. */
  readonly sourceSubcategory: string;
  readonly productCount: number;
  readonly children: readonly CategoryView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One image awaiting a human decision, with all the evidence attached. */
export interface ImageReviewItem {
  readonly id: string;
  readonly designCode: string;
  readonly productId: string;
  readonly productTitle: string;
  readonly sourceFile: string;
  /** Root-relative path under the media mount, when the file is still on disk. */
  readonly url: string | null;
  readonly alt: string;
  readonly position: number;
  readonly storage: string;
  /** The colour the automated rule proposed, when it proposed one. */
  readonly proposedColour: string | null;
  readonly proposedColourToken: string | null;
  /** Why the automated rule did not assign it. */
  readonly reason: ImageReviewReason | null;
  readonly status: ImageReviewStatus;
  /**
   * The colour the image is currently assigned to, or `null` when quarantined
   * or rejected.
   *
   * Distinct from `proposedColour`, which is what the automated rule *guessed*.
   * Echoing the persisted value back lets the reviewer confirm the write
   * actually landed the colour they chose, instead of trusting a 200.
   */
  readonly assignedColour: string | null;
  readonly reviewReason: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly checksum: string | null;
  /** Colours this design actually sells — the reviewer picks from these. */
  readonly availableColours: readonly string[];
  /** True when the design has no verified photo for this colour at all. */
  readonly isLastMissingPhoto: boolean;
}

export interface ImageReviewQueue {
  readonly items: readonly ImageReviewItem[];
  readonly totalItems: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  /** Design-level summary of colour coverage. */
  readonly summary: {
    readonly pending: number;
    readonly assigned: number;
    readonly rejected: number;
    readonly coloursWithoutVerifiedPhotos: number;
    readonly designsAffected: number;
  };
}

export interface StockSetResult {
  readonly sku: string;
  readonly variantId: string;
  readonly stockBefore: number;
  readonly stockAfter: number;
  readonly reservedStock: number;
  readonly inStock: boolean;
  /** False while photography is unverified, even with stock on hand. */
  readonly sellable: boolean;
}

export interface BulkStockSetResult {
  readonly dryRun: boolean;
  readonly applied: readonly StockSetResult[];
  readonly failed: ReadonlyArray<{ sku: string; reason: string }>;
  readonly totals: {
    readonly requested: number;
    readonly changed: number;
    readonly unchanged: number;
    readonly failed: number;
    readonly unitsAdded: number;
  };
}
