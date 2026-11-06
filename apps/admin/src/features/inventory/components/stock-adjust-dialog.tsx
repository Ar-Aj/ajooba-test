'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { STOCK_MOVEMENT_REASONS } from '@ajooba/contracts';
import { cn } from '@/lib/format';

/**
 * Stock adjustment.
 *
 * ## The one rule this control enforces
 *
 * Stock is never *set*, it is *adjusted*. The API's contract is a signed delta
 * plus a reason, and it appends a movement to a ledger; there is no route that
 * writes a level, because a level with no history cannot be explained later. This
 * form therefore asks for a change, not a total — and it shows the resulting
 * level live, so an operator can see what they are about to cause before they
 * cause it.
 *
 * ## Why a reason is mandatory
 *
 * `reason` is an enum in the contract, not free text, because the ledger is only
 * useful if it is groupable: "how much did we lose to damage this quarter" is a
 * question someone will ask, and it is unanswerable if every entry says "misc".
 * The optional note carries the specifics.
 *
 * ## Why the button names the outcome
 *
 * "Apply −3" rather than "Save". An operator who has typed `-3` into a box called
 * "quantity" and presses "Save" may believe they set the level to −3, which is
 * absurd but is exactly the kind of ambiguity that produces a stocktake. The
 * button says what will happen.
 */

type Direction = 'remove' | 'add';

/** Reasons that make sense for each direction. `initial-set` only ever adds. */
const REASONS_FOR: Readonly<Record<Direction, readonly string[]>> = {
  remove: ['sale', 'damage', 'correction', 'audit', 'return'],
  add: ['restock', 'return', 'correction', 'audit', 'initial-set'],
};

const REASON_LABEL: Readonly<Record<string, string>> = {
  'initial-set': 'Initial set',
  correction: 'Correction',
  restock: 'Restock',
  sale: 'Sold',
  return: 'Returned',
  damage: 'Damaged',
  audit: 'Stocktake',
};

export function StockAdjustDialog({
  variantId,
  sku,
  productCode,
  colour,
  size,
  stock,
}: {
  variantId: string;
  sku: string;
  productCode: string;
  colour: string;
  size: number;
  stock: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>('add');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<string>('restock');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delta = direction === 'add' ? quantity : -quantity;
  const after = stock + delta;
  const overdraw = after < 0;
  const reasons = REASONS_FOR[direction];

  const resulting = useMemo(() => {
    if (overdraw) return 'Not enough stock';
    if (after === 0) return 'Out of stock';
    if (after <= 3) return 'Low';
    return 'In stock';
  }, [after, overdraw]);

  function switchDirection(next: Direction) {
    setDirection(next);
    // Keep the reason valid for the new direction rather than submitting a
    // combination the API would reject.
    if (!REASONS_FOR[next].includes(reason)) setReason(REASONS_FOR[next][0] ?? 'correction');
  }

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/inventory/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustments: [
            {
              variantId,
              delta,
              reason,
              ...(note.trim() ? { note: note.trim() } : {}),
            },
          ],
          note: note.trim(),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: { applied?: unknown[]; failed?: Array<{ reason?: string }> };
        error?: { message?: string };
      };

      if (!response.ok || !body.ok) {
        setError(body.error?.message ?? 'The adjustment was refused.');
        return;
      }

      /*
       * A batch endpoint reports per-line outcomes. A single-line batch that
       * "succeeded" with zero applied has failed, and saying so is the whole
       * point of reading the body rather than the status code.
       */
      const applied = body.data?.applied?.length ?? 0;
      if (applied === 0) {
        setError(body.data?.failed?.[0]?.reason ?? 'The adjustment was not applied.');
        return;
      }

      setOpen(false);
      setQuantity(1);
      setNote('');
      router.refresh();
    } catch {
      setError('Could not reach the admin API. Stock has not been changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">
        Adjust
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => (busy ? undefined : setOpen(false))}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`adjust-${variantId}`}
            className="relative w-full max-w-md bg-white p-5 shadow-[var(--shadow-elevated)]"
          >
            <h2 id={`adjust-${variantId}`} className="step-md font-semibold text-ink-900">
              Adjust stock
            </h2>
            <p className="step-sm mt-1 text-ink-600">
              {productCode} · {colour} · UK {size}
            </p>
            <p className="mt-0.5 font-mono text-[0.75rem] text-ink-400">{sku}</p>

            {/* ---- direction ------------------------------------------- */}
            <div className="mt-4 grid grid-cols-2 gap-1 border border-border-strong p-1">
              <button
                type="button"
                onClick={() => switchDirection('remove')}
                aria-pressed={direction === 'remove'}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-1.5 text-[0.8125rem]',
                  direction === 'remove'
                    ? 'bg-ink-900 font-medium text-cream-50'
                    : 'text-ink-600 hover:bg-panel-100',
                )}
              >
                <Minus className="h-3.5 w-3.5" strokeWidth={2} />
                Remove
              </button>
              <button
                type="button"
                onClick={() => switchDirection('add')}
                aria-pressed={direction === 'add'}
                className={cn(
                  'flex items-center justify-center gap-1.5 py-1.5 text-[0.8125rem]',
                  direction === 'add'
                    ? 'bg-ink-900 font-medium text-cream-50'
                    : 'text-ink-600 hover:bg-panel-100',
                )}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Add
              </button>
            </div>

            {/* ---- quantity -------------------------------------------- */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`qty-${variantId}`} className="label-cap block text-ink-500">
                  Units
                </label>
                <input
                  id={`qty-${variantId}`}
                  type="number"
                  min={1}
                  max={100_000}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))
                  }
                  className="field mt-1 tnum"
                />
              </div>
              <div>
                <label htmlFor={`reason-${variantId}`} className="label-cap block text-ink-500">
                  Reason
                </label>
                <select
                  id={`reason-${variantId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="field mt-1"
                >
                  {reasons
                    .filter((value) =>
                      (STOCK_MOVEMENT_REASONS as readonly string[]).includes(value),
                    )
                    .map((value) => (
                      <option key={value} value={value}>
                        {REASON_LABEL[value] ?? value}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* ---- the outcome, before it happens ---------------------- */}
            <div
              className={cn(
                'mt-4 border p-3',
                overdraw ? 'border-red-200 bg-red-50' : 'border-border bg-panel-50',
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="label-cap text-ink-400">Now</span>
                <span className="tnum step-sm text-ink-700">
                  {stock} {stock === 1 ? 'unit' : 'units'}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="label-cap text-ink-400">Change</span>
                <span className="tnum step-sm font-medium text-ink-900">
                  {delta > 0 ? `+${delta}` : delta}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
                <span className="label-cap text-ink-500">After</span>
                <span
                  className={cn(
                    'tnum step-md font-medium',
                    overdraw ? 'text-red-800' : 'text-ink-900',
                  )}
                >
                  {overdraw ? 'Not possible' : `${after} · ${resulting}`}
                </span>
              </div>
            </div>

            <label htmlFor={`note-${variantId}`} className="label-cap mt-4 block text-ink-500">
              Note (optional)
            </label>
            <input
              id={`note-${variantId}`}
              type="text"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              className="field mt-1"
              placeholder="e.g. three pairs water-damaged in transit"
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
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || overdraw || quantity === 0}
                className="btn btn-primary"
              >
                {busy ? 'Applying…' : `Apply ${delta > 0 ? `+${delta}` : delta}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
