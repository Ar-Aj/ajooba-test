import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CatalogView } from '@/features/catalog/components/catalog-view';
import { CategoryRail } from '@/features/catalog/components/category-rail';
import { ProductGridSkeleton } from '@/features/catalog/components/product-grid-skeleton';
import { PageViewTracker } from '@/components/track/page-view-tracker';
import { readCatalogParams } from '@/features/catalog/lib/catalog-params';
import { fetchCategories } from '@/lib/api';

/**
 * Catalogue listing page.
 *
 * The grid is rendered from the live catalogue in MongoDB via the REST API.
 * When the catalogue has not been imported yet the API returns an empty list
 * and the page shows an honest "no products found" state — never a dummy
 * catalogue.
 *
 * ## The category rail is the page's own navigation
 *
 * Every category is listed across the top as a link, with the count the API
 * reports. It is the same list the header and footer use. Selecting one is a
 * URL change, so it is shareable and the back button behaves.
 */

export const metadata: Metadata = {
  title: 'Shop all footwear',
  description: 'Browse every Ajooba Footwear design by category, colour, size and price.',
  alternates: { canonical: '/products' },
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [raw, categories] = await Promise.all([searchParams, fetchCategories()]);
  const params = readCatalogParams(raw);
  const active = params.subcategory;
  const activeName = active
    ? categories.find((category) => category.slug === active)?.displayName
    : undefined;

  return (
    <div className="container-page py-8 md:py-12">
      {/*
        The listing itself is a recorded page view when a category is selected:
        "how many people opened Moji/Jutti this week" is the number that says
        whether a department is being found at all. The all-footwear listing is
        not recorded — it is the shelf everyone lands on, and counting it would
        flatten every category share in the report.
      */}
      {active ? (
        <PageViewTracker kind="category" categorySlug={active} categoryName={activeName} />
      ) : null}

      <header className="mb-8 md:mb-10">
        <h1 className="step-xl text-ink-900">
          {active
            ? (categories.find((category) => category.slug === active)?.displayName ?? 'Footwear')
            : 'All footwear'}
        </h1>
        <p className="step-md mt-3 max-w-xl text-ink-600">
          Every design in the Ajooba catalogue, photographed colour by colour. Filter by category,
          colour, size and price.
        </p>
      </header>

      {/*
        A horizontal category rail rather than a second dropdown. On a phone it
        scrolls; on a laptop it sits on one line. Either way the shopper can see
        the whole taxonomy at once and jump between departments in one tap.
      */}
      <CategoryRail categories={categories} active={active} />

      <Suspense fallback={<ProductGridSkeleton />}>
        <CatalogView searchParams={raw} basePath="/products" />
      </Suspense>
    </div>
  );
}
