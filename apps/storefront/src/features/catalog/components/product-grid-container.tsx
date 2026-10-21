import { catalogQuerySchema, type CatalogQueryInput } from '@ajooba/contracts';
import { ApiRequestError, fetchProducts } from '@/lib/api';
import { ProductGrid } from './product-grid';
import { ProductGridSkeleton } from './product-grid-skeleton';

/**
 * Server component that fetches a page of the live catalogue and renders it.
 *
 * It is a server component on purpose: the API is called over the internal
 * network and no catalogue data is prefetched into the browser bundle.
 *
 * Failure handling matters here. There are three genuinely different states
 * and the page must not conflate them:
 *
 *   1. the catalogue is empty  -> an explicit "no products" state
 *   2. the API is down/failing -> an explicit "temporarily unavailable" state
 *   3. the API answered fine    -> the real product grid
 *
 * None of them is ever a dummy catalogue.
 */

interface ProductGridContainerProps {
  searchParams: Record<string, string | string[] | undefined>;
}

/** Shown when the API could not be reached. Never a placeholder grid. */
function CatalogueUnavailable() {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
      <h2 className="text-base font-medium">Catalogue temporarily unavailable</h2>
      <p className="mt-2 text-sm text-neutral-600">
        We could not reach the catalogue service. Please try again in a moment.
      </p>
    </div>
  );
}

export async function ProductGridContainer({ searchParams }: ProductGridContainerProps) {
  const flattened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    flattened[key] = Array.isArray(value) ? value[0] : value;
  }

  let query: CatalogQueryInput;
  try {
    query = catalogQuerySchema.parse(flattened);
  } catch {
    // Invalid filters fall back to the default listing rather than erroring.
    query = catalogQuerySchema.parse({});
  }

  try {
    const result = await fetchProducts(query);
    return <ProductGrid products={result.items} totalItems={result.totalItems} />;
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnavailable) {
      return <CatalogueUnavailable />;
    }
    // Anything else is a genuine bug — let the error boundary handle it.
    throw error;
  }
}

export { ProductGridSkeleton };
