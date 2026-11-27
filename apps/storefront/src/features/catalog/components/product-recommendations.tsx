'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Product } from '@ajooba/contracts';
import { PriceSavings } from '@/components/ui/price-savings';
import { TapLink } from '@/components/track/tap-link';
import { colourwaysOf, dedupeBySize, swatchHex } from '@/lib/colour-swatch';
import { hasDiscount, rupees } from '@/lib/format';
import { mediaUrl } from '@/lib/media';
import { fieldForIndex } from '@/lib/specimen';
import { cn } from '@/lib/cn';
import {
  computeProductRecommendations,
  type RecommendedProductItem,
} from '../lib/product-recommendations';

/**
 * Renders two horizontal scrolling recommendation sections on every Product
 * Detail Page:
 *
 *  1. "Similar styles in your price range" — closest matches by selling price,
 *     category, silhouette & style attributes.
 *  2. "More to explore for your wardrobe" — complementary designs matched by
 *     colour palette, occasion, and value tier.
 */
export function ProductRecommendations({
  product,
  catalogueProducts,
}: {
  product: Product;
  catalogueProducts: readonly Product[];
}) {
  const { similarProducts, complementaryProducts } = useMemo(
    () => computeProductRecommendations(product, catalogueProducts, 10),
    [product, catalogueProducts],
  );

  if (similarProducts.length === 0 && complementaryProducts.length === 0) {
    return null;
  }

  return (
    <div className="mt-14 space-y-12 border-t border-border pt-10">
      {similarProducts.length > 0 ? (
        <RecommendationCarouselSection
          id="pdp-similar-products"
          badge="Hot Picks"
          title="Similar Styles"
          highlightWord="Close Price"
          viewAllHref={`/products?subcategory=${encodeURIComponent(product.subcategorySlug)}`}
          viewAllLabel="See all"
          items={similarProducts}
          indexOffset={0}
        />
      ) : null}

      {complementaryProducts.length > 0 ? (
        <RecommendationCarouselSection
          id="pdp-complementary-products"
          badge="Trending Deals"
          title="More Pairs"
          highlightWord="You'll Love"
          viewAllHref="/products"
          viewAllLabel="See all"
          items={complementaryProducts}
          indexOffset={3}
        />
      ) : null}
    </div>
  );
}

function RecommendationCarouselSection({
  id,
  badge,
  title,
  highlightWord,
  viewAllHref,
  viewAllLabel,
  items,
  indexOffset,
}: {
  id: string;
  badge: string;
  title: string;
  highlightWord: string;
  viewAllHref: string;
  viewAllLabel: string;
  items: readonly RecommendedProductItem[];
  indexOffset: number;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  function scrollByDirection(direction: 'prev' | 'next') {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = Math.max(260, Math.round(node.clientWidth * 0.72));
    node.scrollBy({
      left: direction === 'next' ? distance : -distance,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  return (
    <section aria-labelledby={`${id}-heading`} data-testid={id}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 bg-ink-900 px-2.5 py-1 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-gold-300">
            <FlameIcon />
            {badge}
          </span>
          <h2
            id={`${id}-heading`}
            className="font-hot text-2xl font-extrabold uppercase leading-none tracking-tight text-ink-950 sm:text-3xl lg:text-[2.15rem]"
          >
            {title} <span className="text-hot-fire">· {highlightWord}</span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scrollByDirection('prev')}
            aria-label={`Scroll ${title} left`}
            className="btn-press inline-flex h-9 w-9 items-center justify-center border border-border bg-cream-50 text-ink-800 hover:border-ink-900 hover:text-ink-950"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => scrollByDirection('next')}
            aria-label={`Scroll ${title} right`}
            className="btn-press inline-flex h-9 w-9 items-center justify-center border border-border bg-cream-50 text-ink-800 hover:border-ink-900 hover:text-ink-950"
          >
            →
          </button>
          <Link
            href={viewAllHref}
            className="ml-2 text-xs font-semibold uppercase tracking-wider text-ink-800 underline underline-offset-4 hover:text-ink-950 sm:text-sm"
          >
            {viewAllLabel} →
          </Link>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="scrollbar-soft mt-5 flex snap-x snap-mandatory gap-3.5 overflow-x-auto overscroll-x-contain pb-4 pt-1 sm:gap-4"
      >
        {items.map((item, idx) => (
          <RecommendationCard key={item.product.id} item={item} index={idx + indexOffset} />
        ))}
      </div>
    </section>
  );
}

function FlameIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className="h-3.5 w-3.5 text-gold-400"
    >
      <path d="M8.7 1.3c.3 1.7-.4 2.8-1.3 3.8-.8.9-1.6 1.8-1.6 3.2 0 1.4 1.1 2.5 2.5 2.5s2.4-1.1 2.4-2.5c0-.7-.3-1.4-.7-2 .9.4 2.2 1.6 2.2 3.5 0 2.7-2.1 4.9-4.7 4.9S2.8 12.6 2.8 9.8c0-2.4 1.5-4.1 2.9-5.6C6.9 3 8 1.9 8.7 1.3Z" />
    </svg>
  );
}

function RecommendationCard({ item, index }: { item: RecommendedProductItem; index: number }) {
  const { product, matchLabel } = item;

  const colourways = useMemo(() => {
    const verified = colourwaysOf(product);
    if (verified.length > 0) return verified;
    return product.colours.map((colour) => {
      const variants = product.variants.filter((v) => v.colour === colour);
      const sizes = dedupeBySize(variants);
      const cheapest = variants.reduce<(typeof variants)[number] | undefined>(
        (best, v) => (!best || v.sellingPrice < best.sellingPrice ? v : best),
        undefined,
      );
      return {
        colour,
        hex: swatchHex(colour),
        images: product.images.slice(0, 2),
        variants,
        sizes,
        totalStock: variants.reduce((sum, v) => sum + v.stock, 0),
        inStock: variants.some((v) => v.inStock),
        sellingPrice: cheapest?.sellingPrice ?? product.sellingPrice,
        mrp: cheapest?.mrp ?? product.mrp,
      };
    });
  }, [product]);

  const [activeColourIdx, setActiveColourIdx] = useState(0);
  const way = colourways[activeColourIdx] ?? colourways[0];

  const primary = way?.images[0] ?? product.images.find((img) => img.colour) ?? product.images[0];
  const secondary = way?.images[1];

  const price = way?.sellingPrice ?? product.sellingPrice;
  const mrp = way?.mrp ?? product.mrp;
  const discounted = hasDiscount(mrp, price);
  const anyInStock = product.variants.some((v) => v.inStock);
  const inStockSizes = (way?.sizes ?? []).filter((v) => v.inStock).map((v) => v.size);

  return (
    <article className="group/rec flex w-[13.75rem] shrink-0 snap-start flex-col border border-border/80 bg-cream-50/70 transition-colors hover:border-ink-400 sm:w-[16rem]">
      <TapLink
        href={`/products/${product.slug}`}
        action="product-open"
        surface="home-rail"
        detail={{
          productId: product.id,
          categorySlug: product.subcategorySlug,
          categoryName: product.subcategory,
        }}
        className="block"
      >
        <div className={cn('specimen aspect-[4/4.2] sm:aspect-4/5', fieldForIndex(index))}>
          {primary ? (
            <>
              <img
                key={primary.url}
                src={mediaUrl(primary.url)}
                alt={primary.alt || product.title}
                width={640}
                height={800}
                loading="lazy"
                decoding="async"
                className={cn(
                  'transition-opacity duration-300',
                  secondary ? 'group-hover/rec:opacity-0' : undefined,
                )}
              />
              {secondary ? (
                <img
                  key={secondary.url}
                  src={mediaUrl(secondary.url)}
                  alt=""
                  aria-hidden="true"
                  width={640}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/rec:opacity-100"
                />
              ) : null}
            </>
          ) : null}

          <span className="absolute left-2 top-2 bg-ink-900/90 px-2 py-0.5 text-[0.7rem] font-medium text-cream-50">
            {matchLabel}
          </span>

          {!anyInStock ? (
            <span className="absolute right-2 top-2 bg-claret-700 px-2 py-0.5 text-[0.7rem] font-medium text-cream-50">
              Sold out
            </span>
          ) : null}
        </div>

        <div className="p-3 pb-2">
          <h3 className="line-clamp-2 font-sans text-[0.925rem] font-semibold leading-snug text-ink-950 transition-colors group-hover/rec:text-gold-700">
            {product.title}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <span className="tnum text-base font-bold text-ink-950">{rupees(price)}</span>
            {discounted ? (
              <span className="tnum text-xs font-medium text-ink-400 line-through">
                {rupees(mrp)}
              </span>
            ) : null}
          </div>
          <PriceSavings mrp={mrp} sellingPrice={price} className="mt-1 text-[0.75rem]" />
        </div>
      </TapLink>

      <div className="mt-auto border-t border-border/70 bg-field-a/60 px-3 py-2">
        {colourways.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {colourways.map((c, idx) => {
              const active = idx === activeColourIdx;
              return (
                <button
                  key={c.colour}
                  type="button"
                  onClick={() => setActiveColourIdx(idx)}
                  aria-label={`Preview ${c.colour}`}
                  title={c.colour}
                  className={cn(
                    'inline-flex items-center gap-1 border px-1.5 py-0.5 text-[0.68rem] font-medium transition-colors',
                    active
                      ? 'border-ink-900 bg-ink-900 text-cream-50'
                      : 'border-border bg-cream-50 text-ink-700 hover:border-ink-500',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full border border-ink-900/20"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span>{c.colour}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <p className="mt-1 truncate text-[0.7rem] text-ink-600">
          {inStockSizes.length > 0 ? `UK: ${inStockSizes.join(', ')}` : 'Out of stock'}
        </p>
      </div>
    </article>
  );
}
