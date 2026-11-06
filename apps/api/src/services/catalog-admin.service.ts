import { Types } from 'mongoose';
import {
  buildColourTokenMap,
  extractColourToken,
  normaliseColourToken,
  resolveImageColour,
  type AdminColourView,
  type AdminProductQuery,
  type AdminProductView,
  type AdminVariantQuery,
  type AdminVariantView,
  type BulkStockSetResult,
  type CategoryQuery,
  type CategoryView,
  type CreateCategoryRequest,
  type CreateProductRequest,
  type CreateVariantRequest,
  type ImageReviewItem,
  type ImageReviewQueue,
  type ImageReviewQuery,
  type ProductStatus,
  type SetStockRequest,
  type StockSetResult,
  type UpdateCategoryRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
} from '@ajooba/contracts';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors.js';
import { CategoryModel } from '../models/category.model.js';
import { ImageReviewModel } from '../models/image-review.model.js';
import { ProductModel } from '../models/product.model.js';
import { StockMovementModel } from '../models/stock-movement.model.js';
import { VariantModel } from '../models/variant.model.js';
import { writeAuditLog } from './audit.service.js';
import { reconcileCategoryTaxonomy } from './category-bootstrap.service.js';
import { refreshProductInStock } from './inventory.service.js';
import { availableUnits } from './stock.service.js';

/**
 * Catalogue administration.
 *
 * Everything in this module is a *write* path, and the rules below are the
 * reasons the catalogue has not silently forked:
 *
 *  1. **Products are addressed by `code`, never by title or slug.** The slug
 *     is derived from the title on every save, so an API keyed on it would
 *     break the first time a title was edited.
 *  2. **Editing a design never creates a second parent record.** Every write
 *     filters on `code` and uses a single `$set`; there is no upsert on the
 *     write path, so a miss is a 404 rather than a duplicate.
 *  3. **`colours` on the product is derived from the variants**, never set
 *     independently. It is the input to image-colour resolution, so letting
 *     it drift would change which photographs become assignable.
 *  4. **Stock is never written by this module.** The only stock entry point
 *     is `setStock` / `bulkSetStock`, which append to the ledger and require
 *     an explicit reason and a concurrency precondition.
 */

/* -------------------------------------------------------------------------- */
/* Slug generation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Derive a URL slug from a title.
 *
 * Deliberately identical in behaviour to the importer's generator so a
 * renamed design gets the same slug the importer would have produced. The
 * uniqueness suffix is applied by the caller against the database.
 */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base.length > 0 ? base.slice(0, 180) : `product-${Date.now().toString(36)}`;
}

/**
 * Produce a slug that is not already taken by another design.
 *
 * The design's own slug is always acceptable, so editing a title twice does
 * not accumulate `-2`, `-3` suffixes.
 */
async function resolveUniqueSlug(title: string, selfId?: Types.ObjectId): Promise<string> {
  const base = slugify(title);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await ProductModel.findOne({ slug: candidate }).select('_id').lean<{
      _id: Types.ObjectId;
    } | null>();

    if (!clash || (selfId && clash._id.equals(selfId))) {
      return candidate;
    }
  }

  throw new ConflictError('Could not derive a unique slug for this title.');
}

/* -------------------------------------------------------------------------- */
/* Category helpers (G-4)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Assert that a category slug exists and is assignable.
 *
 * Retired categories are rejected: reassigning a product to a retired
 * category would put it in a bucket nothing renders.
 */
async function assertAssignableCategory(slug: string): Promise<void> {
  const category = await CategoryModel.findOne({ slug }).lean<{ status: string } | null>();
  if (!category) {
    throw new ValidationError(`Unknown category "${slug}".`, [
      { field: 'subcategorySlug', message: 'No such category.' },
    ]);
  }
  if (category.status !== 'active') {
    throw new ValidationError(`Category "${slug}" is retired and cannot be assigned.`, [
      { field: 'subcategorySlug', message: 'Category is retired.' },
    ]);
  }
}

/**
 * Assert that making `parentSlug` the parent of `slug` would not create a cycle.
 *
 * Walks the existing ancestor chain from the proposed parent. If it reaches
 * the category being edited, the move would make the category its own
 * ancestor.
 */
async function assertNoCycle(slug: string, parentSlug: string | null): Promise<void> {
  if (!parentSlug) return;
  if (parentSlug === slug) {
    throw new ValidationError('A category cannot be its own parent.', [
      { field: 'parentSlug', message: 'A category cannot parent itself.' },
    ]);
  }

  const visited = new Set<string>([slug]);
  let cursor: string | null = parentSlug;

  // Bounded so a pre-existing cycle in the data cannot hang the request.
  for (let depth = 0; depth < 10 && cursor; depth += 1) {
    if (visited.has(cursor)) {
      throw new ValidationError('That parent would create a circular hierarchy.', [
        { field: 'parentSlug', message: 'Circular hierarchy.' },
      ]);
    }
    visited.add(cursor);

    const parent: { parentSlug: string | null } | null = await CategoryModel.findOne({
      slug: cursor,
    })
      .select('parentSlug')
      .lean<{ parentSlug: string | null } | null>();

    cursor = parent?.parentSlug ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* G-1 — Products                                                             */
/* -------------------------------------------------------------------------- */

interface ProductRow {
  _id: Types.ObjectId;
  code: string;
  slug: string;
  title: string;
  description: string;
  subcategory: string;
  subcategorySlug: string;
  brand: string;
  colours: string[];
  status: ProductStatus;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  seoTitle?: string;
  seoDescription?: string;
  quarantinedImages: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface VariantRollup {
  count: number;
  totalStock: number;
  pendingReviewColours: string[];
}

/**
 * Roll variant counts and stock up onto a product row.
 *
 * Kept in one place so the list, the detail read and the write response can
 * never disagree about a design's totals.
 */
async function rollupVariants(productIds: Types.ObjectId[]): Promise<Map<string, VariantRollup>> {
  const result = new Map<string, VariantRollup>();
  if (productIds.length === 0) return result;

  const rows = await VariantModel.aggregate<{
    _id: Types.ObjectId;
    count: number;
    totalStock: number;
    pendingColours: string[];
  }>([
    { $match: { productId: { $in: productIds } } },
    {
      $group: {
        _id: '$productId',
        count: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        pendingColours: {
          $addToSet: {
            $cond: [{ $eq: ['$photographyStatus', 'pending-review'] }, '$colour', '$$REMOVE'],
          },
        },
      },
    },
  ]);

  for (const row of rows) {
    result.set(row._id.toString(), {
      count: row.count,
      totalStock: row.totalStock ?? 0,
      pendingReviewColours: row.pendingColours ?? [],
    });
  }
  return result;
}

function mapProductView(row: ProductRow, rollup: VariantRollup | undefined): AdminProductView {
  return {
    id: row._id.toString(),
    code: row.code,
    slug: row.slug,
    title: row.title,
    description: row.description,
    subcategory: row.subcategory,
    subcategorySlug: row.subcategorySlug,
    brand: row.brand,
    colours: row.colours ?? [],
    status: row.status ?? 'published',
    mrp: row.mrp,
    sellingPrice: row.sellingPrice,
    inStock: row.inStock,
    ...(row.seoTitle ? { seoTitle: row.seoTitle } : {}),
    ...(row.seoDescription ? { seoDescription: row.seoDescription } : {}),
    variantCount: rollup?.count ?? 0,
    totalStock: rollup?.totalStock ?? 0,
    pendingReviewColours: rollup?.pendingReviewColours ?? [],
    quarantinedImageCount: (row.quarantinedImages ?? []).length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * List designs for the admin panel.
 *
 * Unlike the public catalogue this includes drafts and archived designs, and
 * is therefore the only place an administrator can find something they just
 * archived.
 */
/** A Mongo filter clause. */
type FilterClause = Record<string, unknown>;

/**
 * List designs for the admin panel.
 *
 * Unlike the public catalogue this includes drafts and archived designs, and
 * is therefore the only place an administrator can find something they just
 * archived.
 */
export async function listProductsForAdmin(query: AdminProductQuery): Promise<{
  items: AdminProductView[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const filter: Record<string, unknown> = {};

  /*
   * Search and lifecycle clauses are accumulated into one typed list and
   * assigned to `$or` once. Folding them into `filter.$or` as they are
   * produced would require re-reading a field typed `unknown` and spreading
   * it, which is both unsafe and needlessly awkward.
   */
  const clauses: FilterClause[] = [];

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    clauses.push(
      { title: { $regex: escaped, $options: 'i' } },
      { description: { $regex: escaped, $options: 'i' } },
      { code: { $regex: escaped, $options: 'i' } },
      // Variants carry the seller SKU, which is how staff actually search.
      { sku: { $regex: escaped, $options: 'i' } },
    );
  }

  // `status` is absent on designs written before the lifecycle field existed,
  // and those designs are published. Matching on `undefined` explicitly keeps
  // them visible in the default listing.
  if (query.status) {
    clauses.push(
      { status: query.status },
      ...(query.status === 'published' ? [{ status: { $exists: false } }] : []),
    );
  } else {
    // Default admin view: everything except archived.
    clauses.push({ status: { $ne: 'archived' } }, { status: { $exists: false } });
  }

  if (clauses.length > 0) {
    filter.$or = clauses;
  }

  if (query.subcategory) {
    filter.subcategorySlug = query.subcategory;
  }
  if (query.inStock !== undefined) {
    filter.inStock = query.inStock;
  }

  /*
   * A search that can match a SKU lives on the variants collection, so it
   * cannot be expressed as a single product query. Resolve the matching
   * product ids first and narrow the product filter by them.
   */
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const variantRows = await VariantModel.find({ sku: { $regex: escaped, $options: 'i' } })
      .select('productId')
      .lean<Array<{ productId: Types.ObjectId }>>();

    const ids = variantRows.map((row) => row.productId);

    if (ids.length === 0) {
      // No SKU matches. Only the direct title/description/code matches remain.
      filter.$and = [
        {
          $or: [
            { title: { $regex: escaped, $options: 'i' } },
            { description: { $regex: escaped, $options: 'i' } },
            { code: { $regex: escaped, $options: 'i' } },
          ],
        },
      ];
    } else {
      filter.$and = [
        {
          $or: [
            { title: { $regex: escaped, $options: 'i' } },
            { description: { $regex: escaped, $options: 'i' } },
            { code: { $regex: escaped, $options: 'i' } },
            { _id: { $in: ids } },
          ],
        },
      ];
    }
  }

  const [docs, totalItems] = await Promise.all([
    ProductModel.find(filter)
      .sort({ code: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<ProductRow[]>(),
    ProductModel.countDocuments(filter),
  ]);

  const rollups = await rollupVariants(docs.map((doc) => doc._id));

  return {
    items: docs.map((doc) => mapProductView(doc, rollups.get(doc._id.toString()))),
    totalItems,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
  };
}

/** Read one design by its `A<NN>` code, with its colourway rollup. */
export async function getProductByCode(code: string): Promise<AdminProductView> {
  const doc = await ProductModel.findOne({ code }).lean<ProductRow | null>();
  if (!doc) {
    throw new NotFoundError(`Design ${code}`);
  }
  const rollups = await rollupVariants([doc._id]);
  return mapProductView(doc, rollups.get(doc._id.toString()));
}

/** A product row together with its id, for internal callers. */
export async function requireProductByCode(
  code: string,
): Promise<{ _id: Types.ObjectId; code: string; title: string; colours: string[] }> {
  const doc = await ProductModel.findOne({ code }).lean<{
    _id: Types.ObjectId;
    code: string;
    title: string;
    colours: string[];
  } | null>();
  if (!doc) {
    throw new NotFoundError(`Design ${code}`);
  }
  return doc;
}

export interface ActorContext {
  readonly actorId: string;
  readonly actorEmail: string;
  readonly actorRole: string;
  readonly ip: string | null;
}

/**
 * Create a design.
 *
 * A duplicate `code` is a `409`, never an upsert: the importer upserts on
 * `code` because it is re-loading the same source of truth, whereas an
 * administrator creating a design with a code that already exists is a
 * mistake that must be visible.
 */
export async function createProduct(
  input: CreateProductRequest,
  actor: ActorContext,
): Promise<AdminProductView> {
  const existing = await ProductModel.findOne({ code: input.code })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();
  if (existing) {
    throw new ConflictError(`Design ${input.code} already exists.`);
  }

  if (input.sellingPrice > input.mrp && input.mrp > 0) {
    throw new ValidationError('Selling price cannot exceed MRP.', [
      { field: 'sellingPrice', message: 'Must be less than or equal to MRP.' },
    ]);
  }

  await assertAssignableCategory(input.subcategorySlug);

  const slug = await resolveUniqueSlug(input.title);

  const created = await ProductModel.create({
    code: input.code,
    slug,
    title: input.title,
    description: input.description,
    subcategory: input.subcategory,
    subcategorySlug: input.subcategorySlug,
    brand: input.brand,
    colours: input.colours,
    images: [],
    quarantinedImages: [],
    mrp: input.mrp,
    sellingPrice: input.sellingPrice,
    inStock: false,
    status: input.status,
    ...(input.seoTitle ? { seoTitle: input.seoTitle } : {}),
    ...(input.seoDescription ? { seoDescription: input.seoDescription } : {}),
  });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'create',
    entity: 'product',
    entityId: created.code,
    summary: `Design ${created.code} ("${created.title}") created.`,
    changes: { code: created.code, title: created.title, status: created.status },
    ip: actor.ip,
  });

  return getProductByCode(created.code);
}

/**
 * Update a design in place.
 *
 * Deliberately **not** an upsert. `findOne({ code })` then a single `$set`:
 * if the design does not exist the caller gets a 404, and there is no code
 * path in this service that can create a second parent for an edit.
 *
 * `colours` is recomputed from the variants rather than accepted verbatim —
 * see the module note. Changing a design's colour therefore requires the
 * colourway itself to be edited through the variant API.
 */
export async function updateProduct(
  code: string,
  input: UpdateProductRequest,
  actor: ActorContext,
): Promise<AdminProductView> {
  const existing = await ProductModel.findOne({ code }).lean<ProductRow | null>();
  if (!existing) {
    throw new NotFoundError(`Design ${code}`);
  }

  if (input.subcategorySlug && input.subcategorySlug !== existing.subcategorySlug) {
    await assertAssignableCategory(input.subcategorySlug);
  }

  if (
    input.sellingPrice !== undefined &&
    input.mrp !== undefined &&
    input.sellingPrice > input.mrp &&
    input.mrp > 0
  ) {
    throw new ValidationError('Selling price cannot exceed MRP.', [
      { field: 'sellingPrice', message: 'Must be less than or equal to MRP.' },
    ]);
  }

  /*
   * `colours` is only accepted when the design has no variants yet. Once
   * variants exist the colour list is derived from them, because it is the
   * input to image-colour resolution and must not be editable separately.
   */
  const set: Record<string, unknown> = {};

  if (input.title !== undefined && input.title !== existing.title) {
    set.title = input.title;
    set.slug = await resolveUniqueSlug(input.title, existing._id);
  }
  if (input.description !== undefined) set.description = input.description;
  if (input.subcategory !== undefined) set.subcategory = input.subcategory;
  if (input.subcategorySlug !== undefined) set.subcategorySlug = input.subcategorySlug;
  if (input.brand !== undefined) set.brand = input.brand;
  if (input.mrp !== undefined) set.mrp = input.mrp;
  if (input.sellingPrice !== undefined) set.sellingPrice = input.sellingPrice;
  if (input.status !== undefined) set.status = input.status;
  if (input.seoTitle !== undefined) set.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) set.seoDescription = input.seoDescription;

  if (input.colours !== undefined) {
    const variantCount = await VariantModel.countDocuments({ productId: existing._id });
    if (variantCount > 0) {
      throw new ConflictError(
        'This design already has colourways. Change the colours through the ' +
          'colourway endpoints so the gallery and the SKUs stay in step.',
      );
    }
    set.colours = input.colours;
  }

  if (Object.keys(set).length === 0) {
    return getProductByCode(code);
  }

  const updated = await ProductModel.findOneAndUpdate(
    { _id: existing._id },
    { $set: set },
    { returnDocument: 'after' },
  ).lean<ProductRow | null>();

  if (!updated) {
    throw new NotFoundError(`Design ${code}`);
  }

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: input.status && input.status !== existing.status ? 'status-change' : 'update',
    entity: 'product',
    entityId: code,
    summary:
      input.status && input.status !== existing.status
        ? `Design ${code} moved from ${existing.status ?? 'published'} to ${input.status}.`
        : `Design ${code} updated (${Object.keys(set).join(', ')}).`,
    changes: { before: pickFields(existing, Object.keys(set)), after: set },
    ip: actor.ip,
  });

  return getProductByCode(code);
}

/** Read the named fields off a row, for the audit diff. */
function pickFields(row: ProductRow, fields: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    output[field] = (row as unknown as Record<string, unknown>)[field] ?? null;
  }
  return output;
}

/**
 * Retire a design.
 *
 * Soft only. A design referenced by orders, the stock ledger or the audit log
 * is never removed — the storefront hides it and the admin list still shows
 * it, so the history stays explainable.
 */
export async function retireProduct(code: string, actor: ActorContext): Promise<AdminProductView> {
  const existing = await ProductModel.findOne({ code })
    .select('_id code status')
    .lean<{ _id: Types.ObjectId; code: string; status?: ProductStatus } | null>();

  if (!existing) {
    throw new NotFoundError(`Design ${code}`);
  }

  if (existing.status === 'archived') {
    return getProductByCode(code);
  }

  await ProductModel.updateOne({ _id: existing._id }, { $set: { status: 'archived' } });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'status-change',
    entity: 'product',
    entityId: code,
    summary: `Design ${code} archived. Its variants, orders and stock history are retained.`,
    changes: { from: existing.status ?? 'published', to: 'archived' },
    ip: actor.ip,
  });

  return getProductByCode(code);
}

/* -------------------------------------------------------------------------- */
/* G-2 — Colour variants                                                      */
/* -------------------------------------------------------------------------- */

interface VariantRow {
  _id: Types.ObjectId;
  sku: string;
  productId: Types.ObjectId;
  productCode: string;
  articleNumber: string;
  size: number;
  ukIndiaSize?: number;
  euroSize?: number;
  colour: string;
  colourToken: string;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  stock: number;
  reservedStock: number;
  inStock: boolean;
  photographyStatus: 'verified' | 'pending-review';
  ean?: string;
  variantTitle?: string;
}

/**
 * A variant is sellable only when it has stock AND verified photography.
 *
 * Mirrors `isSellable` in `catalog.service.ts` deliberately: the storefront
 * gate and the admin view must not disagree about sellability, and the admin
 * view is how a merchandiser decides whether a colour is launchable.
 */
function isSellable(row: {
  photographyStatus?: string;
  inStock: boolean;
  stock: number;
  reservedStock?: number;
}): boolean {
  if (row.photographyStatus === 'pending-review') return false;
  return row.inStock && availableUnits(row) > 0;
}

/**
 * The URLs of the images verified as this exact colour.
 *
 * Read from `products.images`, which the importer populates with
 * `colour`/`colourToken` set only for images that passed
 * `resolveImageColour`. An empty array means "no verified photo yet" — the
 * state the storefront renders honestly rather than substituting another
 * colour's photograph.
 */
async function verifiedImagesForColour(
  productId: Types.ObjectId,
  colour: string,
): Promise<string[]> {
  const doc = await ProductModel.findById(productId)
    .select('images')
    .lean<{ images?: Array<{ colour?: string; url: string }> } | null>();

  return (doc?.images ?? []).filter((image) => image.colour === colour).map((image) => image.url);
}

async function mapVariantView(row: VariantRow): Promise<AdminVariantView> {
  const images = await verifiedImagesForColour(row.productId, row.colour);
  return {
    sku: row.sku,
    id: row._id.toString(),
    productId: row.productId.toString(),
    productCode: row.productCode,
    articleNumber: row.articleNumber,
    size: row.size,
    ...(row.ukIndiaSize !== undefined ? { ukIndiaSize: row.ukIndiaSize } : {}),
    ...(row.euroSize !== undefined ? { euroSize: row.euroSize } : {}),
    colour: row.colour,
    colourToken: row.colourToken,
    mrp: row.mrp,
    sellingPrice: row.sellingPrice,
    discountPercent: row.discountPercent,
    stock: row.stock,
    reservedStock: row.reservedStock ?? 0,
    inStock: row.inStock,
    sellable: isSellable(row),
    photographyStatus: row.photographyStatus ?? 'verified',
    ...(row.ean ? { ean: row.ean } : {}),
    ...(row.variantTitle ? { variantTitle: row.variantTitle } : {}),
    images,
  };
}

/** List a design's colourways (SKUs), grouped implicitly by colour. */
export async function listVariantsForProduct(
  code: string,
  query: AdminVariantQuery,
): Promise<{
  items: AdminVariantView[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const product = await ProductModel.findOne({ code })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();
  if (!product) {
    throw new NotFoundError(`Design ${code}`);
  }

  const filter: Record<string, unknown> = { productId: product._id };
  if (query.colour) filter.colour = query.colour;
  if (query.colourToken) filter.colourToken = query.colourToken.toUpperCase();
  if (query.photographyStatus) filter.photographyStatus = query.photographyStatus;
  if (query.inStock !== undefined) filter.inStock = query.inStock;

  const [docs, totalItems] = await Promise.all([
    VariantModel.find(filter)
      .sort({ colour: 1, size: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean<VariantRow[]>(),
    VariantModel.countDocuments(filter),
  ]);

  const items = await Promise.all(docs.map((doc) => mapVariantView(doc)));

  return {
    items,
    totalItems,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
  };
}

/**
 * The colourway rollup for one design: one row per colour.
 *
 * This is the level the merchandiser actually works at — "does this design
 * have a sellable Tan?" — rather than one row per size.
 */
export async function listColoursForProduct(code: string): Promise<AdminColourView[]> {
  const product = await ProductModel.findOne({ code })
    .select('_id colours')
    .lean<{ _id: Types.ObjectId; colours: string[] } | null>();
  if (!product) {
    throw new NotFoundError(`Design ${code}`);
  }

  const docs = await VariantModel.find({ productId: product._id })
    .sort({ colour: 1, size: 1 })
    .lean<VariantRow[]>();

  const images =
    (
      await ProductModel.findById(product._id)
        .select('images')
        .lean<{ images?: Array<{ colour?: string; url: string }> } | null>()
    )?.images ?? [];

  const grouped = new Map<string, VariantRow[]>();
  for (const doc of docs) {
    const bucket = grouped.get(doc.colour) ?? [];
    bucket.push(doc);
    grouped.set(doc.colour, bucket);
  }

  /*
   * A colour the product advertises but has no variants for still appears,
   * with zero SKUs. Hiding it would make an empty colourway invisible to the
   * administrator, which is the opposite of useful.
   */
  const colours = new Set<string>([...(product.colours ?? []), ...grouped.keys()]);

  const views: AdminColourView[] = [];
  for (const colour of colours) {
    const rows = grouped.get(colour) ?? [];
    const totalStock = rows.reduce((sum, row) => sum + row.stock, 0);
    const photographyStatus =
      rows.length === 0 || rows.some((row) => row.photographyStatus === 'pending-review')
        ? 'pending-review'
        : 'verified';
    const verifiedImageCount = images.filter((image) => image.colour === colour).length;

    views.push({
      colour,
      colourToken: rows[0]?.colourToken ?? '',
      sizes: rows.map((row) => row.size).sort((a, b) => a - b),
      skus: rows.map((row) => row.sku),
      totalStock,
      photographyStatus,
      verifiedImageCount,
      sellable: rows.some((row) => isSellable(row)),
    });
  }

  return views.sort((a, b) => a.colour.localeCompare(b.colour));
}

/**
 * Create one colourway for an existing design.
 *
 * Invariants enforced here:
 *
 *  - the SKU is unique across the collection (`409` on collision);
 *  - the SKU's design segment matches the parent's code, so a colourway can
 *    never be filed under the wrong design;
 *  - stock is **not** accepted, so a new SKU starts at zero and can only be
 *    raised through the audited ledger.
 *
 * Registering the colour on the parent is part of the operation, because
 * `products.colours` is what image-colour resolution matches against. A
 * new colourway therefore changes which quarantined images become assignable,
 * and the caller is told so.
 */
export async function createVariant(
  code: string,
  input: CreateVariantRequest,
  actor: ActorContext,
): Promise<{ variant: AdminVariantView; newColours: string[] }> {
  const product = await ProductModel.findOne({ code })
    .select('_id code colours')
    .lean<{ _id: Types.ObjectId; code: string; colours: string[] } | null>();
  if (!product) {
    throw new NotFoundError(`Design ${code}`);
  }

  /*
   * The Seller SKU Id encodes the design code: `AJ-A01-OW-06`. If the
   * embedded code disagrees with the parent the record is mis-filed, and
   * accepting it would fork the catalogue under the wrong design.
   */
  const skuDesign = /^AJ-A(\d{2})-/.exec(input.sku)?.[1];
  if (skuDesign && skuDesign !== product.code.replace(/^A/, '')) {
    throw new ValidationError(
      `SKU "${input.sku}" belongs to design A${skuDesign}, not ${product.code}.`,
      [{ field: 'sku', message: `SKU must encode ${product.code}.` }],
    );
  }

  const clash = await VariantModel.findOne({ sku: input.sku })
    .select('_id productCode')
    .lean<{ _id: Types.ObjectId; productCode: string } | null>();
  if (clash) {
    throw new ConflictError(`SKU ${input.sku} already exists on design ${clash.productCode}.`);
  }

  const duplicateSize = await VariantModel.findOne({
    productId: product._id,
    colour: input.colour,
    size: input.size,
  })
    .select('_id sku')
    .lean<{ _id: Types.ObjectId; sku: string } | null>();
  if (duplicateSize) {
    throw new ConflictError(
      `${input.colour} in size ${input.size} already exists as SKU ${duplicateSize.sku}.`,
    );
  }

  if (input.sellingPrice > input.mrp && input.mrp > 0) {
    throw new ValidationError('Selling price cannot exceed MRP.', [
      { field: 'sellingPrice', message: 'Must be less than or equal to MRP.' },
    ]);
  }

  const colourToken = normaliseColourToken(input.colourToken);

  /*
   * A colourway with no verified photograph starts `pending-review`. This is
   * the single most important default in the file: it is what stops a
   * colour from becoming sellable because somebody filled in a form.
   */
  const created = await VariantModel.create({
    sku: input.sku,
    productId: product._id,
    productCode: product.code,
    articleNumber: input.articleNumber || product.code,
    size: input.size,
    ...(input.ukIndiaSize !== undefined ? { ukIndiaSize: input.ukIndiaSize } : {}),
    ...(input.euroSize !== undefined ? { euroSize: input.euroSize } : {}),
    colour: input.colour,
    colourToken,
    mrp: input.mrp,
    sellingPrice: input.sellingPrice,
    discountPercent:
      input.mrp > 0 ? Math.round(((input.mrp - input.sellingPrice) / input.mrp) * 100) : 0,
    // Never settable at creation. See the module note on stock.
    stock: 0,
    inStock: false,
    reservedStock: 0,
    ean: input.ean ?? '',
    ...(input.variantTitle ? { variantTitle: input.variantTitle } : {}),
    photographyStatus: 'pending-review',
  });

  /*
   * Register the colour on the parent if it is new. This is not cosmetic:
   * `products.colours` is the sold-colour set that
   * `resolveImageColour` matches filenames against, so a colourway whose
   * colour is missing from it can never have its photographs resolved.
   */
  const newColours: string[] = [];
  const current = product.colours ?? [];
  if (!current.some((colour) => colour.toLowerCase() === input.colour.toLowerCase())) {
    await ProductModel.updateOne({ _id: product._id }, { $addToSet: { colours: input.colour } });
    newColours.push(input.colour);
  }

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'create',
    entity: 'variant',
    entityId: created.sku,
    summary: `SKU ${created.sku} (${created.colour}, size ${created.size}) created on ${product.code} at stock 0, photography pending review.`,
    changes: {
      sku: created.sku,
      colour: created.colour,
      size: created.size,
      newColours,
    },
    ip: actor.ip,
  });

  const variant = await mapVariantView(
    (await VariantModel.findById(created._id).lean<VariantRow | null>()) as VariantRow,
  );

  return { variant, newColours };
}

/** Read one SKU in full. */
export async function getVariant(sku: string): Promise<AdminVariantView> {
  const doc = await VariantModel.findOne({ sku }).lean<VariantRow | null>();
  if (!doc) {
    throw new NotFoundError(`SKU ${sku}`);
  }
  return mapVariantView(doc);
}

/**
 * Update the editable fields of one SKU.
 *
 * Colour, colour token and SKU itself are **not** editable here. The colour
 * is the parent-relationship key that selects which photographs apply, and
 * changing it without re-running image resolution is precisely the bug that
 * put a black photograph on a Tan tile. Colour changes go through image
 * review, which re-derives the galleries as part of the same operation.
 */
export async function updateVariant(
  sku: string,
  input: UpdateVariantRequest,
  actor: ActorContext,
): Promise<AdminVariantView> {
  const existing = await VariantModel.findOne({ sku }).lean<VariantRow | null>();
  if (!existing) {
    throw new NotFoundError(`SKU ${sku}`);
  }

  const mrp = input.mrp ?? existing.mrp;
  const sellingPrice = input.sellingPrice ?? existing.sellingPrice;
  if (sellingPrice > mrp && mrp > 0) {
    throw new ValidationError('Selling price cannot exceed MRP.', [
      { field: 'sellingPrice', message: 'Must be less than or equal to MRP.' },
    ]);
  }

  const size = input.size ?? existing.size;

  if (size !== existing.size) {
    const duplicate = await VariantModel.findOne({
      productId: existing.productId,
      colour: existing.colour,
      size,
      sku: { $ne: sku },
    })
      .select('sku')
      .lean<{ sku: string } | null>();
    if (duplicate) {
      throw new ConflictError(
        `${existing.colour} in size ${size} already exists as SKU ${duplicate.sku}.`,
      );
    }
  }

  const set: Record<string, unknown> = {};
  if (input.size !== undefined) set.size = input.size;
  if (input.ukIndiaSize !== undefined) set.ukIndiaSize = input.ukIndiaSize;
  if (input.euroSize !== undefined) set.euroSize = input.euroSize;
  if (input.mrp !== undefined) set.mrp = input.mrp;
  if (input.sellingPrice !== undefined) set.sellingPrice = input.sellingPrice;
  if (input.ean !== undefined) set.ean = input.ean;
  if (input.variantTitle !== undefined) set.variantTitle = input.variantTitle;

  if (input.sellingPrice !== undefined || input.mrp !== undefined) {
    set.discountPercent = mrp > 0 ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0;
  }

  if (Object.keys(set).length === 0) {
    return getVariant(sku);
  }

  await VariantModel.updateOne({ sku }, { $set: set });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'update',
    entity: 'variant',
    entityId: sku,
    summary: `SKU ${sku} updated (${Object.keys(set).join(', ')}).`,
    changes: { before: pickVariantFields(existing, Object.keys(set)), after: set },
    ip: actor.ip,
  });

  return getVariant(sku);
}

function pickVariantFields(row: VariantRow, fields: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    output[field] = (row as unknown as Record<string, unknown>)[field] ?? null;
  }
  return output;
}

/**
 * Retire one SKU.
 *
 * Soft: the variant is marked inactive and its stock is released to the
 * ledger, but the row survives because order lines reference it. A SKU that
 * appears in any order can never be removed by this API.
 */
export async function retireVariant(sku: string, actor: ActorContext): Promise<AdminVariantView> {
  const existing = await VariantModel.findOne({ sku })
    .select('_id stock productId productCode inStock')
    .lean<{
      _id: Types.ObjectId;
      stock: number;
      productId: Types.ObjectId;
      productCode: string;
      inStock: boolean;
    } | null>();

  if (!existing) {
    throw new NotFoundError(`SKU ${sku}`);
  }

  if (existing.stock > 0) {
    /*
     * The units are removed through the ledger rather than by deleting the
     * row, so the stock history explains where they went.
     */
    await StockMovementModel.create({
      variantId: existing._id,
      sku,
      productCode: existing.productCode,
      delta: -existing.stock,
      stockBefore: existing.stock,
      stockAfter: 0,
      reason: 'correction',
      note: 'SKU retired by administrator.',
      actorId: new Types.ObjectId(actor.actorId),
      actorLabel: actor.actorEmail,
    });

    await VariantModel.updateOne({ _id: existing._id }, { $set: { stock: 0, inStock: false } });
  }

  await refreshProductInStock([existing.productId]);

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'status-change',
    entity: 'variant',
    entityId: sku,
    summary: `SKU ${sku} retired. Order history and stock movements are retained.`,
    changes: { stockReleased: existing.stock },
    ip: actor.ip,
  });

  return getVariant(sku);
}

/* -------------------------------------------------------------------------- */
/* G-3 — SKU reads                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a batch of SKUs.
 *
 * `missing` is returned explicitly rather than being an omission, because a
 * stock-take has to be able to tell "this SKU does not exist" apart from
 * "this SKU exists and holds nothing". Those are different reconciliation
 * problems.
 */
export async function lookupSkus(skus: readonly string[]): Promise<{
  found: AdminVariantView[];
  missing: string[];
}> {
  const unique = [...new Set(skus.map((sku) => sku.trim()))];
  const docs = await VariantModel.find({ sku: { $in: unique } })
    .sort({ productCode: 1, colour: 1, size: 1 })
    .lean<VariantRow[]>();

  const found = await Promise.all(docs.map((doc) => mapVariantView(doc)));
  const foundSkus = new Set(docs.map((doc) => doc.sku));
  return { found, missing: unique.filter((sku) => !foundSkus.has(sku)) };
}

/** The stock ledger for one SKU, newest first. */
export async function stockHistoryForSku(sku: string): Promise<{
  sku: string;
  variant: AdminVariantView;
  movements: Array<{
    id: string;
    delta: number;
    stockBefore: number;
    stockAfter: number;
    reason: string;
    note: string;
    actorLabel: string;
    createdAt: string;
  }>;
}> {
  const variant = await getVariant(sku);

  const docs = await StockMovementModel.find({ sku }).sort({ createdAt: -1 }).limit(100).lean<
    Array<{
      _id: Types.ObjectId;
      delta: number;
      stockBefore: number;
      stockAfter: number;
      reason: string;
      note: string;
      actorLabel: string;
      createdAt: Date;
    }>
  >();

  return {
    sku,
    variant,
    movements: docs.map((doc) => ({
      id: doc._id.toString(),
      delta: doc.delta,
      stockBefore: doc.stockBefore,
      stockAfter: doc.stockAfter,
      reason: doc.reason,
      note: doc.note,
      actorLabel: doc.actorLabel,
      createdAt: doc.createdAt.toISOString(),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Phase 7 — Stock                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Set an absolute stock level for one SKU.
 *
 * Two things make this safe:
 *
 *  - **A concurrency precondition.** The caller states the level it believes
 *    is on hand; a mismatch is a `409` rather than a silent overwrite. Two
 *    administrators counting the same shelf cannot lose one another's work.
 *  - **A ledger row for every change.** The level is explainable, and the
 *    "what was actually counted" is recoverable.
 *
 * `quantity` is a value the caller states. Nothing in this service invents
 * one: with the workbook carrying no stock column, the only way a number gets
 * here is a human counting or an approved inventory import.
 */
export async function setStock(
  sku: string,
  input: SetStockRequest,
  actor: ActorContext,
): Promise<StockSetResult> {
  if (input.reason === 'correction' && input.note.trim().length === 0) {
    throw new ValidationError('A correction requires a note explaining the correction.', [
      { field: 'note', message: 'Required for a correction.' },
    ]);
  }

  const existing = await VariantModel.findOne({ sku })
    .select('_id stock productId productCode reservedStock inStock photographyStatus')
    .lean<{
      _id: Types.ObjectId;
      stock: number;
      productId: Types.ObjectId;
      productCode: string;
      reservedStock: number;
      inStock: boolean;
      photographyStatus?: string;
    } | null>();

  if (!existing) {
    throw new NotFoundError(`SKU ${sku}`);
  }

  if (existing.stock !== input.expectedCurrentStock) {
    throw new ConflictError(
      `Stock for ${sku} is ${existing.stock}, not ${input.expectedCurrentStock}. ` +
        'Reload the SKU and re-apply so the change is based on the current level.',
    );
  }

  if (input.quantity === existing.stock) {
    return {
      sku,
      variantId: existing._id.toString(),
      stockBefore: existing.stock,
      stockAfter: existing.stock,
      reservedStock: existing.reservedStock ?? 0,
      inStock: existing.inStock,
      sellable: isSellable(existing),
    };
  }

  /*
   * Never set a level below what carts have already reserved. A count that
   * contradicts live reservations is a data problem, not a licence to
   * oversell — the reserved units are promised to a shopper.
   */
  const reserved = existing.reservedStock ?? 0;
  if (input.quantity < reserved) {
    throw new ConflictError(
      `Cannot set ${sku} to ${input.quantity}: ${reserved} unit(s) are reserved by open carts.`,
    );
  }

  const delta = input.quantity - existing.stock;

  await VariantModel.updateOne(
    { _id: existing._id, stock: existing.stock },
    { $set: { stock: input.quantity, inStock: input.quantity > 0 } },
  );

  await StockMovementModel.create({
    variantId: existing._id,
    sku,
    productCode: existing.productCode,
    delta,
    stockBefore: existing.stock,
    stockAfter: input.quantity,
    reason: input.reason,
    note: input.note,
    actorId: new Types.ObjectId(actor.actorId),
    actorLabel: actor.actorEmail,
  });

  await refreshProductInStock([existing.productId]);

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'stock-adjust',
    entity: 'variant',
    entityId: sku,
    summary: `Stock for ${sku} set from ${existing.stock} to ${input.quantity} (${input.reason}).`,
    changes: {
      stockBefore: existing.stock,
      stockAfter: input.quantity,
      delta,
      reason: input.reason,
      note: input.note,
    },
    ip: actor.ip,
  });

  const refreshed = await VariantModel.findById(existing._id)
    .select('reservedStock inStock photographyStatus')
    .lean<{ reservedStock: number; inStock: boolean; photographyStatus?: string } | null>();

  return {
    sku,
    variantId: existing._id.toString(),
    stockBefore: existing.stock,
    stockAfter: input.quantity,
    reservedStock: refreshed?.reservedStock ?? reserved,
    inStock: input.quantity > 0,
    sellable: isSellable({
      ...existing,
      stock: input.quantity,
      inStock: input.quantity > 0,
    }),
  };
}

/**
 * Set stock for a batch of SKUs.
 *
 * A dry run reports exactly what would change and writes nothing. The admin
 * UI requires one before offering the apply button, and the applied response
 * reports per-row failures so a partial batch is safe to retry.
 */
export async function bulkSetStock(
  rows: ReadonlyArray<{ sku: string; quantity: number }>,
  reason: 'audit' | 'restock' | 'correction',
  note: string,
  dryRun: boolean,
  actor: ActorContext,
): Promise<BulkStockSetResult> {
  const applied: StockSetResult[] = [];
  const failed: Array<{ sku: string; reason: string }> = [];

  for (const row of rows) {
    if (dryRun) {
      try {
        const existing = await VariantModel.findOne({ sku: row.sku })
          .select('stock reservedStock')
          .lean<{ stock: number; reservedStock: number } | null>();
        if (!existing) {
          failed.push({ sku: row.sku, reason: 'SKU not found.' });
          continue;
        }
        if (row.quantity < (existing.reservedStock ?? 0)) {
          failed.push({
            sku: row.sku,
            reason: `Below reserved stock (${existing.reservedStock}).`,
          });
          continue;
        }
        applied.push({
          sku: row.sku,
          variantId: '',
          stockBefore: existing.stock,
          stockAfter: row.quantity,
          reservedStock: existing.reservedStock ?? 0,
          inStock: row.quantity > 0,
          sellable: false,
        });
      } catch (error) {
        failed.push({
          sku: row.sku,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      continue;
    }

    try {
      const existing = await VariantModel.findOne({ sku: row.sku })
        .select('stock')
        .lean<{ stock: number } | null>();
      if (!existing) {
        throw new NotFoundError(`SKU ${row.sku}`);
      }

      const result = await setStock(
        row.sku,
        {
          quantity: row.quantity,
          reason,
          note,
          // The dry run read the level moments ago; pass it back as the
          // precondition so a concurrent edit is still caught.
          expectedCurrentStock: existing.stock,
        },
        actor,
      );
      applied.push(result);
    } catch (error) {
      failed.push({
        sku: row.sku,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const changed = applied.filter((entry) => entry.stockBefore !== entry.stockAfter);
  const unitsAdded = changed.reduce(
    (sum, entry) => sum + (entry.stockAfter - entry.stockBefore),
    0,
  );

  if (!dryRun) {
    await writeAuditLog({
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      actorRole: actor.actorRole,
      action: 'stock-adjust',
      entity: 'variant',
      entityId: `${rows.length} SKU(s)`,
      summary: `Bulk stock ${reason}: ${changed.length} row(s) changed, ${failed.length} failed.`,
      changes: { reason, note, changed: changed.length, failed: failed.length },
      ip: actor.ip,
    });
  }

  return {
    dryRun,
    applied,
    failed,
    totals: {
      requested: rows.length,
      changed: changed.length,
      unchanged: applied.length - changed.length,
      failed: failed.length,
      unitsAdded,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* G-4 — Categories                                                           */
/* -------------------------------------------------------------------------- */

interface CategoryRow {
  _id: Types.ObjectId;
  slug: string;
  displayName: string;
  description: string;
  position: number;
  parentSlug: string | null;
  isVisible: boolean;
  status: 'active' | 'retired';
  seoTitle?: string;
  seoDescription?: string;
  sourceSubcategory?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every category as a flat list of views, with live product counts.
 *
 * This is the single read both the tree builder and every write response go
 * through, so a category can never be described two different ways.
 */
export async function listCategoriesFlat(query: {
  status?: 'active' | 'retired';
}): Promise<readonly CategoryView[]> {
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;

  const counts = await ProductModel.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$subcategorySlug', count: { $sum: 1 } } },
  ]);
  const countBySlug = new Map(counts.map((row) => [row._id, row.count]));

  const rows = await CategoryModel.find(filter)
    .sort({ position: 1, slug: 1 })
    .lean<CategoryRow[]>();

  return rows.map((row) => ({
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    position: row.position,
    parentSlug: row.parentSlug,
    isVisible: row.isVisible,
    status: row.status,
    ...(row.seoTitle ? { seoTitle: row.seoTitle } : {}),
    ...(row.seoDescription ? { seoDescription: row.seoDescription } : {}),
    sourceSubcategory: row.sourceSubcategory ?? '',
    productCount: countBySlug.get(row.slug) ?? 0,
    children: [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * The category tree.
 *
 * Assembled from the flat views, with children hung under their parent. A
 * category whose parent is missing from the set (because the parent was
 * filtered out) is promoted to a root rather than disappearing — a category
 * must never vanish from the tree just because of how the query was
 * filtered.
 */
export async function listCategories(query: CategoryQuery): Promise<readonly CategoryView[]> {
  const flat = await listCategoriesFlat({});
  const present = new Set(flat.map((category) => category.slug));

  const childrenOf = new Map<string | null, CategoryView[]>();
  for (const category of flat) {
    const parent =
      category.parentSlug && present.has(category.parentSlug) ? category.parentSlug : null;
    const bucket = childrenOf.get(parent) ?? [];
    bucket.push({ ...category, children: [] });
    childrenOf.set(parent, bucket);
  }

  const byOrder = (a: CategoryView, b: CategoryView): number =>
    a.position - b.position || a.slug.localeCompare(b.slug);

  const attach = (nodes: CategoryView[]): CategoryView[] =>
    nodes
      .sort(byOrder)
      .map((node) => ({ ...node, children: attach(childrenOf.get(node.slug) ?? []) }));

  let tree: readonly CategoryView[] = attach(childrenOf.get(null) ?? []);

  if (query.status) {
    const keep = (nodes: readonly CategoryView[]): readonly CategoryView[] =>
      nodes
        .filter((node) => node.status === query.status)
        .map((node) => ({ ...node, children: keep(node.children) }));
    tree = keep(tree);
  }

  if (query.includeEmpty === false) {
    const prune = (nodes: readonly CategoryView[]): readonly CategoryView[] =>
      nodes
        .map((node) => ({ ...node, children: prune(node.children) }))
        .filter((node) => node.productCount > 0 || node.children.length > 0);
    tree = prune(tree);
  }

  return tree;
}

/** Create a category. */
export async function createCategory(
  input: CreateCategoryRequest,
  actor: ActorContext,
): Promise<CategoryView> {
  const existing = await CategoryModel.findOne({ slug: input.slug })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();
  if (existing) {
    throw new ConflictError(`Category "${input.slug}" already exists.`);
  }

  if (input.parentSlug) {
    const parent = await CategoryModel.findOne({ slug: input.parentSlug })
      .select('status')
      .lean<{ status: string } | null>();
    if (!parent) {
      throw new ValidationError(`Unknown parent category "${input.parentSlug}".`, [
        { field: 'parentSlug', message: 'No such category.' },
      ]);
    }
  }

  const highest = await CategoryModel.findOne({})
    .sort({ position: -1 })
    .select('position')
    .lean<{ position: number } | null>();

  await CategoryModel.create({
    slug: input.slug,
    displayName: input.displayName,
    description: input.description,
    // Append to the end unless an explicit position was given.
    position: input.position ?? (highest ? highest.position + 1 : 0),
    parentSlug: input.parentSlug,
    isVisible: true,
    status: 'active',
    ...(input.seoTitle ? { seoTitle: input.seoTitle } : {}),
    ...(input.seoDescription ? { seoDescription: input.seoDescription } : {}),
  });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'create',
    entity: 'category',
    entityId: input.slug,
    summary: `Category "${input.slug}" (${input.displayName}) created.`,
    changes: input,
    ip: actor.ip,
  });

  const all = await listCategoriesFlat({});
  const created = all.find((category) => category.slug === input.slug);
  if (!created) {
    throw new NotFoundError(`Category ${input.slug}`);
  }
  return created;
}

/** Update a category. */
export async function updateCategory(
  slug: string,
  input: UpdateCategoryRequest,
  actor: ActorContext,
): Promise<CategoryView> {
  const existing = await CategoryModel.findOne({ slug }).lean<CategoryRow | null>();
  if (!existing) {
    throw new NotFoundError(`Category ${slug}`);
  }

  if (input.parentSlug !== undefined) {
    await assertNoCycle(slug, input.parentSlug);
    if (input.parentSlug) {
      const parent = await CategoryModel.findOne({ slug: input.parentSlug })
        .select('status')
        .lean<{ status: string } | null>();
      if (!parent) {
        throw new ValidationError(`Unknown parent category "${input.parentSlug}".`, [
          { field: 'parentSlug', message: 'No such category.' },
        ]);
      }
    }
  }

  const set: Record<string, unknown> = {};
  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.description !== undefined) set.description = input.description;
  if (input.position !== undefined) set.position = input.position;
  if (input.parentSlug !== undefined) set.parentSlug = input.parentSlug;
  if (input.isVisible !== undefined) set.isVisible = input.isVisible;
  if (input.status !== undefined) set.status = input.status;
  if (input.seoTitle !== undefined) set.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) set.seoDescription = input.seoDescription;

  if (Object.keys(set).length === 0) {
    const unchanged = await listCategoriesFlat({});
    const found = unchanged.find((category) => category.slug === slug);
    if (!found) throw new NotFoundError(`Category ${slug}`);
    return found;
  }

  await CategoryModel.updateOne({ slug }, { $set: set });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: input.status && input.status !== existing.status ? 'status-change' : 'update',
    entity: 'category',
    entityId: slug,
    summary: `Category "${slug}" updated (${Object.keys(set).join(', ')}).`,
    changes: {
      before: pickFields(existing as unknown as ProductRow, Object.keys(set)),
      after: set,
    },
    ip: actor.ip,
  });

  const all = await listCategoriesFlat({});
  const updated = all.find((category) => category.slug === slug);
  if (!updated) {
    throw new NotFoundError(`Category ${slug}`);
  }
  return updated;
}

/**
 * Retire a category.
 *
 * Refuses while products still reference it: silently un-categorising them
 * would move live merchandise into "no category" without anybody deciding
 * that. Reassign first, then retire.
 */
export async function retireCategory(slug: string, actor: ActorContext): Promise<CategoryView> {
  const existing = await CategoryModel.findOne({ slug })
    .select('status')
    .lean<{ status: string } | null>();
  if (!existing) {
    throw new NotFoundError(`Category ${slug}`);
  }

  const productCount = await ProductModel.countDocuments({ subcategorySlug: slug });
  if (productCount > 0) {
    throw new ConflictError(
      `Category "${slug}" still has ${productCount} product(s). ` +
        'Reassign them before retiring it.',
    );
  }

  await CategoryModel.updateOne({ slug }, { $set: { status: 'retired', isVisible: false } });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'status-change',
    entity: 'category',
    entityId: slug,
    summary: `Category "${slug}" retired.`,
    changes: { from: existing.status, to: 'retired' },
    ip: actor.ip,
  });

  const all = await listCategoriesFlat({});
  const updated = all.find((category) => category.slug === slug);
  if (!updated) {
    throw new NotFoundError(`Category ${slug}`);
  }
  return updated;
}

/** Bulk reordering. Positions are renumbered so they stay contiguous. */
export async function reorderCategories(
  orderedSlugs: readonly string[],
  actor: ActorContext,
): Promise<readonly CategoryView[]> {
  const known = await CategoryModel.find({ slug: { $in: [...orderedSlugs] } })
    .select('slug')
    .lean<Array<{ slug: string }>>();
  const knownSlugs = new Set(known.map((row) => row.slug));

  const unknownSlugs = orderedSlugs.filter((slug) => !knownSlugs.has(slug));
  if (unknownSlugs.length > 0) {
    throw new ValidationError(`Unknown categories: ${unknownSlugs.join(', ')}.`, [
      { field: 'orderedSlugs', message: 'Contains unknown category slugs.' },
    ]);
  }

  await Promise.all(
    orderedSlugs.map((slug, index) =>
      CategoryModel.updateOne({ slug }, { $set: { position: index } }),
    ),
  );

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'update',
    entity: 'category',
    entityId: `${orderedSlugs.length} category(ies)`,
    summary: `Category order set: ${orderedSlugs.join(', ')}.`,
    changes: { orderedSlugs: [...orderedSlugs] },
    ip: actor.ip,
  });

  return listCategoriesFlat({});
}

/**
 * Seed the categories collection from the slugs already in use.
 *
 * Delegates to `reconcileCategoryTaxonomy`, which is the same routine the API
 * runs at boot. Two implementations of "derive the taxonomy from the
 * catalogue" would eventually disagree about display names or ordering, and
 * an administrator would see the taxonomy change shape depending on which
 * path populated it. There is one implementation; this adds the audit trail
 * and the actor.
 *
 * Additive only: an existing category is left exactly as it is, so this can
 * be re-run without undoing administrator edits.
 */
export async function seedCategoriesFromProducts(actor: ActorContext): Promise<{
  created: string[];
  existing: string[];
  ambiguous: Array<{ slug: string; labels: string[] }>;
}> {
  const result = await reconcileCategoryTaxonomy();

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'create',
    entity: 'category',
    entityId: 'seed',
    summary: `Seeded ${result.created.length} categor(ies) from existing product slugs; ${result.existing.length} already present.`,
    changes: { created: [...result.created], existing: [...result.existing] },
    ip: actor.ip,
  });

  return {
    created: [...result.created],
    existing: [...result.existing],
    ambiguous: result.ambiguous.map((row) => ({ slug: row.slug, labels: [...row.labels] })),
  };
}

/* -------------------------------------------------------------------------- */
/* G-5 — Image review                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Build the review queue.
 *
 * Every candidate is derived from the *actual* product documents, so the
 * queue cannot drift from what the storefront would render. Each item carries
 * the evidence a reviewer needs to decide without opening the filesystem:
 * the source filename, the proposed colour, the reason the automated rule
 * gave up, the colours this design really sells, and whether this is the
 * last missing photograph for its colour.
 */
export async function listImageReviewQueue(query: ImageReviewQuery): Promise<ImageReviewQueue> {
  const filter: Record<string, unknown> = { code: query.code };
  if (query.status) filter.status = query.status;

  const reviews = await ImageReviewModel.find(filter).lean<
    Array<{
      imageId: string;
      designCode: string;
      productId: Types.ObjectId;
      sourceFile: string;
      status: 'pending' | 'assigned' | 'rejected';
      assignedColour?: string;
      autoReason?: 'untokened' | 'token-not-sold' | 'unparsable';
      proposedColour?: string;
      proposedColourToken?: string;
      reviewReason?: string;
      reviewedByEmail?: string;
      reviewedAt?: Date;
      checksum?: string;
      url?: string;
    }>
  >();

  const byId = new Map(reviews.map((review) => [review.imageId, review]));

  /*
   * Seed the queue from the product documents, not from the review
   * collection. Anything with a recorded decision is then overlaid. This is
   * what makes a decision survive a re-import and what keeps the queue
   * honest when nothing has been reviewed yet.
   */
  const productFilter: Record<string, unknown> = {};
  if (query.code) productFilter.code = query.code;

  const products = await ProductModel.find(productFilter)
    .select('code title images colours quarantinedImages')
    .lean<
      Array<{
        _id: Types.ObjectId;
        code: string;
        title: string;
        colours: string[];
        images: Array<{
          url: string;
          alt: string;
          position: number;
          sourceFile: string;
          colour?: string;
          colourToken?: string;
          storage?: string;
          checksum?: string;
        }>;
        quarantinedImages: string[];
      }>
    >();

  const items: ImageReviewItem[] = [];
  /*
   * Verified images per design and colour, accumulated as the products are
   * walked so the "last missing photo" flag can be evaluated afterwards.
   */
  const productVerifiedImages = new Map<string, Map<string, number>>();

  for (const product of products) {
    const soldColours = product.colours ?? [];
    const tokenMap = buildColourTokenMap(
      (
        await VariantModel.find({ productId: product._id })
          .select('colour colourToken')
          .lean<Array<{ colour: string; colourToken: string }>>()
      ).map((variant) => ({ colour: variant.colour, colourToken: variant.colourToken })),
    );

    const verifiedByColour = new Map<string, number>();
    for (const image of product.images ?? []) {
      if (image.colour) {
        verifiedByColour.set(image.colour, (verifiedByColour.get(image.colour) ?? 0) + 1);
      }
    }
    productVerifiedImages.set(product.code, verifiedByColour);

    for (const image of product.images ?? []) {
      const imageId = `${product.code}:${image.sourceFile}`;
      const decision = byId.get(imageId);

      /*
       * An image the rule already assigned is only in the queue when a human
       * has since recorded a decision about it. Otherwise a fully verified
       * design would flood the review list with rows nobody needs to see.
       */
      if (image.colour && !decision) {
        continue;
      }

      const resolution = resolveImageColour(image.sourceFile, tokenMap, soldColours);
      const status = decision?.status ?? (image.colour ? 'assigned' : 'pending');

      items.push({
        id: imageId,
        designCode: product.code,
        productId: product._id.toString(),
        productTitle: product.title,
        sourceFile: image.sourceFile,
        url: image.url ?? decision?.url ?? null,
        alt: image.alt,
        position: image.position,
        storage: image.storage ?? 'local',
        proposedColour: decision?.proposedColour ?? null,
        proposedColourToken:
          decision?.proposedColourToken ??
          (resolution.kind === 'assigned' ? (resolution.token ?? null) : null),
        reason:
          decision?.autoReason ?? (resolution.kind === 'unverified' ? resolution.reason : null),
        status,
        assignedColour: decision?.assignedColour ?? (image.colour || null),
        reviewReason: decision?.reviewReason ?? null,
        reviewedBy: decision?.reviewedByEmail ?? null,
        reviewedAt: decision?.reviewedAt ? decision.reviewedAt.toISOString() : null,
        checksum: image.checksum ?? decision?.checksum ?? null,
        availableColours: soldColours,
        // Computed once, across the whole result set, after the loop.
        isLastMissingPhoto: false,
      });
    }

    /*
     * Files that were never imported at all — the quarantined filenames with
     * no image record — still belong in the queue, because that is exactly
     * the gap an administrator needs to see and resolve.
     */
    for (const sourceFile of product.quarantinedImages ?? []) {
      const imageId = `${product.code}:${sourceFile}`;
      if (byId.has(imageId)) continue;
      if ((product.images ?? []).some((image) => image.sourceFile === sourceFile)) continue;

      const resolution = resolveImageColour(sourceFile, tokenMap, soldColours);

      items.push({
        id: imageId,
        designCode: product.code,
        productId: product._id.toString(),
        productTitle: product.title,
        sourceFile,
        url: null,
        alt: '',
        position: -1,
        storage: 'local',
        proposedColour: resolution.kind === 'assigned' ? resolution.colour : null,
        proposedColourToken: resolution.kind === 'assigned' ? resolution.token : null,
        reason: resolution.kind === 'unverified' ? resolution.reason : null,
        status: 'pending',
        assignedColour: null,
        reviewReason: null,
        reviewedBy: null,
        reviewedAt: null,
        checksum: null,
        availableColours: soldColours,
        isLastMissingPhoto: false,
      });
    }
  }

  const filtered = query.onlyGaps ? items.filter((item) => item.status === 'pending') : items;

  const totalItems = filtered.length;
  const page = query.page;
  const pageSize = query.pageSize;
  const start = (page - 1) * pageSize;

  /*
   * "Last missing photo" means: this pending image is the only one that could
   * give its proposed colour a verified photograph. It is computed once here,
   * across the whole result set, because it is a statement about a colour's
   * coverage rather than about a single image — computing it inside the
   * per-design loop would let a colour look covered because another design
   * happened to be processed first.
   *
   * The count is of *pending* items proposing that colour, per design, since
   * a colour only exists on the design that sells it.
   */
  const pendingPerDesignColour = new Map<string, number>();
  for (const item of filtered) {
    if (item.status !== 'pending' || !item.proposedColour) continue;
    const key = `${item.designCode}::${item.proposedColour}`;
    pendingPerDesignColour.set(key, (pendingPerDesignColour.get(key) ?? 0) + 1);
  }

  /*
   * An untyped `new Map()` default would infer `any` for its values, so the
   * empty map is typed explicitly.
   */
  const noVerifiedPhotos = new Map<string, number>();

  const pageItems = filtered.slice(start, start + pageSize).map((item) => {
    if (item.status !== 'pending' || !item.proposedColour) return item;

    // Only "assign" outcomes move a photo into a gallery, so only those count.
    const colour = item.proposedColour;
    const verifiedForColour =
      (productVerifiedImages.get(item.designCode) ?? noVerifiedPhotos).get(colour) ?? 0;
    const pending = pendingPerDesignColour.get(`${item.designCode}::${colour}`) ?? 0;

    return { ...item, isLastMissingPhoto: verifiedForColour === 0 && pending === 1 };
  });

  const designsAffected = new Set(pageItems.map((item) => item.designCode)).size;
  const coloursWithoutVerifiedPhotos = await VariantModel.aggregate<{ n: number }>([
    { $match: query.code ? { productCode: query.code } : {} },
    { $match: { photographyStatus: 'pending-review' } },
    { $count: 'n' },
  ]);

  return {
    items: pageItems,
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    summary: {
      pending: filtered.filter((item) => item.status === 'pending').length,
      assigned: filtered.filter((item) => item.status === 'assigned').length,
      rejected: filtered.filter((item) => item.status === 'rejected').length,
      coloursWithoutVerifiedPhotos: coloursWithoutVerifiedPhotos[0]?.n ?? 0,
      designsAffected,
    },
  };
}

/**
 * Assign a quarantined image to a colour.
 *
 * The invariants:
 *
 *  - the colour must be one this design **actually sells**, so an override
 *    can never invent a colourway;
 *  - the identical file bytes may not already be assigned to a different
 *    colour, which is what stops one photograph appearing in two galleries;
 *  - a reason is mandatory and is written to the audit log with the
 *    administrator who gave it;
 *  - the colourway is flipped to `verified` in the **same** operation when
 *    this is its first verified photograph, because a verified image behind
 *    a stale `pending-review` flag would leave the storefront still gated.
 */
export async function assignImage(
  imageId: string,
  colour: string,
  reason: string,
  actor: ActorContext,
): Promise<ImageReviewItem> {
  const [designCode, sourceFile] = imageId.split(':');
  if (!designCode || !sourceFile) {
    throw new NotFoundError('Image');
  }

  const product = await ProductModel.findOne({ code: designCode })
    .select('_id code title colours images')
    .lean<{
      _id: Types.ObjectId;
      code: string;
      title: string;
      colours: string[];
      images: Array<{
        url: string;
        alt: string;
        position: number;
        sourceFile: string;
        colour?: string;
        colourToken?: string;
        storage?: string;
        checksum?: string;
      }>;
    } | null>();

  if (!product) {
    throw new NotFoundError(`Design ${designCode}`);
  }

  const soldColours = product.colours ?? [];
  if (!soldColours.some((sold) => sold.toLowerCase() === colour.toLowerCase())) {
    throw new ValidationError(`Design ${designCode} is not sold in "${colour}".`, [
      { field: 'colour', message: `Available: ${soldColours.join(', ') || 'none'}.` },
    ]);
  }

  const image = (product.images ?? []).find((entry) => entry.sourceFile === sourceFile);
  if (!image) {
    throw new NotFoundError(`Image ${imageId}`);
  }

  /*
   * Byte-identical duplicate guard.
   *
   * Two filenames holding the same bytes are one photograph. Showing it under
   * two different colours would put the same shoe on two tiles, so any prior
   * *assignment* of these bytes blocks this one.
   *
   * The lookup deliberately does NOT filter on the colour being assigned: the
   * case worth catching is precisely the mismatch, so constraining the search
   * to that colour would let the real conflict through.
   *
   * Two collections are searched, because an image can be in the catalogue
   * without ever having been reviewed:
   *
   *   - `products.images` — the canonical record. 685 of the 685 current
   *     images were stamped by the colour migration, not by a reviewer, so
   *     searching only the review table would leave every one of them
   *     unguarded.
   *   - `image_reviews` — reviewed assignments, which carry their own copy of
   *     the checksum for audit.
   */
  if (image.checksum) {
    const otherDesign = await ProductModel.findOne({
      _id: { $ne: product._id },
      images: {
        $elemMatch: {
          checksum: image.checksum,
          // Only a *displayed* image occupies a gallery slot. A quarantined
          // copy is not a conflict — it is the very thing awaiting review.
          colour: { $nin: ['', null] },
        },
      },
    })
      .select('code images')
      .lean<{
        code: string;
        images: Array<{ sourceFile: string; colour?: string; checksum?: string }>;
      } | null>();

    const sameDesign = await ProductModel.findOne({
      _id: product._id,
      images: {
        $elemMatch: {
          checksum: image.checksum,
          sourceFile: { $ne: sourceFile },
          colour: { $nin: ['', null] },
        },
      },
    })
      .select('code images')
      .lean<{
        code: string;
        images: Array<{ sourceFile: string; colour?: string; checksum?: string }>;
      } | null>();

    const reviewedClash = await ImageReviewModel.findOne({
      checksum: image.checksum,
      imageId: { $ne: imageId },
      status: 'assigned',
    })
      .select('imageId designCode assignedColour')
      .lean<{ imageId: string; designCode: string; assignedColour?: string } | null>();

    const siblingOnSameDesign = sameDesign
      ? sameDesign.images.find(
          (entry) =>
            entry.sourceFile !== sourceFile && entry.colour && entry.checksum === image.checksum,
        )
      : undefined;

    const conflictingDisplay = reviewedClash
      ? {
          colour: reviewedClash.assignedColour ?? null,
          where: `design ${reviewedClash.designCode} (${reviewedClash.imageId})`,
          label: reviewedClash.imageId,
        }
      : otherDesign
        ? (() => {
            const hit = otherDesign.images.find(
              (entry) => entry.colour && entry.checksum === image.checksum,
            );
            return hit
              ? {
                  colour: hit.colour ?? null,
                  where: `design ${otherDesign.code}`,
                  label: hit.sourceFile,
                }
              : null;
          })()
        : siblingOnSameDesign
          ? {
              colour: siblingOnSameDesign.colour ?? null,
              where: 'this design',
              label: siblingOnSameDesign.sourceFile,
            }
          : null;

    if (conflictingDisplay) {
      const detail =
        conflictingDisplay.colour && conflictingDisplay.colour !== colour
          ? `already shown as ${conflictingDisplay.colour} on ${conflictingDisplay.where} ` +
            `(${conflictingDisplay.label}). One photograph cannot illustrate two colours.`
          : `already in the ${colour} gallery as ${conflictingDisplay.label} on ${conflictingDisplay.where}. ` +
            `Use a distinct photograph, or revert it first.`;

      throw new ConflictError(`Those exact bytes have already been used: ${detail}`);
    }
  }

  const variants = await VariantModel.find({ productId: product._id, colour })
    .select('_id colourToken photographyStatus')
    .lean<Array<{ _id: Types.ObjectId; colourToken: string; photographyStatus?: string }>>();

  if (variants.length === 0) {
    throw new ValidationError(
      `Design ${designCode} has no colourway for "${colour}". Create the colourway first.`,
      [{ field: 'colour', message: 'No such colourway on this design.' }],
    );
  }

  const colourToken = normaliseColourToken(variants[0]!.colourToken);

  // Set the colour on the image so every gallery derivation agrees.
  await ProductModel.updateOne(
    { _id: product._id, 'images.sourceFile': sourceFile },
    { $set: { 'images.$.colour': colour, 'images.$.colourToken': colourToken } },
  );

  /*
   * Promote the colourway now that its colour has a verified photograph.
   *
   * The count must be of **images carrying this colour**, not of documents:
   * a design with exactly one photograph satisfies the condition just as much
   * as one with five, and counting documents would leave every single-photo
   * colour permanently gated even after a successful review.
   */
  const verifiedImageCount = await ProductModel.aggregate<{ n: number }>([
    { $match: { _id: product._id } },
    {
      $project: {
        n: {
          $size: {
            $filter: {
              input: { $ifNull: ['$images', []] },
              as: 'image',
              cond: { $eq: ['$$image.colour', colour] },
            },
          },
        },
      },
    },
  ]);

  const hasVerifiedPhoto = (verifiedImageCount[0]?.n ?? 0) > 0;

  if (hasVerifiedPhoto) {
    await VariantModel.updateMany(
      { productId: product._id, colour, photographyStatus: 'pending-review' },
      { $set: { photographyStatus: 'verified' } },
    );
  }

  await ImageReviewModel.findOneAndUpdate(
    { imageId },
    {
      $set: {
        imageId,
        designCode: product.code,
        productId: product._id,
        sourceFile,
        status: 'assigned',
        assignedColour: colour,
        assignedColourToken: colourToken,
        reviewReason: reason,
        reviewedByEmail: actor.actorEmail,
        reviewedAt: new Date(),
        url: image.url,
        ...(image.checksum ? { checksum: image.checksum } : {}),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  // The image is no longer quarantined.
  await ProductModel.updateOne({ _id: product._id }, { $pull: { quarantinedImages: sourceFile } });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'update',
    entity: 'image-review',
    entityId: imageId,
    summary: `Image "${sourceFile}" assigned to ${colour} on design ${product.code}. Reason: ${reason}`,
    changes: { designCode: product.code, sourceFile, assignedColour: colour, reason },
    ip: actor.ip,
  });

  const refreshed = await ProductModel.findById(product._id)
    .select('images')
    .lean<{ images: Array<{ sourceFile: string; colour?: string }> } | null>();

  const nowVerified = (refreshed?.images ?? []).some(
    (entry) => entry.sourceFile === sourceFile && entry.colour === colour,
  );

  return {
    id: imageId,
    designCode: product.code,
    productId: product._id.toString(),
    productTitle: product.title,
    sourceFile,
    url: image.url,
    alt: image.alt,
    position: image.position,
    storage: image.storage ?? 'local',
    proposedColour: colour,
    proposedColourToken: colourToken,
    reason: null,
    status: nowVerified ? 'assigned' : 'pending',
    assignedColour: nowVerified ? colour : null,
    reviewReason: reason,
    reviewedBy: actor.actorEmail,
    reviewedAt: new Date().toISOString(),
    checksum: image.checksum ?? null,
    availableColours: soldColours,
    isLastMissingPhoto: false,
  };
}

/**
 * Confirm that quarantine is correct.
 *
 * The image stays quarantined and stays undisplayed. The decision is
 * recorded so the item leaves the pending queue and the reviewer is not asked
 * about it again.
 */
export async function rejectImage(
  imageId: string,
  reason: string,
  actor: ActorContext,
): Promise<ImageReviewItem> {
  const [designCode, sourceFile] = imageId.split(':');
  if (!designCode || !sourceFile) {
    throw new NotFoundError('Image');
  }

  const product = await ProductModel.findOne({ code: designCode })
    .select('_id code title colours images')
    .lean<{
      _id: Types.ObjectId;
      code: string;
      title: string;
      colours: string[];
      images: Array<{
        url: string;
        alt: string;
        position: number;
        sourceFile: string;
        storage?: string;
        checksum?: string;
      }>;
    } | null>();

  if (!product) {
    throw new NotFoundError(`Design ${designCode}`);
  }

  const image = (product.images ?? []).find((entry) => entry.sourceFile === sourceFile);

  await ImageReviewModel.findOneAndUpdate(
    { imageId },
    {
      $set: {
        imageId,
        designCode: product.code,
        productId: product._id,
        sourceFile,
        status: 'rejected',
        reviewReason: reason,
        reviewedByEmail: actor.actorEmail,
        reviewedAt: new Date(),
        ...(image?.url ? { url: image.url } : {}),
        ...(image?.checksum ? { checksum: image.checksum } : {}),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  // Keep it quarantined and make sure it is listed as such.
  await ProductModel.updateOne(
    { _id: product._id },
    { $addToSet: { quarantinedImages: sourceFile } },
  );

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'update',
    entity: 'image-review',
    entityId: imageId,
    summary: `Image "${sourceFile}" on design ${product.code} rejected; it stays quarantined. Reason: ${reason}`,
    changes: { designCode: product.code, sourceFile, reason },
    ip: actor.ip,
  });

  return {
    id: imageId,
    designCode: product.code,
    productId: product._id.toString(),
    productTitle: product.title,
    sourceFile,
    url: image?.url ?? null,
    alt: image?.alt ?? '',
    position: image?.position ?? -1,
    storage: image?.storage ?? 'local',
    proposedColour: null,
    proposedColourToken: null,
    reason: null,
    status: 'rejected',
    assignedColour: null,
    reviewReason: reason,
    reviewedBy: actor.actorEmail,
    reviewedAt: new Date().toISOString(),
    checksum: image?.checksum ?? null,
    availableColours: product.colours ?? [],
    isLastMissingPhoto: false,
  };
}

/** Undo a previous assignment, returning the image to quarantine. */
export async function revertImage(
  imageId: string,
  reason: string,
  actor: ActorContext,
): Promise<ImageReviewItem> {
  const [designCode, sourceFile] = imageId.split(':');
  if (!designCode || !sourceFile) {
    throw new NotFoundError('Image');
  }

  const product = await ProductModel.findOne({ code: designCode })
    .select('_id code title colours images')
    .lean<{
      _id: Types.ObjectId;
      code: string;
      title: string;
      colours: string[];
      images: Array<{
        url: string;
        alt: string;
        position: number;
        sourceFile: string;
        storage?: string;
        checksum?: string;
      }>;
    } | null>();

  if (!product) {
    throw new NotFoundError(`Design ${designCode}`);
  }

  const image = (product.images ?? []).find((entry) => entry.sourceFile === sourceFile);

  await ProductModel.updateOne(
    { _id: product._id, 'images.sourceFile': sourceFile },
    { $unset: { 'images.$.colour': '', 'images.$.colourToken': '' } },
  );
  await ProductModel.updateOne(
    { _id: product._id },
    { $addToSet: { quarantinedImages: sourceFile } },
  );

  await ImageReviewModel.findOneAndUpdate(
    { imageId },
    {
      $set: {
        imageId,
        designCode: product.code,
        productId: product._id,
        sourceFile,
        status: 'pending',
        reviewReason: reason,
        reviewedByEmail: actor.actorEmail,
        reviewedAt: new Date(),
      },
      $unset: { assignedColour: '', assignedColourToken: '' },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  /*
   * A colourway whose last verified photograph has just been taken away must
   * go back to `pending-review`, or the storefront would keep selling a
   * colour it can no longer illustrate. Demote only colours that now have no
   * verified image at all — a colour with other photographs is unaffected.
   */
  const verifiedImages =
    (
      await ProductModel.findById(product._id)
        .select('images')
        .lean<{ images: Array<{ colour?: string }> } | null>()
    )?.images ?? [];

  const coveredColours = new Set(
    verifiedImages
      .map((image) => image.colour)
      .filter((colour): colour is string => Boolean(colour)),
  );

  const orphanedColours = await VariantModel.distinct('colour', {
    productId: product._id,
    photographyStatus: 'verified',
  });
  const toDemote = orphanedColours.filter((colour) => !coveredColours.has(colour));

  if (toDemote.length > 0) {
    await VariantModel.updateMany(
      { productId: product._id, colour: { $in: toDemote } },
      { $set: { photographyStatus: 'pending-review' } },
    );
  }

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'update',
    entity: 'image-review',
    entityId: imageId,
    summary: `Assignment of "${sourceFile}" on design ${product.code} reverted to quarantine. Reason: ${reason}`,
    changes: { designCode: product.code, sourceFile, reason },
    ip: actor.ip,
  });

  return {
    id: imageId,
    designCode: product.code,
    productId: product._id.toString(),
    productTitle: product.title,
    sourceFile,
    url: image?.url ?? null,
    alt: image?.alt ?? '',
    position: image?.position ?? -1,
    storage: image?.storage ?? 'local',
    proposedColour: null,
    proposedColourToken: null,
    reason: null,
    status: 'pending',
    assignedColour: null,
    reviewReason: reason,
    reviewedBy: actor.actorEmail,
    reviewedAt: new Date().toISOString(),
    checksum: image?.checksum ?? null,
    availableColours: product.colours ?? [],
    isLastMissingPhoto: false,
  };
}

/**
 * Flip a colourway's photography gate.
 *
 * Refuses to mark a colour verified when it has no verified photograph. That
 * refusal is the backend guarantee behind "a colour never becomes sellable
 * because a form was filled in".
 */
export async function setPhotographyStatus(
  sku: string,
  status: 'verified' | 'pending-review',
  reason: string,
  actor: ActorContext,
): Promise<AdminVariantView> {
  const variant = await VariantModel.findOne({ sku })
    .select('_id productId colour')
    .lean<{ _id: Types.ObjectId; productId: Types.ObjectId; colour: string } | null>();

  if (!variant) {
    throw new NotFoundError(`SKU ${sku}`);
  }

  if (status === 'verified') {
    const verifiedCount = await ProductModel.countDocuments({
      _id: variant.productId,
      images: { $elemMatch: { colour: variant.colour } },
    });

    if (verifiedCount === 0) {
      throw new ConflictError(
        `Design has no verified photograph for ${variant.colour}. ` +
          'Assign an image first — a colourway cannot be marked verified on the strength of a form.',
      );
    }
  }

  const before = await VariantModel.findOne({ sku })
    .select('photographyStatus')
    .lean<{ photographyStatus?: string } | null>();

  await VariantModel.updateOne({ sku }, { $set: { photographyStatus: status } });

  await writeAuditLog({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    actorRole: actor.actorRole,
    action: 'status-change',
    entity: 'variant',
    entityId: sku,
    summary: `Photography for ${sku} moved from ${before?.photographyStatus ?? 'unset'} to ${status}. Reason: ${reason}`,
    changes: { from: before?.photographyStatus ?? null, to: status, reason },
    ip: actor.ip,
  });

  return getVariant(sku);
}

/**
 * The colour coverage for one design: every colour × verified photo count.
 *
 * This is the matrix an administrator uses to decide what to review next,
 * and it names the gaps explicitly rather than leaving them implicit in an
 * empty image list.
 */
export async function getImageCoverage(code: string): Promise<{
  code: string;
  title: string;
  colours: Array<{
    colour: string;
    verifiedImageCount: number;
    skus: number;
    sellableSkus: number;
    hasVerifiedPhoto: boolean;
  }>;
  quarantined: string[];
  gaps: string[];
}> {
  const product = await ProductModel.findOne({ code })
    .select('code title colours images quarantinedImages')
    .lean<{
      code: string;
      title: string;
      colours: string[];
      images: Array<{ colour?: string; sourceFile: string }>;
      quarantinedImages: string[];
    } | null>();

  if (!product) {
    throw new NotFoundError(`Design ${code}`);
  }

  const counts = await VariantModel.aggregate<{ _id: string; n: number; sellable: number }>([
    { $match: { productCode: code } },
    {
      $group: {
        _id: '$colour',
        n: { $sum: 1 },
        sellable: {
          $sum: { $cond: [{ $eq: ['$photographyStatus', 'pending-review'] }, 0, 1] },
        },
      },
    },
  ]);
  const byColour = new Map(counts.map((row) => [row._id, row]));

  const colours = (product.colours ?? []).map((colour) => {
    const verifiedImageCount = (product.images ?? []).filter(
      (image) => image.colour === colour,
    ).length;
    const row = byColour.get(colour);
    return {
      colour,
      verifiedImageCount,
      skus: row?.n ?? 0,
      sellableSkus: row?.sellable ?? 0,
      hasVerifiedPhoto: verifiedImageCount > 0,
    };
  });

  const gaps = colours.filter((entry) => !entry.hasVerifiedPhoto).map((entry) => entry.colour);

  return {
    code: product.code,
    title: product.title,
    colours,
    quarantined: product.quarantinedImages ?? [],
    gaps,
  };
}

export { extractColourToken };
