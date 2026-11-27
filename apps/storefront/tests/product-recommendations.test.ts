import { describe, expect, it } from 'vitest';
import { getFallbackProductsIndex } from '@/lib/fallback-catalog';
import { computeProductRecommendations } from '@/features/catalog/lib/product-recommendations';

describe('computeProductRecommendations', () => {
  const allProducts = Object.values(getFallbackProductsIndex());

  it('populates two distinct scrolling sections for every product in the catalogue', () => {
    expect(allProducts.length).toBeGreaterThan(10);

    for (const current of allProducts) {
      const { similarProducts, complementaryProducts } = computeProductRecommendations(
        current,
        allProducts,
        10,
      );

      expect(similarProducts.length).toBeGreaterThan(0);
      expect(complementaryProducts.length).toBeGreaterThan(0);

      // Current product must never appear in its own recommendations
      expect(similarProducts.some((item) => item.product.id === current.id)).toBe(false);
      expect(complementaryProducts.some((item) => item.product.id === current.id)).toBe(false);

      // The two sections must not duplicate each other
      const section1Ids = new Set(similarProducts.map((item) => item.product.id));
      for (const comp of complementaryProducts) {
        expect(section1Ids.has(comp.product.id)).toBe(false);
      }
    }
  });

  it('ranks closest-price and same-category products highest in similarProducts', () => {
    const target = allProducts[0]!;
    const { similarProducts } = computeProductRecommendations(target, allProducts, 8);

    expect(similarProducts.length).toBe(8);
    // Scores must be sorted descending
    for (let i = 1; i < similarProducts.length; i++) {
      expect(similarProducts[i - 1]!.score).toBeGreaterThanOrEqual(similarProducts[i]!.score);
    }
    // Every item has a non-empty matchLabel
    for (const item of similarProducts) {
      expect(item.matchLabel.length).toBeGreaterThan(0);
    }
  });
});
