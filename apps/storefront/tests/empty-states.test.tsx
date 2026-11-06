import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Link from 'next/link';
import type { Product } from '@ajooba/contracts';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { EmptyState, ServiceUnavailable } from '@/components/ui/empty-states';

/**
 * The storefront's central rule: an empty or unreachable catalogue must
 * produce a *purposeful* state, never invented data. These tests assert
 * that at the component level, where the rule is actually enforced.
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

describe('ProductGrid — never invents data', () => {
  it('renders an explicit empty state instead of placeholder products', () => {
    const html = renderToStaticMarkup(<ProductGrid products={[]} totalItems={0} />);

    expect(html).toContain('No products found');
    // No price, no product link, no invented title.
    expect(html).not.toContain('₹');
    expect(html).not.toContain('/products/ajooba-a11');
  });

  it('marks an out-of-stock design honestly on the card', () => {
    const html = renderToStaticMarkup(
      <ProductGrid products={[makeProduct({ inStock: false })]} totalItems={1} />,
    );
    expect(html).toContain('Sold out');
  });

  it('does not mark an in-stock design as sold out', () => {
    const html = renderToStaticMarkup(
      <ProductGrid products={[makeProduct({ inStock: true })]} totalItems={1} />,
    );
    expect(html).not.toContain('Sold out');
  });
});

describe('ServiceUnavailable — API down is not "no results"', () => {
  it('says the service is unreachable rather than claiming the catalogue is empty', () => {
    const html = renderToStaticMarkup(<ServiceUnavailable />);
    // The apostrophe is HTML-escaped by the renderer, so assert on the
    // unescaped form of the sentence.
    expect(html).toContain('can&#x27;t reach');
    expect(html).not.toContain('No products found');
  });

  it('is exposed to assistive technology as a status, not a static block', () => {
    const html = renderToStaticMarkup(<ServiceUnavailable />);
    expect(html).toContain('role="status"');
  });
});

describe('EmptyState', () => {
  it('renders the title, description and action', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="Your cart is empty"
        description="Nothing here yet."
        action={
          <Link href="/products" rel="noreferrer">
            Browse
          </Link>
        }
      />,
    );
    expect(html).toContain('Your cart is empty');
    expect(html).toContain('Nothing here yet.');
    expect(html).toContain('href="/products"');
  });
});
