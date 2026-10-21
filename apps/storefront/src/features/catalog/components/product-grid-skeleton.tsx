/**
 * Loading skeleton for the product grid.
 * Purely presentational — it contains no product data.
 */
export function ProductGridSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-4 h-4 w-24 animate-pulse rounded bg-neutral-200" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} className="overflow-hidden rounded-lg border border-neutral-200">
            <div className="aspect-square animate-pulse bg-neutral-100" />
            <div className="space-y-2 p-3">
              <div className="h-4 animate-pulse rounded bg-neutral-200" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-neutral-200" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
