import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * A primary metric.
 *
 * Label, figure, and one line of context. The context line is the part most
 * dashboards omit and the part an operator actually needs: "₹1,39,900" answers
 * nothing until it says "across 12 paid orders in the last 30 days".
 *
 * There is no percentage-change badge. A delta against an arbitrary earlier
 * period, on a shop that is three weeks old, is a number with no denominator —
 * it would read as growth when it is simply the first month of trading. The
 * sparkline shows the shape instead, which is honest at any age.
 *
 * ## Why the tiles are ruled rather than cards
 *
 * Four figures in four separate shadowed cards read as four unrelated numbers.
 * Ruled into one block, on one baseline, they read as a comparison — which is
 * the only reason to put them side by side. `emphasis` lets one of them lead, so
 * a row has a headline instead of five equals.
 */
export function Metric({
  label,
  value,
  context,
  emphasis = false,
  tone = 'default',
  accent = false,
  className,
}: {
  label: string;
  value: string;
  context: string;
  /** The one figure on a row that matters most, if there is one. */
  emphasis?: boolean;
  tone?: 'default' | 'waiting' | 'fault' | 'brand';
  /** Draw a rose-gold rule above the tile. Marks a block's leading figure. */
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative bg-white px-4 py-5 md:px-6 md:py-6', className)}>
      {accent ? (
        <span className="absolute inset-x-0 top-0 h-[2px] bg-rose-500" aria-hidden="true" />
      ) : null}
      <p className="text-[0.8125rem] font-medium text-ink-500">{label}</p>
      <p
        className={cn(
          'mt-2',
          emphasis ? 'metric-lead' : 'metric-value',
          tone === 'waiting' ? 'text-gold-700' : '',
          tone === 'fault' ? 'text-claret-700' : '',
          tone === 'brand' ? 'text-rose-700' : '',
          tone === 'default' ? 'text-ink-900' : '',
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[0.875rem] leading-snug text-ink-500">{context}</p>
    </div>
  );
}

/**
 * A compact figure for a header strip: label left, value right, one line.
 *
 * Used where a full tile would waste height. The hairline between rows is drawn
 * as a border on the row rather than a wrapper, so a list of figures is a ruled
 * column and never a stack of boxes.
 */
export function Figure({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: 'default' | 'waiting' | 'fault' | 'brand';
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <span className="text-[0.9375rem] text-ink-600">{label}</span>
      <span className="flex items-baseline gap-2">
        {note ? <span className="text-[0.8125rem] text-ink-400">{note}</span> : null}
        <span
          className={cn(
            'text-[1.0625rem] font-semibold tabular-nums',
            tone === 'waiting' ? 'text-gold-700' : '',
            tone === 'fault' ? 'text-claret-700' : '',
            tone === 'brand' ? 'text-rose-700' : '',
            tone === 'default' ? 'text-ink-900' : '',
          )}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

/**
 * A row of tiles sharing one border, so four figures read as one block.
 *
 * The wrapper exists because the border trick — a 1px gap filled by the border
 * colour — has to be written identically every time, and it is the difference
 * between a comparison and four boxes. Columns are one on a phone, two on a
 * tablet, and a caller-chosen count on a laptop.
 */
export function MetricRow({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
}) {
  const lg =
    columns === 5
      ? 'lg:grid-cols-5'
      : columns === 3
        ? 'lg:grid-cols-3'
        : columns === 2
          ? 'lg:grid-cols-2'
          : 'lg:grid-cols-4';
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2',
        lg,
      )}
    >
      {children}
    </div>
  );
}
