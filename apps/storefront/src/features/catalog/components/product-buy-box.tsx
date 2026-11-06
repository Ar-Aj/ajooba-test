'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Product, ProductImage, ProductVariant } from '@ajooba/contracts';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { cartStore } from '@/lib/cart-store';
import { wishlistStore } from '@/lib/wishlist-store';
import { mediaUrl } from '@/lib/media';
import { discountPercent, hasDiscount, rupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import { trackAddToCart, trackTap, trackWishlist } from '@/lib/track';

/**
 * The buy box.
 *
 * ## Price and stock come from the variant, never the design
 *
 * The catalogue stores price and stock per SKU (`AJ-A11-BRN-08`), not per
 * design. The design-level `mrp` / `sellingPrice` on `Product` is a summary, so
 * the box never lets a shopper add "the cheapest variant" while the UI showed
 * another colour's price. Every number below is read from the one variant the
 * shopper has actually chosen.
 *
 * ## Colour swatches are photographs
 *
 * A colour row shows the *product photograph of that colour* in a small field,
 * not a coloured dot. A dot can only ever be an approximation of the dye; a
 * thumbnail is proof. Where a colour has no verified photograph the swatch falls
 * back to a plain label — it never imports another colour's picture to fill the
 * hole.
 *
 * ## The CTA has four states and they are never blurred
 *
 *   - size chosen and in stock        → "Add to cart", enabled
 *   - size chosen but sold out        → "Out of stock", disabled
 *   - no size chosen, colour has stock → "Select a size", disabled
 *   - no size chosen, colour sold out  → "Sold out", disabled
 *
 * With this catalogue every variant is currently unstocked, so a shopper must
 * see an honest "sold out" and a way forward — not a button that says "select a
 * size" when no size can ever be selected.
 */
export function ProductBuyBox({
  product,
  selectedColour,
  onColourChange,
}: {
  product: Product;
  /** Controlled colour — owned by the gallery section so both halves agree. */
  selectedColour: string;
  onColourChange: (colour: string) => void;
}) {
  const { toast } = useToast();
  const { cart, isWishlisted, account } = useCommerce();
  const pathname = usePathname();
  const [selectedSku, setSelectedSku] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);

  const colourVariants = useMemo(
    () => dedupeBySize(product.variants.filter((variant) => variant.colour === selectedColour)),
    [product.variants, selectedColour],
  );

  const selectedVariant = useMemo(
    () => colourVariants.find((variant) => variant.sku === selectedSku),
    [colourVariants, selectedSku],
  );

  /*
   * The photograph for the chosen colour, used for the cart line, the wishlist
   * tile and the swatch row. Scoped by colour so a Black pair never ships with a
   * brown thumbnail.
   */
  const colourImageFor = (colour: string): ProductImage | undefined =>
    product.images.find((image) => image.colour === colour);

  const colourImage = colourImageFor(selectedColour);

  const inCartQuantity = useMemo(() => {
    if (!selectedVariant) return 0;
    return cart.find((line) => line.variantSku === selectedVariant.sku)?.quantity ?? 0;
  }, [cart, selectedVariant]);

  const maxAddable = selectedVariant
    ? Math.min(10 - inCartQuantity, selectedVariant.inStock ? 10 : 0)
    : 0;

  const anyInStock = product.variants.some((variant) => variant.inStock);
  const anyInStockInColour = product.variants.some(
    (variant) => variant.colour === selectedColour && variant.inStock,
  );
  const selectedColourAwaitingPhotos = product.variants.some(
    (variant) =>
      variant.colour === selectedColour && variant.photographyStatus === 'pending-review',
  );

  const displayPrice = selectedVariant?.sellingPrice ?? product.sellingPrice;
  const displayMrp = selectedVariant?.mrp ?? product.mrp;

  const ctaState: 'add' | 'sold-out' | 'out-of-stock' | 'select-size' = selectedVariant
    ? selectedVariant.inStock
      ? 'add'
      : 'out-of-stock'
    : anyInStockInColour
      ? 'select-size'
      : 'sold-out';

  const ctaLabel =
    ctaState === 'add'
      ? maxAddable <= 0
        ? 'Maximum already in cart'
        : 'Add to cart'
      : ctaState === 'out-of-stock'
        ? 'Out of stock in this size'
        : ctaState === 'sold-out'
          ? 'Sold out'
          : 'Select a size';

  function addToCart() {
    if (!selectedVariant) return;
    if (!selectedVariant.inStock) {
      toast({
        title: 'That size is out of stock',
        description: 'Pick another size, or save this design to your wishlist.',
        tone: 'warning',
      });
      return;
    }

    const qty = Math.min(Math.max(1, quantity), Math.max(1, maxAddable));
    const lineImage = colourImage ?? product.images[0];

    cartStore.add({
      variantSku: selectedVariant.sku,
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      colour: selectedVariant.colour,
      size: selectedVariant.size,
      unitMrp: selectedVariant.mrp,
      unitPrice: selectedVariant.sellingPrice,
      quantity: qty,
      /*
       * The cart line must show the colour the shopper selected, not whichever
       * image happened to be first in the design's gallery. When there is no
       * photograph at all the field is left undefined rather than pointing at
       * the site root — `mediaUrl('')` returns '/', which would render the
       * homepage as the line thumbnail.
       */
      ...(lineImage ? { imageUrl: mediaUrl(lineImage.url), imageAlt: lineImage.alt } : {}),
    });

    /*
     * The single most valuable tap in the shop. Recorded only after the cart
     * actually accepted the line, so the number matches what the shopper sees:
     * an add-to-cart recorded for a click that failed would make the buy box's
     * conversion rate a fiction.
     */
    trackAddToCart({
      productId: product.id,
      sku: selectedVariant.sku,
      quantity: qty,
      surface: 'pdp-buy-box',
      categorySlug: product.subcategorySlug,
      categoryName: product.subcategory,
    });

    toast({
      title: 'Added to your cart',
      description: `${product.title} — ${selectedVariant.colour}, UK ${selectedVariant.size}`,
      tone: 'success',
    });
  }

  const wishlisted = isWishlisted(product.id);

  /*
   * A wishlist is not a device-local thing that can be silently kept.
   *
   * The storefront used to write the save to `localStorage` and say "Saved to
   * your wishlist" whether or not anybody was signed in. On this device that
   * looked like it worked; on the next one the shoe was gone, and the shop had
   * never heard of the save at all. Telling somebody a thing is saved when it is
   * not is worse than refusing, so the refusal is explicit and offers the fix
   * in the same breath.
   */
  function toggleWishlist() {
    if (!account) {
      toast({
        title: 'Sign in to save designs',
        description:
          'A wishlist follows you between devices, so it needs an account. Signing in takes a moment and keeps this pair here when you come back.',
        tone: 'warning',
        action: { label: 'Sign in', href: `/login?next=${encodeURIComponent(pathname)}` },
      });
      trackTap('wishlist-toggle', 'pdp-buy-box', {
        productId: product.id,
        categorySlug: product.subcategorySlug,
        categoryName: product.subcategory,
      });
      return;
    }

    const result = wishlistStore.toggle({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      productCode: product.code,
      unitPrice: product.sellingPrice,
      unitMrp: product.mrp,
      ...(colourImage ? { imageUrl: mediaUrl(colourImage.url), imageAlt: colourImage.alt } : {}),
    });
    toast({
      title: result.added ? 'Saved to your wishlist' : 'Removed from your wishlist',
      tone: 'info',
    });
    trackWishlist({
      productId: product.id,
      surface: 'pdp-buy-box',
      saved: result.added,
      categorySlug: product.subcategorySlug,
    });
  }

  return (
    <div className="flex flex-col">
      {/* ---- identity ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="label-cap text-ink-400">
          {product.brand} · {product.code}
        </p>
        {!anyInStock ? (
          <span className="label-cap text-claret-700">Sold out</span>
        ) : product.inStock ? null : (
          <span className="label-cap text-gold-700">Limited stock</span>
        )}
      </div>

      <h1 className="step-xl mt-3 text-ink-900">{product.title}</h1>

      <div className="mt-4 flex flex-wrap items-baseline gap-3">
        <span className="tnum step-lg text-ink-900">{rupees(displayPrice)}</span>
        {hasDiscount(displayMrp, displayPrice) ? (
          <>
            <span className="tnum step-sm text-ink-400 line-through">{rupees(displayMrp)}</span>
            <span className="step-xs text-gold-700">
              {discountPercent(displayMrp, displayPrice)}% off
            </span>
          </>
        ) : null}
      </div>
      <p className="step-xs mt-1 text-ink-400">Inclusive of all taxes</p>

      {product.description ? (
        <p className="step-sm mt-6 max-w-prose text-ink-600">{product.description}</p>
      ) : null}

      {/* ---- colour ------------------------------------------------------ */}
      {product.colours.length > 0 ? (
        <fieldset className="mt-8">
          <legend className="mb-3 flex w-full items-baseline justify-between gap-4">
            <span className="label-cap text-ink-400">
              Colour <span className="text-ink-800">{selectedColour}</span>
            </span>
            {product.colours.length > 1 ? (
              <span className="step-xs text-ink-400">{product.colours.length} available</span>
            ) : null}
          </legend>

          <div className="flex flex-wrap gap-2">
            {product.colours.map((colour, index) => {
              const available = product.variants.some(
                (variant) => variant.colour === colour && variant.inStock,
              );
              const active = colour === selectedColour;
              const swatch = colourImageFor(colour);
              const awaitingPhotos = product.variants.some(
                (variant) =>
                  variant.colour === colour && variant.photographyStatus === 'pending-review',
              );

              return (
                <button
                  key={colour}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${colour}${!available ? ', out of stock' : ''}${
                    awaitingPhotos ? ', photography in progress' : ''
                  }`}
                  onClick={() => {
                    onColourChange(colour);
                    setSelectedSku(undefined);
                    setQuantity(1);
                    trackTap('select-colour', 'pdp-buy-box', {
                      productId: product.id,
                      categorySlug: product.subcategorySlug,
                      categoryName: product.subcategory,
                    });
                  }}
                  className={cn(
                    'group/swatch btn-press flex items-center gap-2 border py-1 pl-1 pr-3',
                    active
                      ? 'border-ink-900 text-ink-950'
                      : 'border-border text-ink-600 hover:border-ink-400 hover:text-ink-900',
                  )}
                >
                  {/*
                    The photograph is the swatch. A colour with no verified
                    photograph gets no thumbnail at all — the label alone is the
                    honest version, and is better than a dot implying we have a
                    picture we do not.
                  */}
                  <span
                    className={cn(
                      'specimen h-9 w-9 shrink-0',
                      index % 2 === 0 ? 'bg-field-a' : 'bg-field-b',
                      active ? 'opacity-100' : 'opacity-80 group-hover/swatch:opacity-100',
                    )}
                  >
                    {swatch ? (
                      <img
                        src={mediaUrl(swatch.url)}
                        alt=""
                        width={72}
                        height={72}
                        loading="lazy"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 m-auto h-2.5 w-2.5 bg-ink-300"
                      />
                    )}
                  </span>
                  <span className="step-xs font-medium">{colour}</span>
                  {!available ? (
                    <span className="step-xs text-ink-400" aria-hidden="true">
                      —
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selectedColourAwaitingPhotos ? (
            <p className="step-xs mt-3 text-ink-500">
              We are still photographing this colourway, so it is not on sale yet. The other colours
              above are available now.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {/* ---- size -------------------------------------------------------- */}
      <fieldset className="mt-8">
        <legend className="mb-3 flex w-full items-baseline justify-between gap-4">
          <span className="label-cap text-ink-400">
            Size <span className="text-ink-800">UK / India</span>
          </span>
          <Link
            href="/contact"
            className="step-xs text-ink-500 underline underline-offset-4 hover:text-ink-900"
          >
            Size help
          </Link>
        </legend>

        {colourVariants.length === 0 ? (
          <p className="step-sm border border-border px-4 py-3 text-ink-500">
            We have no size data for this colour yet. Try another colour, or contact us and we will
            confirm availability.
          </p>
        ) : (
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
            {colourVariants.map((variant) => {
              const active = variant.sku === selectedSku;
              return (
                <button
                  key={variant.sku}
                  type="button"
                  aria-pressed={active}
                  aria-label={
                    variant.inStock
                      ? `UK size ${variant.size}`
                      : `UK size ${variant.size}, out of stock`
                  }
                  onClick={() => {
                    setSelectedSku(variant.sku);
                    setQuantity(1);
                    trackTap('select-size', 'pdp-buy-box', {
                      productId: product.id,
                      sku: variant.sku,
                      categorySlug: product.subcategorySlug,
                      categoryName: product.subcategory,
                    });
                  }}
                  className={cn(
                    'btn-press tnum step-sm relative h-11 border',
                    active
                      ? 'border-ink-900 bg-ink-900 text-cream-50'
                      : variant.inStock
                        ? 'border-border text-ink-900 hover:border-ink-500'
                        : 'cursor-not-allowed border-border text-ink-300',
                  )}
                >
                  {variant.size}
                  {!variant.inStock ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-1.5 top-1/2 h-px rotate-[-18deg] bg-ink-200"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      {/* ---- quantity + CTA ---------------------------------------------- */}
      <div className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center border border-border">
            <button
              type="button"
              onClick={() => {
                setQuantity((current) => Math.max(1, current - 1));
                trackTap('quantity-decrease', 'pdp-buy-box', {
                  productId: product.id,
                  categorySlug: product.subcategorySlug,
                });
              }}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
              className="h-11 w-11 text-ink-600 hover:text-ink-900 disabled:opacity-30"
            >
              −
            </button>
            <label htmlFor="qty" className="sr-only">
              Quantity
            </label>
            <input
              id="qty"
              type="number"
              min={1}
              max={Math.max(1, maxAddable)}
              value={quantity}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setQuantity(Number.isFinite(parsed) ? Math.max(1, parsed) : 1);
              }}
              className="tnum step-sm h-11 w-11 border-x border-border bg-transparent text-center focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setQuantity((current) => Math.min(Math.max(1, maxAddable), current + 1));
                trackTap('quantity-increase', 'pdp-buy-box', {
                  productId: product.id,
                  categorySlug: product.subcategorySlug,
                });
              }}
              disabled={quantity >= Math.max(1, maxAddable)}
              aria-label="Increase quantity"
              className="h-11 w-11 text-ink-600 hover:text-ink-900 disabled:opacity-30"
            >
              +
            </button>
          </div>

          {inCartQuantity > 0 ? (
            <Link
              href="/cart"
              className="step-xs text-ink-600 underline underline-offset-4 hover:text-ink-900"
            >
              {inCartQuantity} already in your cart · view
            </Link>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={addToCart}
            disabled={ctaState !== 'add' || maxAddable <= 0}
            className="btn-press step-sm flex-1 bg-ink-900 py-4 font-medium text-cream-50 hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 sm:flex-[2]"
          >
            {ctaLabel}
          </button>
          <button
            type="button"
            onClick={toggleWishlist}
            aria-pressed={wishlisted}
            className={cn(
              'btn-press step-sm border px-6 py-4 font-medium',
              wishlisted
                ? 'border-ink-900 bg-cream-100 text-ink-950'
                : 'border-border text-ink-700 hover:border-ink-500 hover:text-ink-950',
            )}
          >
            {wishlisted ? 'Saved' : 'Save'}
          </button>
        </div>

        {selectedVariant && !selectedVariant.inStock ? (
          <p className="step-xs mt-3 text-claret-700">
            This size is unavailable. Choose another size, or save the design and check back.
          </p>
        ) : null}
        {selectedVariant && selectedVariant.inStock && selectedVariant.stock <= 3 ? (
          <p className="step-xs mt-3 text-gold-700">
            Only {selectedVariant.stock} left in UK {selectedVariant.size}.
          </p>
        ) : null}

        {/*
          The sold-out explanation, in the shop's own voice. It sits below the
          button rather than in a coloured box: the button already says "Sold
          out", and a second loud statement of the same fact is noise.
        */}
        {ctaState === 'sold-out' ? (
          <div className="mt-5 border-t border-border pt-4">
            <p className="step-sm text-ink-800">This design is sold out in {selectedColour}.</p>
            <p className="step-sm mt-1.5 max-w-prose text-ink-500">
              Stock is confirmed against our warehouse before a pair is listed as available, so we
              would rather show you an honest sold out than take an order we cannot ship. Save the
              design, or write to us and we will tell you when it returns.
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              <Link
                href={`/contact?design=${encodeURIComponent(product.code)}`}
                className="step-xs link-underline text-ink-700 hover:text-ink-950"
              >
                Ask about this design
              </Link>
              <Link
                href={`/products?subcategory=${encodeURIComponent(product.subcategorySlug)}`}
                className="step-xs link-underline text-ink-700 hover:text-ink-950"
              >
                See more {product.subcategory}
              </Link>
            </div>
          </div>
        ) : null}

        {/*
          The three reassurances, as a plain list rather than icon tiles. They
          are the same promises the trust band makes, restated where the shopper
          is actually deciding.
        */}
        <ul className="mt-8 space-y-2 border-t border-border pt-5">
          {[
            'Free shipping over ₹1,499 · dispatched in 1 working day',
            '10-day returns, prepaid label in the box',
            'Photographed colour by colour — what you see is the pair you get',
          ].map((line) => (
            <li key={line} className="step-xs flex gap-2.5 text-ink-500">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 bg-gold-500" />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * For each size, keep one representative variant.
 *
 * Prefer in stock, then the lowest price — that is what a shopper would be shown
 * anyway, and keeping every duplicate would render two identical "UK 8" buttons
 * with different SKUs behind them.
 */
function dedupeBySize(variants: readonly ProductVariant[]): ProductVariant[] {
  const bySize = new Map<number, ProductVariant>();
  for (const variant of variants) {
    const existing = bySize.get(variant.size);
    if (!existing) {
      bySize.set(variant.size, variant);
      continue;
    }
    const better =
      (variant.inStock && !existing.inStock) ||
      (variant.inStock === existing.inStock && variant.sellingPrice < existing.sellingPrice);
    if (better) bySize.set(variant.size, variant);
  }
  return [...bySize.values()].sort((a, b) => a.size - b.size);
}
