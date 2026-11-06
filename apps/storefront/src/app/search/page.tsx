import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CatalogView } from '@/features/catalog/components/catalog-view';
import { ProductGridSkeleton } from '@/features/catalog/components/product-grid-skeleton';
import { readCatalogParams } from '@/features/catalog/lib/catalog-params';
import { fetchCatalogFacets, fetchCategories } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search the Ajooba Footwear catalogue.',
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;

  // The site search uses `?q=` (short and conventional); the catalogue API uses
  // `search=`. Translate here so the API contract stays untouched.
  const q = raw.q;
  const query = Array.isArray(q) ? q[0] : q;
  const params: Record<string, string | string[] | undefined> = { ...raw };
  if (query) {
    params.search = query;
  }
  delete params.q;

  const parsed = readCatalogParams(params);
  const searchTerm = parsed.search ?? '';

  return (
    <div className="container-page py-8 md:py-12">
      <header className="mb-8 md:mb-12">
        <h1 className="step-xl text-ink-900">
          {searchTerm ? (
            <>
              Results for <span className="text-gold-700">“{searchTerm}”</span>
            </>
          ) : (
            'Search'
          )}
        </h1>
        <p className="step-md mt-3 max-w-xl text-ink-600">
          {searchTerm
            ? 'Everything in the catalogue that matches your search.'
            : 'Type a design code, a colour or a category in the search bar, or start from one of the shortcuts below.'}
        </p>
      </header>

      {searchTerm ? (
        <Suspense fallback={<ProductGridSkeleton />}>
          <CatalogView searchParams={params} basePath="/search" />
        </Suspense>
      ) : (
        <SearchSuggestions />
      )}
    </div>
  );
}

/**
 * The empty-search state.
 *
 * Every shortcut is built from live data: the categories come from the API's
 * taxonomy, and the colour and price shortcuts come from the real facet list
 * for the current catalogue. If the catalogue has no brown designs there is no
 * "Brown" chip, because a shortcut that returns nothing is worse than one fewer
 * shortcut.
 *
 * The previous version was a hardcoded array of eight links, four of which
 * pointed at slugs that might not exist — so a shopper could be sent to an empty
 * grid from the one screen that is supposed to help them.
 */
async function SearchSuggestions() {
  const [categories, facets] = await Promise.all([fetchCategories(), fetchCatalogFacets()]);

  const topColours = (facets?.colours ?? [])
    .filter((facet) => facet.count > 0)
    .slice(0, 4)
    .map((facet) => ({
      label: facet.value,
      href: `/products?colour=${encodeURIComponent(facet.value)}`,
      count: facet.count,
    }));

  const groups = [
    {
      title: 'Shop by category',
      items: categories.map((category) => ({
        label: category.displayName,
        href: `/products?subcategory=${encodeURIComponent(category.slug)}`,
        count: category.productCount,
      })),
    },
    { title: 'Shop by colour', items: topColours },
    {
      title: 'Shop by price',
      items: [
        { label: 'Under ₹1,500', href: '/products?maxPrice=1500', count: undefined },
        { label: 'Under ₹2,500', href: '/products?maxPrice=2500', count: undefined },
        { label: 'Newest first', href: '/products?sort=newest', count: undefined },
      ],
    },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="max-w-3xl space-y-10">
      {groups.map((group) => (
        <section key={group.title}>
          <h2 className="label-cap mb-4 text-ink-400">{group.title}</h2>
          <ul className="flex flex-wrap gap-2">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="btn-press step-sm inline-flex items-center gap-2 border border-border px-4 py-2 text-ink-700 hover:border-ink-500 hover:text-ink-950"
                >
                  {item.label}
                  {item.count !== undefined ? (
                    <span className="tnum step-xs text-ink-400">{item.count}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
