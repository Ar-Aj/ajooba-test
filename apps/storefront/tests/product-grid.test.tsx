import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Product } from '@ajooba/contracts';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { mediaUrl } from '@/lib/env';

/**
 * The storefront's no-fake-data rule is enforced in the component layer, so it
 * is tested in the component layer. These tests assert on rendered markup and
 * on values that genuinely exist in the source catalogue.
 *
 * React elements are rendered with `react-dom/server`, which is already a
 * dependency — no extra test renderer is introduced.
 */

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-product-id',
    code: 'A11',
    slug: 'ajooba-a11',
    title: 'AJOOBA Ethnic Mojri',
    description: 'Handcrafted leather mojri.',
    subcategory: 'Mojri / Jutti',
    subcategorySlug: 'mojri-jutti',
    brand: 'Ajooba Footwear',
    colours: ['Brown'],
    images: [],
    variants: [],
    mrp: 1999,
    sellingPrice: 1399,
    inStock: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ProductGrid — empty catalogue', () => {
  it('renders an explicit empty state instead of placeholder products', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[]} totalItems={0} />);

    expect(html).toContain('No products found');
    expect(html).toContain('The catalogue is empty for these filters');

    // A real empty state has no product cards, no prices and no links to
    // product detail pages.
    expect(html).not.toContain('/products/ajooba-a11');
    expect(html).not.toContain('₹');
  });

  it('offers a way out of the empty state', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[]} totalItems={0} />);
    expect(html).toContain('Clear filters');
  });
});

describe('ProductGrid — populated catalogue', () => {
  it('reports the real design count supplied by the API', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[makeProduct()]} totalItems={55} />);

    expect(html).toContain('55 designs');
  });

  it('uses singular wording for a single design', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[makeProduct()]} totalItems={1} />);

    expect(html).toContain('1 design<');
  });

  it('links to the product detail page by slug', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[makeProduct()]} totalItems={1} />);

    expect(html).toContain('href="/products/ajooba-a11"');
  });

  it('formats prices with the Indian locale and shows the MRP struck through', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[makeProduct()]} totalItems={1} />);

    expect(html).toContain('₹1,399');
    expect(html).toContain('₹1,999');
  });

  it('does not render a struck-through MRP when there is no discount', () => {
    const html = renderToStaticMarkup(
      <ProductGrid products={[makeProduct({ mrp: 1399, sellingPrice: 1399 })]} totalItems={1} />,
    );

    expect(html).toContain('₹1,399');
    expect(html).not.toContain('line-through');
  });

  it('renders a card without an image rather than inventing an image', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[makeProduct()]} totalItems={1} />);

    // No <img> at all — an empty square placeholder, not a stock photo.
    expect(html).not.toContain('<img');
  });

  it('renders the real image path when one exists', () => {
    const html = renderToStaticMarkup(
      <ProductGrid
        products={[
          makeProduct({
            images: [
              {
                url: '/products/AJ-A11/A11-BRN-1.jpg',
                alt: 'AJOOBA Ethnic Mojri in Brown',
                position: 0,
                sourceFile: 'A11-BRN-1.jpg',
              },
            ],
          }),
        ]}
        totalItems={1}
      />,
    );

    expect(html).toContain('src="/products/AJ-A11/A11-BRN-1.jpg"');
    expect(html).toContain('alt="AJOOBA Ethnic Mojri in Brown"');
    expect(html).toContain('loading="lazy"');
  });
});

describe('mediaUrl', () => {
  it('joins the media base URL with an asset path', () => {
    expect(mediaUrl('/products/AJ-A11/A11-BRN-1.jpg')).toBe('/products/AJ-A11/A11-BRN-1.jpg');
  });

  it('normalises a missing leading slash', () => {
    expect(mediaUrl('products/AJ-A11/A11-BRN-1.jpg')).toBe('/products/AJ-A11/A11-BRN-1.jpg');
  });
});
