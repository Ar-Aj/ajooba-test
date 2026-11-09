'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReturnRequest, ReturnStatus } from '@ajooba/contracts';

const ACTIONS: Partial<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  requested: ['approved', 'rejected'],
  approved: ['received'],
};

const ACTION_LABEL: Partial<Record<ReturnStatus, string>> = {
  approved: 'Approve request',
  rejected: 'Reject request',
  received: 'Mark received & inspected',
};

interface ActionResponse {
  ok?: boolean;
  error?: { message?: string };
  data?: { settled?: boolean; message?: string; providerStatus?: string | null };
}

export function ReturnReviewActions({
  request,
  canWrite,
}: {
  request: ReturnRequest;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const actions = ACTIONS[request.status] ?? [];

  async function send(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const response = await fetch(path, {
        method: path.endsWith('/refund') || path.endsWith('/reconcile') ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = (await response.json()) as ActionResponse;
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error?.message ?? 'The return was not updated. Refresh and try again.',
        );
      }
      if (result.data?.message) setFeedback(result.data.message);
      setNote('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The return was not updated.');
    } finally {
      setBusy(false);
    }
  }

  function move(status: ReturnStatus) {
    void send(`/api/admin/returns/${encodeURIComponent(request.id)}`, {
      status,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  }

  if (!canWrite)
    return <span className="step-xs text-ink-400">Requires returns:write permission</span>;

  return (
    <div className="min-w-56 space-y-2">
      {actions.length > 0 ? (
        <>
          <label className="sr-only" htmlFor={`return-note-${request.id}`}>
            Staff note for {request.returnNumber}
          </label>
          <input
            id={`return-note-${request.id}`}
            className="field w-full"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="Optional customer update"
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
                onClick={() => move(status)}
              >
                {busy ? 'Saving…' : ACTION_LABEL[status]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {request.status === 'received' ? (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() =>
            void send(
              `/api/admin/returns/${encodeURIComponent(request.id)}/${request.refundRef ? 'reconcile' : 'refund'}`,
              request.refundRef ? undefined : {},
            )
          }
        >
          {busy
            ? 'Checking…'
            : request.refundRef
              ? 'Check Razorpay status'
              : 'Start Razorpay refund'}
        </button>
      ) : null}

      {feedback ? (
        <p className="step-xs text-ink-600" role="status">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="step-xs text-claret-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
