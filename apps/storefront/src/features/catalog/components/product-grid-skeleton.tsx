/**
 * Loading skeleton for the product grid.
 * Purely presentational — it contains no product data.
 */
export function ProductGridSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading products…</span>
      <div className="mb-4 h-4 w-24 animate-pulse rounded bg-ink-100 motion-reduce:animate-none" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
            <div className="aspect-square animate-pulse bg-ink-50 motion-reduce:animate-none" />
            <div className="space-y-2 p-3">
              <div className="h-4 w-full animate-pulse rounded bg-ink-100 motion-reduce:animate-none" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-ink-100 motion-reduce:animate-none" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
