import Link from 'next/link';
import type { HomepageProductCard, InteractionSurface } from '@ajooba/contracts';
import { mediaUrl } from '@/lib/media';
import { hasDiscount, rupees } from '@/lib/format';
import { PriceSavings } from '@/components/ui/price-savings';
import { fieldForIndex } from '@/lib/specimen';
import { cn } from '@/lib/cn';
import { TapLink } from '@/components/track/tap-link';

/**
 * The specimen tile.
 *
 * A design shown the way a field guide shows a bird: one object alone on a flat
 * field, at a consistent scale, with its name and facts beneath it.
 */
export { fieldForIndex };

export function SpecimenTile({
  product,
  index = 0,
  priority = false,
  hoverImageUrl,
  hoverImageAlt,
  className,
  surface = 'home-rail',
}: {
  product: HomepageProductCard;
  index?: number;
  priority?: boolean;
  hoverImageUrl?: string;
  hoverImageAlt?: string;
  className?: string;
  surface?: InteractionSurface;
}) {
  const soldOut = !product.isPurchasable;
  const discounted = hasDiscount(product.mrp, product.sellingPrice);

  return (
    <TapLink
      href={`/products/${product.slug}`}
      action="product-open"
      surface={surface}
      detail={{
        productId: product.id,
        categorySlug: product.subcategorySlug,
        categoryName: product.subcategory,
      }}
      className={cn('group block', className)}
      data-testid="specimen-tile"
    >
      <div
        className={cn(
          'specimen aspect-4/5',
          fieldForIndex(index),
          soldOut ? 'opacity-90' : undefined,
        )}
      >
        {product.imageUrl ? (
          <>
            <img
              src={mediaUrl(product.imageUrl)}
              alt={product.imageAlt ?? product.title}
              width={800}
              height={1000}
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : undefined}
              decoding="async"
              className={cn(
                'transition-opacity duration-300',
                hoverImageUrl ? 'group-hover:opacity-0' : undefined,
              )}
            />
            {hoverImageUrl ? (
              <img
                src={mediaUrl(hoverImageUrl)}
                alt={hoverImageAlt ?? ''}
                aria-hidden="true"
                width={800}
                height={1000}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
            ) : null}
          </>
        ) : (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-ink-300"
          >
            <svg viewBox="0 0 64 40" className="h-10 w-16" fill="none" stroke="currentColor">
              <path
                d="M4 30c0-3 3-5 7-6l8-7c2-2 5-2 7 0l3 3 8-2c4-1 7 1 7 5 0 4-3 7-8 7H10c-4 0-6-1-6-3v3Z"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {soldOut ? (
          <span className="absolute left-2 top-2 bg-claret-700 px-2.5 py-1 text-sm font-medium text-cream-50">
            Sold out
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <h3 className="step-md line-clamp-2 font-medium text-ink-900 group-hover:text-gold-700">
          {product.title}
        </h3>
        <p className="mt-1 text-sm text-ink-600">
          {product.subcategory}
          {product.code ? ` · ${product.code}` : ''}
        </p>
        <p className="step-sm mt-1 line-clamp-2 font-medium text-ink-800 group-hover:text-ink-950">
          {product.title}
        </p>

        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="tnum step-md font-semibold text-ink-900">
            {rupees(product.sellingPrice)}
          </span>
          {discounted ? (
            <>
              <span className="tnum text-sm text-ink-500 line-through">{rupees(product.mrp)}</span>
            </>
          ) : null}
        </div>
        <PriceSavings mrp={product.mrp} sellingPrice={product.sellingPrice} className="mt-1.5" />

        {product.verifiedColours.length > 0 ? (
          <p className="mt-1.5 text-sm text-ink-600">
            Colours: {product.verifiedColours.join(', ')}
          </p>
        ) : null}
      </div>
    </TapLink>
  );
}

/**
 * The section heading used by every storefront section.
 */
export function SectionHeading({
  heading,
  subheading,
  href,
  linkLabel,
  className,
}: {
  heading: string;
  subheading?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-8 gap-y-3', className)}>
      <div className="max-w-2xl">
        <h2 className="step-xl text-ink-900">{heading}</h2>
        {subheading ? <p className="step-md mt-3 max-w-xl text-ink-600">{subheading}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className="step-sm link-underline shrink-0 pb-1 text-ink-700 hover:text-ink-950"
        >
          {linkLabel} →
        </Link>
      ) : null}
    </div>
  );
}
