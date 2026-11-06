'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@ajooba/contracts';
import { ORDER_TRANSITIONS, TRANSITION_COPY } from '@/lib/order-lifecycle';
import { cn } from '@/lib/format';

/**
 * The status control on an order.
 *
 * ## Why a dialog and not `window.confirm`
 *
 * These transitions are not undoable: cancelling an order returns stock to the
 * catalogue and emails the customer, and "mark delivered" is the end of the
 * line. A browser `confirm()` is unstyled, unbranded, cannot ask for a reason,
 * and is blocked entirely by some managed browsers — so it is used only where a
 * mistake is cheap. Here, a mistake is expensive, so the panel asks properly:
 * the destination, what it will do, and an optional note stored in the audit log.
 *
 * ## Only legal moves are offered
 *
 * `ORDER_TRANSITIONS` mirrors the API's table. If the two ever disagree the API
 * wins and its message is shown verbatim; the panel never claims a move it did
 * not make.
 *
 * ## Fetch, then refresh
 *
 * The call goes to `/api/admin/orders/:id/status`, a route handler that attaches
 * the httpOnly session cookie. The token never reaches this component, which is
 * why this is a plain `fetch` and not a token-carrying client.
 */
export function OrderStatusControl({
  orderId,
  current,
  orderNumber,
}: {
  orderId: string;
  current: OrderStatus;
  orderNumber: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinations = ORDER_TRANSITIONS[current];

  async function submit() {
    if (!pending) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: pending, ...(note.trim() ? { note: note.trim() } : {}) }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
      };

      if (!response.ok || !body.ok) {
        setError(body.error?.message ?? 'The status change was refused.');
        return;
      }

      setPending(null);
      setNote('');
      // Re-render the server component so every figure on the page reflects the
      // new state, rather than only the badge this component knows about.
      router.refresh();
    } catch {
      setError('Could not reach the admin API. The order has not been changed.');
    } finally {
      setBusy(false);
    }
  }

  if (destinations.length === 0) {
    return (
      <p className="step-sm text-ink-500">
        This order is <span className="font-medium text-ink-800">{current}</span> and cannot move
        again. The lifecycle ends here.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {destinations.map((destination) => {
          const copy = TRANSITION_COPY[destination];
          return (
            <button
              key={destination}
              type="button"
              onClick={() => {
                setPending(destination);
                setError(null);
              }}
              className={cn('btn btn-sm', copy.destructive ? 'btn-danger' : 'btn-secondary')}
            >
              {copy.label}
            </button>
          );
        })}
      </div>

      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => (busy ? undefined : setPending(null))}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="transition-title"
            className="relative w-full max-w-md bg-white p-5 shadow-[var(--shadow-elevated)]"
          >
            <h2 id="transition-title" className="step-md font-semibold text-ink-900">
              {TRANSITION_COPY[pending].label}
            </h2>
            <p className="step-sm mt-1.5 text-ink-600">{TRANSITION_COPY[pending].intent}</p>

            <dl className="mt-4 border border-border bg-panel-50 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="label-cap text-ink-400">Order</dt>
                <dd className="font-mono text-[0.75rem] text-ink-900">{orderNumber}</dd>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <dt className="label-cap text-ink-400">From → to</dt>
                <dd className="step-sm text-ink-900">
                  {current} → <span className="font-medium">{pending}</span>
                </dd>
              </div>
            </dl>

            <label htmlFor="transition-note" className="label-cap mt-4 block text-ink-500">
              Note (optional, stored in the audit log)
            </label>
            <textarea
              id="transition-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={500}
              className="field mt-1"
              placeholder="e.g. customer asked to hold delivery until Monday"
            />

            {error ? (
              <p
                role="alert"
                className="step-sm mt-3 border border-red-200 bg-red-50 p-2 text-red-800"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={busy}
                className="btn btn-secondary"
              >
                Keep as is
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className={cn(
                  'btn',
                  TRANSITION_COPY[pending].destructive ? 'btn-danger' : 'btn-primary',
                )}
              >
                {busy ? 'Saving…' : TRANSITION_COPY[pending].label}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
