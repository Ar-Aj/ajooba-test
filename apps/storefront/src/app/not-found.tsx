import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FEATURED_SUBCATEGORIES } from '@/config/subcategories';

/**
 * 404 page.
 *
 * Used when a product slug does not exist in the catalogue, or when an
 * unknown path is visited. It is a real page, not a redirect, and it never
 * suggests a product that may not exist — only real category routes.
 */
export default function NotFound() {
  return (
    <div className="container-page py-16 md:py-24">
      <div className="mx-auto max-w-xl text-center">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-gold-700">404</p>
        <h1 className="mt-4 font-display text-4xl leading-tight md:text-5xl">
          We couldn't find that page
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-600 md:text-base">
          The link may be out of date, or the design may have been retired from the catalogue. Try
          one of these instead.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button intent="gold" size="lg" asChild>
            <Link href="/products">Browse all footwear</Link>
          </Button>
          <Button intent="outline" size="lg" asChild>
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-3xl">
        <h2 className="text-center font-display text-xl">Popular categories</h2>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {FEATURED_SUBCATEGORIES.map((sub) => (
            <li key={sub.slug}>
              <Link
                href={`/products?subcategory=${encodeURIComponent(sub.slug)}`}
                className="inline-flex h-10 items-center rounded-full border border-ink-200 bg-white px-4 text-sm text-ink-700 hover:border-ink-400"
              >
                {sub.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
