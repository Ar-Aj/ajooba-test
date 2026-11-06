'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Product } from '@ajooba/contracts';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { useHydrated } from '@/lib/use-hydrated';
import { cartStore } from '@/lib/cart-store';
import { wishlistStore } from '@/lib/wishlist-store';
import { mediaUrl } from '@/lib/media';
import { hasDiscount, rupees } from '@/lib/format';
import { PriceSavings } from '@/components/ui/price-savings';
import { colourwaysOf, isLightSwatch, type Colourway } from '@/lib/colour-swatch';
import { cn } from '@/lib/cn';
import { trackAddToCart, trackTap, trackWishlist } from '@/lib/track';

const ANGLE_LABELS = [
  'Studio Pair',
  'Side Profile',
  'Toe & Heel',
  'Top & Arch',
  'Sole Tread',
  'Stitch Detail',
  'On-Foot View',
] as const;

type StageMode = 'zoom' | 'split' | 'deck';

/**
 * Ajooba's Mehbooba — Multi-Colourway Interactive Buying Studio.
 *
 * Built around the catalogue's multi-angle photography on the house's warm
 * champagne and cream ground:
 *  - **Touch & Hover Zoom**: Hovering with a pointer or touching/dragging on a
 *    phone zooms smoothly (2.2× or 2.8×) into the exact point of contact across
 *    any of the design's studio angles.
 *  - **Split Compare**: Interactive curtain comparing any two colourways of the
 *    same shoe at the identical studio angle.
 *  - **3D Colour Deck**: Fans out all verified colourways (2, 3, 4+ from admin)
 *    side by side in 3D perspective.
 */
export function Ajooba3DShowcase({
  products,
  heading,
  subheading,
}: {
  products: readonly Product[];
  heading?: string;
  subheading?: string;
}) {
  const { toast } = useToast();
  const { cart, isWishlisted, account, ready } = useCommerce();
  const hydrated = useHydrated();
  const deviceKnown = hydrated && ready;
  const pathname = usePathname();

  const eligibleProducts = useMemo(() => {
    const multi = products.filter((p) => colourwaysOf(p).length >= 2);
    return multi.length > 0 ? multi : products;
  }, [products]);

  // Display only the 1 admin-selected model (first eligible product passed in).
  const product = eligibleProducts[0];

  const colourways = useMemo<Colourway[]>(() => (product ? colourwaysOf(product) : []), [product]);

  const [activeColourIdx, setActiveColourIdx] = useState(0);
  const [compareColourIdx, setCompareColourIdx] = useState(1);
  const [angleIdx, setAngleIdx] = useState(0);
  const [selectedSizeIdx, setSelectedSizeIdx] = useState(0);

  const [stageMode, setStageMode] = useState<StageMode>('zoom');
  const [zoomScale, setZoomScale] = useState<2.2 | 2.8>(2.2);
  const [isZooming, setIsZooming] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });
  const [splitPercent, setSplitPercent] = useState(50);

  const zoomFrameRef = useRef<HTMLDivElement | null>(null);
  const splitDragging = useRef(false);

  useEffect(() => {
    setActiveColourIdx(0);
    setCompareColourIdx(1);
    setAngleIdx(0);
    setSelectedSizeIdx(0);
    setIsZooming(false);
  }, [product?.id]);

  const primaryWay = colourways[activeColourIdx] ?? colourways[0];
  const secondaryWay =
    colourways[compareColourIdx] ??
    colourways[(activeColourIdx + 1) % Math.max(1, colourways.length)] ??
    primaryWay;

  if (!product || !primaryWay || !secondaryWay) return null;

  const images = primaryWay.images;
  const safeAngleIdx = images.length > 0 ? angleIdx % images.length : 0;
  const activeImage = images[safeAngleIdx] ?? images[0];

  const compareImages = secondaryWay.images;
  const compareImage =
    compareImages[compareImages.length > 0 ? safeAngleIdx % compareImages.length : 0] ??
    compareImages[0];

  const sizes = primaryWay.sizes;
  const selectedVariant = sizes[selectedSizeIdx] ?? sizes[0];

  const displayPrice = selectedVariant?.sellingPrice ?? primaryWay.sellingPrice;
  const displayMrp = selectedVariant?.mrp ?? primaryWay.mrp;
  const discounted = hasDiscount(displayMrp, displayPrice);

  const inCartQuantity =
    deviceKnown && selectedVariant
      ? (cart.find((line) => line.variantSku === selectedVariant.sku)?.quantity ?? 0)
      : 0;
  const maxAddable = selectedVariant
    ? Math.min(10 - inCartQuantity, selectedVariant.inStock ? 10 : 0)
    : 0;

  const wishlisted = deviceKnown ? isWishlisted(product.id) : false;

  const selectColourway = (index: number) => {
    if (index === activeColourIdx) return;
    setActiveColourIdx(index);
    if (index === compareColourIdx) {
      setCompareColourIdx((index + 1) % Math.max(1, colourways.length));
    }
    setSelectedSizeIdx(0);
    trackTap('select-colour', 'home-rail', {
      productId: product.id,
      categorySlug: product.subcategorySlug,
      categoryName: product.subcategory,
    });
  };

  const updateZoomPoint = (clientX: number, clientY: number) => {
    const box = zoomFrameRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - box.top) / box.height) * 100));
    setZoomOrigin({ x, y });
  };

  const handleAddToCart = () => {
    if (!selectedVariant) return;
    if (!selectedVariant.inStock) {
      toast({
        title: `UK ${selectedVariant.size} (${selectedVariant.sku}) is out of stock`,
        description: 'Try another size or shade, or save this design to your wishlist.',
        tone: 'warning',
      });
      return;
    }

    const lineImage = primaryWay.images[0] ?? product.images[0];

    cartStore.add({
      variantSku: selectedVariant.sku,
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      colour: selectedVariant.colour,
      size: selectedVariant.size,
      unitMrp: selectedVariant.mrp,
      unitPrice: selectedVariant.sellingPrice,
      quantity: 1,
      ...(lineImage ? { imageUrl: mediaUrl(lineImage.url), imageAlt: lineImage.alt } : {}),
    });

    trackAddToCart({
      productId: product.id,
      sku: selectedVariant.sku,
      quantity: 1,
      surface: 'pdp-buy-box',
      categorySlug: product.subcategorySlug,
      categoryName: product.subcategory,
    });

    toast({
      title: 'Added to your cart',
      description: `${product.title} · ${selectedVariant.colour}, UK ${selectedVariant.size}`,
      tone: 'success',
    });
  };

  const handleToggleWishlist = () => {
    if (!account) {
      toast({
        title: 'Sign in to save designs',
        description: 'Sign in once to keep your saved colourways across devices.',
        tone: 'warning',
        action: { label: 'Sign in', href: `/login?next=${encodeURIComponent(pathname)}` },
      });
      return;
    }
    const lineImage = primaryWay.images[0] ?? product.images[0];
    const result = wishlistStore.toggle({
      productId: product.id,
      productSlug: product.slug,
      productTitle: product.title,
      productCode: product.code,
      unitPrice: displayPrice,
      unitMrp: displayMrp,
      ...(lineImage ? { imageUrl: mediaUrl(lineImage.url), imageAlt: lineImage.alt } : {}),
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
  };

  const isDefaultHeading = !heading || heading.trim().toLowerCase() === 'the ajooba edit';
  const displayHeading = isDefaultHeading ? "Ajooba's Mehbooba" : heading;
  const displaySubheading =
    !subheading || subheading.trim().toLowerCase() === 'hand-finished, built to last.'
      ? 'One prized design across every shade. Hover or touch the studio frame to zoom into the stitch work, slide to compare colourways side by side, or fan the 3D colour deck.'
      : subheading;

  return (
    <section
      className="bg-field-b py-16 text-ink-900 md:py-24"
      aria-label={displayHeading}
      data-testid="ajooba-3d-showcase"
    >
      <div className="container-page">
        {/* ---- Section Header + Single Model Shade Switcher ---------------- */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h2 className="step-xl text-ink-900">{displayHeading}</h2>
            <p className="step-md mt-3 text-ink-600">{displaySubheading}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-ui="shade-header-pills">
            <span className="step-xs mr-1 text-ink-600">
              Design <strong className="font-semibold text-ink-900">{product.code}</strong> ·{' '}
              {colourways.length} shades:
            </span>
            {colourways.map((way, idx) => {
              const active = idx === activeColourIdx;
              return (
                <button
                  key={way.colour}
                  type="button"
                  onClick={() => selectColourway(idx)}
                  aria-pressed={active}
                  className={cn(
                    'btn-press inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium transition-colors',
                    active
                      ? 'bg-ink-900 text-cream-50'
                      : 'bg-cream-50 text-ink-800 hover:bg-field-a hover:text-ink-950',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: way.hex,
                      border: isLightSwatch(way.hex)
                        ? '1px solid rgba(24,21,18,0.35)'
                        : '1px solid rgba(253,250,242,0.35)',
                    }}
                  />
                  {way.colour}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- Main 12-Column Interactive Grid ---------------------------- */}
        <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-10">
          {/* ================================================================ */}
          {/* LEFT 7 COLS: TOUCH-TO-ZOOM, SPLIT COMPARE & 3D COLOUR DECK       */}
          {/* ================================================================ */}
          <div className="bg-cream-50 p-5 sm:p-8 lg:col-span-7" data-ui="studio-stage">
            {/* Mode Switcher Bar */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Interactive view modes"
                className="inline-flex flex-wrap bg-field-a p-1"
              >
                {(
                  [
                    { id: 'zoom', label: 'Touch & Hover Zoom' },
                    { id: 'split', label: `Split Compare (${colourways.length} Shades)` },
                    { id: 'deck', label: '3D Colour Deck' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={stageMode === tab.id}
                    onClick={() => {
                      setStageMode(tab.id);
                      setIsZooming(false);
                    }}
                    className={cn(
                      'step-xs px-3.5 py-2 font-medium transition-colors',
                      stageMode === tab.id
                        ? 'bg-ink-900 text-cream-50'
                        : 'text-ink-700 hover:text-ink-950',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {stageMode === 'zoom' ? (
                <div className="inline-flex items-center gap-1 bg-field-a p-1">
                  {([2.2, 2.8] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setZoomScale(level)}
                      className={cn(
                        'tnum step-xs px-2.5 py-1.5 font-medium transition-colors',
                        zoomScale === level
                          ? 'bg-gold-500 text-ink-950'
                          : 'text-ink-600 hover:text-ink-900',
                      )}
                    >
                      {level}× Zoom
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* ---------------- MODE 1: TOUCH & HOVER ZOOM ---------------- */}
            {stageMode === 'zoom' ? (
              <div>
                <div
                  ref={zoomFrameRef}
                  onMouseEnter={(e) => {
                    setIsZooming(true);
                    updateZoomPoint(e.clientX, e.clientY);
                  }}
                  onMouseMove={(e) => {
                    if (!isZooming) setIsZooming(true);
                    updateZoomPoint(e.clientX, e.clientY);
                  }}
                  onMouseLeave={() => setIsZooming(false)}
                  onTouchStart={(e) => {
                    const touch = e.touches[0];
                    if (!touch) return;
                    setIsZooming(true);
                    updateZoomPoint(touch.clientX, touch.clientY);
                  }}
                  onTouchMove={(e) => {
                    const touch = e.touches[0];
                    if (!touch) return;
                    updateZoomPoint(touch.clientX, touch.clientY);
                  }}
                  onTouchEnd={() => setIsZooming(false)}
                  onClick={(e) => {
                    updateZoomPoint(e.clientX, e.clientY);
                    setIsZooming((curr) => !curr);
                  }}
                  className={cn(
                    'relative aspect-square w-full select-none overflow-hidden bg-field-e',
                    isZooming ? 'cursor-zoom-out' : 'cursor-zoom-in',
                  )}
                >
                  {activeImage ? (
                    <img
                      key={activeImage.url}
                      src={mediaUrl(activeImage.url)}
                      alt={activeImage.alt || `${product.title} in ${primaryWay.colour}`}
                      width={1000}
                      height={1000}
                      draggable={false}
                      style={{
                        transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                        transform: isZooming ? `scale(${zoomScale})` : 'scale(1)',
                      }}
                      className="h-full w-full select-none object-contain p-6 transition-transform duration-150 ease-out"
                    />
                  ) : null}

                  {/* Top status pills */}
                  <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between gap-2">
                    <span className="step-xs bg-cream-50/95 px-3 py-1 font-medium text-ink-900">
                      {primaryWay.colour} · {ANGLE_LABELS[safeAngleIdx] ?? 'Studio View'}
                    </span>
                  </div>

                  {/* Bottom touch/hover guidance pill */}
                  <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                    <span className="step-xs bg-cream-50/95 px-3 py-1 text-ink-700">
                      {isZooming
                        ? `Inspecting at ${zoomScale}× — move to pan across stitch & grain`
                        : 'Hover or touch anywhere on the shoe to zoom in'}
                    </span>
                    <span className="tnum step-xs bg-ink-900 px-2.5 py-1 text-cream-50">
                      {safeAngleIdx + 1}/{images.length}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---------------- MODE 2: SPLIT COMPARE --------------------- */}
            {stageMode === 'split' ? (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="step-xs text-ink-700">
                    Left shade: <strong className="text-ink-950">{primaryWay.colour}</strong>
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="step-xs text-ink-600">Right shade:</span>
                    {colourways.map((way, idx) => {
                      if (idx === activeColourIdx) return null;
                      return (
                        <button
                          key={way.colour}
                          type="button"
                          onClick={() => setCompareColourIdx(idx)}
                          className={cn(
                            'step-xs px-2.5 py-1 font-medium transition-colors',
                            compareColourIdx === idx
                              ? 'bg-ink-900 text-cream-50'
                              : 'bg-field-a text-ink-700 hover:text-ink-950',
                          )}
                        >
                          {way.colour}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  onPointerDown={(e) => {
                    splitDragging.current = true;
                    const box = e.currentTarget.getBoundingClientRect();
                    const pct = ((e.clientX - box.left) / box.width) * 100;
                    setSplitPercent(Math.min(92, Math.max(8, Math.round(pct))));
                  }}
                  onPointerMove={(e) => {
                    if (!splitDragging.current) return;
                    const box = e.currentTarget.getBoundingClientRect();
                    const pct = ((e.clientX - box.left) / box.width) * 100;
                    setSplitPercent(Math.min(92, Math.max(8, Math.round(pct))));
                  }}
                  onPointerUp={() => {
                    splitDragging.current = false;
                  }}
                  onPointerLeave={() => {
                    splitDragging.current = false;
                  }}
                  className="relative aspect-square w-full cursor-ew-resize select-none overflow-hidden bg-field-e"
                >
                  {compareImage ? (
                    <img
                      src={mediaUrl(compareImage.url)}
                      alt={`${product.title} in ${secondaryWay.colour}`}
                      width={900}
                      height={900}
                      draggable={false}
                      className="h-full w-full object-contain p-6"
                    />
                  ) : null}

                  {activeImage ? (
                    <div
                      style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
                      className="absolute inset-0 bg-field-a"
                    >
                      <img
                        src={mediaUrl(activeImage.url)}
                        alt={`${product.title} in ${primaryWay.colour}`}
                        width={900}
                        height={900}
                        draggable={false}
                        className="h-full w-full object-contain p-6"
                      />
                    </div>
                  ) : null}

                  <div
                    style={{ left: `${splitPercent}%` }}
                    className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink-900"
                  >
                    <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-gold-300">
                      ⇄
                    </span>
                  </div>

                  <span className="step-xs absolute bottom-3 left-3 bg-cream-50/95 px-3 py-1 font-medium text-ink-900">
                    {primaryWay.colour}
                  </span>
                  <span className="step-xs absolute bottom-3 right-3 bg-ink-900 px-3 py-1 font-medium text-cream-50">
                    {secondaryWay.colour}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <span className="step-xs font-medium text-ink-800">{primaryWay.colour}</span>
                  <input
                    type="range"
                    min={8}
                    max={92}
                    value={splitPercent}
                    aria-label="Slide to compare colourways"
                    onChange={(e) => setSplitPercent(Number(e.target.value))}
                    className="h-1.5 flex-1 cursor-ew-resize accent-ink-900"
                  />
                  <span className="step-xs font-medium text-ink-800">{secondaryWay.colour}</span>
                </div>
              </div>
            ) : null}

            {/* ---------------- MODE 3: 3D COLOUR DECK -------------------- */}
            {stageMode === 'deck' ? (
              <div
                style={{ perspective: '1200px' }}
                className="my-2 grid grid-cols-2 gap-4 sm:grid-cols-3"
              >
                {colourways.map((way, idx) => {
                  const selected = idx === activeColourIdx;
                  const shot = way.images[safeAngleIdx % way.images.length] ?? way.images[0];
                  return (
                    <button
                      key={way.colour}
                      type="button"
                      onClick={() => selectColourway(idx)}
                      style={{
                        transform: selected
                          ? 'translateZ(18px) rotateY(0deg)'
                          : idx < activeColourIdx
                            ? 'rotateY(11deg)'
                            : 'rotateY(-11deg)',
                      }}
                      className={cn(
                        'flex flex-col p-3 text-left transition-transform duration-300',
                        selected
                          ? 'bg-ink-900 text-cream-50'
                          : 'bg-field-a text-ink-900 hover:bg-field-d',
                      )}
                    >
                      <div className="specimen aspect-square w-full bg-cream-50">
                        {shot ? (
                          <img
                            src={mediaUrl(shot.url)}
                            alt={`${product.title} in ${way.colour}`}
                            width={400}
                            height={400}
                            className="h-full w-full object-contain"
                          />
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: way.hex }}
                          />
                          {way.colour}
                        </span>
                        <span
                          className={cn(
                            'tnum text-xs',
                            selected ? 'text-gold-300' : 'text-ink-600',
                          )}
                        >
                          {rupees(way.sellingPrice)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          'mt-1 text-xs',
                          selected ? 'text-cream-50/75' : 'text-ink-500',
                        )}
                      >
                        {way.sizes.length} UK sizes · {way.images.length} angles
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* ---- Studio Angle Selector Strip --------------------------- */}
            <div className="mt-5 bg-field-a p-3">
              <div className="mb-2.5 flex items-center justify-between text-xs text-ink-600">
                <span>
                  Select studio angle ({images.length} verified views in{' '}
                  <strong className="text-ink-900">{primaryWay.colour}</strong>)
                </span>
                <span className="hidden sm:inline">
                  {ANGLE_LABELS[safeAngleIdx] ?? 'Studio View'}
                </span>
              </div>
              <div className="scrollbar-none flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 touch-pan-y sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0">
                {images.map((img, idx) => {
                  const active = idx === safeAngleIdx;
                  return (
                    <button
                      key={img.url}
                      type="button"
                      onClick={() => setAngleIdx(idx)}
                      className={cn(
                        ' flex w-18 shrink-0 snap-start flex-col items-center p-1 transition-colors sm:w-auto',
                        active
                          ? 'bg-ink-900 text-cream-50'
                          : 'bg-cream-50 text-ink-700 hover:bg-field-b',
                      )}
                    >
                      <div className="aspect-square w-full overflow-hidden bg-cream-50">
                        <img
                          src={mediaUrl(img.url)}
                          alt={ANGLE_LABELS[idx] ?? `View ${idx + 1}`}
                          width={140}
                          height={140}
                          loading="lazy"
                          className="h-full w-full object-contain p-1"
                        />
                      </div>
                      <span className="mt-1 truncate text-[0.6875rem] font-medium">
                        {(ANGLE_LABELS[idx] ?? 'View').split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ================================================================ */}
          {/* RIGHT 5 COLS: THE INTERACTIVE BUYING COCKPIT                     */}
          {/* ================================================================ */}
          <div className="bg-cream-50 p-6 sm:p-8 lg:col-span-5" data-ui="buying-cockpit">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="step-xs font-medium text-ink-500">
                {product.subcategory} · Design {product.code}
              </span>
              <span
                className={cn(
                  'step-xs px-2.5 py-1 font-medium',
                  primaryWay.inStock ? 'bg-gold-100 text-gold-900' : 'bg-field-a text-ink-700',
                )}
              >
                {primaryWay.inStock ? 'In stock' : 'Currently sold out'}
              </span>
            </div>

            <p className="step-lg mt-2 text-ink-900">{product.title}</p>

            {/* ---- Price + Explicit Discount Amount ----------------------- */}
            <div className="mt-4 bg-field-e p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="tnum step-xl text-ink-900">{rupees(displayPrice)}</span>
                {discounted ? (
                  <span className="tnum step-md text-ink-400 line-through">
                    MRP {rupees(displayMrp)}
                  </span>
                ) : null}
              </div>
              <PriceSavings mrp={displayMrp} sellingPrice={displayPrice} className="mt-1.5" />
              <p className="step-xs mt-1.5 text-ink-500">
                Inclusive of all taxes · Free shipping across India over ₹1,499
              </p>
            </div>

            {/* ---- Colourways Picker (2+ Shades, Admin-Driven) ----------- */}
            <div className="mt-6">
              <div className="flex items-baseline justify-between gap-2">
                <span className="step-xs font-medium text-ink-600">
                  Selected shade: <strong className="text-ink-900">{primaryWay.colour}</strong>
                </span>
                <span className="tnum step-xs text-ink-500">
                  {colourways.length} verified shades
                </span>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {colourways.map((way, idx) => {
                  const active = idx === activeColourIdx;
                  const thumb = way.images[0];
                  return (
                    <button
                      key={way.colour}
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectColourway(idx)}
                      className={cn(
                        'btn-press flex items-center gap-2.5 p-2 text-left transition-colors',
                        active
                          ? 'bg-ink-900 text-cream-50'
                          : 'bg-field-a text-ink-800 hover:bg-field-d',
                      )}
                    >
                      <span className="specimen h-11 w-11 shrink-0 bg-cream-50">
                        {thumb ? (
                          <img
                            src={mediaUrl(thumb.url)}
                            alt={way.colour}
                            width={88}
                            height={88}
                            className="h-full w-full object-contain p-1"
                          />
                        ) : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: way.hex,
                              border: isLightSwatch(way.hex)
                                ? '1px solid rgba(24,21,18,0.35)'
                                : '1px solid rgba(253,250,242,0.35)',
                            }}
                          />
                          <span className="truncate text-xs font-semibold">{way.colour}</span>
                        </div>
                        <p
                          className={cn(
                            'tnum mt-0.5 text-xs',
                            active ? 'text-cream-50/75' : 'text-ink-500',
                          )}
                        >
                          {way.images.length} shots · {rupees(way.sellingPrice)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- UK Size & SKU Matrix (Cut Out-of-Stock Sizes) --------- */}
            <div className="mt-6">
              <div className="flex items-baseline justify-between gap-2">
                <span className="step-xs font-medium text-ink-600">UK / India size &amp; SKU</span>
                {selectedVariant ? (
                  <span className="tnum step-xs font-medium text-ink-800">
                    SKU: {selectedVariant.sku}
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 grid grid-cols-5 gap-2">
                {sizes.map((variant, idx) => {
                  const active = idx === selectedSizeIdx;
                  return (
                    <button
                      key={variant.sku}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedSizeIdx(idx);
                        trackTap('select-size', 'pdp-buy-box', {
                          productId: product.id,
                          sku: variant.sku,
                          categorySlug: product.subcategorySlug,
                          categoryName: product.subcategory,
                        });
                      }}
                      title={
                        variant.inStock
                          ? `UK ${variant.size} · SKU ${variant.sku} · In stock`
                          : `UK ${variant.size} · SKU ${variant.sku} · Out of stock`
                      }
                      className={cn(
                        'btn-press tnum relative flex flex-col items-center justify-center py-2.5 transition-colors',
                        variant.inStock
                          ? active
                            ? 'bg-ink-900 font-semibold text-cream-50'
                            : 'bg-field-a text-ink-900 hover:bg-field-d'
                          : active
                            ? 'bg-field-b text-ink-500 line-through decoration-claret-600'
                            : 'bg-field-e text-ink-400 line-through decoration-ink-400',
                      )}
                    >
                      <span className="text-xs font-semibold">UK {variant.size}</span>
                      <span className="tnum mt-0.5 text-[0.6875rem] opacity-80">
                        {variant.sku.split('-').slice(-2).join('-')}
                      </span>
                      {variant.inStock ? null : (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-1.5 top-1/2 h-[1.5px] -rotate-[24deg] bg-claret-600/75"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedVariant ? (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 bg-field-a px-3.5 py-2 text-xs">
                  <span className="tnum text-ink-800">
                    Selected SKU: <strong className="text-ink-950">{selectedVariant.sku}</strong>
                  </span>
                  <span
                    className={cn(
                      'font-medium',
                      selectedVariant.inStock ? 'text-gold-800' : 'text-claret-700',
                    )}
                  >
                    {selectedVariant.inStock
                      ? `${selectedVariant.stock} pair(s) ready to ship`
                      : `Out of stock in UK ${selectedVariant.size}`}
                  </span>
                </div>
              ) : null}
            </div>

            {/* ---- Direct Buy / Add to Cart + Save + Full Details -------- */}
            <div className="mt-6 space-y-3">
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={!selectedVariant?.inStock || maxAddable <= 0}
                  className="btn-press step-sm flex-1 bg-gold-500 px-6 py-3.5 font-semibold text-ink-950 hover:bg-gold-400 disabled:cursor-not-allowed disabled:bg-field-b disabled:text-ink-500"
                >
                  {selectedVariant?.inStock
                    ? maxAddable <= 0
                      ? 'Maximum in Cart'
                      : `Add UK ${selectedVariant.size} to Cart · ${rupees(displayPrice)}`
                    : `UK ${selectedVariant?.size ?? ''} Out of Stock`}
                </button>

                <button
                  type="button"
                  onClick={handleToggleWishlist}
                  aria-pressed={wishlisted}
                  className={cn(
                    'btn-press step-sm px-5 py-3.5 font-medium transition-colors',
                    wishlisted
                      ? 'bg-ink-900 text-cream-50'
                      : 'bg-field-a text-ink-900 hover:bg-field-d',
                  )}
                >
                  {wishlisted ? 'Saved' : 'Save shade'}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-ink-600">
                <Link
                  href={`/products/${product.slug}`}
                  className="link-underline font-medium text-ink-900 hover:text-ink-950"
                >
                  Open full product page &amp; all {product.variants.length} SKUs →
                </Link>
                <Link
                  href={`/contact?design=${encodeURIComponent(product.code)}`}
                  className="text-ink-600 underline underline-offset-4 hover:text-ink-900"
                >
                  Ask about restock
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
