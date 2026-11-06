import { cn } from '@/lib/cn';
import { TapLink } from '@/components/track/tap-link';

interface PaginationProps {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}

/**
 * Server-rendered pagination.
 *
 * Real `<a>` elements, not buttons — pagination must work without JS, be
 * middle-clickable, and be crawlable. `rel=prev/next` is not emitted because
 * the page already emits canonical + robots metadata; adding rel attributes to
 * pagination here would be redundant.
 *
 * Visual language: current page is a filled ink block, the rest are bare
 * numerals on the page ground with a hover underline. Numbered boxes around
 * every page turn the footer of a listing into a grid of buttons, which reads
 * as a control panel rather than a shelf.
 */
export function Pagination({ page, totalPages, hrefFor }: PaginationProps) {
  if (totalPages <= 1) return null;

  const windowSize = 2;
  const pages: number[] = [];
  const push = (n: number) => {
    if (!pages.includes(n)) pages.push(n);
  };
  push(1);
  for (let i = page - windowSize; i <= page + windowSize; i++) {
    if (i > 1 && i < totalPages) push(i);
  }
  push(totalPages);

  const withGaps: Array<number | 'gap'> = [];
  let previous = 0;
  for (const item of pages) {
    if (previous && item - previous > 1) withGaps.push('gap');
    withGaps.push(item);
    previous = item;
  }

  return (
    <nav aria-label="Pagination" className="mt-14 border-t border-border pt-6">
      <ol className="flex flex-wrap items-center justify-between gap-4">
        <li>
          {page > 1 ? (
            <TapLink
              href={hrefFor(page - 1)}
              action="page-prev"
              surface="catalog-pagination"
              className="step-sm link-underline text-ink-700 hover:text-ink-950"
            >
              ← Previous
            </TapLink>
          ) : (
            <span aria-disabled="true" className="step-sm text-ink-300">
              ← Previous
            </span>
          )}
        </li>

        <li>
          <ol className="flex items-center gap-1">
            {withGaps.map((item, index) =>
              item === 'gap' ? (
                <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-ink-300">
                  …
                </li>
              ) : (
                <li key={item}>
                  <TapLink
                    href={hrefFor(item)}
                    action={item > page ? 'page-next' : 'page-prev'}
                    surface="catalog-pagination"
                    className={cn(
                      'tnum step-sm inline-flex h-9 min-w-9 items-center justify-center px-2',
                      item === page
                        ? 'bg-ink-900 font-medium text-cream-50'
                        : 'text-ink-600 hover:bg-cream-100 hover:text-ink-950',
                    )}
                    aria-label={`Page ${item}${item === page ? ', current page' : ''}`}
                  >
                    {item}
                  </TapLink>
                </li>
              ),
            )}
          </ol>
        </li>

        <li>
          {page < totalPages ? (
            <TapLink
              href={hrefFor(page + 1)}
              action="page-next"
              surface="catalog-pagination"
              className="step-sm link-underline text-ink-700 hover:text-ink-950"
            >
              Next →
            </TapLink>
          ) : (
            <span aria-disabled="true" className="step-sm text-ink-300">
              Next →
            </span>
          )}
        </li>
      </ol>
    </nav>
  );
}
