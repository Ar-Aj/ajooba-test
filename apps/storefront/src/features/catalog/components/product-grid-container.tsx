import { catalogQuerySchema, type CatalogQueryInput } from '@ajooba/contracts';
import { ApiRequestError, fetchProducts } from '@/lib/api';
import { ProductGrid } from './product-grid';
import { ProductGridSkeleton } from './product-grid-skeleton';
import { ServiceUnavailable } from '@/components/ui/empty-states';
import { readCatalogParams, toApiQuery } from '../lib/catalog-params';

/**
 * Minimal server component that fetches a page of the live catalogue and
 * renders just the grid.
 *
 * The full shop page uses `CatalogView` (which adds filters, sort, toolbar
 * and pagination). This component remains as the narrow, dependency-light
 * entry point used by the home page's "new in" rail and by any surface that
 * only needs the grid.
 *
 * Failure handling:
 *   1. empty catalogue   -> explicit "no products" state
 *   2. API down/failing -> explicit "temporarily unavailable" state
 *   3. API answered     -> the real product grid
 *
 * None of them is ever a dummy catalogue.
 */

interface ProductGridContainerProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export async function ProductGridContainer({ searchParams }: ProductGridContainerProps) {
  const params = readCatalogParams(searchParams);

  let query: CatalogQueryInput;
  try {
    query = catalogQuerySchema.parse(toApiQuery(params));
  } catch {
    query = catalogQuerySchema.parse({});
  }

  try {
    const result = await fetchProducts(query);
    return <ProductGrid products={result.items} totalItems={result.totalItems} />;
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnavailable) {
      return <ServiceUnavailable what="the catalogue" />;
    }
    throw error;
  }
}

export { ProductGridSkeleton };
