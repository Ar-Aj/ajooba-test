import Link from 'next/link';
import type {
  HomepageProductCard,
  InteractionSurface,
  Product,
  ResolvedHomepageSection,
} from '@ajooba/contracts';
import { mediaUrl } from '@/lib/media';
import { rupees } from '@/lib/format';
import { SpecimenTile, SectionHeading } from './specimen-tile';
import { ShopTile } from './shop-tile';
import { Ajooba3DShowcase } from './ajooba-3d-showcase';
import { colourwaysOf } from '@/lib/colour-swatch';
import { fieldForIndex } from '@/lib/specimen';
import { Rail, Reveal } from '@/components/ui/reveal';
import { DealCountdown } from './deal-countdown';
import { TapLink } from '@/components/track/tap-link';

/**
 * The homepage section renderer.
 *
 * Every section type in the contract has a branch here. When `productById` is
 * supplied by the homepage, every product card upgrades to `ShopTile` (showing
 * the rupee + percentage discount, interactive colourways, and all UK sizes &
 * SKUs with out-of-stock sizes visibly cut through), and the `featured` section
 * renders the interactive 3D buying studio (`Ajooba3DShowcase`).
 */
export function HomepageSectionRenderer({
  section,
  productById,
}: {
  section: ResolvedHomepageSection;
  productById?: Readonly<Record<string, Product>>;
}) {
  const config = section.config as Record<string, unknown>;

  switch (section.type) {
    /* --- A. The campaign banner --------------------------------------- */
    case 'hero': {
      const imageUrl = String(config.imageUrl ?? '');
      const alt = String(config.alt ?? section.heading);
      const ctaHref = String(config.ctaHref ?? config.linkUrl ?? '/products');
      const ctaLabel = String(config.ctaLabel ?? 'Shop the collection');
      const mobileImageUrl = config.mobileImageUrl ? String(config.mobileImageUrl) : null;

      if (!imageUrl) return null;

      return (
        <section className="bg-ink-900" aria-label={section.heading || 'Campaign'}>
          <div className="container-page grid grid-cols-1 items-center gap-8 py-10 md:grid-cols-12 md:gap-12 md:py-14">
            <div className="relative aspect-16/9 md:order-2 md:col-span-7">
              <picture>
                {mobileImageUrl ? (
                  <source media="(max-width: 640px)" srcSet={mediaUrl(mobileImageUrl)} />
                ) : null}
                <img
                  src={mediaUrl(imageUrl)}
                  alt={alt}
                  width={1672}
                  height={941}
                  className="h-full w-full object-contain"
                />
              </picture>
            </div>

            <div className="md:order-1 md:col-span-5">
              {section.heading ? (
                <h2 className="step-xl text-cream-50">{section.heading}</h2>
              ) : null}
              {section.subheading ? (
                <p className="step-md mt-4 max-w-md text-cream-50/70">{section.subheading}</p>
              ) : null}
              <TapLink
                href={ctaHref}
                action="banner-open"
                surface="home-hero"
                className="btn-press step-sm mt-7 inline-flex bg-gold-500 px-7 py-3.5 font-medium text-ink-900 hover:bg-gold-400"
              >
                {ctaLabel}
              </TapLink>
            </div>
          </div>
        </section>
      );
    }

    /* --- B. Shop by category ------------------------------------------- */
    case 'category-grid': {
      const tiles = section.categories;
      if (tiles.length === 0) {
        return (
          <SectionNotice
            heading={section.heading}
            message="No categories are published yet, so this part of the page is resting."
          />
        );
      }

      return (
        <section className="container-page py-16 md:py-24" aria-label={section.heading}>
          <Reveal>
            <SectionHeading
              heading={section.heading || 'Shop by category'}
              subheading={section.subheading || undefined}
              href="/products"
              linkLabel="Everything"
            />
          </Reveal>

          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 md:gap-x-6 lg:grid-cols-4">
            {tiles.map((tile, index) => (
              <li key={tile.slug}>
                <Reveal delay={Math.min(index * 60, 240)}>
                  <TapLink
                    href={tile.href}
                    action="category-open"
                    surface="home-category-index"
                    detail={{ categorySlug: tile.slug, categoryName: tile.displayName }}
                    className="group block"
                  >
                    <div className={`specimen aspect-square ${fieldForIndex(index)}`}>
                      {tile.imageUrl ? (
                        <img
                          src={mediaUrl(tile.imageUrl)}
                          alt={tile.imageAlt || tile.displayName}
                          width={800}
                          height={800}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                      <span className="tnum absolute right-2 top-2 bg-cream-50 px-2.5 py-1 text-sm font-medium text-ink-800">
                        {tile.count} {tile.count === 1 ? 'design' : 'designs'}
                      </span>
                    </div>

                    <h3 className="step-lg mt-3 text-ink-900 group-hover:text-ink-950">
                      {tile.displayName}
                    </h3>
                    {tile.description ? (
                      <p className="step-sm mt-1 line-clamp-2 text-ink-500">{tile.description}</p>
                    ) : null}
                  </TapLink>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    /* --- C. New arrivals ------------------------------------------------ */
    case 'new-arrivals': {
      if (section.products.length === 0) {
        return (
          <SectionNotice
            heading={section.heading}
            message="Nothing new has been published yet. This section fills itself as designs go live."
          />
        );
      }

      const rail = config.layout === 'rail';

      return (
        <section className="container-page py-16 md:py-24" aria-label={section.heading}>
          <Reveal>
            <SectionHeading
              heading={section.heading || 'Just arrived'}
              subheading={section.subheading || undefined}
              href="/products?sort=newest"
              linkLabel="See all new"
            />
          </Reveal>

          {rail ? (
            <Reveal className="mt-10">
              <Rail label={section.heading || 'New arrivals'}>
                {section.products.map((product, index) => (
                  <li
                    key={product.id}
                    className="w-[78vw] max-w-[20.5rem] shrink-0 snap-start sm:w-[20.5rem]"
                  >
                    <CardTile card={product} full={productById?.[product.id]} index={index} />
                  </li>
                ))}
              </Rail>
            </Reveal>
          ) : (
            <ul className="scrollbar-none -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
              {section.products.map((product, index) => (
                <li
                  key={product.id}
                  className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
                >
                  <Reveal delay={Math.min(index * 50, 200)}>
                    <CardTile card={product} full={productById?.[product.id]} index={index} />
                  </Reveal>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    /* --- D. Ajooba's Mehbooba — The 3D Shoe-ba Studio (Featured) -------- */
    case 'featured': {
      const spotlightId = config.spotlightProductId as string | null;

      // Resolve full products for this section, putting the spotlight design first
      const orderedCards = spotlightId
        ? [
            ...section.products.filter((p) => p.id === spotlightId),
            ...section.products.filter((p) => p.id !== spotlightId),
          ]
        : [...section.products];

      const resolvedFromSection: Product[] = [];
      for (const card of orderedCards) {
        const full = productById?.[card.id];
        if (full && colourwaysOf(full).length >= 2) {
          resolvedFromSection.push(full);
        }
      }

      // If no product in the section had >= 2 colourways (or if productById has more),
      // include catalogue multi-colourway products so the 3D showcase always has
      // a rich >=2 colourway product ready to inspect.
      const fallbackMulti = productById
        ? Object.values(productById).filter(
            (p) =>
              colourwaysOf(p).length >= 2 &&
              !resolvedFromSection.some((existing) => existing.id === p.id),
          )
        : [];

      const showcaseProducts = [...resolvedFromSection, ...fallbackMulti].slice(0, 1);

      if (showcaseProducts.length > 0) {
        return (
          <Ajooba3DShowcase
            products={showcaseProducts}
            heading={section.heading || undefined}
            subheading={section.subheading || undefined}
          />
        );
      }

      if (section.products.length === 0) {
        return (
          <SectionNotice
            heading={section.heading}
            message="No designs have been chosen for this edit yet."
          />
        );
      }

      return (
        <section className="bg-field-b py-16 md:py-24" aria-label={section.heading}>
          <div className="container-page">
            <Reveal>
              <SectionHeading
                heading={section.heading || "Ajooba's Mehbooba"}
                subheading={section.subheading || undefined}
              />
            </Reveal>
            <ul className="scrollbar-none -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
              {section.products.map((product, index) => (
                <li
                  key={product.id}
                  className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
                >
                  <Reveal delay={Math.min(index * 50, 200)}>
                    <CardTile card={product} full={productById?.[product.id]} index={index} />
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }

    /* --- E. Trending ---------------------------------------------------- */
    case 'trending': {
      if (section.products.length === 0) {
        return (
          <SectionNotice
            heading={section.heading}
            message="Nothing has been picked for this section yet."
          />
        );
      }

      return (
        <section className="container-page py-16 md:py-24" aria-label={section.heading}>
          <Reveal>
            <SectionHeading
              heading={section.heading || 'Most wanted'}
              subheading={section.subheading || undefined}
              href="/products"
              linkLabel="All designs"
            />
          </Reveal>

          <ul className="scrollbar-none -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
            {section.products.slice(0, 4).map((product, index) => (
              <li
                key={product.id}
                className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
              >
                <Reveal delay={Math.min(index * 50, 200)}>
                  <CardTile card={product} full={productById?.[product.id]} index={index} />
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    /* --- F. A timed deal ------------------------------------------------ */
    case 'deal': {
      if (section.products.length === 0 || section.deals.length === 0) return null;
      const endsAt = section.campaignEndsAt ?? String(config.endsAt ?? '');

      return (
        <section className="surface-dark py-16 md:py-24" aria-label={section.heading}>
          <div className="container-page">
            <Reveal>
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                <div className="max-w-2xl">
                  <h2 className="step-xl text-cream-50">{section.heading}</h2>
                  {section.subheading ? (
                    <p className="step-md mt-3 max-w-xl text-cream-50/65">{section.subheading}</p>
                  ) : null}
                </div>
                {endsAt ? (
                  <DealCountdown
                    endsAt={endsAt}
                    className="tnum step-sm flex flex-wrap items-center gap-3 border border-cream-50/20 px-4 py-2 text-cream-50"
                  />
                ) : null}
              </div>
            </Reveal>

            <ul className="scrollbar-none -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
              {section.products.map((product, index) => {
                const deal = section.deals.find((entry) => entry.productId === product.id);
                if (!deal) return null;
                const off = deal.basePrice - deal.finalPrice;
                const percent = off > 0 ? Math.round((off / deal.basePrice) * 100) : 0;

                return (
                  <li
                    key={product.id}
                    className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
                  >
                    <Reveal delay={Math.min(index * 50, 200)}>
                      <DealTile
                        product={product}
                        full={productById?.[product.id]}
                        index={index}
                        finalPrice={deal.finalPrice}
                        basePrice={deal.basePrice}
                        percent={percent}
                      />
                    </Reveal>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      );
    }

    /* --- G. Shop by colour ---------------------------------------------- */
    case 'colour-shop': {
      const tiles = section.colourTiles;
      if (tiles.length === 0) {
        return (
          <SectionNotice
            heading={section.heading}
            message="No colour is available to shop right now."
          />
        );
      }

      return (
        <section className="container-page py-16 md:py-24" aria-label={section.heading}>
          <Reveal>
            <SectionHeading
              heading={section.heading || 'By colour'}
              subheading={section.subheading || undefined}
            />
          </Reveal>

          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:gap-x-6 lg:grid-cols-6">
            {tiles.map((tile, index) => (
              <li key={tile.colour}>
                <Reveal delay={Math.min(index * 40, 200)}>
                  <Link href={tile.href} className="group block">
                    <div className={`specimen aspect-square ${fieldForIndex(index + 2)}`}>
                      {tile.imageUrl ? (
                        <img
                          src={mediaUrl(tile.imageUrl)}
                          alt={tile.imageAlt}
                          width={600}
                          height={600}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="step-sm text-ink-800 group-hover:text-ink-950">
                        {tile.colour}
                      </span>
                      <span className="tnum step-xs text-ink-400">{tile.count}</span>
                    </div>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      );
    }

    /* --- H. A collection spotlight -------------------------------------- */
    case 'collection-spotlight': {
      if (section.products.length === 0) {
        return (
          <SectionNotice
            heading={section.heading}
            message="This collection has no published designs yet."
          />
        );
      }

      const slug = String(config.categorySlug ?? '');

      return (
        <section className="bg-field-c py-16 md:py-24" aria-label={section.heading}>
          <div className="container-page">
            <Reveal>
              <SectionHeading
                heading={section.heading}
                subheading={section.subheading || undefined}
                href={slug ? `/products?subcategory=${encodeURIComponent(slug)}` : '/products'}
                linkLabel="The full collection"
              />
            </Reveal>

            <ul className="scrollbar-none -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 touch-pan-y sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-x-5 sm:gap-y-10 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
              {section.products.slice(0, 4).map((product, index) => (
                <li
                  key={product.id}
                  className="w-[78vw] max-w-[20rem] shrink-0 snap-start sm:w-auto sm:max-w-none"
                >
                  <Reveal delay={Math.min(index * 50, 200)}>
                    <CardTile card={product} full={productById?.[product.id]} index={index} />
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function CardTile({
  card,
  full,
  index,
  surface = 'home-rail',
}: {
  card: HomepageProductCard;
  full?: Product;
  index: number;
  surface?: InteractionSurface;
}) {
  if (full) {
    return <ShopTile card={card} product={full} index={index} surface={surface} />;
  }
  return <SpecimenTile product={card} index={index} surface={surface} />;
}

function SectionNotice({ heading, message }: { heading: string; message: string }) {
  return (
    <section className="container-page py-16 md:py-24">
      {heading ? <h2 className="step-lg text-ink-900">{heading}</h2> : null}
      <p className="step-sm mt-2 max-w-lg text-ink-500">{message}</p>
    </section>
  );
}

function DealTile({
  product,
  full,
  index,
  finalPrice,
  basePrice,
  percent,
}: {
  product: ResolvedHomepageSection['products'][number];
  full?: Product;
  index: number;
  finalPrice: number;
  basePrice: number;
  percent: number;
}) {
  return (
    <div>
      <CardTile card={product} full={full} index={index} />
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tnum step-sm text-gold-300">{rupees(finalPrice)}</span>
        {percent > 0 ? (
          <>
            <span className="tnum step-xs text-cream-50/45 line-through">{rupees(basePrice)}</span>
            <span className="step-xs text-cream-50/60">−{percent}%</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
