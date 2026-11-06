'use client';

import { useMemo, useState } from 'react';
import type { HomepageProductCard, InteractionSurface, Product } from '@ajooba/contracts';
import { mediaUrl } from '@/lib/media';
import { hasDiscount, rupees } from '@/lib/format';
import { PriceSavings } from '@/components/ui/price-savings';
import { fieldForIndex } from '@/lib/specimen';
import { colourwaysOf, dedupeBySize, swatchHex } from '@/lib/colour-swatch';
import { cn } from '@/lib/cn';
import { trackTap } from '@/lib/track';
import { TapLink } from '@/components/track/tap-link';

const CARD_UK_SIZES = [6, 7, 8, 9, 10, 11] as const;

/**
 * The shop tile — a specimen tile that carries what a shopper needs to decide:
 *  1. Price, MRP, and exact savings in rupees and percent (`Save ₹X · Y% off`).
 *  2. Interactive colourway swatches that swap the photograph, sizes and SKUs.
 *  3. UK sizes & SKUs of the chosen colourway, with unavailable sizes visibly
 *     struck and cut through.
 */
export function ShopTile({
  card,
  product,
  index = 0,
  priority = false,
  surface = 'home-rail',
  className,
}: {
  card: HomepageProductCard;
  product: Product;
  index?: number;
  priority?: boolean;
  surface?: InteractionSurface;
  className?: string;
}) {
  const colourways = useMemo(() => {
    const verified = colourwaysOf(product);
    if (verified.length > 0) return verified;
    const allColours = product.colours.length > 0 ? product.colours : card.verifiedColours;
    return allColours.map((colour) => {
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
        sellingPrice: cheapest?.sellingPrice ?? card.sellingPrice,
        mrp: cheapest?.mrp ?? card.mrp,
      };
    });
  }, [product, card]);

  const [activeColourIdx, setActiveColourIdx] = useState(0);
  const [selectedSizeIdx, setSelectedSizeIdx] = useState(0);

  const way = colourways[activeColourIdx] ?? colourways[0];

  const primary = way?.images[0];
  const secondary = way?.images[1];
  const imageUrl = primary?.url ?? card.imageUrl;
  const imageAlt = primary?.alt ?? card.imageAlt ?? card.title;

  const sizes = way?.sizes ?? [];
  const activeVariant = sizes[selectedSizeIdx] ?? sizes[0];

  const price = activeVariant?.sellingPrice ?? way?.sellingPrice ?? card.sellingPrice;
  const mrp = activeVariant?.mrp ?? way?.mrp ?? card.mrp;
  const discounted = hasDiscount(mrp, price);

  const anyInStock = product.variants.some((variant) => variant.inStock);

  const chooseColour = (next: number) => {
    if (next === activeColourIdx) return;
    setActiveColourIdx(next);
    setSelectedSizeIdx(0);
  };

  return (
    <div className={cn('group/tile flex flex-col', className)} data-testid="specimen-tile">
      <TapLink
        href={`/products/${product.slug}`}
        action="product-open"
        surface={surface}
        detail={{
          productId: product.id,
          categorySlug: product.subcategorySlug,
          categoryName: product.subcategory,
        }}
        className="group block"
      >
        <div
          className={cn(
            'specimen aspect-4/5',
            fieldForIndex(index),
            anyInStock ? undefined : 'opacity-95',
          )}
        >
          {imageUrl ? (
            <>
              <img
                key={imageUrl}
                src={mediaUrl(imageUrl)}
                alt={imageAlt}
                width={800}
                height={1000}
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : undefined}
                decoding="async"
                className={cn(
                  'animate-in fade-in-0 duration-300 transition-opacity',
                  secondary ? 'group-hover:opacity-0' : undefined,
                )}
              />
              {secondary ? (
                <img
                  key={secondary.url}
                  src={mediaUrl(secondary.url)}
                  alt=""
                  aria-hidden="true"
                  width={800}
                  height={1000}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />
              ) : null}
            </>
          ) : null}

          {anyInStock ? (
            <span className="absolute left-2 top-2 bg-ink-900 px-2.5 py-1 text-sm font-medium text-cream-50">
              In stock
            </span>
          ) : (
            <span className="absolute left-2 top-2 bg-claret-700 px-2.5 py-1 text-sm font-medium text-cream-50">
              Sold out
            </span>
          )}
        </div>

        <div className="mt-3">
          {/* Heading comes first so no small text sits directly above h3 */}
          <h3 className="step-md line-clamp-2 font-medium text-ink-900 group-hover:text-gold-700">
            {product.title}
          </h3>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-600">
            <span>
              {product.subcategory} · {product.code}
            </span>
            {activeVariant ? (
              <span className="tnum text-ink-700">SKU: {activeVariant.sku}</span>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="tnum step-md font-semibold text-ink-900">{rupees(price)}</span>
            {discounted ? (
              <>
                <span className="tnum text-sm text-ink-500 line-through">MRP {rupees(mrp)}</span>
              </>
            ) : null}
          </div>
          <PriceSavings mrp={mrp} sellingPrice={price} className="mt-1.5" />
        </div>
      </TapLink>

      {/* ---- Interactive Colourways & UK Sizes / SKUs --------------------- */}
      <div className="mt-3 space-y-2.5 bg-field-a p-3">
        {colourways.length > 0 ? (
          <div>
            <div className="flex items-center justify-between gap-2 text-sm text-ink-700">
              <span>
                Shade: <strong className="font-medium text-ink-900">{way?.colour}</strong>
              </span>
              <span className="tnum">
                {colourways.length} {colourways.length === 1 ? 'colour' : 'colours'}
              </span>
            </div>

            <div
              role="group"
              aria-label={`${product.title}: colourways`}
              className="scrollbar-none mt-1.5 flex flex-nowrap items-center gap-1.5 overflow-x-auto touch-pan-y sm:flex-wrap sm:overflow-visible"
            >
              {colourways.map((colourway, position) => {
                const selected = position === activeColourIdx;
                return (
                  <button
                    key={colourway.colour}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`Show ${colourway.colour}${colourway.inStock ? '' : ', sold out'}`}
                    title={`${colourway.colour}${colourway.inStock ? ' (In stock)' : ' (Out of stock)'}`}
                    onMouseEnter={() => chooseColour(position)}
                    onFocus={() => chooseColour(position)}
                    onClick={() => {
                      chooseColour(position);
                      trackTap('select-colour', surface, {
                        productId: product.id,
                        categorySlug: product.subcategorySlug,
                        categoryName: product.subcategory,
                      });
                    }}
                    className={cn(
                      'btn-press inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-sm transition-colors',
                      selected
                        ? 'bg-ink-900 font-medium text-cream-50'
                        : 'bg-cream-50 text-ink-800 hover:bg-cream-200',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="block h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: colourway.hex }}
                    />
                    <span>{colourway.colour}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {sizes.length > 0 ? (
          <div>
            <div className="flex items-center justify-between gap-2 text-sm text-ink-700">
              <span>UK size & SKU</span>
              <span className="tnum">{sizes.filter((v) => v.inStock).length} sizes in stock</span>
            </div>

            <ul
              className="scrollbar-none mt-1.5 flex flex-nowrap items-center gap-1.5 overflow-x-auto touch-pan-y sm:flex-wrap sm:overflow-visible"
              aria-label={`Available UK sizes in ${way?.colour}`}
            >
              {CARD_UK_SIZES.map((ukSize) => {
                const sIdx = sizes.findIndex((v) => v.size === ukSize);
                const variant = sIdx >= 0 ? sizes[sIdx] : undefined;
                const inStock = Boolean(variant && variant.inStock);
                const isSelectedSize = sIdx >= 0 && sIdx === selectedSizeIdx;

                return (
                  <li key={ukSize} className="shrink-0">
                    <button
                      type="button"
                      disabled={!variant}
                      onClick={() => {
                        if (sIdx >= 0) setSelectedSizeIdx(sIdx);
                      }}
                      onMouseEnter={() => {
                        if (sIdx >= 0) setSelectedSizeIdx(sIdx);
                      }}
                      aria-label={
                        variant
                          ? `UK ${ukSize} (${variant.sku}) — ${inStock ? 'In stock' : 'Out of stock'}`
                          : `UK ${ukSize} — Not offered`
                      }
                      title={
                        variant
                          ? `SKU ${variant.sku} · UK ${ukSize} · ${inStock ? 'In stock' : 'Out of stock'}`
                          : `UK ${ukSize} · Out of stock`
                      }
                      className={cn(
                        'tnum relative inline-flex h-7 min-w-8 items-center justify-center px-2 text-sm font-medium transition-colors',
                        inStock
                          ? isSelectedSize
                            ? 'bg-ink-900 text-cream-50'
                            : 'bg-cream-50 text-ink-900 hover:bg-cream-200'
                          : isSelectedSize
                            ? 'bg-cream-200 text-ink-700 line-through'
                            : 'bg-cream-50/75 text-ink-500 line-through hover:bg-cream-200',
                      )}
                    >
                      {ukSize}
                      {!inStock ? <CardDiagonalCut /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CardDiagonalCut() {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-claret-600/65"
    >
      <line x1="10" y1="90" x2="90" y2="10" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}
