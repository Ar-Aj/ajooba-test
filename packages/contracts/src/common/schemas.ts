import { z } from 'zod';

/**
 * Shared Zod primitives. Every boundary in the platform (HTTP request, HTTP
 * response, environment variable, message payload) validates through these.
 */

/** A non-empty trimmed string. */
export const nonEmptyString = z.string().trim().min(1);

/** An Indian Rupee amount expressed in paise-safe integer minor units is NOT used
 * for catalogue data — the source workbooks use whole rupees. Money is modelled
 * as a positive integer number of rupees and stored in MongoDB as an integer. */
export const rupeeAmount = z.number().int().nonnegative();

/** A positive integer stock quantity. */
export const stockQuantity = z.number().int().nonnegative();

/**
 * ISO-4217 INR currency code.
 */
export const currencyCode = z.literal('INR');

/**
 * A URL that must be absolute (http/https). Relative URLs are rejected so that
 * no request handler can be tricked into resolving a user-supplied path.
 */
export const absoluteUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'URL must use http or https',
  });

/** A MongoDB ObjectId (24 hex characters). */
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid MongoDB ObjectId');

/** A URL-safe slug. */
export const slug = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphenated slug');

/**
 * A seller SKU id in the canonical Ajooba format:
 * `AJ-A<NN>-<COLOUR_TOKEN>-<SIZE>` e.g. `AJ-A11-BRN-08`.
 *
 * This format is asserted from the real catalogue — all 674 rows in
 * `products data.xlsx` conform to it. See docs/catalog-audit.md.
 */
export const sellerSkuId = z
  .string()
  .trim()
  .regex(/^AJ-A\d{2}-[A-Z]{2,5}-\d{1,2}$/, 'Must match AJ-A<NN>-<COLOUR_TOKEN>-<SIZE>');

/** Pagination query schema shared by list endpoints. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;

/**
 * Generic envelope helpers.
 */
export const apiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
    meta: z
      .object({
        requestId: z.string(),
        timestamp: z.string(),
        pagination: z
          .object({
            page: z.number().int(),
            pageSize: z.number().int(),
            totalItems: z.number().int(),
            totalPages: z.number().int(),
            hasNextPage: z.boolean(),
            hasPreviousPage: z.boolean(),
          })
          .optional(),
      })
      .optional(),
  });

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      'VALIDATION_FAILED',
      'NOT_FOUND',
      'CONFLICT',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
    ]),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  }),
  meta: z.object({ requestId: z.string(), timestamp: z.string() }).optional(),
});
