import {
  buildColourTokenMap,
  resolveImageColour,
  type CatalogFacets,
  type CatalogListResult,
  type CatalogQuery,
  type CategoryView,
  type FacetCount,
  type Product,
  type ProductImage,
  type ResolvedHomepageSection,
} from '@ajooba/contracts';
import catalogData from '../data/catalog.json';
import homepageData from '../data/homepage.json';

interface RawVariant {
  sku: string;
  size: number;
  colour: string;
  colourToken: string;
  mrp: number;
  sellingPrice: number;
  discountPercent: number;
  stock: number;
  templateStock?: number | null;
  inStock: boolean;
  ukIndiaSize?: number | null;
  euroSize?: number | null;
  ean?: string;
  articleNumber?: string;
  marketplaceImageUrls?: string[];
  photographyStatus?: 'verified' | 'pending-review';
}

interface RawProduct {
  id?: string;
  code: string;
  slug: string;
  title: string;
  description: string;
  subcategory: string;
  subcategorySlug: string;
  brand: string;
  colours: string[];
  images: Array<{
    url: string;
    alt: string;
    position: number;
    sourceFile: string;
  }>;
  mrp: number;
  sellingPrice: number;
  inStock: boolean;
  variants: RawVariant[];
}

const FALLBACK_TIMESTAMP = '2026-10-23T00:00:00.000Z';

function normalizeProducts(): Product[] {
  const rawList = (catalogData as { products: RawProduct[] }).products ?? [];

  return rawList.map((raw) => {
    const id = raw.id ?? raw.code;
    const soldColours = raw.colours ?? [];
    const tokenMap = buildColourTokenMap(raw.variants ?? []);
    const assignedColours = new Set<string>();

    const images: ProductImage[] = (raw.images ?? []).map((img) => {
      const resolution = resolveImageColour(img.sourceFile, tokenMap, soldColours);
      if (resolution.kind === 'assigned') {
        assignedColours.add(resolution.colour);
        return {
          url: img.url,
          alt: img.alt,
          position: img.position,
          sourceFile: img.sourceFile,
          colour: resolution.colour as ProductImage['colour'],
          ...(resolution.token ? { colourToken: resolution.token } : {}),
        };
      }
      return {
        url: img.url,
        alt: img.alt,
        position: img.position,
        sourceFile: img.sourceFile,
      };
    });

    const variants = (raw.variants ?? []).map((v) => {
      const stock = v.stock > 0 ? v.stock : (v.templateStock ?? 0);
      const hasPhoto = assignedColours.has(v.colour);
      const photographyStatus =
        v.photographyStatus ?? (hasPhoto ? ('verified' as const) : ('pending-review' as const));
      const inStock = Boolean((v.inStock || stock > 0) && photographyStatus === 'verified');
      return {
        sku: v.sku,
        productId: id,
        size: v.size,
        colour: v.colour,
        colourToken: v.colourToken,
        mrp: v.mrp,
        sellingPrice: v.sellingPrice,
        discountPercent: v.discountPercent,
        stock,
        inStock,
        ukIndiaSize: v.ukIndiaSize ?? undefined,
        euroSize: v.euroSize ?? undefined,
        ean: v.ean ?? undefined,
        photographyStatus,
      };
    });

    return {
      id,
      code: raw.code,
      slug: raw.slug,
      title: raw.title,
      description: raw.description,
      subcategory: raw.subcategory,
      subcategorySlug: raw.subcategorySlug,
      brand: raw.brand || 'Ajooba Footwear',
      colours: soldColours,
      images,
      variants,
      mrp: raw.mrp,
      sellingPrice: raw.sellingPrice,
      inStock: Boolean(raw.inStock || variants.some((v) => v.inStock)),
      createdAt: FALLBACK_TIMESTAMP,
      updatedAt: FALLBACK_TIMESTAMP,
    };
  });
}

let cachedProducts: Product[] | null = null;
let cachedIndex: Record<string, Product> | null = null;

export function getFallbackProducts(): Product[] {
  if (!cachedProducts) {
    cachedProducts = normalizeProducts();
  }
  return cachedProducts;
}

export function getFallbackProductsIndex(): Record<string, Product> {
  if (!cachedIndex) {
    const map: Record<string, Product> = {};
    const list = getFallbackProducts();
    for (const product of list) {
      map[product.id] = product;
      if (product.code && product.code !== product.id) {
        map[product.code] = product;
      }
    }
    cachedIndex = map;
  }
  return cachedIndex;
}

export function getFallbackProductBySlug(slug: string): Product | null {
  const list = getFallbackProducts();
  const normalized = slug.trim().toLowerCase();
  return (
    list.find(
      (p) =>
        p.slug.toLowerCase() === normalized ||
        p.code.toLowerCase() === normalized ||
        p.id.toLowerCase() === normalized,
    ) ?? null
  );
}

export function getFallbackHomepageSections(): ResolvedHomepageSection[] {
  const payload = homepageData as unknown as {
    data?: { sections?: Array<Record<string, unknown>> };
    sections?: Array<Record<string, unknown>>;
  };
  const rawSections = payload.data?.sections ?? payload.sections ?? [];

  return rawSections.map((s) => ({
    id: String(s.id ?? 'sec'),
    type: s.type as ResolvedHomepageSection['type'],
    position: Number(s.position ?? 0),
    isVisible: Boolean(s.isVisible ?? true),
    heading: String(s.heading ?? ''),
    subheading: String(s.subheading ?? ''),
    config: (s.config ?? {}) as Record<string, unknown>,
    startsAt: (s.startsAt as string | null) ?? null,
    endsAt: (s.endsAt as string | null) ?? null,
    products: (s.products ?? []) as ResolvedHomepageSection['products'],
    deals: (s.deals ?? []) as ResolvedHomepageSection['deals'],
    colourTiles: (s.colourTiles ?? []) as ResolvedHomepageSection['colourTiles'],
    categories: (s.categories ?? []) as ResolvedHomepageSection['categories'],
    unresolvedProductIds: (s.unresolvedProductIds ?? []) as readonly string[],
    hiddenBecause: (s.hiddenBecause as ResolvedHomepageSection['hiddenBecause']) ?? null,
    campaignEndsAt: (s.campaignEndsAt as string | null) ?? null,
  }));
}

export function getFallbackCategories(): readonly CategoryView[] {
  const products = getFallbackProducts();
  const countsBySubcategory: Record<string, number> = {};

  for (const p of products) {
    countsBySubcategory[p.subcategorySlug] = (countsBySubcategory[p.subcategorySlug] ?? 0) + 1;
  }

  const categoryConfigs: Array<{
    slug: string;
    displayName: string;
    description: string;
    sourceSubcategory: string;
  }> = [
    {
      slug: 'mojri-jutti',
      displayName: 'Mojri / Jutti',
      description: 'Handcrafted traditional mojris and juttis for celebratory occasions.',
      sourceSubcategory: 'Mojri / Jutti',
    },
    {
      slug: 'shoe',
      displayName: 'Shoes & Loafers',
      description: 'Casual slip-ons, formal loafers and comfortable everyday shoes.',
      sourceSubcategory: 'shoe',
    },
    {
      slug: 'sandal',
      displayName: 'Sandals',
      description: 'Lightweight, breathable sandals built for all-day comfort.',
      sourceSubcategory: 'sandal',
    },
    {
      slug: 'chappal',
      displayName: 'Chappals',
      description: 'Classic open-toe daily wear chappals with resilient outsoles.',
      sourceSubcategory: 'Chappal',
    },
  ];

  return categoryConfigs.map((cfg, index) => ({
    slug: cfg.slug,
    displayName: cfg.displayName,
    description: cfg.description,
    position: index,
    parentSlug: null,
    isVisible: true,
    status: 'active' as const,
    sourceSubcategory: cfg.sourceSubcategory,
    productCount: countsBySubcategory[cfg.slug] ?? 0,
    children: [],
    createdAt: FALLBACK_TIMESTAMP,
    updatedAt: FALLBACK_TIMESTAMP,
  }));
}

export function getFallbackFacets(): CatalogFacets {
  const products = getFallbackProducts();
  const categories = getFallbackCategories();

  const subcategoryCounts: Record<string, number> = {};
  const colourCounts: Record<string, number> = {};
  const sizeCounts: Record<string, number> = {};
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const p of products) {
    if (p.sellingPrice < minPrice) minPrice = p.sellingPrice;
    if (p.sellingPrice > maxPrice) maxPrice = p.sellingPrice;

    subcategoryCounts[p.subcategorySlug] = (subcategoryCounts[p.subcategorySlug] ?? 0) + 1;

    for (const c of p.colours) {
      colourCounts[c] = (colourCounts[c] ?? 0) + 1;
    }

    const distinctSizes = new Set(p.variants.map((v) => String(v.size)));
    for (const s of distinctSizes) {
      sizeCounts[s] = (sizeCounts[s] ?? 0) + 1;
    }
  }

  const toFacetList = (record: Record<string, number>): FacetCount[] =>
    Object.entries(record)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

  return {
    categories,
    subcategories: toFacetList(subcategoryCounts),
    colours: toFacetList(colourCounts),
    sizes: toFacetList(sizeCounts),
    priceRange: {
      min: Number.isFinite(minPrice) ? minPrice : 0,
      max: Number.isFinite(maxPrice) ? maxPrice : 5000,
    },
  };
}

export function queryFallbackProducts(query: Partial<CatalogQuery> = {}): CatalogListResult {
  const all = getFallbackProducts();
  let filtered = [...all];

  if (query.search) {
    const q = query.search.trim().toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.subcategory.toLowerCase().includes(q) ||
        p.colours.some((c) => c.toLowerCase().includes(q)),
    );
  }

  if (query.subcategory) {
    filtered = filtered.filter((p) => p.subcategorySlug === query.subcategory);
  }

  const hasVariantCriterion =
    query.colour !== undefined ||
    (query.size !== undefined && query.size !== null) ||
    (query.minPrice !== undefined && query.minPrice !== null) ||
    (query.maxPrice !== undefined && query.maxPrice !== null) ||
    query.inStock !== undefined;

  if (hasVariantCriterion) {
    const colourNeedle = query.colour?.toLowerCase();
    const targetSize = query.size !== undefined && query.size !== null ? Number(query.size) : null;
    const minP =
      query.minPrice !== undefined && query.minPrice !== null ? Number(query.minPrice) : null;
    const maxP =
      query.maxPrice !== undefined && query.maxPrice !== null ? Number(query.maxPrice) : null;

    filtered = filtered.filter((p) => {
      if (p.variants.length === 0) {
        if (colourNeedle && !p.colours.some((c) => c.toLowerCase() === colourNeedle)) return false;
        if (targetSize !== null) return false;
        if (minP !== null && p.sellingPrice < minP) return false;
        if (maxP !== null && p.sellingPrice > maxP) return false;
        if (query.inStock !== undefined && p.inStock !== query.inStock) return false;
        return true;
      }

      return p.variants.some((v) => {
        if (colourNeedle && v.colour.toLowerCase() !== colourNeedle) return false;
        if (targetSize !== null && v.size !== targetSize) return false;
        if (minP !== null && v.sellingPrice < minP) return false;
        if (maxP !== null && v.sellingPrice > maxP) return false;
        if (query.inStock === true && !v.inStock) return false;
        if (query.inStock === false && v.inStock) return false;
        return true;
      });
    });
  }

  if (query.sort === 'price-asc') {
    filtered.sort((a, b) => a.sellingPrice - b.sellingPrice);
  } else if (query.sort === 'price-desc') {
    filtered.sort((a, b) => b.sellingPrice - a.sellingPrice);
  } else if (query.sort === 'title-asc') {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (query.sort === 'title-desc') {
    filtered.sort((a, b) => b.title.localeCompare(a.title));
  } else if (query.sort === 'newest') {
    filtered.sort((a, b) => b.code.localeCompare(a.code));
  }

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.max(1, query.pageSize ?? 24);
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    totalItems,
    page,
    pageSize,
    totalPages,
  };
}
