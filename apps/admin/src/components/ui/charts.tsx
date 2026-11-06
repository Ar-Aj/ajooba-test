import { cn } from '@/lib/format';

/**
 * A sparkline drawn as SVG, server-rendered.
 *
 * ## Why not a charting library
 *
 * The dashboard needs one line per metric and one bar series. A charting library
 * for that is 40–120 kB of client JavaScript to draw a path that is nine numbers
 * long. This component is a pure function of its data, ships no JavaScript, and
 * renders in the first HTML response — which is the whole point of computing the
 * dashboard on the server.
 *
 * ## Why the shape is honest
 *
 *  - The y-axis always starts at zero. A sparkline that starts at the minimum
 *    makes a 2% wobble look like a collapse, and the person reading this screen
 *    is making stock decisions from it.
 *  - A day with no orders plots on the zero line, not as a gap. The API returns a
 *    dense series precisely so the shape cannot lie about a quiet week.
 *  - The final point is marked, because "where it ended" is what the eye looks
 *    for first and a bare line does not answer it.
 *
 * It is `aria-hidden` and paired with the numbers it draws. A screen reader
 * should read the values, not a path.
 */

type Series = readonly number[];

function bounds(series: Series): { min: number; max: number } {
  let max = 0;
  for (const value of series) if (value > max) max = value;
  return { min: 0, max: max === 0 ? 1 : max };
}

function toPath(series: Series, width: number, height: number, padding: number): string {
  if (series.length === 0) return '';
  const { min, max } = bounds(series);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const step = series.length === 1 ? 0 : innerWidth / (series.length - 1);

  return series
    .map((value, index) => {
      const x = padding + index * step;
      const y = padding + innerHeight - ((value - min) / (max - min)) * innerHeight;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function toArea(series: Series, width: number, height: number, padding: number): string {
  if (series.length === 0) return '';
  const line = toPath(series, width, height, padding);
  const lastX = padding + (series.length === 1 ? 0 : width - padding * 2);
  const baseline = height - padding;
  return `${line} L${lastX.toFixed(2)} ${baseline} L${padding.toFixed(2)} ${baseline} Z`;
}

/** Where the last point sits, so it can be marked. */
function lastPoint(
  series: Series,
  width: number,
  height: number,
  padding: number,
): { x: number; y: number } | null {
  if (series.length === 0) return null;
  const { min, max } = bounds(series);
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const step = series.length === 1 ? 0 : innerWidth / (series.length - 1);
  const value = series[series.length - 1] ?? 0;
  return {
    x: padding + (series.length - 1) * step,
    y: padding + innerHeight - ((value - min) / (max - min)) * innerHeight,
  };
}

/**
 * The line.
 *
 * `stroke` is a CSS colour string rather than a class, because an SVG path
 * cannot receive a Tailwind text colour without `currentColor` plumbing that
 * obscures which colour a caller asked for. In practice every call site passes
 * one of two house values.
 */
export function Sparkline({
  data,
  width = 240,
  height = 48,
  stroke = 'var(--color-ink-700)',
  fill = 'rgba(11, 20, 36, 0.06)',
  label,
  className,
}: {
  data: Series;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  /** A description for the shape, for the sighted operator's benefit. */
  label?: string;
  className?: string;
}) {
  const padding = 3;
  const path = toPath(data, width, height, padding);
  const area = toArea(data, width, height, padding);
  const end = lastPoint(data, width, height, padding);
  const flat = data.every((value) => value === 0);

  return (
    <div className={cn('min-w-0', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        {flat ? (
          // Nothing happened in this window. Draw the zero line itself, so the
          // chart reads as "no activity" rather than "broken chart".
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke={stroke}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.45}
          />
        ) : (
          <>
            <path d={area} fill={fill} />
            <path
              d={path}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {end ? <circle cx={end.x} cy={end.y} r={2} fill={stroke} /> : null}
          </>
        )}
      </svg>
      {label ? <p className="step-xs mt-1 text-ink-400">{label}</p> : null}
    </div>
  );
}

/**
 * A daily bar series.
 *
 * Bars rather than a line when the question is "how many on each day" and the
 * answer for most days is zero: a line through a series of zeros and ones draws
 * a shape that suggests continuity, whereas bars show separate days honestly.
 */
export function BarSeries({
  data,
  labels,
  height = 96,
  barClassName = 'bg-ink-800',
  emptyLabel = 'No days with activity in this window.',
}: {
  data: Series;
  /** Tooltip text per bar, aligned with `data`. */
  labels: readonly string[];
  height?: number;
  barClassName?: string;
  emptyLabel?: string;
}) {
  const max = Math.max(...data, 0);

  if (max === 0) {
    return (
      <div className="flex items-center justify-center border border-dashed border-border px-4 py-8">
        <p className="step-xs text-ink-400">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      className="flex items-end gap-px"
      style={{ height }}
      role="img"
      aria-label="Daily activity"
    >
      {data.map((value, index) => {
        const ratio = value / max;
        // A zero day still gets a 1px stub, so the reader can count the days in
        // the window and see that the gaps are real.
        const barHeight = value === 0 ? 1 : Math.max(2, ratio * height);
        return (
          <div
            key={labels[index] ?? index}
            className={cn('flex-1', value === 0 ? 'bg-panel-300' : barClassName)}
            style={{ height: barHeight }}
            title={labels[index]}
          />
        );
      })}
    </div>
  );
}

/**
 * A horizontal proportion bar, for a breakdown that must be read as parts of a
 * whole (order statuses). Rendered as stacked segments rather than a pie: a pie
 * of five thin slices is unreadable at this size, and adjacent segments share an
 * edge so small values remain visible.
 */
export function ProportionBar({
  segments,
}: {
  segments: ReadonlyArray<{ label: string; value: number; className: string }>;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total === 0) {
    return <div className="h-2 w-full bg-panel-200" aria-hidden="true" />;
  }

  return (
    <div
      className="flex h-2 w-full overflow-hidden bg-panel-200"
      role="img"
      aria-label="Order status split"
    >
      {segments.map((segment) =>
        segment.value === 0 ? null : (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ),
      )}
    </div>
  );
}
