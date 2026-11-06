import { z } from 'zod';

/**
 * Homepage merchandising contracts.
 *
 * A homepage is an ordered, admin-managed list of **sections**. Each section
 * references existing catalogue records by id — it never stores a copy of a
 * product. The storefront resolves those ids through the same catalogue
 * service the rest of the site uses, so merchandising can never drift from
 * the catalogue.
 *
 * Design rules encoded here (not just documented):
 *
 *  - `productIds` are *references*, validated server-side against real,
 *    published products before publication.
 *  - `categorySlug` must be one of the catalogue's real sub-category slugs.
 *  - A campaign's `endsAt` is persisted and drives the countdown, so an
 *    expired campaign stops rendering without anyone editing the page.
 *  - Discounts are expressed with the existing pricing service's rule shape,
 *    never as an invented "sale price" field that checkout could ignore.
 */

/* -------------------------------------------------------------------------- */
/* Section types                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The supported homepage section kinds.
 *
 * Each maps to exactly one storefront component. Adding a value here forces
 * a compile error in the renderer until it is implemented.
 */
export const HOMEPAGE_SECTION_TYPES = [
  /** A 16:9 campaign banner driven by the existing `banners` collection. */
  'hero',
  /** Four curated category entry points. */
  'category-grid',
  /** Newest published products, or an explicit admin selection. */
  'new-arrivals',
  /** An editorial showcase with one optional spotlight product. */
  'featured',
  /** Ranked by real sales where data exists, otherwise an honest curated set. */
  'trending',
  /** A time-limited, backend-validated promotion. */
  'deal',
  /** Colour discovery that deep-links to the matching variant. */
  'colour-shop',
  /** A configurable collection/occasion/style spotlight. */
  'collection-spotlight',
] as const;

export type HomepageSectionType = (typeof HOMEPAGE_SECTION_TYPES)[number];

/**
 * How a section chooses its products.
 *
 *  - `automatic`  -> computed by the backend from real catalogue data.
 *  - `manual`     -> the admin's explicit `productIds`, in their chosen order.
 *  - `category`   -> the products of one real sub-category.
 */
export const PRODUCT_SOURCE_MODES = ['automatic', 'manual', 'category'] as const;
export type ProductSourceMode = (typeof PRODUCT_SOURCE_MODES)[number];

/** Layout presets a grid-style section can use. */
export const SECTION_LAYOUTS = ['grid', 'rail', 'spotlight'] as const;
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];

/**
 * Why a section is not currently shown.
 *
 * Surfaced to the admin so a section that silently fails to appear can be
 * diagnosed, and to the storefront so it can render an honest empty state
 * instead of a broken rail.
 */
export const SECTION_HIDE_REASONS = [
  'disabled',
  'not-scheduled',
  'expired',
  'no-products',
  'no-campaign',
  'unresolved-references',
] as const;
export type SectionHideReason = (typeof SECTION_HIDE_REASONS)[number];

/* -------------------------------------------------------------------------- */
/* Discriminated section configuration                                       */
/* -------------------------------------------------------------------------- */

/** Shared fields every section has. */
const sectionBaseShape = {
  /** Lower comes first. Unique across the homepage. */
  position: z.number().int().min(0).max(500),
  isVisible: z.boolean(),
  /** Optional scheduling window; null means "always eligible". */
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
};

/**
 * The supported discount rules for a deal.
 *
 * `percentage` is a percentage off the variant's **existing** selling price.
 * The backend recomputes the final price with the same pricing service
 * checkout uses, so the badge and the charged price can never disagree.
 */
export const DEAL_DISCOUNT_TYPES = ['percentage', 'fixed'] as const;
export type DealDiscountType = (typeof DEAL_DISCOUNT_TYPES)[number];

/**
 * Build one section variant.
 *
 * A Zod discriminated union cannot be `.extend()`ed after construction, so
 * each variant is built as a plain object here.
 *
 * The shared scheduling fields are deliberately **NOT** spread into this
 * shape. `homepageSectionSchema` validates the `config` object on its own, and
 * `config` is stored in `homepage_sections.config` — a separate document field
 * from `position` / `isVisible` / `startsAt` / `endsAt`.
 *
 * Folding the base fields in here meant the write schema demanded
 * `config.position` and friends, which the API never sent and the admin editor
 * never set. Every save of a hand-written payload failed validation for reasons
 * that had nothing to do with what the administrator was actually editing.
 * (A `deal` still carries its own campaign window in `startsAt`/`endsAt`,
 * which is a different thing from the section-level scheduling fields and is
 * declared in that variant's own shape.)
 */
const section = <T extends z.ZodRawShape>(type: HomepageSectionType, shape: T) =>
  z.object({ ...shape, type: z.literal(type) });

/** The union of every section's configuration. */
export const homepageSectionSchema = z.discriminatedUnion('type', [
  section('hero', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    bannerId: z.string().trim().min(1).max(64),
    ctaHref: z.string().trim().max(2048),
    ctaLabel: z.string().trim().max(60),
  }),
  section('category-grid', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    layout: z.enum(SECTION_LAYOUTS),
    /** 3-4 reads best; the cap stops a homepage becoming a full catalogue. */
    categorySlugs: z.array(z.string().trim().min(1).max(64)).min(1).max(4),
  }),
  section('new-arrivals', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    layout: z.enum(SECTION_LAYOUTS),
    mode: z.enum(PRODUCT_SOURCE_MODES),
    productIds: z.array(z.string().trim().min(1).max(64)).max(24),
    limit: z.number().int().min(1).max(24),
  }),
  section('featured', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    layout: z.enum(SECTION_LAYOUTS),
    mode: z.enum(PRODUCT_SOURCE_MODES),
    productIds: z.array(z.string().trim().min(1).max(64)).max(24),
    limit: z.number().int().min(1).max(24),
    spotlightProductId: z.string().trim().max(64).nullable(),
  }),
  section('trending', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    layout: z.enum(SECTION_LAYOUTS),
    mode: z.enum(PRODUCT_SOURCE_MODES),
    productIds: z.array(z.string().trim().min(1).max(64)).max(24),
    limit: z.number().int().min(1).max(24),
  }),
  section('deal', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    layout: z.enum(SECTION_LAYOUTS),
    mode: z.enum(PRODUCT_SOURCE_MODES),
    productIds: z.array(z.string().trim().min(1).max(64)).max(24),
    limit: z.number().int().min(1).max(24),
    discountType: z.enum(DEAL_DISCOUNT_TYPES),
    /** Percent (1-90) when `percentage`, or whole rupees when `fixed`. */
    discountValue: z.number().int().min(1).max(90),
  }),
  section('colour-shop', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    colours: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
    limit: z.number().int().min(1).max(12),
  }),
  section('collection-spotlight', {
    heading: z.string().trim().max(160),
    subheading: z.string().trim().max(300),
    layout: z.enum(SECTION_LAYOUTS),
    categorySlug: z.string().trim().min(1).max(64),
    mode: z.enum(PRODUCT_SOURCE_MODES),
    productIds: z.array(z.string().trim().min(1).max(64)).max(24),
    limit: z.number().int().min(1).max(24),
  }),
]);

export type HomepageSectionInput = z.infer<typeof homepageSectionSchema>;

/** A stored section: its identity plus its validated configuration. */
export const storedHomepageSectionSchema = z.object({
  _id: z.string(),
  position: z.number().int(),
  isVisible: z.boolean(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  config: homepageSectionSchema,
});

export type StoredHomepageSection = z.infer<typeof storedHomepageSectionSchema>;

/* -------------------------------------------------------------------------- */
/* Homepage document                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The whole-page save payload.
 *
 * The admin edits a draft and publishes it; `version` provides optimistic
 * concurrency so two admins cannot silently overwrite each other.
 */
export const homepageConfigSchema = z.object({
  version: z.number().int().min(0),
  sections: z.array(
    z.object({
      ...sectionBaseShape,
      config: homepageSectionSchema,
    }),
  ),
  /** When false the admin can save without going live. */
  publish: z.boolean(),
});

export type HomepageConfigInput = z.infer<typeof homepageConfigSchema>;

/* -------------------------------------------------------------------------- */
/* Resolved (storefront-facing) shapes                                        */
/* -------------------------------------------------------------------------- */

/** A product as a homepage card needs it: reference-only, resolved server-side. */
export interface HomepageProductCard {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly subcategory: string;
  readonly subcategorySlug: string;
  readonly mrp: number;
  readonly sellingPrice: number;
  readonly inStock: boolean;
  /** The verified primary image for this product, or null when none exists. */
  readonly imageUrl: string | null;
  readonly imageAlt: string | null;
  /** True when the product has at least one sellable variant. */
  readonly isPurchasable: boolean;
  /** Colours that have verified photography, for the variant picker. */
  readonly verifiedColours: readonly string[];
}

/** A deal price, computed by the backend with the checkout pricing service. */
export interface HomepageDealPrice {
  readonly productId: string;
  readonly variantSku: string;
  readonly basePrice: number;
  readonly finalPrice: number;
  readonly discountType: DealDiscountType;
  readonly discountValue: number;
  readonly mrp: number;
}

/**
 * A resolved colour tile for the shop-by-colour section.
 *
 * Deliberately NOT stored inside `config`. `config` is the administrator's
 * editable input (`colours: string[]`) and is round-tripped verbatim on save;
 * tiles are derived output. Mixing the two made a read-modify-write cycle
 * impossible — the admin GET returned objects where the write schema demanded
 * strings, so every save from the editor failed validation.
 */
export interface HomepageColourTile {
  readonly colour: string;
  readonly count: number;
  readonly href: string;
  readonly imageUrl: string | null;
  readonly imageAlt: string;
}

/**
 * A resolved tile for the shop-by-category section.
 *
 * Same reasoning as `HomepageColourTile`: `config.categorySlugs` is the
 * administrator's editable selection and is round-tripped verbatim, so the
 * *resolved* category — display name, description, live count, representative
 * photograph — lives here instead.
 *
 * Before this existed the storefront resolved a slug through
 * `config/subcategories.ts`, a hardcoded four-entry map. A category created in
 * the admin panel therefore rendered as its raw slug ("bridal-jutti") with no
 * description and no image, which looked like a bug in a shop that had just
 * been set up correctly.
 */
export interface HomepageCategoryTile {
  readonly slug: string;
  readonly displayName: string;
  readonly description: string;
  readonly count: number;
  readonly href: string;
  /** A photograph of one of the category's products, when one exists. */
  readonly imageUrl: string | null;
  readonly imageAlt: string;
}

/** A section after references have been resolved, with its honesty flags. */
export interface ResolvedHomepageSection {
  readonly id: string;
  readonly type: HomepageSectionType;
  readonly position: number;
  readonly isVisible: boolean;
  readonly heading: string;
  readonly subheading: string;
  /**
   * The stored configuration, unchanged, so it can be sent straight back on
   * save. Never contains resolved output.
   */
  readonly config: Record<string, unknown>;
  /** The section's own scheduling window, for the admin editor. */
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly products: readonly HomepageProductCard[];
  readonly deals: readonly HomepageDealPrice[];
  /** Resolved tiles for `colour-shop`; empty for every other type. */
  readonly colourTiles: readonly HomepageColourTile[];
  /** Resolved tiles for `category-grid`; empty for every other type. */
  readonly categories: readonly HomepageCategoryTile[];
  /** Id -> the reason it was dropped, when references could not be resolved. */
  readonly unresolvedProductIds: readonly string[];
  /** Why the storefront is not rendering this section, if it is not. */
  readonly hiddenBecause: SectionHideReason | null;
  /** For deals: the persisted campaign end, which the countdown reads. */
  readonly campaignEndsAt: string | null;
}

export interface HomepageConfig {
  readonly version: number;
  readonly sections: readonly ResolvedHomepageSection[];
  readonly updatedAt: string;
  readonly updatedBy: string | null;
}

/* -------------------------------------------------------------------------- */
/* Product picker                                                             */
/* -------------------------------------------------------------------------- */

export const productPickerQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  subcategory: z.string().trim().max(64).optional(),
  /** Only products that can actually be bought right now. */
  purchasableOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductPickerQuery = z.infer<typeof productPickerQuerySchema>;

/**
 * One row in the admin product picker.
 *
 * It deliberately reports the *problems* as first-class fields so an
 * administrator can see, before publishing, that a product has no imagery or
 * no sellable variant.
 */
export interface ProductPickerRow {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly title: string;
  readonly subcategory: string;
  readonly subcategorySlug: string;
  readonly sellingPrice: number;
  readonly mrp: number;
  readonly inStock: boolean;
  readonly imageUrl: string | null;
  readonly colours: readonly string[];
  /** Warnings shown as badges next to the row in the picker. */
  readonly hasImage: boolean;
  readonly hasSellableVariant: boolean;
  readonly hasQuarantinedImages: boolean;
}

export interface ProductPickerResult {
  readonly items: readonly ProductPickerRow[];
  readonly totalItems: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}
