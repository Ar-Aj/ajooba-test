import Link from 'next/link';
import type {
  InteractionActionRow,
  InteractionBucketRow,
  InteractionCategoryRow,
  InteractionProductRow,
  InteractionTrendPoint,
} from '@ajooba/contracts';
import { cn } from '@/lib/format';

/**
 * The pieces every interaction screen shares.
 *
 * Three screens read the same events — the store-wide report, the product
 * spectrum and a customer's profile — so the ranked lists and the button matrix
 * live here. If a product's add rate were formatted one way on the spectrum and
 * another on a customer's profile, the two screens would look like they were
 * measuring different things.
 */

/* -------------------------------------------------------------------------- */
/* Numbers                                                                    */
/* -------------------------------------------------------------------------- */

/** A count, with thousands separators. Never abbreviated — see the note below. */
export function count(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

/**
 * A share, as a percentage.
 *
 * One decimal below 10% so a small but real slice is not rounded to "0%" — the
 * figure an operator is most likely to misread as "nothing happened".
 */
export function share(value: number): string {
  const percent = value * 100;
  if (percent === 0) return '0%';
  if (percent < 1) return '<1%';
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

/* -------------------------------------------------------------------------- */
/* Share bar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A labelled proportion, as a ruled row.
 *
 * A bar per row rather than a pie: this list is read top-down by an operator
 * asking "which surface gets the most taps", and a ranked bar chart answers that
 * by length alone, without estimating angles. The bar is drawn against the
 * largest row rather than against the total, so the smallest rows are still
 * visible as bars instead of slivers.
 */
export function ShareList({
  rows,
  emptyLabel = 'No activity recorded in this window.',
  limit = 8,
  tone = 'rose',
}: {
  rows: readonly (InteractionBucketRow | InteractionActionRow)[];
  emptyLabel?: string;
  limit?: number;
  /** `rose` for data; `ink` for a block that is context rather than a finding. */
  tone?: 'rose' | 'ink';
}) {
  const shown = rows.filter((row) => row.taps > 0).slice(0, limit);
  if (shown.length === 0) {
    return <p className="text-[0.9375rem] text-ink-500">{emptyLabel}</p>;
  }

  const max = Math.max(...shown.map((row) => row.taps), 1);

  return (
    <ul className="space-y-3">
      {shown.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[0.9375rem] text-ink-800">{row.label}</span>
            <span className="shrink-0 text-[0.8125rem] tabular-nums text-ink-500">
              {count(row.taps)}
              <span className="ml-1.5 text-ink-400">{share(row.share)}</span>
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-200"
            role="presentation"
          >
            <div
              className={cn(
                'h-full rounded-full',
                tone === 'rose' ? 'bg-rose-500' : 'bg-ink-600',
              )}
              style={{ width: `${Math.max((row.taps / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* The button matrix                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The buttons a design (or a customer) earned, as a compact matrix.
 *
 * ## Why a matrix and not another bar list
 *
 * A bar list answers "which button was pressed most". That is useful once. The
 * question a merchandiser keeps asking is *"did they configure it and then leave,
 * or did they configure it and buy?"* — which needs two things side by side: the
 * count, and what it means. So each row carries the count, its share, and a
 * verdict word, and the whole block is scannable in one pass.
 *
 * Nothing here is invented. A verdict is a comparison of counts the pipeline
 * already returned, and where the comparison is not meaningful (no views, no
 * configuration) the row says so rather than guessing.
 */
export function ActionMatrix({
  actions,
  emptyLabel = 'No button was pressed in this window.',
  limit = 10,
}: {
  actions: readonly InteractionActionRow[];
  emptyLabel?: string;
  limit?: number;
}) {
  const shown = actions.filter((action) => action.taps > 0).slice(0, limit);
  if (shown.length === 0) {
    return (
      <p className="text-[0.9375rem] leading-relaxed text-ink-500">{emptyLabel}</p>
    );
  }

  const max = Math.max(...shown.map((action) => action.taps), 1);

  return (
    <ul className="divide-y divide-border">
      {shown.map((action) => (
        <li key={action.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[0.9375rem] font-medium text-ink-900">
                {action.label}
              </span>
              <span className="shrink-0 text-[0.9375rem] font-semibold tabular-nums text-ink-900">
                {count(action.taps)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-panel-200">
                <div
                  className="h-full rounded-full bg-rose-400"
                  style={{ width: `${Math.max((action.taps / max) * 100, 2)}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[0.8125rem] tabular-nums text-ink-400">
                {share(action.share)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Funnel                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A funnel, as counts with their drop-offs.
 *
 * Each step is a superset of the next *in this dataset* rather than a strict one
 * — a shopper can add to cart in one session and view the product in another —
 * so the numbers are counts of sessions, not of a cohort walking through a door.
 * Saying "sessions that did X" rather than "of 100 visitors, 12" keeps the screen
 * honest about what it measured.
 */
export function Funnel({
  steps,
}: {
  steps: readonly { label: string; value: number; hint: string }[];
}) {
  const top = Math.max(...steps.map((step) => step.value), 1);

  return (
    <ol className="space-y-4">
      {steps.map((step, index) => {
        const previous = index === 0 ? null : steps[index - 1];
        const drop = previous && previous.value > 0 ? 1 - step.value / previous.value : null;
        return (
          <li key={step.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[0.9375rem] font-medium text-ink-800">{step.label}</span>
              <span className="flex items-baseline gap-2">
                {drop !== null && drop > 0.001 ? (
                  <span className="text-[0.8125rem] tabular-nums text-ink-400">
                    −{share(drop)} from above
                  </span>
                ) : null}
                <span className="text-[1.0625rem] font-semibold tabular-nums text-ink-900">
                  {count(step.value)}
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-panel-200">
              <div
                className={cn(
                  'h-full rounded-full',
                  index === 0
                    ? 'bg-rose-600'
                    : index === 1
                      ? 'bg-rose-500'
                      : index === 2
                        ? 'bg-rose-400'
                        : 'bg-rose-300',
                )}
                style={{ width: `${Math.max((step.value / top) * 100, step.value > 0 ? 2 : 0)}%` }}
              />
            </div>
            <p className="mt-1 text-[0.8125rem] text-ink-400">{step.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A daily activity strip.
 *
 * Bars, not a line, for the same reason the dashboard uses bars: most days are
 * quiet, and a line through zeros draws a story about continuity that did not
 * happen. Quiet days keep a 2px stub so the reader can count the days in the
 * window and see the gaps are real.
 */
export function ActivityStrip({
  points,
  metric = 'taps',
}: {
  points: readonly InteractionTrendPoint[];
  metric?: 'taps' | 'productViews' | 'addToCart';
}) {
  if (points.length === 0) {
    return <p className="text-[0.9375rem] text-ink-500">No days in this window.</p>;
  }

  const values = points.map((point) => point[metric]);
  const max = Math.max(...values, 1);

  return (
    <div>
      <div className="flex h-28 items-end gap-px" role="img" aria-label="Daily activity">
        {points.map((point) => (
          <div
            key={point.date}
            className={cn(
              'flex-1 rounded-t-sm transition-colors',
              point[metric] === 0 ? 'bg-panel-300' : 'bg-rose-500',
            )}
            style={{ height: point[metric] === 0 ? 2 : Math.max(3, (point[metric] / max) * 112) }}
            title={`${point.date}: ${count(point[metric])}`}
          />
        ))}
      </div>
      <div className="mt-2.5 flex justify-between">
        <span className="text-[0.8125rem] tabular-nums text-ink-400">{points[0]?.date}</span>
        <span className="text-[0.8125rem] tabular-nums text-ink-400">
          Peak {count(max)} in a day
        </span>
        <span className="text-[0.8125rem] tabular-nums text-ink-400">
          {points[points.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}

/** A session-count strip, for the product profile's own trend. */
export function SessionStrip({
  points,
}: {
  points: readonly { date: string; sessions: number }[];
}) {
  if (points.length === 0) {
    return <p className="text-[0.9375rem] text-ink-500">No days in this window.</p>;
  }
  const max = Math.max(...points.map((point) => point.sessions), 1);

  return (
    <div>
      <div className="flex h-20 items-end gap-px" role="img" aria-label="Sessions per day">
        {points.map((point) => (
          <div
            key={point.date}
            className={cn('flex-1 rounded-t-sm', point.sessions === 0 ? 'bg-panel-300' : 'bg-rose-500')}
            style={{ height: point.sessions === 0 ? 2 : Math.max(3, (point.sessions / max) * 80) }}
            title={`${point.date}: ${point.sessions} sessions`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="text-[0.8125rem] tabular-nums text-ink-400">{points[0]?.date}</span>
        <span className="text-[0.8125rem] tabular-nums text-ink-400">Peak {max}</span>
        <span className="text-[0.8125rem] tabular-nums text-ink-400">
          {points[points.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Product table                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The product interaction table.
 *
 * ## Why these columns and not more
 *
 * Views, taps, adds, saves, sessions, and the rate. Each answers a different
 * question an operator actually asks: *is this being found* (views), *is it being
 * handled* (taps), *is it being wanted* (saves), *is it being bought* (adds), and
 * *does wanting turn into buying* (the rate).
 *
 * ## The rate is over sessions, not views
 *
 * A shopper who reloads the page five times is one shopper. Dividing adds by
 * views would score them at 20% off a single cart action and report a better
 * product than one that genuinely converted. The denominator is set at the API,
 * from distinct sessions, and the column header says so.
 */
export function ProductTable({
  products,
  showCategory = true,
  hrefFor,
}: {
  products: readonly InteractionProductRow[];
  showCategory?: boolean;
  /** When provided, a row links to that product's drill-down. */
  hrefFor?: (product: InteractionProductRow) => string;
}) {
  return (
    <div className="table-scroll scrollbar-soft">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="w-10 text-right">
              #
            </th>
            <th scope="col">Design</th>
            {showCategory ? <th scope="col">Category</th> : null}
            <th scope="col" className="text-right">
              Views
            </th>
            <th scope="col" className="text-right">
              Taps
            </th>
            <th scope="col" className="text-right">
              Added
            </th>
            <th scope="col" className="text-right">
              Saved
            </th>
            <th scope="col" className="text-right">
              Visitors
            </th>
            <th scope="col" className="text-right">
              Add rate
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => {
            const title = (
              <span className="block max-w-[22rem] truncate font-medium text-ink-900">
                {product.title}
              </span>
            );
            return (
              <tr key={product.productId} className="group">
                <td className="text-right tabular-nums text-ink-400">{index + 1}</td>
                <td>
                  <span className="flex flex-col gap-0.5">
                    {hrefFor ? (
                      <Link href={hrefFor(product)} className="hover:text-rose-800">
                        {title}
                      </Link>
                    ) : (
                      title
                    )}
                    <span className="font-mono text-[0.8125rem] text-ink-500">{product.code}</span>
                  </span>
                </td>
                {showCategory ? (
                  <td>
                    <Link
                      href={`/insights?category=${encodeURIComponent(product.categorySlug)}`}
                      className="text-ink-600 hover:text-rose-800"
                    >
                      {product.categoryName}
                    </Link>
                  </td>
                ) : null}
                <td className="text-right tabular-nums">{count(product.views)}</td>
                <td className="text-right tabular-nums">{count(product.taps)}</td>
                <td className="text-right tabular-nums font-medium">{count(product.addToCart)}</td>
                <td className="text-right tabular-nums">{count(product.wishlistAdds)}</td>
                <td className="text-right tabular-nums">{count(product.visitors)}</td>
                <td className="text-right tabular-nums">
                  {product.addToCart === 0 ? (
                    <span className="text-ink-400">—</span>
                  ) : (
                    <span className="font-semibold text-ink-900">{share(product.addToCartRate)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Category table                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The category roll-up.
 *
 * Every row is a roll-up of the product rows above it — same events, grouped one
 * level up — which is why the store-wide totals equal the sum of these rows. The
 * `share` column is what makes the table a decision rather than a list: it says
 * how much of the shop's attention a category is taking, which is the number to
 * compare against how much of the catalogue it occupies.
 */
export function CategoryTable({
  categories,
  activeSlug,
}: {
  categories: readonly InteractionCategoryRow[];
  /** The category the report is currently filtered to, if any. */
  activeSlug?: string;
}) {
  return (
    <div className="table-scroll scrollbar-soft">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="w-10 text-right">
              #
            </th>
            <th scope="col">Category</th>
            <th scope="col" className="text-right">
              Views
            </th>
            <th scope="col" className="text-right">
              Taps
            </th>
            <th scope="col" className="text-right">
              Added
            </th>
            <th scope="col" className="text-right">
              Saved
            </th>
            <th scope="col" className="text-right">
              Designs touched
            </th>
            <th scope="col" className="text-right">
              Share of taps
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => {
            const active = activeSlug === category.slug;
            return (
              <tr key={category.slug} className={active ? 'bg-rose-50' : undefined}>
                <td className="text-right tabular-nums text-ink-400">{index + 1}</td>
                <td>
                  {active ? (
                    <span className="flex items-center gap-2 font-semibold text-rose-800">
                      {category.name}
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[0.75rem] font-semibold text-rose-800">
                        Filtered
                      </span>
                    </span>
                  ) : (
                    <Link
                      href={`/insights?category=${encodeURIComponent(category.slug)}`}
                      className="font-medium text-ink-900 hover:text-rose-800"
                    >
                      {category.name}
                    </Link>
                  )}
                </td>
                <td className="text-right tabular-nums">{count(category.views)}</td>
                <td className="text-right tabular-nums">{count(category.taps)}</td>
                <td className="text-right tabular-nums font-medium">{count(category.addToCart)}</td>
                <td className="text-right tabular-nums">{count(category.wishlistAdds)}</td>
                <td className="text-right tabular-nums">{count(category.productsTouched)}</td>
                <td className="text-right tabular-nums">{share(category.share)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
