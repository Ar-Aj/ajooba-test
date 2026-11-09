'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProductImage } from '@ajooba/contracts';
import { mediaUrl } from '@/lib/media';
import { fieldForIndex } from '@/lib/specimen';
import { cn } from '@/lib/cn';

/**
 * The product gallery.
 *
 * ## One object, at size, on a field
 *
 * The main frame is the specimen field: a flat tint with the photograph of the
 * selected colour held inside it at full height. It is the largest thing on the
 * page because on a product page the object *is* the page.
 *
 * ## Rules this component enforces
 *
 * - **The gallery shows exactly one colour's photography.** The caller filters
 *   the list by the selected colour. An image whose colour the importer could
 *   not verify never reaches `images` at all, so it cannot appear here.
 * - **A colour with no photography says so.** We do not substitute another
 *   colour's images — showing a brown shoe under a Black swatch is the specific
 *   defect this was fixed to remove.
 * - **The thumbnails are a real list of buttons** with `aria-current`, and the
 *   arrow keys move between them, because a strip of twenty small photographs
 *   is otherwise a tab-stop... twenty tab-stops.
 *
 * ## Zoom
 *
 * Clicking the main frame opens the same photograph at full viewport size. It
 * is a `dialog`, closes on Escape and on backdrop click, and carries a real
 * close button. Anything less on a product page leaves a shopper unable to
 * inspect stitching, which is the one thing they came to inspect.
 */
export function ProductGallery({
  images,
  title,
  colour,
  isPrimaryColour = true,
}: {
  images: readonly ProductImage[];
  title: string;
  /** The colour currently selected in the buy box. */
  colour?: string;
  /** False when another colour is selected, which changes the empty-state copy. */
  isPrimaryColour?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  /*
   * Switching colour changes which images are in the list, so the previous
   * index can point past the end. Reset to the first image of the new gallery.
   * This is derived during render rather than in an effect so the reset lands in
   * the same paint as the new list — an effect would show one frame of the old
   * index against the new images.
   */
  const activeKey = images.map((image) => image.url).join('|');
  const [lastKey, setLastKey] = useState(activeKey);
  if (lastKey !== activeKey) {
    setLastKey(activeKey);
    setActiveIndex(0);
    setZoomed(false);
  }

  const active = images[activeIndex] ?? images[0];

  // Escape closes the zoomed view. Bound only while it is open.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setZoomed(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [zoomed]);

  const imageCount = images.length;

  const step = useMemo(
    () => (delta: number) => {
      if (imageCount === 0) return;
      setActiveIndex((current) => (current + delta + imageCount) % imageCount);
    },
    [imageCount],
  );

  /* ---- no verified photography for this colour ------------------------- */
  if (!active) {
    return (
      <div data-testid="product-gallery">
        <div className="specimen aspect-4/5 bg-field-e">
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <p className="step-md text-ink-700">
              {colour && !isPrimaryColour
                ? `No ${colour} photography yet`
                : 'No image is available for this design yet'}
            </p>
            <p className="step-sm mt-2 max-w-xs text-ink-500">
              We photograph every colourway before it goes on sale. Verified studio photographs for
              this colourway are pending review, so this colour is not on sale yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="product-gallery" className="flex flex-col gap-3 md:flex-row-reverse md:gap-5">
      {/* ---- main frame -------------------------------------------------- */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={`Open ${active.alt || title} at full size`}
          className="specimen block aspect-4/5 w-full cursor-zoom-in bg-field-e"
        >
          <img
            key={active.url}
            src={mediaUrl(active.url)}
            alt={active.alt || title}
            width={1200}
            height={1500}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0"
            style={{ animation: 'crossfade 260ms var(--ease-out-quiet) both' }}
          />
        </button>

        {imageCount > 1 ? (
          <p className="step-xs mt-2 flex items-center justify-between text-ink-400">
            <span>
              {activeIndex + 1} / {imageCount}
            </span>
            <span className="hidden md:inline">Click the image to enlarge</span>
          </p>
        ) : null}
      </div>

      {/* ---- thumbnails -------------------------------------------------- */}
      {imageCount > 1 ? (
        <ul
          className="flex gap-2 overflow-x-auto scrollbar-none md:w-[5.5rem] md:flex-col md:overflow-visible"
          aria-label="Product images"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
              event.preventDefault();
              step(1);
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
              event.preventDefault();
              step(-1);
            }
          }}
        >
          {images.map((image, index) => (
            <li key={image.url} className="shrink-0">
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-current={index === activeIndex}
                aria-label={`View image ${index + 1} of ${imageCount}`}
                className={cn(
                  'specimen block h-20 w-16 md:h-24 md:w-full',
                  fieldForIndex(index),
                  index === activeIndex
                    ? 'ring-1 ring-ink-900 ring-offset-1 ring-offset-cream-50'
                    : 'opacity-65 hover:opacity-100',
                )}
              >
                <img src={mediaUrl(image.url)} alt="" loading="lazy" width={200} height={240} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ---- zoom -------------------------------------------------------- */}
      {zoomed ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.alt || title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/92 p-4"
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close enlarged image"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center text-2xl text-cream-50/70 hover:text-cream-50"
          >
            ×
          </button>

          {imageCount > 1 ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous image"
                className="absolute left-3 z-10 flex h-12 w-12 items-center justify-center text-2xl text-cream-50/60 hover:text-cream-50"
              >
                ←
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
                aria-label="Next image"
                className="absolute right-3 z-10 flex h-12 w-12 items-center justify-center text-2xl text-cream-50/60 hover:text-cream-50"
              >
                →
              </button>
            </>
          ) : null}

          <img
            src={mediaUrl(active.url)}
            alt={active.alt || title}
            className="max-h-[92dvh] max-w-[92vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
