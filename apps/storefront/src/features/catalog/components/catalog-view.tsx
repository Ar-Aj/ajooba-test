import { catalogQuerySchema } from '@ajooba/contracts';
import { ApiRequestError, fetchCatalogFacets, fetchProducts } from '@/lib/api';
import { ProductGrid } from './product-grid';
import { CatalogToolbar } from './catalog-toolbar';
import { FilterPanel } from './filter-panel';
import { Pagination } from './pagination';
import { ServiceUnavailable, ErrorPanel } from '@/components/ui/empty-states';
import { readCatalogParams, toApiQuery, buildCatalogHref } from '../lib/catalog-params';

/**
 * Server component that fetches a page of the live catalogue and renders it.
 *
 * Server-rendered on purpose: the API is called over the internal network and
 * no catalogue data is prefetched into the browser bundle.
 *
 * Failure handling matters here. There are four genuinely different states and
 * the page must not conflate them:
 *
 *   1. the catalogue is empty     -> an explicit "no products" state
 *   2. the filters match nothing  -> a "no matches + suggestions" state
 *   3. the API is down / failing  -> "temporarily unavailable"
 *   4. the API answered fine      -> the real grid
 *
 * None of them is ever a dummy catalogue.
 *
 * ## The two reads run in parallel
 *
 * The facets and the product page are independent queries against the same API,
 * so they are issued together. Serialising them doubled the time to first byte
 * of every catalogue page for no reason other than the order the code happened
 * to be written in.
 */

interface CatalogViewProps {
  searchParams: Record<string, string | string[] | undefined>;
  basePath?: string;
}

export async function CatalogView({ searchParams, basePath = '/products' }: CatalogViewProps) {
  const params = readCatalogParams(searchParams);

  let query;
  try {
    query = catalogQuerySchema.parse(toApiQuery(params));
  } catch {
    // Invalid filters fall back to the default listing rather than erroring.
    query = catalogQuerySchema.parse({});
  }

  try {
    // Facet counts are a nicety, not a requirement — if that endpoint is
    // unavailable `fetchCatalogFacets` returns null and the panel still works,
    // just without counts.
    const [result, facets] = await Promise.all([fetchProducts(query), fetchCatalogFacets()]);

    // A page beyond the last page is a dead end, not an error: nudge to the
    // last real page instead of showing an empty grid.
    if (result.totalPages > 0 && query.page > result.totalPages) {
      return (
        <div className="py-16 text-center">
          <h2 className="step-lg text-ink-900">That page is past the end</h2>
          <p className="step-sm mt-2 text-ink-500">
            This listing has {result.totalPages} {result.totalPages === 1 ? 'page' : 'pages'}.
          </p>
          <a
            href={buildCatalogHref(params, { page: result.totalPages }, basePath)}
            className="btn-press step-sm mt-6 inline-flex bg-ink-900 px-6 py-3 font-medium text-cream-50 hover:bg-ink-800"
          >
            Go to the last page
          </a>
        </div>
      );
    }

    const activeCategory = params.subcategory
      ? facets?.categories.find((category) => category.slug === params.subcategory)
      : undefined;

    return (
      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12">
        {/* Desktop filter rail */}
        <aside className="hidden lg:block" aria-label="Product filters">
          <div className="sticky top-32 max-h-[calc(100dvh-10rem)] overflow-y-auto pr-2 scrollbar-soft">
            <FilterPanel params={params} basePath={basePath} facets={facets} />
          </div>
        </aside>

        <div>
          {/*
            The category's own sentence, when one is selected and the API knows
            it. This is what makes a filtered view feel like a department in a
            shop rather than a database result — and it disappears the moment it
            would be a guess.
          */}
          {activeCategory ? (
            <div className="mb-8 max-w-2xl">
              <h2 className="step-lg text-ink-900">{activeCategory.displayName}</h2>
              {activeCategory.description ? (
                <p className="step-sm mt-2 text-ink-500">{activeCategory.description}</p>
              ) : null}
            </div>
          ) : null}

          <CatalogToolbar
            params={params}
            totalItems={result.totalItems}
            basePath={basePath}
            facets={facets}
          />

          <div className="mt-8">
            <ProductGrid products={result.items} totalItems={result.totalItems} />
          </div>

          {result.totalItems > 0 ? (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              hrefFor={(page) => buildCatalogHref(params, { page }, basePath)}
            />
          ) : null}
        </div>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiRequestError && (error.isUnavailable || error.isNotFound)) {
      return <ServiceUnavailable what="the catalogue" />;
    }
    // Anything else is a genuine bug — render a recoverable panel rather than
    // a hard 500 page.
    return (
      <ErrorPanel
        title="We couldn't load the catalogue"
        message="Something unexpected went wrong while fetching products. Reloading the page usually clears it."
        action={
          <a
            href={basePath}
            className="step-sm inline-flex h-11 items-center border border-border px-5 font-medium text-ink-900 hover:border-ink-500"
          >
            Refresh the page
          </a>
        }
      />
    );
  }
}
