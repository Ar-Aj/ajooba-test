import { cn } from '@/lib/cn';

/**
 * The empty states.
 *
 * Tone: "there is nothing here right now", stated once, with a way out. Never
 * sales-y, never an apology loop, never a decorative illustration pretending to
 * be product photography.
 *
 * Visually these are type on the page ground with a single hairline at the top.
 * The dashed-border box they used to live in made every empty page look like an
 * unfinished placeholder — which, for a shop, is exactly the wrong impression
 * when the real cause is a filter that matched nothing.
 */
interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn('border-t border-border pt-10 text-center md:pt-14', className)}
    >
      {icon ? (
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center text-ink-300">
          {icon}
        </div>
      ) : null}
      <h2 className="step-lg text-ink-900">{title}</h2>
      <p className="step-sm mx-auto mt-3 max-w-md text-ink-500">{description}</p>
      {action ? <div className="mt-7 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * "Down for maintenance" state. Used when the catalogue API is unreachable —
 * deliberately distinct from "the catalogue is empty", because a shopper who is
 * told a shop is empty when the shop is merely offline will not come back.
 */
export function ServiceUnavailable({
  className,
  what = 'the catalogue',
}: {
  className?: string;
  what?: string;
}) {
  return (
    <div role="status" className={cn('border-t-2 border-gold-500 pt-10 text-center', className)}>
      <h2 className="step-lg text-ink-900">{`We can't reach ${what} right now`}</h2>
      <p className="step-sm mx-auto mt-3 max-w-md text-ink-500">
        Please try again in a moment. We have not lost your selection — it is still safe in your
        cart.
      </p>
    </div>
  );
}

/**
 * Full-page error fallback used by route error boundaries.
 *
 * Claret, because this one genuinely is a fault state and the house rule gives
 * claret to faults only.
 */
export function ErrorPanel({
  title = 'Something went wrong',
  message = "We've hit an unexpected problem. Reloading the page usually clears it.",
  action,
  className,
}: {
  title?: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('border-t-2 border-claret-600 pt-10 text-center', className)}>
      <h2 className="step-lg text-claret-700">{title}</h2>
      <p className="step-sm mx-auto mt-3 max-w-md text-ink-600">{message}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
