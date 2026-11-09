'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { HomepageProductCard, Product } from '@ajooba/contracts';
import { discountPercent, rupees } from '@/lib/format';
import { colourwaysOf } from '@/lib/colour-swatch';
import { cn } from '@/lib/cn';
import { SectionHeading } from './specimen-tile';
import { ShopTile } from './shop-tile';

/** Build a `HomepageProductCard` projection from a full `Product` record. */
function toCard(product: Product): HomepageProductCard {
  const primaryImage = product.images[0];
  const verifiedColours = colourwaysOf(product).map((c) => c.colour);
  return {
    id: product.id,
    code: product.code,
    slug: product.slug,
    title: product.title,
    subcategory: product.subcategory,
    subcategorySlug: product.subcategorySlug,
    mrp: product.mrp,
    sellingPrice: product.sellingPrice,
    inStock: product.inStock,
    imageUrl: primaryImage?.url ?? null,
    imageAlt: primaryImage?.alt ?? product.title,
    isPurchasable: product.variants.some((v) => v.inStock),
    verifiedColours: verifiedColours.length > 0 ? verifiedColours : product.colours,
  };
}

/**
 * Section 1: Shop by UK / India Size Availability.
 *
 * Groups the live catalogue by every UK foot size actually cut across the
 * collection, ranking in-stock variants first and highest savings next so a
 * shopper can filter to their exact UK size in one tap.
 */
export function SizeAvailabilitySection({ products }: { products: readonly Product[] }) {
  const sizeBuckets = useMemo(() => {
    const map = new Map<number, { size: number; items: Product[]; inStockCount: number }>();

    for (const product of products) {
      if (product.images.length === 0) continue;
      const seenSizes = new Set<number>();
      for (const variant of product.variants) {
        if (seenSizes.has(variant.size)) continue;
        seenSizes.add(variant.size);

        let entry = map.get(variant.size);
        if (!entry) {
          entry = { size: variant.size, items: [], inStockCount: 0 };
          map.set(variant.size, entry);
        }
        entry.items.push(product);
        if (product.variants.some((v) => v.size === variant.size && v.inStock)) {
          entry.inStockCount += 1;
        }
      }
    }

    for (const bucket of map.values()) {
      bucket.items.sort((a, b) => {
        const aInStock = a.variants.some((v) => v.size === bucket.size && v.inStock) ? 1 : 0;
        const bInStock = b.variants.some((v) => v.size === bucket.size && v.inStock) ? 1 : 0;
        if (aInStock !== bInStock) return bInStock - aInStock;
        return b.mrp - b.sellingPrice - (a.mrp - a.sellingPrice);
      });
    }

    return [...map.values()].sort((a, b) => a.size - b.size);
  }, [products]);

  const defaultBucketIdx = useMemo(() => {
    const idx8 = sizeBuckets.findIndex((b) => b.size === 8);
    return idx8 >= 0 ? idx8 : 0;
  }, [sizeBuckets]);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const activeBucket = sizeBuckets[selectedIdx ?? defaultBucketIdx] ?? sizeBuckets[0];

  if (!activeBucket || sizeBuckets.length === 0) return null;

  const displayed = activeBucket.items.slice(0, 4);

  return (
    <section
      className="bg-field-a py-16 md:py-24"
      aria-label="Shop by UK size"
      data-testid="size-availability-section"
    >
      <div className="container-page">
        <SectionHeading
          heading="Shop by your UK size"
          subheading="Select your foot size to see designs cut in that exact UK last, with live SKU codes, colourways and savings."
          href={`/products?size=${activeBucket.size}`}
          linkLabel={`All UK ${activeBucket.size} designs (${activeBucket.items.length})`}
        />

        <div
          role="tablist"
          aria-label="Filter designs by UK size"
          className="scrollbar-none -mx-4 mt-8 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 pb-1 touch-pan-y sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          data-ui="size-tabs"
        >
          {sizeBuckets.map((bucket, idx) => {
            const active = bucket.size === activeBucket.size;
            return (
              <button
                key={bucket.size}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedIdx(idx)}
                className={cn(
                  'btn-press tnum flex shrink-0 items-baseline gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-ink-900 text-cream-50'
                    : 'bg-cream-50 text-ink-800 hover:bg-field-b hover:text-ink-950',
                )}
              >
                <span>UK {bucket.size}</span>
                <span className={cn('text-xs', active ? 'text-gold-300' : 'text-ink-500')}>
                  {bucket.items.length} pairs
                </span>
              </button>
            );
          })}
        </div>

        <ul className="scrollbar-none -mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:mt-10 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
          {displayed.map((product, index) => (
            <li
              key={product.id}
              className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
            >
              <ShopTile
                card={toCard(product)}
                product={product}
                index={index}
                surface="home-rail"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Section 2: Shop by Price Tier, Discount & Multi-Shade Availability.
 *
 * Gives shoppers a direct way to buy by budget and value: pairs under ₹1,499,
 * largest price drops (₹600–₹900 saved), or designs with 3+ verified shades.
 */
export function SavingsAvailabilitySection({ products }: { products: readonly Product[] }) {
  const shelves = useMemo(() => {
    const withPhotos = products.filter((p) => p.images.length > 0);

    const biggestSavings = [...withPhotos]
      .filter((p) => p.mrp - p.sellingPrice >= 500)
      .sort((a, b) => b.mrp - b.sellingPrice - (a.mrp - a.sellingPrice));

    const under1499 = [...withPhotos]
      .filter((p) => p.sellingPrice <= 1499)
      .sort(
        (a, b) => discountPercent(b.mrp, b.sellingPrice) - discountPercent(a.mrp, a.sellingPrice),
      );

    const multiShade = [...withPhotos]
      .filter((p) => colourwaysOf(p).length >= 3 || p.colours.length >= 3)
      .sort((a, b) => colourwaysOf(b).length - colourwaysOf(a).length);

    return [
      {
        id: 'savings',
        label: 'Biggest price drops',
        badge: `Up to ${rupees(biggestSavings[0] ? biggestSavings[0].mrp - biggestSavings[0].sellingPrice : 900)} off`,
        href: '/products?sort=price-asc',
        items: biggestSavings,
      },
      {
        id: 'under-1499',
        label: 'Pairs under ₹1,499',
        badge: `${under1499.length} designs`,
        href: '/products?maxPrice=1499',
        items: under1499,
      },
      {
        id: 'multi-shade',
        label: 'Three or more shades',
        badge: `${multiShade.length} designs`,
        href: '/products',
        items: multiShade,
      },
    ].filter((shelf) => shelf.items.length > 0);
  }, [products]);

  const [activeShelfIdx, setActiveShelfIdx] = useState(0);
  const activeShelf = shelves[activeShelfIdx] ?? shelves[0];

  if (!activeShelf) return null;

  const displayed = activeShelf.items.slice(0, 4);

  return (
    <section
      className="bg-cream-50 py-16 md:py-24"
      aria-label="Pairs by price and savings"
      data-testid="savings-availability-section"
    >
      <div className="container-page">
        <SectionHeading
          heading="Pairs by price and savings"
          subheading="Browse catalogue designs grouped by current price reductions, pairs under ₹1,499, and multi-shade editions."
          href={activeShelf.href}
          linkLabel={`Explore all (${activeShelf.items.length})`}
        />

        <div
          className="mt-8 flex flex-wrap items-center justify-between gap-4"
          data-ui="shelf-tabs"
        >
          <div
            role="tablist"
            aria-label="Filter by price and savings"
            className="scrollbar-none -mx-4 flex w-[calc(100%+2rem)] flex-nowrap items-center gap-2 overflow-x-auto px-4 pb-1 touch-pan-y sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          >
            {shelves.map((shelf, idx) => {
              const active = idx === activeShelfIdx;
              return (
                <button
                  key={shelf.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveShelfIdx(idx)}
                  className={cn(
                    'btn-press tnum flex shrink-0 items-baseline gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-ink-900 text-cream-50'
                      : 'bg-field-a text-ink-800 hover:bg-field-b hover:text-ink-950',
                  )}
                >
                  <span>{shelf.label}</span>
                  <span className={cn('text-xs', active ? 'text-gold-300' : 'text-ink-500')}>
                    {shelf.badge}
                  </span>
                </button>
              );
            })}
          </div>

          <Link
            href={activeShelf.href}
            className="step-xs link-underline font-medium text-ink-800 hover:text-ink-950"
          >
            See all {activeShelf.items.length} pairs in this edit →
          </Link>
        </div>

        <ul className="scrollbar-none -mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:mt-10 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
          {displayed.map((product, index) => (
            <li
              key={product.id}
              className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
            >
              <ShopTile
                card={toCard(product)}
                product={product}
                index={index + 1}
                surface="home-rail"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
