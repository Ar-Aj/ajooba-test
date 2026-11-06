import type { InteractionSurface, Product } from '@ajooba/contracts';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { mediaUrl } from '@/lib/media';
import { hasDiscount, rupees } from '@/lib/format';
import { PriceSavings } from '@/components/ui/price-savings';
import { fieldForIndex } from '@/lib/specimen';
import { TapLink } from '@/components/track/tap-link';

/**
 * The catalogue grid.
 *
 * A shelf of specimens, not a deck of cards. Each design is one flat field with
 * one photograph on it and its own label underneath — the same tile the
 * homepage uses, because a shopper who learns to read one surface should not
 * have to relearn another.
 *
 * Renders real products from the API. When the catalogue is empty for the
 * current filters it renders an explicit empty state with a way out — it never
 * substitutes placeholder or sample products. The visible wording is asserted
 * by `tests/product-grid.test.tsx` and `tests/empty-states.test.tsx`, so the
 * strings and their adjacency are deliberately preserved.
 */

interface ProductGridProps {
  products: readonly Product[];
  totalItems: number;
  /** Which surface these tiles sit on. Defaults to the catalogue grid. */
  surface?: InteractionSurface;
}

export function ProductGrid({ products, totalItems, surface = 'catalog-grid' }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="py-16 text-center md:py-24">
        <h2 className="step-lg text-ink-900">No products found</h2>
        <p className="step-sm mx-auto mt-3 max-w-md text-ink-500">
          The catalogue is empty for these filters. Browse the full catalogue to see every design.
        </p>
        <Link
          href="/products"
          className="btn-press step-sm mt-7 inline-flex bg-ink-900 px-6 py-3 font-medium text-cream-50 hover:bg-ink-800"
        >
          Clear filters
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/*
        The count sits above the grid on its own line. It is the live total for
        the current query, not the number on this page, because that is the
        number a shopper is using to decide whether to filter further.
      */}
      <p className="step-xs mb-6 text-ink-500">
        {totalItems} {totalItems === 1 ? 'design' : 'designs'}
      </p>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((product, index) => (
          <li key={product.id}>
            <SpecimenCard product={product} index={index} surface={surface} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One design on the shelf.
 *
 * The hover behaviour is a second photograph of the *same* design when the
 * catalogue has one, which is the only honest way to preview more of an object
 * without opening it. If there is no second verified view, the tile simply
 * brightens its name — a crossfade to a colour that does not exist would be a
 * lie dressed as an interaction.
 */
export function SpecimenCard({
  product,
  index = 0,
  className,
  surface = 'catalog-grid',
}: {
  product: Product;
  index?: number;
  className?: string;
  /**
   * Which surface the tap is attributed to.
   *
   * The same tile appears on the catalogue grid, the homepage rails, the search
   * results and the wishlist. They are different decisions for the shop — "the
   * homepage rail worked" is not the same news as "the catalogue grid worked" —
   * so the surface travels with the tile rather than being inferred from the
   * route, which cannot distinguish the rail from the grid on `/`.
   */
  surface?: InteractionSurface;
}) {
  const primary = product.images[0];
  const secondary = product.images.find(
    (image) => image.url !== primary?.url && image.colour === primary?.colour,
  );
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
      data-testid="specimen-card"
    >
      <div className={cn('specimen aspect-4/5', fieldForIndex(index))}>
        {primary ? (
          <>
            <img
              src={mediaUrl(primary.url)}
              alt={primary.alt}
              width={800}
              height={1000}
              loading="lazy"
              decoding="async"
              className={cn(
                'transition-opacity duration-300',
                secondary ? 'group-hover:opacity-0' : undefined,
              )}
            />
            {secondary ? (
              <img
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
        ) : (
          /*
            No verified photograph for this design. An empty field, marked as
            empty. Never a stock shoe, never another colour's photograph.
          */
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center text-ink-300"
          >
            <svg viewBox="0 0 64 40" className="h-9 w-14" fill="none" stroke="currentColor">
              <path
                d="M4 30c0-3 3-5 7-6l8-7c2-2 5-2 7 0l3 3 8-2c4-1 7 1 7 5 0 4-3 7-8 7H10c-4 0-6-1-6-3v3Z"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        {product.inStock ? null : (
          <span className="label-cap absolute left-0 top-0 bg-ink-900 px-2 py-1 text-cream-50">
            Sold out
          </span>
        )}
      </div>

      <div className="mt-3">
        <p className="step-xs text-ink-400">{product.subcategory}</p>
        <p className="step-sm mt-1 line-clamp-2 font-medium text-ink-800 group-hover:text-ink-950">
          {product.title}
        </p>
        <p className="step-sm mt-1.5 text-ink-900">
          {rupees(product.sellingPrice)}
          {discounted ? (
            <span className="step-xs ml-2 text-ink-400 line-through">{rupees(product.mrp)}</span>
          ) : null}
        </p>
        <PriceSavings mrp={product.mrp} sellingPrice={product.sellingPrice} className="mt-1" />
        {product.colours.length > 1 ? (
          <p className="step-xs mt-1 text-ink-500">{product.colours.length} colourways</p>
        ) : null}
      </div>
    </TapLink>
  );
}

/**
 * Single product card — the same specimen tile.
 *
 * Kept as a named export because the wishlist and the "you may also like" rails
 * already import it, and a second visual language for the same object in the
 * same shop is exactly the inconsistency this redesign is removing.
 */
export function ProductCard({
  product,
  className,
  surface = 'home-rail',
}: {
  product: Product;
  className?: string;
  surface?: InteractionSurface;
}) {
  return <SpecimenCard product={product} className={className} surface={surface} />;
}
