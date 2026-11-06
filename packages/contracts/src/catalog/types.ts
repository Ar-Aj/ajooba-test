/**
 * Catalogue domain contracts.
 *
 * Every field below is backed by a column that genuinely exists in the source
 * workbook `public/products/products data.xlsx` or in the Flipkart listing
 * templates (`.xls`) that ship alongside the product images. Nothing in this
 * file is invented.
 *
 * Source of truth for each field is documented on the type.
 */

/*
 * `CategoryView` now appears in a *public* contract (the catalogue facets and
 * the `/v1/catalog/categories` read), so it is referenced from here as well as
 * from the admin contracts. It is declared in `admin.ts` because that is where
 * the category write surface lives and where its full field list belongs; the
 * import below is type-only, so it adds nothing to the runtime bundle and
 * cannot create a module cycle.
 */
import type { CategoryView } from './admin.js';

/**
 * `Sub-category` column in the source workbook.
 *
 * Observed values (exact, from the workbook):
 *   - "Mojri / Jutti"  (267 rows)
 *   - "shoe"           (325 rows)
 *   - "sandal"         ( 58 rows)
 *   - "Chappal"        ( 24 rows)
 *
 * The capitalisation is inconsistent in the source and is preserved verbatim
 * rather than silently normalised. A normalisation map is applied at import
 * time and recorded in the audit trail.
 */
export const SUBCATEGORY_RAW_VALUES = ['Mojri / Jutti', 'shoe', 'sandal', 'Chappal'] as const;
export type SubcategoryRaw = (typeof SUBCATEGORY_RAW_VALUES)[number];

/**
 * The sub-category slugs the source workbook happens to contain.
 *
 * **This is a seed set, not a closed enum.** The live taxonomy is the
 * `categories` collection (see `CategoryView`), and an administrator can add
 * a category that is not in this list. Anything that validates or filters
 * against `subcategorySlug` must therefore accept *any* well-formed slug —
 * `categorySlugSchema` below — and treat this constant only as the set of
 * names the importer is known to emit.
 *
 * Before this was made explicit, `catalogQuerySchema.subcategory` was
 * `z.enum(SUBCATEGORY_SLUGS)`. A category created in the admin panel was then
 * rejected with a 400 the moment a shopper filtered by it, and the storefront
 * silently dropped the filter. That is the exact defect the comment exists to
 * prevent from coming back.
 */
export const SUBCATEGORY_SLUGS = ['mojri-jutti', 'shoe', 'sandal', 'chappal'] as const;
/** A slug drawn from the workbook's known set. Never use as a validator. */
export type SubcategorySlug = (typeof SUBCATEGORY_SLUGS)[number];

/**
 * The shape of a category slug — the only structural rule a category slug has
 * to satisfy.
 *
 * Kept here rather than inline in `schemas.ts` so the API, the admin panel and
 * the storefront all reject and accept exactly the same strings.
 */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CATEGORY_SLUG_MAX_LENGTH = 60;

/**
 * `Colour` column in the source workbook.
 *
 * Observed values (exact): Beige, Black, Blue, Brown, Chickoo, Cherry, Golden,
 * Grey, Ivory, Olive, Tan, White.
 */
export const COLOUR_RAW_VALUES = [
  'Beige',
  'Black',
  'Blue',
  'Brown',
  'Chickoo',
  'Cherry',
  'Golden',
  'Grey',
  'Ivory',
  'Olive',
  'Tan',
  'White',
] as const;
export type ColourRaw = (typeof COLOUR_RAW_VALUES)[number];

/**
 * Colour token used inside the Seller SKU Id, e.g. `AJ-A11-BRN-08`.
 *
 * Observed mapping (token -> workbook `Colour`), from all 674 rows:
 *   BEG -> Beige, BLK -> Black, BLUE -> Blue, BRN -> Brown, CHK -> Chickoo,
 *   CHR -> Cherry, GLD -> Golden, GRY -> Grey, IVR -> Ivory, IVY -> Ivory,
 *   OLV -> Olive, OW -> Ivory, TAN -> Tan, WHT -> White.
 *
 * NOTE: `OW` and `IVR` both mean Ivory, and `IVY` also means Ivory. This is a
 * genuine ambiguity in the source data — see docs/catalog-audit.md §7.
 *
 * NOTE: 5 of the 674 Seller SKU Ids use a mixed-case token — `AJ-A33-Tan-06`
 * through `AJ-A33-Tan-10` — for the colour "Tan", while 92 other rows use
 * `TAN`. The SKU itself is always stored verbatim; only the *token* is
 * normalised to uppercase for indexing. See `normaliseColourToken`.
 */
export const COLOUR_TOKENS = [
  'BEG',
  'BLK',
  'BLUE',
  'BRN',
  'CHK',
  'CHR',
  'GLD',
  'GRY',
  'IVR',
  'IVY',
  'OLV',
  'OW',
  'TAN',
  'WHT',
] as const;
export type ColourToken = (typeof COLOUR_TOKENS)[number];

/**
 * Normalise a colour token for indexing.
 *
 * The source data is not consistently cased (`Tan` vs `TAN`), so tokens are
 * upper-cased before being stored. The Seller SKU Id itself is NEVER
 * modified — it is stored exactly as it appears in the workbook.
 */
export function normaliseColourToken(token: string): ColourToken {
  const upper = token.trim().toUpperCase();
  const match = COLOUR_TOKENS.find((candidate) => candidate === upper);
  if (!match) {
    throw new Error(`Unknown colour token: ${token}`);
  }
  return match;
}

/**
 * UK/India size scale actually present in the catalogue.
 * Observed values: 5, 6, 7, 8, 9, 10, 11, 12, 13.
 */
export const SIZE_VALUES = [5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
export type SizeValue = (typeof SIZE_VALUES)[number];

/**
 * The brand. Every Flipkart listing template row carries
 * `Brand = "Ajooba Footwear"`.
 */
export const BRAND_NAME = 'Ajooba Footwear' as const;

/**
 * A single purchasable unit: one product design, in one colour, in one size.
 *
 * Backing data:
 *   - `Seller SKU Id`     -> `sku`
 *   - `Size`              -> `size`
 *   - `Colour`            -> `colour`
 *   - `MRP`               -> `mrp`
 *   - `Your Selling Price`-> `sellingPrice`
 */
export interface ProductVariant {
  readonly sku: string;
  readonly productId: string;
  readonly size: number;
  readonly colour: string;
  readonly colourToken: string;
  readonly mrp: number;
  readonly sellingPrice: number;
  readonly discountPercent: number;
  readonly stock: number;
  readonly inStock: boolean;
  /** UK/India size from the Flipkart template `UK/India Size` column. */
  readonly ukIndiaSize?: number;
  /** Euro size from the Flipkart template `Euro Size` column. */
  readonly euroSize?: number;
  /** Flipkart template `EAN/UPC`. Empty in the source data. */
  readonly ean?: string;
  /**
   * Whether this colourway has verified photography.
   *
   * A `pending-review` variant is withheld from sale even when it has stock,
   * because the gallery for that colour has nothing verified to show. Reading
   * this here is what stops a colour being bought on the strength of a photo
   * that actually belongs to a different colour.
   */
  readonly photographyStatus?: 'verified' | 'pending-review';
}

/**
 * A product design — the grouping level of the catalogue.
 *
 * The catalogue contains 55 distinct designs (identified by the `A<NN>` code
 * embedded in the Seller SKU Id). The Flipkart templates call the same
 * grouping "Article Number" / "Group ID" / "Style Code" / "Model Name".
 */
export interface Product {
  readonly id: string;
  /** The `A<NN>` design code parsed out of the Seller SKU Id. */
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly subcategory: string;
  readonly subcategorySlug: string;
  readonly brand: string;
  readonly colours: readonly string[];
  readonly images: readonly ProductImage[];
  /**
   * Source filenames whose colour could not be verified. These images are kept
   * in a review queue and are **not** shown in the storefront for any colour.
   *
   * Advisory: the storefront never reads this to render — an unverified image is
   * simply absent from `images`. It exists so an admin/review tool can find
   * what is still outstanding. Optional so existing fixtures and any cached
   * pre-migration payload remain valid.
   */
  readonly quarantinedImages?: readonly string[];
  readonly variants: readonly ProductVariant[];
  readonly mrp: number;
  readonly sellingPrice: number;
  readonly inStock: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Where a catalogue image is served from.
 *
 * - `local` — the file lives in the repository's `public/` tree and is
 *   served by the API's static mount. This is the pre-Cloudinary state.
 * - `cloudinary` — the file was uploaded to Cloudinary and the record
 *   carries a public id and a delivery URL. Cloudinary handles delivery.
 *
 * The image *binary* is never stored in a MongoDB document in either case.
 * MongoDB holds the record and the media reference; the bytes live on disk
 * or in the CDN.
 */
export const MEDIA_STORAGES = ['local', 'cloudinary'] as const;
export type MediaStorage = (typeof MEDIA_STORAGES)[number];

/**
 * A catalogue image. Paths are relative to `public/` and are stored exactly as
 * the original asset filenames exist on disk — no renaming or regeneration.
 */
export interface ProductImage {
  /** Absolute-from-public path, e.g. `/products/AJ-A11/A11-BLK-1.jpg`. */
  readonly url: string;
  readonly alt: string;
  readonly position: number;
  /** The `A<NN>-<COLOUR>-<INDEX>` filename the asset was derived from. */
  readonly sourceFile: string;
  /**
   * The colour this image was verified as belonging to, recorded at import time.
   *
   * Present only when the filename's colour token matched a colour the design
   * actually sells. An image without this field is **quarantined**: it is not
   * assigned to a colour and is not shown in the storefront, pending review.
   * See `resolveImageColour` in `./colour-images.ts`.
   */
  readonly colour?: ColourRaw;
  /** The normalised colour token the assignment was derived from. */
  readonly colourToken?: ColourToken;
  /** Where the bytes actually live. */
  readonly storage?: MediaStorage;
  /** Cloudinary public id, present only when `storage === 'cloudinary'`. */
  readonly publicId?: string;
  /** Cloudinary delivery URL, present only when `storage === 'cloudinary'`. */
  readonly cloudinaryUrl?: string;
  /** Intrinsic width in pixels, when known. */
  readonly width?: number;
  /** Intrinsic height in pixels, when known. */
  readonly height?: number;
  /** Size in bytes, when known. */
  readonly bytes?: number;
  /** Content hash of the source file, used to de-duplicate uploads. */
  readonly checksum?: string;
}

/**
 * Catalogue list query. All filters are optional; an empty query returns the
 * full catalogue.
 */
export interface CatalogQuery {
  readonly search?: string;
  readonly subcategory?: string;
  readonly colour?: string;
  readonly size?: number;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly inStock?: boolean;
  readonly sort?: CatalogSort;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Supported catalogue sort orders.
 */
export const CATALOG_SORTS = [
  'newest',
  'price-asc',
  'price-desc',
  'title-asc',
  'title-desc',
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export interface CatalogListResult {
  readonly items: readonly Product[];
  readonly totalItems: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/**
 * Catalogue facet counts for filter UI. Counts are computed from real data at
 * request time — they are never pre-seeded or randomised.
 */
export interface CatalogFacets {
  /**
   * The live category taxonomy, from the `categories` collection.
   *
   * The storefront builds its category filter and its navigation from this,
   * so an administrator-created category shows up without a deploy. The
   * `subcategories` counts below are the same numbers keyed by slug; this
   * array adds the display name, ordering and visibility.
   */
  readonly categories: readonly CategoryView[];
  readonly subcategories: readonly FacetCount[];
  readonly colours: readonly FacetCount[];
  readonly sizes: readonly FacetCount[];
  readonly priceRange: { readonly min: number; readonly max: number };
}

export interface FacetCount {
  readonly value: string;
  readonly count: number;
}
