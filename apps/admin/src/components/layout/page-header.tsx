import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * The header every panel screen carries.
 *
 * ## The shape
 *
 * An eyebrow (where you are), the title in the panel's serif voice, one sentence
 * of context, and the screen's actions. On a phone the actions drop below the
 * title and go full width, because a row of two 44px buttons squeezed beside a
 * title is a row of two thumb-misses.
 *
 * ## Why the sentence is there
 *
 * It is not decoration. Every screen in this panel enforces a real rule — an
 * order cannot skip a status, a coupon code is immutable, a description edit
 * creates a new version — and an operator who does not know the rule rings
 * somebody to ask. One sentence here prevents that call.
 *
 * ## Why it sits on white rather than on the page ground
 *
 * The header is the one band that never scrolls away in spirit: it names the
 * screen. Putting it on the white sheet and the body on warm paper gives the
 * panel a head and a body, which is the cheapest way to make a long screen feel
 * organised. A rose-gold hairline under it marks the boundary without a heavy
 * rule.
 *
 * It is a server component: no state, no client bundle.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  /** A short breadcrumb-ish line above the title. e.g. "Sell → Orders". */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Right-aligned actions. Full width beneath the title on a phone. */
  actions?: ReactNode;
  /** A row of small facts under the description. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('border-b border-border bg-white', className)}>
      <div className="container-page py-5 md:py-7 lg:py-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-10">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink-500">
                <span className="inline-block h-1 w-1 rounded-full bg-rose-500" aria-hidden="true" />
                {eyebrow}
              </p>
            ) : null}
            <h1 className="step-lg mt-1.5 text-ink-900">{title}</h1>
            {description ? (
              <p className="step-md mt-2.5 max-w-3xl text-ink-500">{description}</p>
            ) : null}
            {meta ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3">{meta}</div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 max-md:w-full max-md:[&>*]:flex-1">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/**
 * One small fact in a header's meta row: a label above a value.
 *
 * Used for the things an operator checks before touching anything — the window a
 * dashboard covers, the count a filter matched, the moment the data was read.
 * The value is set larger than the label so the row scans as figures, not as
 * sentences.
 */
export function HeaderFact({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'waiting' | 'fault' | 'brand';
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="label-cap">{label}</span>
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
  );
}

/**
 * A titled sheet for a block of content or a table.
 *
 * Every panel screen is built from these: the sheet is the panel's only container
 * primitive, so a table, a chart and a form all sit on the same sheet with the
 * same head and the same hairline.
 *
 * The head carries a small rose-gold tick before the title. One pixel of colour,
 * repeated on every sheet, is what makes a screen of eight blocks read as one
 * document rather than eight unrelated boxes.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  flush = false,
  className,
  id,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Remove the body padding, for a table that must reach the sheet's edges. */
  flush?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <section className={cn('sheet', className)} id={id}>
      {title ? (
        <div className="sheet-head">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold text-ink-900">
              <span
                className="inline-block h-3.5 w-[2px] shrink-0 rounded-full bg-rose-500"
                aria-hidden="true"
              />
              {title}
            </h2>
            {description ? (
              <p className="mt-1 max-w-2xl pl-3.5 text-[0.875rem] leading-relaxed text-ink-500">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? '' : 'p-4 md:p-6'}>{children}</div>
    </section>
  );
}

/**
 * The honest empty state.
 *
 * Every list in this panel can legitimately be empty — a new store has no orders,
 * a filter can match nothing — and "nothing here" is a fact worth stating plainly
 * rather than dressing in an illustration. The optional action is the thing the
 * operator should do next.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-6 py-16 text-center', className)}>
      <span
        className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50"
        aria-hidden="true"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
      </span>
      <p className="text-[1.0625rem] font-semibold text-ink-800">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[1rem] leading-relaxed text-ink-500">
        {description}
      </p>
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * A notice.
 *
 * Three tones, and the tone is always carried by a word as well as a colour —
 * never colour alone. An operator printing a screenshot in greyscale must still
 * be able to tell an outage from a warning.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'error';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    info: 'border-border bg-panel-100 text-ink-700',
    warning: 'border-gold-200 bg-gold-50 text-gold-800',
    error: 'border-red-200 bg-red-50 text-red-800',
  } as const;

  const prefix = { info: '', warning: 'Warning — ', error: 'Error — ' } as const;

  return (
    <div
      className={cn('rounded-lg border p-4 md:p-5', styles[tone])}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className="text-[1rem] font-semibold">
        {prefix[tone]}
        {title}
      </p>
      {children ? <div className="mt-1.5 text-[1rem] leading-relaxed opacity-90">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A window selector rendered as links.
 *
 * The window lives in the URL, so an operator can bookmark "the fortnight before
 * the sale" and the server renders the right numbers on the first paint. A
 * client-side selector would need to fetch after mount, and a screenshot of a
 * half-loaded dashboard is worse than no screenshot.
 *
 * The active tab is rose gold, the same mark the rail uses for the current
 * screen, so "this is the one you're looking at" means one thing everywhere.
 */
export function WindowTabs({
  windows,
  active,
  hrefFor,
}: {
  windows: readonly { days: number; label: string }[];
  active: number;
  hrefFor: (days: number) => string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border-strong bg-white p-1">
      {windows.map((window) => (
        <a
          key={window.days}
          href={hrefFor(window.days)}
          aria-current={window.days === active ? 'page' : undefined}
          className={cn(
            'btn-press rounded-md px-3.5 py-2 text-[0.9375rem] font-semibold',
            window.days === active
              ? 'bg-rose-500 text-ink-900 shadow-[inset_0_0_0_1px_var(--color-rose-600)]'
              : 'text-ink-600 hover:bg-rose-50 hover:text-rose-800',
          )}
        >
          {window.label}
        </a>
      ))}
    </div>
  );
}
