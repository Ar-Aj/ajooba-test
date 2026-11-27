'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Product, ProductImage, ProductVariant } from '@ajooba/contracts';
import { Button } from '@/components/ui/button';
import { PriceSavings } from '@/components/ui/price-savings';
import { ProductConfidence } from './product-confidence';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { cartStore } from '@/lib/cart-store';
import { wishlistStore } from '@/lib/wishlist-store';
import { mediaUrl } from '@/lib/media';
import { hasDiscount, rupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import { trackAddToCart, trackTap, trackWishlist } from '@/lib/track';

const DESCRIPTION_PREVIEW_LENGTH = 185;

type DetailTabKey = 'description' | 'specifications' | 'shipping';

/**
 * Extracts key design & feature tags from the product's title and description
 * so the Specifications & Features tab can display structured highlights
 * alongside the catalogue's core variant data.
 */
function extractProductFeatureHighlights(product: Product): {
  silhouette: string;
  closure: string;
  finish: string;
  occasions: string;
} {
  const text = `${product.title} ${product.description}`.toLowerCase();

  let silhouette = product.subcategory;
  if (text.includes('loafer')) silhouette = 'Loafers';
  else if (text.includes('mojri') || text.includes('jutti'))
    silhouette = 'Traditional Mojri / Jutti';
  else if (text.includes('oxford')) silhouette = 'Oxford Dress Shoes';
  else if (text.includes('derby')) silhouette = 'Derby Shoes';
  else if (text.includes('monk')) silhouette = 'Monk Strap Shoes';
  else if (text.includes('mules') || text.includes('mule')) silhouette = 'Slip-On Mules';
  else if (text.includes('sandal')) silhouette = 'Sandals';
  else if (text.includes('sneaker')) silhouette = 'Casual Sneakers';

  let closure = 'Slip-On';
  if (text.includes('lace-up') || text.includes('lace up')) closure = 'Lace-Up';
  else if (text.includes('buckle') || text.includes('monk')) closure = 'Buckle / Strap';
  else if (text.includes('slip-on') || text.includes('slip on')) closure = 'Easy Slip-On';

  const finishes: string[] = [];
  if (text.includes('patent') || text.includes('gloss')) finishes.push('High-Gloss Patent');
  if (text.includes('suede')) finishes.push('Suede Finish');
  if (text.includes('textured') || text.includes('woven')) finishes.push('Textured Weave');
  if (text.includes('horsebit')) finishes.push('Metallic Horsebit Detail');
  if (text.includes('tassel')) finishes.push('Tassel Accent');
  if (text.includes('embossed') || text.includes('croc')) finishes.push('Embossed Pattern');
  if (text.includes('embroidered') || text.includes('ethnic')) finishes.push('Artisanal Detailing');
  const finish = finishes.length > 0 ? finishes.slice(0, 2).join(' · ') : 'Hand-Finished Upper';

  const occasionList: string[] = [];
  if (text.includes('wedding') || text.includes('reception') || text.includes('festive')) {
    occasionList.push('Weddings & Festive');
  }
  if (
    text.includes('formal') ||
    text.includes('business') ||
    text.includes('office') ||
    text.includes('suit')
  ) {
    occasionList.push('Formal & Business');
  }
  if (text.includes('party') || text.includes('celebration')) {
    occasionList.push('Parties & Evenings');
  }
  if (text.includes('casual') || text.includes('everyday')) {
    occasionList.push('Smart Casual');
  }
  const occasions =
    occasionList.length > 0 ? occasionList.slice(0, 2).join(', ') : `${product.subcategory} Wear`;

  return { silhouette, closure, finish, occasions };
}

/**
 * The buy box.
 *
 * Restructured so shoppers see a balanced product title, clear brand/category
 * identity, pricing, colour & size selection, and primary purchase actions
 * immediately above the fold — followed by a compact, category-segregated
 * section for Description (with a "Read more" toggle) and Specifications.
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
  const router = useRouter();
  const [selectedSku, setSelectedSku] = useState<string | undefined>(undefined);
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState<DetailTabKey>('description');
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  const colourVariants = useMemo(
    () => dedupeBySize(product.variants.filter((variant) => variant.colour === selectedColour)),
    [product.variants, selectedColour],
  );

  const selectedVariant = useMemo(
    () => colourVariants.find((variant) => variant.sku === selectedSku),
    [colourVariants, selectedSku],
  );

  const allSizes = useMemo(
    () => [...new Set(product.variants.map((v) => v.size))].sort((a, b) => a - b),
    [product.variants],
  );

  const inStockSizesForColour = useMemo(
    () => colourVariants.filter((v) => v.inStock).map((v) => v.size),
    [colourVariants],
  );

  const featureHighlights = useMemo(() => extractProductFeatureHighlights(product), [product]);

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

  const purchaseUnavailable = ctaState === 'sold-out' || ctaState === 'out-of-stock';
  const addDisabled = purchaseUnavailable || (ctaState === 'add' && maxAddable <= 0);
  const buyDisabled =
    purchaseUnavailable || (ctaState === 'add' && maxAddable <= 0 && inCartQuantity === 0);

  function scrollToSize() {
    const sizeSelector = document.getElementById('pdp-size-selector');
    if (!sizeSelector) return;

    sizeSelector.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  }

  function addToCart(proceedToCheckout = false) {
    if (!selectedVariant) {
      if (ctaState === 'select-size') scrollToSize();
      return;
    }
    if (!selectedVariant.inStock) {
      toast({
        title: 'That size is out of stock',
        description: 'Pick another size, or save this design to your wishlist.',
        tone: 'warning',
      });
      return;
    }

    if (maxAddable <= 0) {
      if (proceedToCheckout && inCartQuantity > 0) router.push('/checkout');
      return;
    }

    const qty = Math.min(Math.max(1, quantity), maxAddable);
    const lineImage = colourImage ?? product.images[0];

    cartStore.add({
      variantSku: selectedVariant.sku,
      ...(selectedVariant.id ? { variantId: selectedVariant.id } : {}),
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      colour: selectedVariant.colour,
      size: selectedVariant.size,
      unitMrp: selectedVariant.mrp,
      unitPrice: selectedVariant.sellingPrice,
      quantity: qty,
      ...(lineImage ? { imageUrl: mediaUrl(lineImage.url), imageAlt: lineImage.alt } : {}),
    });

    trackAddToCart({
      productId: product.id,
      sku: selectedVariant.sku,
      quantity: qty,
      surface: 'pdp-buy-box',
      categorySlug: product.subcategorySlug,
      categoryName: product.subcategory,
    });

    if (proceedToCheckout) {
      router.push('/checkout');
    } else {
      toast({
        title: 'Added to your cart',
        description: `${product.title} — ${selectedVariant.colour}, UK ${selectedVariant.size}`,
        tone: 'success',
      });
    }
  }

  const wishlisted = isWishlisted(product.id);

  function toggleWishlist() {
    if (!account) {
      toast({
        title: 'Sign in to save designs',
        description: 'Sign in to save this design to your account wishlist.',
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

    void wishlistStore
      .toggleRemote({
        productId: product.id,
        productSlug: product.slug,
        productTitle: product.title,
        productCode: product.code,
        unitPrice: product.sellingPrice,
        unitMrp: product.mrp,
        ...(colourImage ? { imageUrl: mediaUrl(colourImage.url), imageAlt: colourImage.alt } : {}),
      })
      .then((result) => {
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
      })
      .catch((error: unknown) => {
        toast({
          title: 'Could not update wishlist',
          description: error instanceof Error ? error.message : 'Please try again in a moment.',
          tone: 'warning',
        });
      });
  }

  const rawDescription = product.description?.trim() ?? '';
  const shouldTruncateDescription = rawDescription.length > DESCRIPTION_PREVIEW_LENGTH;
  const visibleDescription =
    shouldTruncateDescription && !isDescriptionExpanded
      ? `${rawDescription.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}…`
      : rawDescription;

  return (
    <div className="flex flex-col">
      {/* ---- 1. Brand, Category & Stock Badge ----------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center bg-ink-900 px-2.5 py-0.5 text-[0.72rem] font-semibold uppercase tracking-widest text-cream-50">
            {product.brand}
          </span>
          <span className="inline-flex items-center border border-border bg-field-a px-2.5 py-0.5 text-[0.72rem] font-medium uppercase tracking-wider text-ink-700">
            {product.subcategory}
          </span>
        </div>
        {!anyInStock ? (
          <span className="label-cap text-claret-700">Sold out</span>
        ) : product.inStock ? (
          <span className="text-xs font-semibold text-emerald-800">● In stock</span>
        ) : (
          <span className="label-cap text-gold-700">Limited stock</span>
        )}
      </div>

      {/* ---- 2. Product Name (Reduced, Balanced Sizing — Context Unchanged) */}
      <h1 className="mt-2.5 font-sans text-lg font-semibold leading-snug tracking-tight text-ink-950 sm:text-xl lg:text-[1.35rem]">
        {product.title}
      </h1>

      {/* ---- 3. Pricing & Savings Block ----------------------------------- */}
      <div className="mt-3.5 border-y border-border/80 bg-field-e/50 px-3.5 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="tnum text-2xl font-bold text-ink-950 sm:text-[1.65rem]">
            {rupees(displayPrice)}
          </span>
          {hasDiscount(displayMrp, displayPrice) ? (
            <span className="tnum text-sm font-medium text-ink-400 line-through">
              MRP {rupees(displayMrp)}
            </span>
          ) : null}
          <PriceSavings mrp={displayMrp} sellingPrice={displayPrice} />
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Inclusive of all taxes · Shipping &amp; COD availability confirmed at checkout.
        </p>
      </div>

      {/* ---- 4. At-a-Glance Selection Summary Strip ----------------------- */}
      <div className="mt-3.5 grid grid-cols-3 gap-2 border border-border bg-cream-100/60 p-2.5 text-xs">
        <div>
          <span className="block text-[0.68rem] font-medium uppercase tracking-wider text-ink-400">
            Brand
          </span>
          <span className="mt-0.5 block truncate font-semibold text-ink-900">{product.brand}</span>
        </div>
        <div className="border-x border-border/70 px-2">
          <span className="block text-[0.68rem] font-medium uppercase tracking-wider text-ink-400">
            Colour
          </span>
          <span className="mt-0.5 block truncate font-semibold text-ink-900">
            {selectedColour || '—'}
          </span>
        </div>
        <div className="pl-1">
          <span className="block text-[0.68rem] font-medium uppercase tracking-wider text-ink-400">
            Size (UK)
          </span>
          <span className="mt-0.5 block truncate font-semibold text-ink-900">
            {selectedVariant ? `UK ${selectedVariant.size}` : 'Select size'}
          </span>
        </div>
      </div>

      {/* ---- 5. Colour Selection ------------------------------------------ */}
      {product.colours.length > 0 ? (
        <fieldset className="mt-5">
          <legend className="mb-2.5 flex w-full items-baseline justify-between gap-4">
            <span className="label-cap text-ink-500">
              Select Colour: <span className="text-ink-950">{selectedColour}</span>
            </span>
            {product.colours.length > 1 ? (
              <span className="step-xs text-ink-500">{product.colours.length} shades</span>
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
                      ? 'border-ink-900 bg-ink-900/5 font-semibold text-ink-950'
                      : 'border-border text-ink-600 hover:border-ink-400 hover:text-ink-900',
                  )}
                >
                  <span
                    className={cn(
                      'specimen h-8 w-8 shrink-0',
                      index % 2 === 0 ? 'bg-field-a' : 'bg-field-b',
                      active ? 'opacity-100' : 'opacity-80 group-hover/swatch:opacity-100',
                    )}
                  >
                    {swatch ? (
                      <img
                        src={mediaUrl(swatch.url)}
                        alt=""
                        width={64}
                        height={64}
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
            <p className="step-xs mt-2.5 text-ink-500">
              We are still photographing this colourway, so it is not on sale yet. The other colours
              above are available now.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {/* ---- 6. Size Selection -------------------------------------------- */}
      <fieldset id="pdp-size-selector" tabIndex={-1} className="mt-5 scroll-mt-24 outline-none">
        <legend className="mb-2.5 flex w-full items-baseline justify-between gap-4">
          <span className="label-cap text-ink-500">
            Select Size <span className="text-ink-900">(UK / India)</span>
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
            We have no size data for this colour yet. Try another colour, or check back once
            availability is updated.
          </p>
        ) : (
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
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
                    'btn-press tnum step-sm relative h-10 border font-medium',
                    active
                      ? 'border-ink-900 bg-ink-900 text-cream-50'
                      : variant.inStock
                        ? 'border-border bg-cream-50 text-ink-900 hover:border-ink-500'
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

      {/* ---- 7. Quantity + Primary CTAs ----------------------------------- */}
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center border border-border bg-cream-50">
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
              className="h-10 w-10 text-ink-600 hover:text-ink-900 disabled:opacity-30"
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
              className="tnum step-sm h-10 w-10 border-x border-border bg-transparent text-center focus:outline-none"
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
              className="h-10 w-10 text-ink-600 hover:text-ink-900 disabled:opacity-30"
            >
              +
            </button>
          </div>

          <Button
            type="button"
            onClick={toggleWishlist}
            aria-pressed={wishlisted}
            intent="ghost"
            size="sm"
            className="px-2 underline underline-offset-4"
          >
            {wishlisted ? '♥ Saved to wishlist' : '♡ Save to wishlist'}
          </Button>

          {inCartQuantity > 0 ? (
            <Link
              href="/cart"
              className="step-xs text-ink-600 underline underline-offset-4 hover:text-ink-900"
            >
              {inCartQuantity} already in your cart · view
            </Link>
          ) : null}
        </div>

        <div className="mt-3.5 hidden grid-cols-2 gap-2 md:grid">
          <Button
            type="button"
            onClick={() => addToCart()}
            intent="outline"
            size="lg"
            block
            disabled={addDisabled}
          >
            {ctaLabel}
          </Button>
          <Button
            type="button"
            onClick={() => addToCart(true)}
            intent="gold"
            size="lg"
            block
            disabled={buyDisabled}
          >
            {ctaState === 'select-size'
              ? 'Choose size'
              : ctaState === 'sold-out'
                ? 'Sold out'
                : ctaState === 'out-of-stock'
                  ? 'Unavailable'
                  : 'Buy now'}
          </Button>
        </div>

        {selectedVariant && !selectedVariant.inStock ? (
          <p className="step-xs mt-2.5 text-claret-700">
            This size is unavailable. Choose another size, or save the design and check back.
          </p>
        ) : null}
        {selectedVariant && selectedVariant.inStock && selectedVariant.stock <= 3 ? (
          <p className="step-xs mt-2.5 text-gold-700">
            Only {selectedVariant.stock} left in UK {selectedVariant.size}.
          </p>
        ) : null}

        {ctaState === 'sold-out' ? (
          <div className="mt-4 border-t border-border pt-3.5">
            <p className="step-sm text-ink-800">This design is sold out in {selectedColour}.</p>
            <p className="step-xs mt-1 max-w-prose text-ink-500">
              Stock is confirmed against our warehouse before a pair is listed as available. Save
              the design, or check the contact page for enquiries.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-4">
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
      </div>

      {/* ---- 8. Compact Category-Segregated Description & Specifications --- */}
      <section
        aria-label="Product details and specifications"
        className="mt-6 border border-border bg-field-e/40"
      >
        {/* Category Tabs Header */}
        <div
          role="tablist"
          aria-label="Product information categories"
          className="grid grid-cols-3 border-b border-border bg-cream-100/70"
        >
          {(
            [
              { key: 'description', label: 'Description' },
              { key: 'specifications', label: 'Specifications' },
              { key: 'shipping', label: 'Delivery & Care' },
            ] as const
          ).map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'px-2.5 py-2.5 text-center text-xs font-semibold uppercase tracking-wider transition-colors',
                  isActive
                    ? 'border-b-2 border-ink-900 bg-cream-50 text-ink-950'
                    : 'text-ink-500 hover:bg-cream-50/50 hover:text-ink-900',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab 1: Description with "Read more / Show less" + Key Highlights */}
        {activeTab === 'description' ? (
          <div role="tabpanel" className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.7rem] font-semibold uppercase tracking-widest text-gold-700">
                Design Overview
              </span>
              <span className="text-[0.7rem] font-medium text-ink-400">
                {product.brand} · {product.subcategory}
              </span>
            </div>

            {rawDescription ? (
              <div className="mt-2">
                <p className="text-sm leading-relaxed text-ink-700">{visibleDescription}</p>
                {shouldTruncateDescription ? (
                  <button
                    type="button"
                    aria-expanded={isDescriptionExpanded}
                    onClick={() => setIsDescriptionExpanded((prev) => !prev)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink-900 underline underline-offset-4 hover:text-gold-700"
                  >
                    {isDescriptionExpanded ? 'Read less' : 'Read more'}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-600">
                {product.title} by {product.brand}.
              </p>
            )}

            {/* Quick Category-Segregated Feature Pills inside Description */}
            <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-border/70 pt-3 text-xs">
              <div className="bg-cream-50 px-2.5 py-2">
                <span className="block text-[0.68rem] uppercase tracking-wider text-ink-400">
                  Silhouette &amp; Style
                </span>
                <span className="mt-0.5 block font-semibold text-ink-900">
                  {featureHighlights.silhouette}
                </span>
              </div>
              <div className="bg-cream-50 px-2.5 py-2">
                <span className="block text-[0.68rem] uppercase tracking-wider text-ink-400">
                  Finish &amp; Craft
                </span>
                <span className="mt-0.5 block font-semibold text-ink-900">
                  {featureHighlights.finish}
                </span>
              </div>
              <div className="bg-cream-50 px-2.5 py-2">
                <span className="block text-[0.68rem] uppercase tracking-wider text-ink-400">
                  Closure Type
                </span>
                <span className="mt-0.5 block font-semibold text-ink-900">
                  {featureHighlights.closure}
                </span>
              </div>
              <div className="bg-cream-50 px-2.5 py-2">
                <span className="block text-[0.68rem] uppercase tracking-wider text-ink-400">
                  Ideal Occasion
                </span>
                <span className="mt-0.5 block font-semibold text-ink-900">
                  {featureHighlights.occasions}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Tab 2: Segregated Specifications & Features */}
        {activeTab === 'specifications' ? (
          <div role="tabpanel" className="divide-y divide-border/70 p-4 text-xs">
            <div className="pb-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-gold-700">
                1. Brand &amp; Product Classification
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-ink-400">Brand</dt>
                  <dd className="font-semibold text-ink-900">{product.brand}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">Category</dt>
                  <dd className="font-semibold text-ink-900">{product.subcategory}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">Closure</dt>
                  <dd className="font-semibold text-ink-900">{featureHighlights.closure}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">Upper Finish</dt>
                  <dd className="font-semibold text-ink-900">{featureHighlights.finish}</dd>
                </div>
              </dl>
            </div>

            <div className="py-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-gold-700">
                2. Colour &amp; UK Sizing Details
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-ink-400">Selected Colour</dt>
                  <dd className="font-semibold text-ink-900">{selectedColour || '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">All Colours</dt>
                  <dd className="font-semibold text-ink-900">
                    {product.colours.length > 0 ? product.colours.join(', ') : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">UK Sizes Manufactured</dt>
                  <dd className="font-semibold text-ink-900">
                    {allSizes.length > 0 ? `UK ${allSizes.join(', ')}` : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">In Stock ({selectedColour})</dt>
                  <dd className="font-semibold text-ink-900">
                    {inStockSizesForColour.length > 0
                      ? `UK ${inStockSizesForColour.join(', ')}`
                      : 'Currently out of stock'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="pt-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-gold-700">
                3. Occasion &amp; Origin
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-ink-400">Recommended Wear</dt>
                  <dd className="font-semibold text-ink-900">{featureHighlights.occasions}</dd>
                </div>
                <div>
                  <dt className="text-ink-400">Country of Origin</dt>
                  <dd className="font-semibold text-ink-900">India</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        {/* Tab 3: Segregated Delivery, Returns & Care */}
        {activeTab === 'shipping' ? (
          <div role="tabpanel" className="divide-y divide-border/70 p-4 text-xs leading-relaxed">
            <div className="pb-2.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-gold-700">
                Delivery &amp; Cash on Delivery
              </p>
              <p className="mt-1 text-ink-700">
                Shipping charges and courier serviceability are calculated from your destination PIN
                code at checkout. Cash on delivery is available on eligible orders.
              </p>
            </div>
            <div className="py-2.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-gold-700">
                10-Day Returns &amp; Size Exchanges
              </p>
              <p className="mt-1 text-ink-700">
                Request a return or same-design UK size exchange from your account within 10 days of
                delivery. Replacements are confirmed after stock check and inspection.
              </p>
            </div>
            <div className="pt-2.5">
              <p className="text-[0.68rem] font-semibold uppercase tracking-widest text-gold-700">
                Care &amp; Longevity
              </p>
              <p className="mt-1 text-ink-700">
                Wipe gently with a soft, dry cloth after wear and store in a breathable shoe bag
                away from direct heat or moisture.
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <ProductConfidence />

      {/* ---- Mobile Sticky Purchase Bar ----------------------------------- */}
      <div
        role="region"
        aria-label="Quick purchase options"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-cream-50/95 px-4 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-8px_24px_rgba(24,21,18,0.08)] backdrop-blur-sm md:hidden"
      >
        <div className="mx-auto max-w-lg">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <p className="tnum step-md font-semibold text-ink-900">{rupees(displayPrice)}</p>
              <PriceSavings
                mrp={displayMrp}
                sellingPrice={displayPrice}
                className="text-[0.6875rem]"
              />
            </div>
            <p className="step-xs pb-0.5 text-ink-500">
              {selectedVariant
                ? `UK ${selectedVariant.size} · ${selectedVariant.colour}`
                : 'Choose a size'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pb-2">
            <Button
              intent="outline"
              size="md"
              block
              className="h-12"
              disabled={addDisabled}
              onClick={() => addToCart()}
            >
              {ctaState === 'select-size'
                ? 'Choose size'
                : ctaState === 'sold-out'
                  ? 'Sold out'
                  : ctaState === 'out-of-stock'
                    ? 'Unavailable'
                    : 'Add to cart'}
            </Button>
            <Button
              intent="gold"
              size="md"
              block
              className="h-12"
              disabled={buyDisabled}
              onClick={() => addToCart(true)}
            >
              {ctaState === 'select-size'
                ? 'Choose size'
                : ctaState === 'sold-out'
                  ? 'Sold out'
                  : ctaState === 'out-of-stock'
                    ? 'Unavailable'
                    : 'Buy now'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * For each size, keep one representative variant.
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
