import {
  buildColourTokenMap,
  resolveImageColour,
  type Product,
  type ProductImage,
} from '@ajooba/contracts';

export interface RecommendedProductItem {
  product: Product;
  score: number;
  priceDiff: number;
  matchLabel: string;
}

export interface ProductRecommendationSections {
  /** Section 1: Closest matches by price range, category, and style keywords. */
  similarProducts: RecommendedProductItem[];
  /** Section 2: Complementary designs by colourway, occasion, and value tier. */
  complementaryProducts: RecommendedProductItem[];
}

const STYLE_KEYWORDS = [
  'loafer',
  'loafers',
  'slip-on',
  'tassel',
  'horsebit',
  'penny',
  'buckle',
  'monk',
  'lace-up',
  'oxford',
  'derby',
  'brogue',
  'mojri',
  'jutti',
  'ethnic',
  'suede',
  'patent',
  'textured',
  'woven',
  'embossed',
  'croc',
  'velvet',
  'leather',
  'driving',
  'mule',
  'mules',
  'sandal',
  'sandals',
  'sneaker',
  'sneakers',
  'boot',
  'boots',
  'stitching',
  'cushioned',
] as const;

const OCCASION_KEYWORDS = [
  'formal',
  'casual',
  'wedding',
  'weddings',
  'reception',
  'receptions',
  'party',
  'parties',
  'festive',
  'business',
  'office',
  'everyday',
  'daily',
  'celebration',
  'celebrations',
  'suit',
  'suits',
  'trousers',
  'blazer',
  'kurta',
  'sherwani',
] as const;

function extractTokens(product: Product, dictionary: readonly string[]): Set<string> {
  const haystack = `${product.title} ${product.description} ${product.subcategory}`.toLowerCase();
  const matched = new Set<string>();
  for (const word of dictionary) {
    if (haystack.includes(word)) {
      matched.add(word.replace(/s$/, ''));
    }
  }
  return matched;
}

/**
 * Ensures a product's images have their colour resolved (falling back to
 * filename token resolution when `image.colour` was not pre-populated).
 */
export function ensureResolvedProductImages(product: Product): Product {
  const needsResolution = product.images.some((image) => !image.colour);
  if (!needsResolution) return product;

  const soldColours =
    product.variants.length > 0
      ? [...new Set(product.variants.map((v) => v.colour))]
      : product.colours;
  const tokenMap = buildColourTokenMap(product.variants);

  const resolvedImages: ProductImage[] = product.images.map((img) => {
    if (img.colour) return img;
    const res = resolveImageColour(img.sourceFile, tokenMap, soldColours);
    if (res.kind === 'assigned') {
      return {
        ...img,
        colour: res.colour as ProductImage['colour'],
        ...(res.token ? { colourToken: res.token } : {}),
      };
    }
    return img;
  });

  return { ...product, images: resolvedImages };
}

function hasDisplayableImage(product: Product): boolean {
  return product.images.some((img) => Boolean(img.colour) || Boolean(img.url));
}

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/**
 * Computes two distinct, non-overlapping horizontal scrolling recommendation
 * lists for any product detail page:
 *
 *  1. `similarProducts`: Scored by price proximity to the selected product,
 *     same category/subcategory, shared silhouette/material keywords, and stock.
 *  2. `complementaryProducts`: Scored by shared colourways, occasion pairing,
 *     discount value, and stock — excluding items already placed in Section 1.
 */
export function computeProductRecommendations(
  currentProduct: Product,
  catalogue: readonly Product[],
  maxPerSection = 10,
): ProductRecommendationSections {
  const candidates = catalogue
    .filter((item) => item.id !== currentProduct.id && item.slug !== currentProduct.slug)
    .map(ensureResolvedProductImages)
    .filter(hasDisplayableImage);

  if (candidates.length === 0) {
    return { similarProducts: [], complementaryProducts: [] };
  }

  const currentStyleTokens = extractTokens(currentProduct, STYLE_KEYWORDS);
  const currentOccasionTokens = extractTokens(currentProduct, OCCASION_KEYWORDS);
  const currentColours = new Set(currentProduct.colours);
  const currentSizes = new Set(currentProduct.variants.filter((v) => v.inStock).map((v) => v.size));

  // ---- Pass 1: Score all candidates for Section 1 (Similar Price & Style) ----
  const scoredSimilar: RecommendedProductItem[] = candidates.map((candidate) => {
    const priceDiff = Math.abs(candidate.sellingPrice - currentProduct.sellingPrice);
    let priceScore = 0;
    if (priceDiff === 0) {
      priceScore = 45;
    } else if (priceDiff <= 100) {
      priceScore = 40;
    } else if (priceDiff <= 200) {
      priceScore = 34;
    } else if (priceDiff <= 350) {
      priceScore = 26;
    } else if (priceDiff <= 500) {
      priceScore = 18;
    } else {
      priceScore = Math.max(0, 14 - Math.floor(priceDiff / 120));
    }

    const sameCategory =
      candidate.subcategorySlug === currentProduct.subcategorySlug ||
      candidate.subcategory.toLowerCase() === currentProduct.subcategory.toLowerCase();
    const categoryScore = sameCategory ? 30 : 0;

    const candidateStyleTokens = extractTokens(candidate, STYLE_KEYWORDS);
    let sharedStyleCount = 0;
    for (const token of candidateStyleTokens) {
      if (currentStyleTokens.has(token)) sharedStyleCount += 1;
    }
    const styleScore = Math.min(25, sharedStyleCount * 5);

    const sharedColours = candidate.colours.filter((c) => currentColours.has(c));
    const colourScore = Math.min(9, sharedColours.length * 3);

    const hasOverlappingSize = candidate.variants.some(
      (v) => v.inStock && currentSizes.has(v.size),
    );
    const sizeScore = hasOverlappingSize ? 4 : 0;

    const stockScore = candidate.inStock ? 14 : 0;

    const totalScore =
      priceScore + categoryScore + styleScore + colourScore + sizeScore + stockScore;

    let matchLabel = 'Similar style';
    if (priceDiff === 0) {
      matchLabel = `Same price · ${formatInr(candidate.sellingPrice)}`;
    } else if (priceDiff <= 150) {
      matchLabel = `Within ${formatInr(priceDiff)} of this pair`;
    } else if (sameCategory && priceDiff <= 350) {
      matchLabel = `${candidate.subcategory} · Similar price`;
    } else if (sameCategory) {
      matchLabel = `More in ${candidate.subcategory}`;
    } else if (priceDiff <= 300) {
      matchLabel = `Closest price range`;
    }

    return {
      product: candidate,
      score: totalScore,
      priceDiff,
      matchLabel,
    };
  });

  scoredSimilar.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.priceDiff !== b.priceDiff) return a.priceDiff - b.priceDiff;
    return a.product.slug.localeCompare(b.product.slug);
  });

  // Partition count so Section 2 always has items even on smaller catalogues
  const section1Limit =
    candidates.length <= maxPerSection
      ? Math.ceil(candidates.length / 2)
      : Math.min(maxPerSection, Math.ceil(candidates.length * 0.55));

  const similarProducts = scoredSimilar.slice(0, section1Limit);
  const usedIds = new Set(similarProducts.map((item) => item.product.id));

  // ---- Pass 2: Score remaining candidates for Section 2 (Complementary / Explore) ----
  const remainingPool = candidates.filter((c) => !usedIds.has(c.id));
  const poolForSection2 = remainingPool.length > 0 ? remainingPool : candidates;

  const scoredComplementary: RecommendedProductItem[] = poolForSection2.map((candidate) => {
    const priceDiff = Math.abs(candidate.sellingPrice - currentProduct.sellingPrice);
    const sharedColours = candidate.colours.filter((c) => currentColours.has(c));
    const colourScore = Math.min(24, sharedColours.length * 8);

    const candidateOccasions = extractTokens(candidate, OCCASION_KEYWORDS);
    let sharedOccasionCount = 0;
    for (const token of candidateOccasions) {
      if (currentOccasionTokens.has(token)) sharedOccasionCount += 1;
    }
    const occasionScore = Math.min(24, sharedOccasionCount * 6);

    const discountPct =
      candidate.mrp > candidate.sellingPrice
        ? Math.round(((candidate.mrp - candidate.sellingPrice) / candidate.mrp) * 100)
        : 0;
    const valueScore = Math.min(18, Math.floor(discountPct / 3));

    const differentCategoryBonus =
      candidate.subcategorySlug !== currentProduct.subcategorySlug ? 10 : 5;
    const priceProximityBonus = priceDiff <= 400 ? 12 : priceDiff <= 700 ? 6 : 0;
    const stockScore = candidate.inStock ? 15 : 0;

    const totalScore =
      colourScore +
      occasionScore +
      valueScore +
      differentCategoryBonus +
      priceProximityBonus +
      stockScore;

    let matchLabel = `Popular in ${candidate.subcategory}`;
    if (sharedColours.length > 0) {
      matchLabel = `Available in ${sharedColours.slice(0, 2).join(' & ')}`;
    } else if (discountPct >= 25) {
      matchLabel = `${discountPct}% off · Best value`;
    } else if (priceDiff <= 250) {
      matchLabel = `Similar budget · ${formatInr(candidate.sellingPrice)}`;
    }

    return {
      product: candidate,
      score: totalScore,
      priceDiff,
      matchLabel,
    };
  });

  scoredComplementary.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.priceDiff !== b.priceDiff) return a.priceDiff - b.priceDiff;
    return a.product.slug.localeCompare(b.product.slug);
  });

  const complementaryProducts = scoredComplementary.slice(0, maxPerSection);

  return {
    similarProducts,
    complementaryProducts,
  };
}
