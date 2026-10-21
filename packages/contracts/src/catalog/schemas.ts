import { z } from 'zod';
import {
  CATALOG_SORTS,
  COLOUR_RAW_VALUES,
  COLOUR_TOKENS,
  SIZE_VALUES,
  SUBCATEGORY_RAW_VALUES,
  SUBCATEGORY_SLUGS,
} from './types.js';

/**
 * Zod schemas for the catalogue boundary.
 * These are the single source of truth for request validation in the API and
 * for type inference in both Next.js applications.
 */

export const subcategorySlugSchema = z.enum(SUBCATEGORY_SLUGS);
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

export const productImageSchema = z.object({
  url: z.string().min(1),
  alt: z.string(),
  position: z.number().int().nonnegative(),
  sourceFile: z.string().min(1),
});

export const productVariantSchema = z.object({
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

export const catalogFacetsSchema = z.object({
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
