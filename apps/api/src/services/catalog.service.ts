import type { Types } from 'mongoose';
import {
  DEFAULT_PAGE_SIZE,
  type CatalogFacets,
  type CatalogListResult,
  type CatalogQueryInput,
  type CategoryView,
  type FacetCount,
  type Product,
  type ProductImage,
  type ProductVariant,
} from '@ajooba/contracts';
import { CategoryModel } from '../models/category.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import { availableUnits } from './stock.service.js';

/**
 * Catalogue read service.
 *
 * All reads go to MongoDB. There is no in-memory fallback and no seeded
 * fixture data — if the database is empty, the API correctly returns an empty
 * catalogue rather than inventing products.
 */

/**
 * The publication gate for every **public** catalogue read.
 *
 * Three states exist and only one of them belongs on the storefront:
 *
 *  - `published` — live.
 *  - `draft`     — admin-only; must never appear in a customer listing.
 *  - `archived`  — retired; hidden, but still resolvable for order history
 *                  (which reads the product collection directly, not through
 *                  this service).
 *
 * `$exists: false` is included because the field was introduced after the
 * first 55 designs were imported. Those rows carry no `status` at all and the
 * Mongoose default only applies on a *write*, so a strict `status: 'published'`
 * filter would have taken the entire live catalogue offline. Absent means
 * published — that is the documented migration contract, and the same
 * clause appears in `listProductsForAdmin`.
 */
const PUBLISHED_CLAUSE: Record<string, unknown> = {
  $or: [{ status: 'published' }, { status: { $exists: false } }],
};

/** Merge the publication gate into a filter without clobbering a caller's `$or`. */
function withPublished(filter: Record<string, unknown>): Record<string, unknown> {
  const existingAnd = Array.isArray(filter.$and) ? (filter.$and as unknown[]) : [];
  /*
   * `buildFilter` may already have set `$or` for a text search. Mongo treats a
   * second `$or` key as an overwrite, not an AND, so the gate is folded into
   * `$and` instead — which is also why the search clause is moved there.
   */
  const existingOr = filter.$or;
  delete filter.$or;

  const and: unknown[] = [...existingAnd];
  if (existingOr !== undefined) and.push({ $or: existingOr });
  and.push(PUBLISHED_CLAUSE);

  filter.$and = and;
  return filter;
}

interface ProductDoc {
  _id: { toString(): string };
  code: string;
  slug: string;
  title: string;
  description: string;
  subcategory: string;
  subcategorySlug: string;
  brand: string;
  colours: string[];
  images: ProductImage[];
  quarantinedImages?: string[];
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  status?: 'draft' | 'published' | 'archived';
  seoTitle?: string;
  seoDescription?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface VariantDoc {
  sku: string;
  productId: { toString(): string };
  size: number;
  ukIndiaSize?: number;
  euroSize?: number;
  colour: string;
  colourToken: string;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  stock: number;
  inStock: boolean;
  reservedStock?: number;
  ean?: string;
  photographyStatus?: 'verified' | 'pending-review';
}

/*
 * Whether a variant may actually be bought.
 *
 * Stock is necessary but not sufficient: a colourway with no verified
 * photography is withheld regardless of stock, because the storefront cannot
 * show the shopper anything truthful for that colour. Without this gate a
 * `pending-review` variant with stock would be added to cart against an empty
 * or wrong-colour gallery — the exact defect this change set exists to stop.
 *
 * Note this only affects what the API *reports*; `stock`, `inStock` and
 * `reservedStock` are stored unchanged, so lifting the review flag restores
 * sellability without re-entering any stock data.
 */
function isSellable(doc: VariantDoc): boolean {
  if (doc.photographyStatus === 'pending-review') return false;
  return doc.inStock && availableUnits(doc) > 0;
}

function mapVariant(doc: VariantDoc, productId: string): ProductVariant {
  return {
    sku: doc.sku,
    productId,
    size: doc.size,
    colour: doc.colour,
    colourToken: doc.colourToken,
    mrp: doc.mrp,
    sellingPrice: doc.sellingPrice,
    discountPercent: doc.discountPercent,
    // Reported availability is gated on verified photography; the underlying
    // `stock` number is passed through untouched so nothing is lost.
    stock: doc.stock,
    inStock: isSellable(doc),
    ...(doc.photographyStatus ? { photographyStatus: doc.photographyStatus } : {}),
    ...(doc.ukIndiaSize !== undefined ? { ukIndiaSize: doc.ukIndiaSize } : {}),
    ...(doc.euroSize !== undefined ? { euroSize: doc.euroSize } : {}),
    ...(doc.ean ? { ean: doc.ean } : {}),
  };
}

function mapProduct(doc: ProductDoc, variants: ProductVariant[]): Product {
  return {
    id: doc._id.toString(),
    code: doc.code,
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    subcategory: doc.subcategory,
    subcategorySlug: doc.subcategorySlug,
    brand: doc.brand,
    colours: doc.colours,
    images: doc.images,
    quarantinedImages: doc.quarantinedImages ?? [],
    variants,
    mrp: doc.mrp,
    sellingPrice: doc.sellingPrice,
    inStock: doc.inStock,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Build the Mongo filter for a catalogue query.
 */
function buildFilter(query: CatalogQueryInput): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
    ];
  }

  if (query.subcategory) {
    filter.subcategorySlug = query.subcategory;
  }

  /*
   * Colour lives on the variant (one design can be made in several colours),
   * but the product document denormalises the distinct colour list into
   * `colours`. Filtering on that array is therefore equivalent to "has at
   * least one variant in this colour" and avoids a second query.
   */
  if (query.colour) {
    filter.colours = query.colour;
  }

  if (query.inStock !== undefined) {
    filter.inStock = query.inStock;
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const priceRange: { $gte?: number; $lte?: number } = {};
    if (query.minPrice !== undefined) priceRange.$gte = query.minPrice;
    if (query.maxPrice !== undefined) priceRange.$lte = query.maxPrice;
    filter.sellingPrice = priceRange;
  }

  return filter;
}

/**
 * Resolve the set of product ids that have a variant in the requested size.
 *
 * Size is a variant-level attribute only — the product document does not
 * denormalise the size scale — so a size filter has to be resolved through
 * the variants collection before the product query can run.
 */
async function resolveProductIdsForSize(size: number): Promise<Types.ObjectId[]> {
  const variantDocs = await VariantModel.find({ size })
    .select('productId')
    .lean<Array<{ productId: Types.ObjectId }>>();

  const ids = new Map<string, Types.ObjectId>();
  for (const doc of variantDocs) {
    const id = doc.productId;
    ids.set(id.toString(), id);
  }
  return [...ids.values()];
}

function buildSort(sort: CatalogQueryInput['sort']): Record<string, 1 | -1> {
  switch (sort) {
    case 'price-asc':
      return { sellingPrice: 1 };
    case 'price-desc':
      return { sellingPrice: -1 };
    case 'title-asc':
      return { title: 1 };
    case 'title-desc':
      return { title: -1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

/**
 * List products with filters, sorting and pagination.
 */
export async function listProducts(query: CatalogQueryInput): Promise<CatalogListResult> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  // The publication gate is applied to BOTH the rows and the count. Counting
  // without it produced a "showing 12 of 55" header over a grid of 12 rows
  // because 43 drafts were being counted but not returned.
  const filter = withPublished(buildFilter(query));
  const sort = buildSort(query.sort);

  /*
   * A size filter narrows the result set to designs that are actually
   * manufactured in that size. When no design matches, the product query is
   * short-circuited to an empty set rather than running against an
   * unfiltered collection.
   */
  if (query.size !== undefined) {
    const productIds = await resolveProductIdsForSize(query.size);
    if (productIds.length === 0) {
      return { items: [], totalItems: 0, page, pageSize, totalPages: 0 };
    }
    filter._id = { $in: productIds };
  }

  const [docs, totalItems] = await Promise.all([
    ProductModel.find(filter)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ProductDoc[]>(),
    ProductModel.countDocuments(filter),
  ]);

  const productIds: Types.ObjectId[] = docs.map((doc) => doc._id as Types.ObjectId);
  const variantDocs = await VariantModel.find({ productId: { $in: productIds } })
    .sort({ colour: 1, size: 1 })
    .lean<VariantDoc[]>();

  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const variantDoc of variantDocs) {
    const key = variantDoc.productId.toString();
    const list = variantsByProduct.get(key) ?? [];
    list.push(mapVariant(variantDoc, key));
    variantsByProduct.set(key, list);
  }

  const items = docs.map((doc) => mapProduct(doc, variantsByProduct.get(doc._id.toString()) ?? []));

  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);

  return { items, totalItems, page, pageSize, totalPages };
}

/**
 * Fetch a single product by its slug, with its variants.
 *
 * Only **published** designs are returned. A draft or archived design answers
 * exactly as an unknown slug does — a 404 — so an unpublished product can
 * never be reached by guessing its URL. The admin panel reads through
 * `getProductByCode` instead, which is deliberately unfiltered.
 */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const doc = await ProductModel.findOne({ slug, ...PUBLISHED_CLAUSE }).lean<ProductDoc>();
  if (!doc) {
    return null;
  }

  const productId = doc._id.toString();
  const variantDocs = await VariantModel.find({ productId: doc._id as Types.ObjectId })
    .sort({ colour: 1, size: 1 })
    .lean<VariantDoc[]>();

  return mapProduct(
    doc,
    variantDocs.map((variant) => mapVariant(variant, productId)),
  );
}

/**
 * Compute catalogue facet counts from real data.
 *
 * Every count is gated on publication, so the filter panel can never advertise
 * "Formal Shoes (29)" beside a grid of 12 designs. The same gate is used by
 * `listProducts`, so the two numbers cannot drift.
 *
 * `categories` is returned alongside the raw slug counts: it is the live
 * taxonomy from the `categories` collection, with the display names, ordering
 * and visibility an administrator set. The storefront builds its filter list
 * from this rather than from a hardcoded array, which is what makes a
 * newly-created category appear without a deploy.
 */
export async function getCatalogFacets(): Promise<CatalogFacets> {
  const [subcategoryRows, colourRows, sizeRows, priceRows, categoryDocs] = await Promise.all([
    ProductModel.aggregate<{ _id: string; count: number }>([
      { $match: PUBLISHED_CLAUSE },
      // Group by the SLUG, not the display label. The catalogue query filters
      // on `subcategorySlug`, so the facet counts have to be computed over the
      // same field or the two numbers will not agree.
      { $group: { _id: '$subcategorySlug', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    VariantModel.aggregate<{ _id: string; count: number }>([
      // Colour lives on the variant, so the gate is applied by pre-resolving
      // the published product ids rather than by a join.
      { $match: await publishedProductIdClause() },
      { $group: { _id: '$colour', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    VariantModel.aggregate<{ _id: number; count: number }>([
      { $match: await publishedProductIdClause() },
      { $group: { _id: '$size', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    ProductModel.aggregate<{ min: number; max: number }>([
      { $match: PUBLISHED_CLAUSE },
      {
        $group: {
          _id: null,
          min: { $min: '$sellingPrice' },
          max: { $max: '$sellingPrice' },
        },
      },
    ]),
    CategoryModel.find({ status: 'active', isVisible: true })
      .sort({ position: 1, slug: 1 })
      .lean<CategoryFacetDoc[]>(),
  ]);

  const toFacets = (rows: Array<{ _id: string | number; count: number }>): FacetCount[] =>
    rows.map((row) => ({ value: String(row._id), count: row.count }));

  const countsBySlug = new Map(subcategoryRows.map((row) => [String(row._id), row.count]));

  const categories: CategoryView[] = categoryDocs.map((doc) => ({
    slug: doc.slug,
    displayName: doc.displayName,
    description: doc.description ?? '',
    position: doc.position,
    parentSlug: doc.parentSlug ?? null,
    isVisible: doc.isVisible,
    status: doc.status,
    sourceSubcategory: doc.sourceSubcategory ?? '',
    productCount: countsBySlug.get(doc.slug) ?? 0,
    children: [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }));

  return {
    categories,
    subcategories: toFacets(subcategoryRows),
    colours: toFacets(colourRows),
    sizes: toFacets(sizeRows),
    priceRange: {
      min: priceRows[0]?.min ?? 0,
      max: priceRows[0]?.max ?? 0,
    },
  };
}

/** A `productId` clause restricted to published designs. */
async function publishedProductIdClause(): Promise<Record<string, unknown>> {
  const rows = await ProductModel.find(PUBLISHED_CLAUSE)
    .select('_id')
    .lean<Array<{ _id: Types.ObjectId }>>();
  return { productId: { $in: rows.map((row) => row._id) } };
}

/* -------------------------------------------------------------------------- */
/* Public taxonomy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The category taxonomy as the storefront should render it.
 *
 * ## Why this is its own read
 *
 * The storefront needs the taxonomy in three places — the primary navigation,
 * the filter panel, and the homepage category grid — and it needs it *before*
 * it needs any products. Bundling it into `/facets` (which is also a
 * product-count query) meant the header could not render navigation until the
 * whole facet aggregation had completed, and a slow facet query degraded the
 * shell.
 *
 * This read is deliberately count-light: it joins the published product count
 * per slug with one aggregation, and it returns the tree.
 *
 * ## The rules
 *
 *  * **Only active, visible categories.** A retired or hidden category is
 *    absent — the storefront must not offer a destination the shop cannot
 *    serve, and the admin panel already models that distinction.
 *  * **Only categories that have a published product.** A visible but empty
 *    category is a doorway into "no results", which is the single most
 *    common cause of a shopper bouncing. It stays in the admin panel (where
 *    an administrator is building it out) and stays out of the shop.
 *  * **Parents before children, siblings by `position`.** The order an
 *    administrator set is the order the shop shows.
 */
export async function getPublicCategories(): Promise<readonly CategoryView[]> {
  const [docs, countRows] = await Promise.all([
    CategoryModel.find({ status: 'active', isVisible: true })
      .sort({ position: 1, slug: 1 })
      .lean<CategoryFacetDoc[]>(),
    ProductModel.aggregate<{ _id: string; count: number }>([
      { $match: PUBLISHED_CLAUSE },
      { $group: { _id: '$subcategorySlug', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = new Map(countRows.map((row) => [String(row._id), row.count]));

  const views: CategoryView[] = docs.map((doc) => ({
    slug: doc.slug,
    displayName: doc.displayName,
    description: doc.description ?? '',
    position: doc.position,
    parentSlug: doc.parentSlug ?? null,
    isVisible: doc.isVisible,
    status: doc.status,
    sourceSubcategory: doc.sourceSubcategory ?? '',
    productCount: counts.get(doc.slug) ?? 0,
    children: [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }));

  const present = new Set(views.map((view) => view.slug));
  const byParent = new Map<string | null, CategoryView[]>();

  for (const view of views) {
    // A category with a parent that did not survive the filter is promoted to
    // the root rather than vanishing — the same rule the admin tree uses.
    const parent = view.parentSlug && present.has(view.parentSlug) ? view.parentSlug : null;
    const bucket = byParent.get(parent) ?? [];
    bucket.push(view);
    byParent.set(parent, bucket);
  }

  const assemble = (parent: string | null): CategoryView[] => {
    const nodes = (byParent.get(parent) ?? []).sort(
      (a, b) => a.position - b.position || a.slug.localeCompare(b.slug),
    );

    const kept: CategoryView[] = [];
    for (const node of nodes) {
      const children = assemble(node.slug);
      /*
       * The pruning rule: an empty leaf is dropped, but an empty *parent*
       * whose children have products is kept, so a shopper can still reach
       * everything below it.
       */
      if (node.productCount === 0 && children.length === 0) continue;
      kept.push({ ...node, children });
    }
    return kept;
  };

  return assemble(null);
}

/** The category fields the facet read needs. */
interface CategoryFacetDoc {
  slug: string;
  displayName: string;
  description?: string;
  position: number;
  parentSlug?: string | null;
  isVisible: boolean;
  status: 'active' | 'retired';
  sourceSubcategory?: string;
  createdAt: Date;
  updatedAt: Date;
}
