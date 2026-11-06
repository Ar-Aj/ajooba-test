import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * Pagination for a list endpoint.
 *
 * ## Why links and not buttons
 *
 * The page number belongs in the URL. An operator who has filtered the orders
 * list to page 3 and sends the link to a colleague must send page 3, and the back
 * button must return to page 2. A client-side pager makes both of those silently
 * wrong.
 *
 * ## What it says
 *
 * "Showing 25–48 of 312" answers the question a page control is actually asked,
 * which is not "which page am I on" but "have I seen everything". The page number
 * is the mechanism; the range is the information.
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  totalPages,
  hrefFor,
  className,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  /** Computed locally when the API omits it. */
  totalPages?: number;
  /** Build the href for a given page, preserving the current filters. */
  hrefFor: (page: number) => string;
  className?: string;
}) {
  const pages = totalPages ?? (totalItems === 0 ? 1 : Math.ceil(totalItems / pageSize));
  if (totalItems === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);
  const hasPrev = page > 1;
  const hasNext = page < pages;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5',
        className,
      )}
    >
      <p className="step-xs tabular-nums text-ink-500">
        Showing {first}–{last} of {totalItems}
        <span className="mx-2 text-ink-300" aria-hidden="true">
          ·
        </span>
        Page {page} of {pages}
      </p>

      <div className="flex items-center gap-1">
        {hasPrev ? (
          <Link href={hrefFor(page - 1)} className="btn btn-secondary btn-sm" rel="prev">
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Previous
          </Link>
        ) : (
          <span
            className="btn btn-secondary btn-sm cursor-not-allowed opacity-40"
            aria-hidden="true"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Previous
          </span>
        )}
        {hasNext ? (
          <Link href={hrefFor(page + 1)} className="btn btn-secondary btn-sm" rel="next">
            Next
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        ) : (
          <span
            className="btn btn-secondary btn-sm cursor-not-allowed opacity-40"
            aria-hidden="true"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
        )}
      </div>
    </nav>
  );
}

/**
 * Build a query string from a partial record, dropping empty values.
 *
 * Every filter bar in the panel needs this, and doing it inline each time is how
 * a filter ends up written as `?status=undefined`.
 */
export function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '' && value !== 'all') {
      params.set(key, String(value));
    }
  }
  const result = params.toString();
  return result ? `?${result}` : '';
}

/**
 * A count pill for a filter tab: "Placed 12".
 *
 * The number is muted so the word stays the label and the count is the evidence.
 */
export function FilterCount({ count }: { count: number }) {
  return (
    <span className="ml-1.5 tabular-nums text-ink-400" aria-hidden="true">
      {count}
    </span>
  );
}
