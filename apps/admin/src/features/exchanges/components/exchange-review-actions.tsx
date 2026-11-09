'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ExchangeRequest, ExchangeStatus } from '@ajooba/contracts';

const NEXT_ACTIONS: Partial<Record<ExchangeStatus, readonly ExchangeStatus[]>> = {
  requested: ['approved', 'rejected'],
  approved: ['received', 'rejected'],
  received: ['replacement-shipped'],
  'replacement-shipped': ['completed'],
};

const ACTION_LABEL: Partial<Record<ExchangeStatus, string>> = {
  approved: 'Approve & hold stock',
  rejected: 'Reject request',
  received: 'Mark pair received',
  'replacement-shipped': 'Mark replacement shipped',
  completed: 'Complete exchange',
};

export function ExchangeReviewActions({
  exchange,
  canWrite,
}: {
  exchange: ExchangeRequest;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const actions = NEXT_ACTIONS[exchange.status] ?? [];

  async function move(status: ExchangeStatus) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/exchanges/${encodeURIComponent(exchange.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status, note: note.trim() }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error?.message ?? 'The exchange was not updated. Refresh and try again.',
        );
      }
      setNote('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The exchange was not updated.');
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite)
    return <span className="step-xs text-ink-400">Requires orders:write permission</span>;
  if (actions.length === 0) return <span className="step-xs text-ink-400">No action pending</span>;

  return (
    <div className="min-w-56 space-y-2">
      <label className="sr-only" htmlFor={`exchange-note-${exchange.id}`}>
        Staff note for {exchange.exchangeNumber}
      </label>
      <input
        id={`exchange-note-${exchange.id}`}
        className="field w-full"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        placeholder="Optional update for the customer"
      />
      <div className="flex flex-wrap gap-2">
        {actions.map((status) => (
          <button
            key={status}
            type="button"
            className={
              status === 'rejected' ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'
            }
            disabled={busy}
            onClick={() => void move(status)}
          >
            {busy ? 'Saving…' : ACTION_LABEL[status]}
          </button>
        ))}
      </div>
      {error ? (
        <p className="step-xs text-claret-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
