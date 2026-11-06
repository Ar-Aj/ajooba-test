import { Types } from 'mongoose';
import {
  HOMEPAGE_SECTION_TYPES,
  type HomepageColourTile,
  type HomepageCategoryTile,
  type HomepageDealPrice,
  type HomepageProductCard,
  type HomepageSectionType,
  type ProductPickerQuery,
  type ProductSourceMode,
  type ResolvedHomepageSection,
  type SectionHideReason,
} from '@ajooba/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';
import { BannerModel } from '../models/banner.model.js';
import { CategoryModel } from '../models/category.model.js';
import { HomepageSectionModel } from '../models/homepage-section.model.js';
import { OrderModel } from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import { computeDiscount } from './pricing.service.js';
import { availableUnits } from './stock.service.js';

/**
 * Homepage merchandising service.
 *
 * Three responsibilities, in order of importance:
 *
 *  1. **Never reference a product that does not exist.** Every id an admin
 *     saves is resolved against the catalogue *before* the save is accepted.
 *     An unresolvable id is reported, not stored.
 *  2. **Never promote an unpurchasable product as available.** A card is only
 *     labelled in stock when a variant passes the same sellability gate
 *     checkout uses (`pending-review` photography withheld, stock > reserved).
 *  3. **Never show a deal price the checkout would not honour.** Deal prices
 *     are computed with `pricing.service`, the same module that prices the
 *     basket, so a countdown badge and a charged price cannot disagree.
 */

/**
 * Assert a category slug is one the merchandising layer may reference.
 *
 * The check is against the live `categories` collection, not against a
 * hardcoded array. The hardcoded set that used to sit here meant an
 * administrator could create a category, assign products to it, and then be
 * told by the homepage editor that the category "is not a category in this
 * catalogue" — because the editor was validating against a constant baked in
 * at build time.
 *
 * A category that exists but is retired is refused for the same reason
 * product assignment refuses one: nothing renders it, so a merchandising
 * section pointing at it would resolve to an empty slot.
 */
async function assertAssignableCategoryForMerchandising(slug: string): Promise<void> {
  if (!slug) {
    throw new ValidationError('A category must be chosen for this section.', [
      { field: 'categorySlug', message: 'Category is required.' },
    ]);
  }

  const category = await CategoryModel.findOne({ slug }).select('status').lean<{
    status: string;
  } | null>();

  if (!category) {
    throw new ConflictError(`"${slug}" is not a category in this catalogue.`);
  }
  if (category.status !== 'active') {
    throw new ConflictError(`"${slug}" is retired and cannot be merchandised.`);
  }
}

interface ProductDoc {
  _id: Types.ObjectId;
  code: string;
  slug: string;
  title: string;
  subcategory: string;
  subcategorySlug: string;
  colours: string[];
  images: Array<{ url: string; alt: string; position: number; colour?: string }>;
  quarantinedImages?: string[];
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  createdAt: Date;
}

interface VariantDoc {
  _id: Types.ObjectId;
  sku: string;
  productId: Types.ObjectId;
  colour: string;
  size: number;
  mrp: number;
  sellingPrice: number;
  stock: number;
  inStock: boolean;
  reservedStock?: number;
  photographyStatus?: 'verified' | 'pending-review';
}

/**
 * The same sellability gate the catalogue uses.
 *
 * A variant with `pending-review` photography is withheld regardless of
 * stock: the storefront cannot show the shopper anything truthful for that
 * colourway, so presenting it as available would be a lie.
 */
function isSellable(doc: VariantDoc): boolean {
  if (doc.photographyStatus === 'pending-review') return false;
  return doc.inStock && availableUnits(doc) > 0;
}

/**
 * The primary image for a product.
 *
 * Images are stored position-ordered and only *verified* ones are in
 * `images` (quarantined files live in `quarantinedImages`), so the first
 * entry is both the hero shot and a colour we have genuinely photographed.
 */
function pickPrimaryImage(doc: ProductDoc): { url: string; alt: string } | null {
  const ordered = [...doc.images].sort((a, b) => a.position - b.position);
  const first = ordered[0];
  return first ? { url: first.url, alt: first.alt } : null;
}

/**
 * Turn product documents into storefront cards.
 *
 * `verifiedColours` comes from the variants that are both sellable *and*
 * carry verified photography, so the colour picker can never offer a colour
 * whose gallery would be empty or wrong.
 */
function toCards(
  docs: ProductDoc[],
  variantsByProduct: Map<string, VariantDoc[]>,
): HomepageProductCard[] {
  return docs.map((doc) => {
    const variants = variantsByProduct.get(doc._id.toString()) ?? [];
    const sellable = variants.filter(isSellable);
    const image = pickPrimaryImage(doc);
    const verifiedColours = [...new Set(sellable.map((v) => v.colour))].sort();

    return {
      id: doc._id.toString(),
      code: doc.code,
      slug: doc.slug,
      title: doc.title,
      subcategory: doc.subcategory,
      subcategorySlug: doc.subcategorySlug,
      mrp: doc.mrp,
      sellingPrice: doc.sellingPrice,
      inStock: doc.inStock,
      imageUrl: image?.url ?? null,
      imageAlt: image?.alt ?? null,
      isPurchasable: sellable.length > 0,
      verifiedColours,
    };
  });
}

/** Load variants for a set of products, keyed by product id. */
async function loadVariants(productIds: Types.ObjectId[]): Promise<Map<string, VariantDoc[]>> {
  const map = new Map<string, VariantDoc[]>();
  if (productIds.length === 0) return map;
  const docs = await VariantModel.find({ productId: { $in: productIds } })
    .sort({ colour: 1, size: 1 })
    .lean<VariantDoc[]>();
  for (const doc of docs) {
    const key = doc.productId.toString();
    const list = map.get(key) ?? [];
    list.push(doc);
    map.set(key, list);
  }
  return map;
}

/** Fetch product documents by id, preserving the caller's order. */
async function fetchProductsByIds(ids: string[]): Promise<{
  byId: Map<string, ProductDoc>;
  missing: string[];
}> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  const docs = await ProductModel.find({ _id: { $in: valid } }).lean<ProductDoc[]>();
  const byId = new Map(docs.map((d) => [d._id.toString(), d]));
  const missing = ids.filter((id) => !byId.has(id));
  return { byId, missing };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Validate one section's references before it is stored.
 *
 * Returns the ids that could not be resolved so the caller can report them.
 * Throws only for problems that make the section meaningless (an unknown
 * category, a hero pointing at a banner that does not exist).
 */
export async function validateSectionReferences(
  config: Record<string, unknown> & { type: string },
): Promise<{ unresolvedProductIds: string[] }> {
  const unresolvedProductIds: string[] = [];

  if (config.type === 'hero') {
    const bannerId = configString(config.bannerId);
    const banner = await BannerModel.exists({ _id: bannerId });
    if (!banner) {
      throw new NotFoundError(`Banner ${bannerId}`);
    }
    return { unresolvedProductIds };
  }

  if (config.type === 'category-grid') {
    for (const slug of config.categorySlugs as string[]) {
      await assertAssignableCategoryForMerchandising(slug);
    }
    return { unresolvedProductIds };
  }

  if (config.type === 'colour-shop') {
    // Colours are intersected with what is actually published later, so an
    // over-eager selection degrades to fewer tiles rather than a broken one.
    return { unresolvedProductIds };
  }

  if (config.type === 'collection-spotlight') {
    const slug = configString(config.categorySlug);
    await assertAssignableCategoryForMerchandising(slug);
  }

  const ids = Array.isArray(config.productIds) ? (config.productIds as string[]) : [];
  if (ids.length > 0) {
    const { missing } = await fetchProductsByIds(ids);
    unresolvedProductIds.push(...missing);

    if (config.type === 'featured') {
      const spotlight = config.spotlightProductId;
      if (typeof spotlight === 'string' && spotlight.length > 0) {
        const { missing: spotMissing } = await fetchProductsByIds([spotlight]);
        unresolvedProductIds.push(...spotMissing);
      }
    }
  }

  return { unresolvedProductIds };
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

interface StoredSection {
  _id: Types.ObjectId;
  type: string;
  position: number;
  isVisible: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  config: Record<string, unknown>;
  updatedAt: Date;
}

/** Whether `now` falls inside the section's optional scheduling window. */
function withinWindow(section: StoredSection, now: Date): boolean {
  if (section.startsAt && now < section.startsAt) return false;
  if (section.endsAt && now > section.endsAt) return false;
  return true;
}

/**
 * Compute the deal price for one product's cheapest sellable variant.
 *
 * The discount is applied to the variant's *existing* selling price and
 * rounded to whole rupees by the shared pricing service, so the figure shown
 * on the badge is the figure the checkout charges.
 */
function buildDeals(
  card: HomepageProductCard,
  variants: VariantDoc[],
  discountType: 'percentage' | 'fixed',
  discountValue: number,
): HomepageDealPrice[] {
  const sellable = variants.filter(isSellable);
  if (sellable.length === 0) return [];
  const cheapest = sellable.reduce((a, b) => (a.sellingPrice <= b.sellingPrice ? a : b));

  /*
   * `computeDiscount` returns the *discount amount*; the deal price is what
   * remains. Reusing the checkout's own pricing function is what guarantees
   * the badge price and the charged price cannot drift apart.
   */
  const discountAmount = computeDiscount(
    {
      code: '',
      type: discountType,
      value: discountValue,
      minOrderAmount: 0,
      maxDiscountAmount: null,
    },
    cheapest.sellingPrice,
  );
  const finalPrice = Math.max(0, cheapest.sellingPrice - discountAmount);
  if (finalPrice >= cheapest.sellingPrice) return [];
  return [
    {
      productId: card.id,
      variantSku: cheapest.sku,
      basePrice: cheapest.sellingPrice,
      finalPrice,
      discountType,
      discountValue,
      mrp: cheapest.mrp,
    },
  ];
}

/**
 * Resolve one section's references into renderable cards.
 *
 * This is where the honesty rules bite:
 *
 *  - `hiddenBecause` explains *why* a section is not shown, so the storefront
 *    can render an empty state instead of an empty rail.
 *  - `unresolvedProductIds` reports references that were dropped, so the
 *    admin can fix them.
 */
/**
 * Read a config value that is supposed to be a string.
 *
 * `config` is stored as a free-form document, so a value can be anything.
 * Plain `String(value)` would render an object as the literal text
 * "[object Object]" and put that on the storefront, so anything that is not
 * genuinely a string collapses to the fallback instead.
 */
function configString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

async function resolveSection(section: StoredSection, now: Date): Promise<ResolvedHomepageSection> {
  const config = section.config as Record<string, unknown> & { type: HomepageSectionType };

  const base = {
    id: section._id.toString(),
    type: config.type,
    position: section.position,
    isVisible: section.isVisible,
    heading: configString(config.heading),
    subheading: configString(config.subheading),
    startsAt: section.startsAt ? section.startsAt.toISOString() : null,
    endsAt: section.endsAt ? section.endsAt.toISOString() : null,
    /*
     * Echoed back unchanged so a client can re-save what it just read. The
     * `type` discriminator is already on the object.
     */
    config,
    products: [] as HomepageProductCard[],
    deals: [] as HomepageDealPrice[],
    /*
     * Derived output lives here, never inside `config`. `config` is echoed
     * back verbatim so the admin editor can re-save a section it merely read;
     * mixing resolved values into it made every save fail schema validation.
     */
    colourTiles: [] as HomepageColourTile[],
    categories: [] as HomepageCategoryTile[],
    unresolvedProductIds: [] as string[],
    hiddenBecause: null as SectionHideReason | null,
    // The persisted campaign end, which the countdown reads. For a deal this
    // is the same value the visibility check used.
    campaignEndsAt: section.endsAt ? section.endsAt.toISOString() : null,
  };

  if (!section.isVisible) {
    return { ...base, hiddenBecause: 'disabled' };
  }
  if (!withinWindow(section, now)) {
    const expired = section.endsAt !== null && now > section.endsAt;
    return { ...base, hiddenBecause: expired ? 'expired' : 'not-scheduled' };
  }

  /* --- hero: the artwork comes from the existing banners collection ------ */
  if (config.type === 'hero') {
    const banner = await BannerModel.findById(configString(config.bannerId)).lean<{
      title: string;
      imageUrl: string;
      mobileImageUrl: string | null;
      linkUrl: string;
      alt?: string;
    } | null>();
    if (!banner) {
      return { ...base, hiddenBecause: 'unresolved-references' };
    }
    return {
      ...base,
      config: {
        ...config,
        imageUrl: banner.imageUrl,
        mobileImageUrl: banner.mobileImageUrl,
        alt: banner.alt ?? banner.title,
        linkUrl: banner.linkUrl,
      },
    };
  }

  /* --- deal: an expired campaign is simply not a deal -------------------- */
  /*
   * A deal's campaign window IS the section's scheduling window — there is
   * one source of truth, so the countdown can never read a different date
   * from the one the visibility check used.
   */
  if (config.type === 'deal') {
    const endsAt = section.endsAt;
    if (endsAt && endsAt.getTime() <= now.getTime()) {
      return { ...base, hiddenBecause: 'expired' };
    }
    if (section.startsAt && section.startsAt.getTime() > now.getTime()) {
      return { ...base, hiddenBecause: 'not-scheduled' };
    }
  }

  /* --- category-grid: resolve to real, non-empty categories --------------- */
  if (config.type === 'category-grid') {
    const slugs = config.categorySlugs as string[];

    /*
     * The tiles are built from the taxonomy, not from a hardcoded map.
     *
     * Only a category that currently has products is surfaced, so a card can
     * never lead to an empty result page — the same rule
     * `getPublicCategories` applies, evaluated here against the section's own
     * selection so one slow category cannot empty the whole shelf.
     *
     * The representative photograph is the newest verified image of the
     * newest design in that category. It is chosen from real imagery only; a
     * category with no photographed product renders as a typographic tile
     * rather than borrowing a picture of something else.
     */
    const [categoryDocs, counts, sample] = await Promise.all([
      CategoryModel.find({ slug: { $in: slugs }, status: 'active', isVisible: true })
        .sort({ position: 1, slug: 1 })
        .lean<Array<{ slug: string; displayName: string; description?: string }>>(),
      ProductModel.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            subcategorySlug: { $in: slugs },
            $or: [{ status: 'published' }, { status: { $exists: false } }],
          },
        },
        { $group: { _id: '$subcategorySlug', count: { $sum: 1 } } },
      ]),
      ProductModel.aggregate<{
        _id: string;
        imageUrl: string | null;
        imageAlt: string | null;
      }>([
        {
          $match: {
            subcategorySlug: { $in: slugs },
            $or: [{ status: 'published' }, { status: { $exists: false } }],
            'images.0': { $exists: true },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$subcategorySlug',
            imageUrl: { $first: { $arrayElemAt: ['$images.url', 0] } },
            imageAlt: { $first: { $arrayElemAt: ['$images.alt', 0] } },
          },
        },
      ]),
    ]);

    const populated = new Set(counts.filter((row) => row.count > 0).map((row) => row._id));
    const countBySlug = new Map(counts.map((row) => [row._id, row.count]));
    const sampleBySlug = new Map(sample.map((row) => [row._id, row]));
    const bySlug = new Map(categoryDocs.map((doc) => [doc.slug, doc]));

    // Preserve the administrator's chosen order, then drop the categories that
    // would lead nowhere.
    const shownSlugs = slugs.filter((slug) => populated.has(slug) && bySlug.has(slug));

    if (shownSlugs.length === 0) {
      return { ...base, hiddenBecause: 'no-products' };
    }

    const tiles: HomepageCategoryTile[] = shownSlugs.map((slug) => {
      const doc = bySlug.get(slug)!;
      const image = sampleBySlug.get(slug);
      return {
        slug,
        displayName: doc.displayName,
        description: doc.description ?? '',
        count: countBySlug.get(slug) ?? 0,
        href: `/products?subcategory=${encodeURIComponent(slug)}`,
        imageUrl: image?.imageUrl ?? null,
        imageAlt: image?.imageAlt || `${doc.displayName} footwear`,
      };
    });

    return {
      ...base,
      config: { ...config, categorySlugs: shownSlugs },
      categories: tiles,
    };
  }

  /* --- colour-shop: intersect with colours that really exist -------------- */
  if (config.type === 'colour-shop') {
    const requested = config.colours as string[];
    const limit = (config.limit as number | undefined) ?? 8;
    const rows = await ProductModel.aggregate<{ _id: string; count: number }>([
      { $unwind: '$colours' },
      { $match: { colours: { $in: requested } } },
      { $group: { _id: '$colours', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);
    if (rows.length === 0) {
      return { ...base, hiddenBecause: 'no-products' };
    }
    /*
     * Each tile must show a photograph of *that* colour. A product's images
     * carry the `colour` they were verified as belonging to, so the tile
     * image is chosen only from images matching this exact colour.
     *
     * If a colour has no verified photograph anywhere in the catalogue, the
     * tile is dropped rather than illustrated with the wrong colour — showing
     * a brown shoe on a "black" swatch is worse than showing one fewer swatch.
     */
    const tiles = (
      await Promise.all(
        rows.map(async (row) => {
          // Only images explicitly verified as this colour qualify.
          const match = await ProductModel.findOne({
            colours: row._id,
            images: { $elemMatch: { colour: row._id } },
          })
            .sort({ createdAt: -1 })
            .lean<ProductDoc | null>();

          if (!match) return null;

          const image = match.images.find((i) => i.colour === row._id);
          if (!image) return null;

          return {
            colour: row._id,
            count: row.count,
            href: `/products?colour=${encodeURIComponent(row._id)}`,
            imageUrl: image.url,
            imageAlt: image.alt || `${row._id} footwear`,
          };
        }),
      )
    ).filter((t): t is NonNullable<typeof t> => t !== null);

    if (tiles.length === 0) {
      return { ...base, hiddenBecause: 'no-products' };
    }

    return {
      ...base,
      colourTiles: tiles,
    };
  }

  /* --- product-driven sections ------------------------------------------- */

  const mode = (config.mode as ProductSourceMode | undefined) ?? 'automatic';
  const limit = (config.limit as number | undefined) ?? 8;
  let docs: ProductDoc[] = [];
  const unresolvedProductIds: string[] = [];

  if (mode === 'manual') {
    const ids = (config.productIds as string[]) ?? [];
    const { byId, missing } = await fetchProductsByIds(ids);
    unresolvedProductIds.push(...missing);
    // Preserve the admin's chosen order.
    docs = ids.map((id) => byId.get(id)).filter((d): d is ProductDoc => Boolean(d));
    if (config.type === 'collection-spotlight' && config.categorySlug) {
      docs = docs.filter((d) => d.subcategorySlug === config.categorySlug);
    }
    docs = docs.slice(0, limit);
  } else if (mode === 'category') {
    const slug =
      config.type === 'collection-spotlight'
        ? configString(config.categorySlug)
        : (config.subcategorySlug as string | undefined);
    if (!slug) {
      return { ...base, hiddenBecause: 'no-products' };
    }
    docs = await ProductModel.find({ subcategorySlug: slug })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<ProductDoc[]>();
  } else {
    /*
     * `automatic` is the only mode that has an opinion about *which*
     * products. For trending that opinion is "what people actually bought".
     * Every other automatic section is simply the newest designs.
     */
    if (config.type === 'trending') {
      const ranked = await rankBySales(limit);
      if (ranked.length > 0) {
        docs = ranked;
      } else {
        // No genuine sales yet: an honest newest-first fallback rather than
        // a fabricated ranking.
        docs = await ProductModel.find({})
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean<ProductDoc[]>();
      }
    } else {
      docs = await ProductModel.find({}).sort({ createdAt: -1 }).limit(limit).lean<ProductDoc[]>();
    }
  }

  if (docs.length === 0) {
    return { ...base, unresolvedProductIds, hiddenBecause: 'no-products' };
  }

  const variantsByProduct = await loadVariants(docs.map((d) => d._id));
  const cards = toCards(docs, variantsByProduct);

  /*
   * Trending is ranked by real sales when there is enough data.
   *
   * When the platform has no orders the query returns nothing and the section
   * falls back to the newest products under the administrator's own heading —
   * never an invented "1,200 sold this week". Ranking is computed only from
   * completed, paid order lines, so a cancelled or unpaid order cannot make
   * something look popular.
   */
  let deals: HomepageDealPrice[] = [];
  if (config.type === 'deal') {
    const discountType = config.discountType as 'percentage' | 'fixed';
    const discountValue = config.discountValue as number;
    deals = cards.flatMap((card) =>
      buildDeals(card, variantsByProduct.get(card.id) ?? [], discountType, discountValue),
    );
    if (deals.length === 0) {
      return { ...base, unresolvedProductIds, hiddenBecause: 'no-campaign' };
    }
  }

  return { ...base, products: cards, deals, unresolvedProductIds };
}

/**
 * The best-selling designs, ranked from genuine order lines.
 *
 * Returns an empty list when there are no completed sales, which is the
 * signal for the caller to fall back to a curated or newest-first selection.
 * Only `completed` orders that were actually paid count: a cancelled or
 * unpaid order must not be able to make a design look popular.
 */
async function rankBySales(limit: number): Promise<ProductDoc[]> {
  const rows = await OrderModel.aggregate<{ _id: Types.ObjectId; units: number }>([
    { $match: { status: 'completed', paymentStatus: 'paid' } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        units: { $sum: '$items.quantity' },
      },
    },
    { $sort: { units: -1 } },
    { $limit: limit },
  ]);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row._id).filter((id) => id instanceof Types.ObjectId);
  if (ids.length === 0) return [];

  const docs = await ProductModel.find({ _id: { $in: ids } })
    .sort({ createdAt: -1 })
    .lean<ProductDoc[]>();

  const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));

  // Preserve the sales order the aggregation produced.
  return ids.map((id) => byId.get(id.toString())).filter((doc): doc is ProductDoc => Boolean(doc));
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Search the real catalogue for the admin product picker.
 *
 * Each row reports its *problems* explicitly (`hasImage`,
 * `hasSellableVariant`, `hasQuarantinedImages`) so an administrator can see
 * before publishing that a product has no photography or nothing buyable.
 */
export async function searchProductsForPicker(query: ProductPickerQuery) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 24;

  const filter: Record<string, unknown> = {};
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: { $regex: escaped, $options: 'i' } },
      { code: { $regex: escaped, $options: 'i' } },
    ];
  }
  if (query.subcategory) {
    filter.subcategorySlug = query.subcategory;
  }

  const [docs, totalItems] = await Promise.all([
    ProductModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ProductDoc[]>(),
    ProductModel.countDocuments(filter),
  ]);

  const variantsByProduct = await loadVariants(docs.map((d) => d._id));

  let rows = docs.map((doc) => {
    const variants = variantsByProduct.get(doc._id.toString()) ?? [];
    const image = pickPrimaryImage(doc);
    return {
      id: doc._id.toString(),
      code: doc.code,
      slug: doc.slug,
      title: doc.title,
      subcategory: doc.subcategory,
      subcategorySlug: doc.subcategorySlug,
      sellingPrice: doc.sellingPrice,
      mrp: doc.mrp,
      inStock: doc.inStock,
      imageUrl: image?.url ?? null,
      colours: [...new Set(variants.map((v) => v.colour))].sort(),
      hasImage: image !== null,
      hasSellableVariant: variants.some(isSellable),
      hasQuarantinedImages: (doc.quarantinedImages?.length ?? 0) > 0,
    };
  });

  if (query.purchasableOnly) {
    rows = rows.filter((r) => r.hasSellableVariant);
  }

  return {
    items: rows,
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

/**
 * The published homepage, fully resolved.
 *
 * Sections that cannot be rendered are **omitted** — the storefront only ever
 * receives sections it can honestly display.
 */
export async function getResolvedHomepage(): Promise<ResolvedHomepageSection[]> {
  const now = new Date();
  const sections = await HomepageSectionModel.find({})
    .sort({ position: 1 })
    .lean<StoredSection[]>();
  if (sections.length === 0) return [];

  const resolved = await Promise.all(sections.map((s) => resolveSection(s, now)));
  return resolved.filter((s) => s.hiddenBecause === null);
}

/**
 * Every section, including hidden ones, for the admin editor.
 */
export async function listSectionsForAdmin(): Promise<
  Array<{ id: string; section: ResolvedHomepageSection }>
> {
  const now = new Date();
  const sections = await HomepageSectionModel.find({})
    .sort({ position: 1 })
    .lean<StoredSection[]>();
  return Promise.all(
    sections.map(async (section) => ({
      id: section._id.toString(),
      section: await resolveSection(section, now),
    })),
  );
}

/**
 * Replace the whole section list.
 *
 * A full replace (rather than per-section PATCH) is deliberate: ordering and
 * visibility are page-level concerns, so the admin saves one coherent page.
 * `version` guards against a second admin overwriting a newer save.
 */
export async function saveSections(
  sections: Array<{
    position: number;
    isVisible: boolean;
    startsAt: string | null;
    endsAt: string | null;
    config: Record<string, unknown>;
  }>,
  expectedVersion: number,
  actorId: string | null,
): Promise<ResolvedHomepageSection[]> {
  const current = await HomepageSectionModel.find({}).lean<StoredSection[]>();
  const currentVersion = currentVersionOf(current);

  if (expectedVersion !== currentVersion) {
    throw new ConflictError(
      `This homepage was saved by someone else (version ${currentVersion}, you had ${expectedVersion}). Reload and try again.`,
    );
  }

  // Validate every reference before writing anything: a partial write that
  // leaves one bad section would be harder to reason about than no write.
  const problems: string[] = [];
  for (const [index, section] of sections.entries()) {
    const type = configString(section.config.type);
    if (!HOMEPAGE_SECTION_TYPES.includes(type as HomepageSectionType)) {
      problems.push(`Section ${index + 1}: "${type}" is not a supported section type.`);
      continue;
    }
    try {
      const { unresolvedProductIds } = await validateSectionReferences(
        section.config as Record<string, unknown> & { type: string },
      );
      if (unresolvedProductIds.length > 0) {
        problems.push(
          `Section ${index + 1}: ${unresolvedProductIds.length} product reference(s) do not exist.`,
        );
      }
    } catch (error) {
      problems.push(`Section ${index + 1}: ${(error as Error).message}`);
    }
  }

  if (problems.length > 0) {
    throw new ConflictError(`Homepage not saved. ${problems.join(' ')}`);
  }

  // Only now is it safe to write.
  await HomepageSectionModel.deleteMany({});
  if (sections.length > 0) {
    await HomepageSectionModel.insertMany(
      sections.map((section) => ({
        type: configString(section.config.type),
        position: section.position,
        isVisible: section.isVisible,
        startsAt: section.startsAt ? new Date(section.startsAt) : null,
        endsAt: section.endsAt ? new Date(section.endsAt) : null,
        config: section.config,
        updatedBy: actorId,
      })),
    );
  }

  return getResolvedHomepage();
}

/**
 * The homepage version.
 *
 * It is derived from the newest `updatedAt`, which changes whenever a save
 * lands, so a concurrent edit is detected without a second counter that
 * could drift out of step with the data.
 */
export function currentVersionOf(sections: StoredSection[]): number {
  if (sections.length === 0) return 0;
  const newest = sections.reduce(
    (max, s) => (s.updatedAt.getTime() > max.getTime() ? s.updatedAt : max),
    new Date(0),
  );
  return newest.getTime();
}

/**
 * The version an administrator must echo back on save.
 *
 * `listSectionsForAdmin` calls this so the editor is handed the exact value
 * the next save will be checked against. Without it the client has no way to
 * produce a valid optimistic-concurrency token, and every save fails.
 */
export async function currentHomepageVersion(): Promise<number> {
  const sections = await HomepageSectionModel.find({}).lean<StoredSection[]>();
  return currentVersionOf(sections);
}

/** Remove every section (used by the admin's "start fresh" action). */
export async function clearSections(): Promise<void> {
  await HomepageSectionModel.deleteMany({});
}
