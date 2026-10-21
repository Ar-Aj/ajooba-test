import type { Types } from 'mongoose';
import {
  DEFAULT_PAGE_SIZE,
  type CatalogFacets,
  type CatalogListResult,
  type CatalogQueryInput,
  type FacetCount,
  type Product,
  type ProductImage,
  type ProductVariant,
} from '@ajooba/contracts';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';

/**
 * Catalogue read service.
 *
 * All reads go to MongoDB. There is no in-memory fallback and no seeded
 * fixture data — if the database is empty, the API correctly returns an empty
 * catalogue rather than inventing products.
 */

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
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
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
  ean?: string;
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
    stock: doc.stock,
    inStock: doc.inStock,
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
  const filter = buildFilter(query);
  const sort = buildSort(query.sort);

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
 */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const doc = await ProductModel.findOne({ slug }).lean<ProductDoc>();
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
 */
export async function getCatalogFacets(): Promise<CatalogFacets> {
  const [subcategoryRows, colourRows, sizeRows, priceRows] = await Promise.all([
    ProductModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$subcategory', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    VariantModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$colour', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    VariantModel.aggregate<{ _id: number; count: number }>([
      { $group: { _id: '$size', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    ProductModel.aggregate<{ min: number; max: number }>([
      {
        $group: {
          _id: null,
          min: { $min: '$sellingPrice' },
          max: { $max: '$sellingPrice' },
        },
      },
    ]),
  ]);

  const toFacets = (rows: Array<{ _id: string | number; count: number }>): FacetCount[] =>
    rows.map((row) => ({ value: String(row._id), count: row.count }));

  return {
    subcategories: toFacets(subcategoryRows),
    colours: toFacets(colourRows),
    sizes: toFacets(sizeRows),
    priceRange: {
      min: priceRows[0]?.min ?? 0,
      max: priceRows[0]?.max ?? 0,
    },
  };
}
