import { z } from 'zod';
import {
  CATALOG_SORTS,
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_PATTERN,
  COLOUR_RAW_VALUES,
  COLOUR_TOKENS,
  MEDIA_STORAGES,
  SIZE_VALUES,
  SUBCATEGORY_RAW_VALUES,
} from './types.js';

/**
 * Zod schemas for the catalogue boundary.
 * These are the single source of truth for request validation in the API and
 * for type inference in both Next.js applications.
 */

/**
 * A category slug.
 *
 * Structural, not enumerated. The taxonomy is the `categories` collection and
 * an administrator can create a slug that is not in `SUBCATEGORY_SLUGS`; an
 * enum here would reject it at the API boundary and make the admin panel a
 * lie. Existence is checked against the database at write time
 * (`assertAssignableCategory`), which is the only place that answer is known.
 */
export const categorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(CATEGORY_SLUG_MAX_LENGTH)
  .regex(CATEGORY_SLUG_PATTERN, 'Category slug must be lowercase kebab-case');

/** @deprecated Use `categorySlugSchema`. Kept for callers that read the old name. */
export const subcategorySlugSchema = categorySlugSchema;
export const colourRawSchema = z.enum(COLOUR_RAW_VALUES);
export const colourTokenSchema = z.enum(COLOUR_TOKENS);
export const sizeValueSchema = z.union(SIZE_VALUES.map((value) => z.literal(value)));
export const catalogSortSchema = z.enum(CATALOG_SORTS);

/**
 * Raw sub-category value as written in the source workbook.
 * Used at import time, not in API responses.
 */
export const subcategoryRawSchema = z.enum(SUBCATEGORY_RAW_VALUES);

/**
 * Query schema for `GET /v1/catalog/products`.
 *
 * Unknown query keys are stripped rather than rejected so that adding a new
 * filter is backwards compatible for existing clients.
 */
export const catalogQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  subcategory: subcategorySlugSchema.optional(),
  colour: colourRawSchema.optional(),
  size: z.coerce.number().int().min(5).max(13).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: catalogSortSchema.default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type CatalogQueryInput = z.infer<typeof catalogQuerySchema>;

/**
 * Path parameter schema for `GET /v1/catalog/products/:slug`.
 */
export const productSlugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a valid product slug'),
});

export const skuParamSchema = z.object({
  sku: z
    .string()
    .trim()
    .regex(/^AJ-A\d{2}-[A-Z]{2,5}-\d{1,2}$/),
});

/**
 * A Seller SKU Id from the source workbook.
 *
 * Observed forms across all 674 rows:
 *   AJ-A01-OW-06     (the normal form — zero-padded design code, UPPERCASE token)
 *   AJ-A33-Tan-06    (5 rows use a mixed-case colour token)
 *
 * The mixed-case rows are a genuine inconsistency in the source data, not a
 * typo in this schema: `AJ-A33-Tan-06` through `AJ-A33-Tan-10` all exist
 * alongside `AJ-A33-BLK-*` for the same design. They are accepted here and
 * normalised at import time; see docs/catalog-audit.md.
 */
export const sellerSkuIdSchema = z
  .string()
  .trim()
  .regex(/^AJ-A\d{2}-[A-Za-z]{2,5}-\d{1,2}$/, 'Must be a Seller SKU Id, e.g. AJ-A01-OW-06');

/**
 * The `A<NN>` design code parsed out of a Seller SKU Id.
 *
 * Note the two different code formats in the source assets:
 *   - Seller SKU Id  -> `A01` (zero-padded, two digits)
 *   - image folder   -> `AJ-A1` (NOT zero-padded)
 *
 * The mapping between them is one-to-one but not string-equal. See
 * docs/catalog-audit.md § Image folder naming.
 */
export const designCodeSchema = z
  .string()
  .trim()
  .regex(/^A\d{2}$/);

export const mediaStorageSchema = z.enum(MEDIA_STORAGES);

export const productImageSchema = z.object({
  url: z.string().min(1),
  alt: z.string(),
  position: z.number().int().nonnegative(),
  sourceFile: z.string().min(1),
  /**
   * Set only when the image's filename colour token was verified against a
   * colour this design sells. Absent = quarantined, not displayed.
   */
  colour: colourRawSchema.optional(),
  colourToken: colourTokenSchema.optional(),
  storage: mediaStorageSchema.optional(),
  publicId: z.string().optional(),
  cloudinaryUrl: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(),
});

export const productVariantSchema = z.object({
  id: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  sku: z.string().min(1),
  productId: z.string().min(1),
  size: sizeValueSchema,
  colour: colourRawSchema,
  colourToken: colourTokenSchema,
  mrp: z.number().int().nonnegative(),
  sellingPrice: z.number().int().nonnegative(),
  discountPercent: z.number().min(0).max(100),
  stock: z.number().int().nonnegative(),
  inStock: z.boolean(),
  /**
   * Absent (pre-migration) or `verified` = sellable on stock alone.
   * `pending-review` = colour has no verified photography; withheld from sale.
   */
  photographyStatus: z.enum(['verified', 'pending-review']).optional(),
  ukIndiaSize: z.number().int().optional(),
  euroSize: z.number().int().optional(),
  ean: z.string().optional(),
});

export const productSchema = z.object({
  id: z.string().min(1),
  code: designCodeSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  subcategory: z.string().min(1),
  subcategorySlug: subcategorySlugSchema,
  brand: z.string().min(1),
  colours: z.array(colourRawSchema),
  images: z.array(productImageSchema),
  /**
   * Source filenames that could not be verified against a sold colour. They are
   * retained in the review queue and deliberately excluded from the storefront.
   * Optional so pre-migration payloads still validate.
   */
  quarantinedImages: z.array(z.string()).optional(),
  variants: z.array(productVariantSchema),
  mrp: z.number().int().nonnegative(),
  sellingPrice: z.number().int().nonnegative(),
  inStock: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const facetCountSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

/**
 * The wire schema for a category, as the facet endpoint reports it.
 *
 * `children` is `z.array(z.unknown())` rather than a recursive reference so
 * this file stays a leaf of the import graph. The storefront reads a flat list
 * and builds its own grouping from `parentSlug`, so the nesting never crosses
 * the boundary in a shape it depends on.
 */
export const categoryViewSchema = z.object({
  slug: categorySlugSchema,
  displayName: z.string().min(1),
  description: z.string().default(''),
  position: z.number().int(),
  parentSlug: z.string().nullable().default(null),
  isVisible: z.boolean(),
  status: z.enum(['active', 'retired']),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  sourceSubcategory: z.string().default(''),
  productCount: z.number().int().nonnegative().default(0),
  children: z.array(z.unknown()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const catalogFacetsSchema = z.object({
  /**
   * The live taxonomy. `.default([])` keeps a cached pre-upgrade payload
   * valid — the field is additive and the storefront falls back to deriving
   * labels from the slug counts when it is absent.
   */
  categories: z.array(categoryViewSchema).default([]),
  subcategories: z.array(facetCountSchema),
  colours: z.array(facetCountSchema),
  sizes: z.array(facetCountSchema),
  priceRange: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
});

export const catalogListResultSchema = z.object({
  items: z.array(productSchema),
  totalItems: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().nonnegative(),
});
