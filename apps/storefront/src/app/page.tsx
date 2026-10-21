import Link from 'next/link';
import { BRAND_NAME } from '@ajooba/contracts';
import { mediaUrl } from '@/lib/env';

/**
 * Storefront home page.
 *
 * Deliberately minimal at this stage. It renders static brand content only —
 * no placeholder products, no fake counts, no invented promotional claims.
 * Product grids are added once the catalogue import pipeline has run and the
 * database contains the real catalogue.
 */

const HERO_BANNERS = [
  { file: 'banner home hero 1.png', alt: 'Ajooba Footwear hero banner 1' },
  { file: 'banner home hero 2.png', alt: 'Ajooba Footwear hero banner 2' },
  { file: 'banner home hero 3.png', alt: 'Ajooba Footwear hero banner 3' },
] as const;

export default function HomePage() {
  return (
    <main className="min-h-dvh">
      <header className="border-b border-neutral-200">
        <div className="container-page flex h-16 items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {BRAND_NAME}
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
            <Link href="/products" className="hover:text-brand-600">
              Shop
            </Link>
          </nav>
        </div>
      </header>

      <section className="container-page py-8 md:py-12">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Ethnic footwear, crafted for weddings, festivities and everyday wear.
        </h1>
        <p className="mt-4 max-w-xl text-neutral-600">
          Mojris, juttis, sandals and chappals from {BRAND_NAME}. Browse the full catalogue by
          category, colour and size.
        </p>
        <Link
          href="/products"
          className="mt-8 inline-flex h-11 items-center rounded-md bg-brand-600 px-6 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          Browse the catalogue
        </Link>
      </section>

      <section className="container-page pb-12" aria-label="Featured banners">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HERO_BANNERS.map((banner) => (
            <li key={banner.file}>
              <img
                src={mediaUrl(`/banner/${banner.file}`)}
                alt={banner.alt}
                width={1200}
                height={800}
                loading="lazy"
                className="h-auto w-full rounded-lg border border-neutral-200 object-cover"
              />
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-neutral-200 py-8">
        <div className="container-page text-sm text-neutral-600">
          <p>{BRAND_NAME}</p>
        </div>
      </footer>
    </main>
  );
}
