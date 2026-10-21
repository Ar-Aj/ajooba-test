import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BRAND_NAME } from '@ajooba/contracts';
import { ProductGridContainer } from '@/features/catalog/components/product-grid-container';
import { ProductGridSkeleton } from '@/features/catalog/components/product-grid-skeleton';

/**
 * Catalogue listing page.
 *
 * The grid is rendered from the live catalogue in MongoDB via the REST API.
 * When the catalogue has not been imported yet the API returns an empty list
 * and the page shows an honest "no products found" state — never a dummy
 * catalogue.
 */

export const metadata: Metadata = {
  title: 'Shop all footwear',
  description: 'Browse every Ajooba Footwear design by category, colour and size.',
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <main className="min-h-dvh">
      <header className="border-b border-neutral-200">
        <div className="container-page py-8 md:py-12">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">All footwear</h1>
          <p className="mt-2 text-neutral-600">Every design in the {BRAND_NAME} catalogue.</p>
        </div>
      </header>

      <section className="container-page py-8">
        <Suspense fallback={<ProductGridSkeleton />}>
          <ProductGridContainer searchParams={params} />
        </Suspense>
      </section>
    </main>
  );
}
