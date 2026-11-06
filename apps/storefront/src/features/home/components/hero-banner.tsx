import Link from 'next/link';
import { HERO_BANNER } from '../data/hero-slides';

/**
 * The opening banner.
 *
 * ## What it is
 *
 * A full-bleed 16:9 picture with the campaign's own words set on it. Not a card,
 * not a two-column "image beside some copy" block: the picture runs edge to edge
 * and the type sits on the artwork the way it would on a poster, because the
 * visitor arriving from an advertisement needs to recognise what they were
 * promised before they read anything else.
 *
 * ## The ratio is the ratio, everywhere
 *
 * The frame is pinned to `aspect-16/9` at **every** breakpoint. The authored
 * artwork is 1672x941 — exactly 16:9 — so pinning the frame to the same ratio
 * means the picture is rendered whole: no letterboxing gaps, no cropped shoe, no
 * distortion. A phone therefore shows a short, wide poster (390px wide is 219px
 * tall), and the type is scaled to that measured space rather than being allowed
 * to overflow it: the body sentence is dropped below `sm`, and the headline uses
 * a smaller clamp step. The alternative — growing the frame on a phone — would
 * break the one rule this banner has.
 *
 * ## Why the copy is bottom-left
 *
 * The artwork is dark through the upper-left and lighter through the right, so a
 * left-aligned block over a left-to-right scrim stays legible without a solid
 * panel. The scrim is a gradient rather than a tint: it costs nothing to paint,
 * it never covers the product, and it deepens automatically over the part of the
 * picture the words need.
 *
 * ## Why there is no carousel any more
 *
 * There used to be three slides on a timer. A carousel asks the visitor to wait
 * for the message they came for; on a page with one thing to say, slides two and
 * three were only delaying slide one. The banner is now static — nothing moves
 * under a reader's eyes, and the largest image on the page loads once.
 *
 * Being static also means this is a **server** component: no client JavaScript
 * is shipped for the first screen at all, and there is no state to hydrate.
 */
export function HeroBanner() {
  const banner = HERO_BANNER;

  return (
    <section aria-label="Ajooba Footwear seasonal campaign" className="relative isolate w-full">
      <div className="relative aspect-16/9 w-full overflow-hidden bg-ink-950">
        {/*
          The picture. Eager and high priority: it is the largest paint on the
          page and the one thing a visitor must not wait for.
        */}
        <img
          src={banner.src}
          alt={banner.alt}
          width={1672}
          height={941}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />

        {/*
          Flat warm-umber photo scrim so the campaign copy is legible without
          a CSS gradient.
        */}
        <div aria-hidden="true" className="absolute inset-0 bg-ink-950/55" />

        {/* --- the words ---------------------------------------------------- */}
        <div className="absolute inset-0">
          <div className="container-page flex h-full items-end pb-4 sm:items-center sm:pb-0">
            <div className="max-w-xl">
              <p className="label-cap flex items-center gap-2 text-[0.625rem] text-gold-300 md:gap-2.5 md:text-xs">
                <span aria-hidden="true" className="h-px w-4 bg-gold-400/70 md:w-6" />
                {banner.eyebrow}
              </p>

              <h1 className="mt-1.5 text-balance font-display text-[clamp(1.5rem,4.5vw,3.75rem)] leading-[1.06] tracking-[-0.02em] text-cream-50 md:mt-4">
                {banner.title}
              </h1>

              {/* Hidden below `sm`: in 219px of poster there is room for one sentence. */}
              <p className="mt-2 hidden max-w-xl text-base leading-relaxed text-cream-100/90 sm:block md:mt-4">
                {banner.eyebrow} — {banner.body}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 sm:mt-5 md:mt-7 md:gap-x-6 md:gap-y-3">
                <Link
                  href={banner.ctaHref}
                  className="btn-press inline-flex h-9 items-center gap-1.5 bg-gold-400 px-4 text-sm font-medium text-ink-950 hover:bg-gold-300 sm:h-11 sm:px-6 md:h-12 md:px-7 md:text-base"
                >
                  {banner.ctaLabel}
                  <span aria-hidden="true" className="text-ink-900/70">
                    →
                  </span>
                </Link>
                {banner.secondaryHref && banner.secondaryLabel ? (
                  <Link
                    href={banner.secondaryHref}
                    className="link-underline hidden text-base text-cream-100 hover:text-white sm:inline-block"
                  >
                    {banner.secondaryLabel}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The picture the viewer sees if the artwork is unavailable.
 *
 * A designed statement rather than a grey box: a shop with a thousand products
 * in it must never look broken at the top. Kept to the same 16:9 frame so it
 * occupies exactly the space the banner would have.
 */
export function HeroBannerFallback() {
  return (
    <section className="bg-ink-950">
      <div className="aspect-16/9 w-full">
        <div className="container-page flex h-full items-center">
          <div>
            <h1 className="max-w-3xl font-display text-[clamp(1.375rem,3.1vw,2.75rem)] leading-[1.08] text-cream-50">
              Hand-finished footwear, made in Uttar Pradesh.
            </h1>
            <Link
              href="/products"
              className="btn-press mt-3 inline-flex h-9 items-center bg-gold-400 px-4 text-sm font-medium text-ink-950 hover:bg-gold-300 sm:mt-4 sm:h-11 sm:px-6 md:mt-6 md:h-12 md:px-7"
            >
              Browse the catalogue
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
