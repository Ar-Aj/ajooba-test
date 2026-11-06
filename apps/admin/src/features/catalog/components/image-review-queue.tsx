'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ImageReviewItem } from '@ajooba/contracts';
import {
  AdminApiError,
  assignImage,
  listReviewQueue,
  rejectImage,
  revertImage,
} from '@/lib/catalog-api';

/**
 * The image review queue (G-5).
 *
 * This screen is the human half of a safety rule. At import time an image is
 * only auto-assigned when its filename token matches a colour the design
 * genuinely sells; everything else is quarantined. This queue is where an
 * administrator looks at the quarantined images and decides.
 *
 * Design commitments, each one enforced by the API rather than by this file:
 *
 *  - **Every decision needs a reason.** The reason is stored with the
 *    administrator and the timestamp, so an assignment can be audited and
 *    undone later.
 *  - **Nothing is auto-trusted.** The queue never pre-selects a colour. The
 *    reviewer must choose from the colours the design actually sells.
 *  - **A failed action changes nothing.** Every decision re-reads the queue
 *    from the server, so what is on screen is what is stored — never a
 *    locally patched row that the database never accepted.
 */

/** Why an image could not be assigned automatically, in plain language. */
const REASON_TEXT: Record<string, string> = {
  untokened: 'Filename carried no colour token',
  'token-not-sold': 'Filename colour is not one this design sells',
  unparsable: 'Filename did not match any known pattern',
};

const STATUS_TEXT: Record<string, string> = {
  pending: 'Needs review',
  assigned: 'Assigned',
  rejected: 'Rejected',
};

interface QueueState {
  items: ImageReviewItem[];
  totalItems: number;
  page: number;
  totalPages: number;
  summary: {
    pending: number;
    assigned: number;
    rejected: number;
    coloursWithoutVerifiedPhotos: number;
    designsAffected: number;
  };
}

/** The decision a reviewer is composing for one image. */
interface DraftDecision {
  imageId: string;
  colour: string;
  reason: string;
}

export function ImageReviewQueueScreen() {
  const [state, setState] = useState<QueueState | null>(null);
  const [codeFilter, setCodeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'pending' | 'assigned' | 'rejected'>('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [draft, setDraft] = useState<DraftDecision | null>(null);

  /**
   * Re-read the queue from the API.
   *
   * Called after every decision rather than patching local state, so the
   * screen can never show a colour assignment the database rejected.
   */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listReviewQueue({
        code: codeFilter || undefined,
        status: statusFilter,
        page,
        pageSize: 24,
      });
      setState({
        items: [...result.items],
        totalItems: result.totalItems,
        page: result.page,
        totalPages: result.totalPages,
        summary: { ...result.summary },
      });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof AdminApiError ? error.message : 'Could not load the review queue.',
      });
    } finally {
      setLoading(false);
    }
  }, [codeFilter, statusFilter, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Run one decision, then reload so the screen reflects stored truth. */
  async function decide(action: 'assign' | 'reject' | 'revert', item: ImageReviewItem) {
    const colour = draft?.imageId === item.id ? draft.colour : '';
    const reason = draft?.imageId === item.id ? draft.reason : '';

    if (action === 'assign' && colour.length === 0) {
      setNotice({ kind: 'error', text: 'Choose the colour this photograph actually shows.' });
      return;
    }
    if (reason.trim().length < 10) {
      setNotice({
        kind: 'error',
        text: 'A reason of at least 10 characters is required — it is stored with your name.',
      });
      return;
    }

    setBusy(item.id);
    setNotice(null);
    try {
      if (action === 'assign') {
        await assignImage(item.id, colour, reason.trim());
      } else if (action === 'reject') {
        await rejectImage(item.id, reason.trim());
      } else {
        await revertImage(item.id, reason.trim());
      }

      setDraft(null);
      await reload();
      setNotice({
        kind: 'ok',
        text:
          action === 'assign'
            ? `${item.sourceFile} assigned to ${colour}.`
            : action === 'reject'
              ? `${item.sourceFile} marked rejected and left out of every gallery.`
              : `${item.sourceFile} returned to quarantine.`,
      });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof AdminApiError ? error.message : 'The decision was not saved.',
      });
    } finally {
      setBusy(null);
    }
  }

  const summary = state?.summary;

  return (
    <div>
      {/* The live queue counts, straight from the API's own summary. */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Needs review" value={summary?.pending} />
        <Stat label="Assigned" value={summary?.assigned} />
        <Stat label="Rejected" value={summary?.rejected} />
        <Stat label="Colours with no photo" value={summary?.coloursWithoutVerifiedPhotos} />
        <Stat label="Designs affected" value={summary?.designsAffected} />
      </dl>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-neutral-600">Design code</span>
          <input
            value={codeFilter}
            onChange={(event) => {
              setCodeFilter(event.target.value.toUpperCase());
              setPage(1);
            }}
            placeholder="e.g. A46"
            maxLength={3}
            className="mt-1 w-28 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-sm">
          <span className="block text-neutral-600">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="mt-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="pending">Needs review</option>
            <option value="assigned">Assigned</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>

        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {notice ? (
        <p
          role="status"
          className={`mt-4 rounded border px-3 py-2 text-sm ${
            notice.kind === 'ok'
              ? 'border-green-300 bg-green-50 text-green-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {loading && !state ? (
        <p className="mt-6 text-sm text-neutral-600">Loading the queue…</p>
      ) : null}

      {!loading && state && state.items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
          <h2 className="text-sm font-medium">Nothing in this view</h2>
          <p className="mt-2 text-sm text-neutral-600">
            No images match this filter. Every photograph for this status has a decision, or the
            design has no unresolved images left.
          </p>
        </div>
      ) : null}

      <ul className="mt-6 space-y-4">
        {state?.items.map((item) => {
          const isOpen = draft?.imageId === item.id;
          return (
            <li key={item.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap gap-4">
                {item.url ? (
                  /*
                   * The exact bytes the reviewer is judging. Quarantined
                   * images are never shown on the storefront, so this
                   * admin-only preview is the only place they appear.
                   *
                   * A plain <img> rather than next/image: these are
                   * arbitrary user-supplied filenames under a media mount
                   * that cannot be statically optimised at build time, and
                   * the reviewer needs the unmodified original rather than
                   * a resized derivative.
                   */
                  <img
                    src={item.url}
                    alt={item.alt || item.sourceFile}
                    className="h-32 w-32 rounded border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="flex h-32 w-32 items-center justify-center rounded border border-dashed border-neutral-300 bg-neutral-50 p-2 text-center text-xs text-neutral-500">
                    File not on disk
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{item.sourceFile}</span>
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                      {item.designCode}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        item.status === 'assigned'
                          ? 'bg-green-100 text-green-900'
                          : item.status === 'rejected'
                            ? 'bg-red-100 text-red-900'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {STATUS_TEXT[item.status] ?? item.status}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-neutral-700">{item.productTitle}</p>

                  {/* The evidence a reviewer needs, without opening a filesystem. */}
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <Field label="Proposed colour">{item.proposedColour ?? 'None proposed'}</Field>
                    <Field label="Currently assigned to">
                      {item.assignedColour ?? 'Not in any gallery'}
                    </Field>
                    <Field label="Why it was held back">
                      {item.reason
                        ? (REASON_TEXT[item.reason] ?? item.reason)
                        : 'Assigned at import'}
                    </Field>
                    <Field label="Design sells">
                      {item.availableColours.length > 0
                        ? item.availableColours.join(', ')
                        : 'No colourways'}
                    </Field>
                    <Field label="Checksum">{item.checksum ?? 'not recorded'}</Field>
                    {item.reviewedBy ? (
                      <Field label="Last reviewed by">
                        {item.reviewedBy}
                        {item.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleString()}` : ''}
                      </Field>
                    ) : null}
                  </dl>

                  {item.status === 'pending' && item.reason ? (
                    <p className="mt-2 text-xs text-amber-800">
                      This image is quarantined and appears in no storefront gallery until a
                      decision is recorded.
                    </p>
                  ) : null}

                  {item.status === 'pending' ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft(
                          isOpen
                            ? null
                            : {
                                imageId: item.id,
                                colour: '',
                                reason: '',
                              },
                        )
                      }
                      className="btn btn-primary btn-sm mt-3"
                    >
                      {isOpen ? 'Cancel' : 'Review this image'}
                    </button>
                  ) : null}

                  {isOpen ? (
                    <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
                      {/* No colour is pre-selected: the reviewer must
                          actually look at the photograph and choose. */}
                      <label className="block text-sm">
                        <span className="block font-medium">Verified colour</span>
                        <select
                          value={draft.colour}
                          onChange={(event) =>
                            setDraft(draft ? { ...draft, colour: event.target.value } : draft)
                          }
                          className="mt-1 w-full max-w-xs rounded border border-neutral-300 bg-white px-2 py-1.5"
                        >
                          <option value="">Choose the colour it shows…</option>
                          {item.availableColours.map((colour) => (
                            <option key={colour} value={colour}>
                              {colour}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="mt-3 block text-sm">
                        <span className="block font-medium">
                          Reason <span className="font-normal text-neutral-600">(required)</span>
                        </span>
                        <textarea
                          value={draft.reason}
                          onChange={(event) =>
                            setDraft(draft ? { ...draft, reason: event.target.value } : draft)
                          }
                          rows={2}
                          maxLength={500}
                          placeholder="e.g. Filename says OW but the shoe is clearly the ivory pair; verified against the studio shoot."
                          className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                        />
                      </label>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <ActionButton
                          busy={busy === item.id}
                          onClick={() => void decide('assign', item)}
                          label="Confirm colour"
                        />
                        <ActionButton
                          busy={busy === item.id}
                          onClick={() => void decide('reject', item)}
                          label="Reject — keep quarantined"
                          tone="danger"
                        />
                      </div>
                    </div>
                  ) : null}

                  {item.status === 'assigned' ? (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft(isOpen ? null : { imageId: item.id, colour: '', reason: '' })
                        }
                        className="text-sm text-neutral-600 underline hover:text-neutral-900"
                      >
                        {isOpen ? 'Cancel revert' : 'Undo this assignment'}
                      </button>

                      {isOpen ? (
                        <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-3">
                          <label className="block text-sm">
                            <span className="block font-medium">
                              Reason for reverting{' '}
                              <span className="font-normal text-neutral-600">(required)</span>
                            </span>
                            <textarea
                              value={draft.reason}
                              onChange={(event) =>
                                setDraft(draft ? { ...draft, reason: event.target.value } : draft)
                              }
                              rows={2}
                              maxLength={500}
                              className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                            />
                          </label>
                          <ActionButton
                            busy={busy === item.id}
                            onClick={() => void decide('revert', item)}
                            label="Return to quarantine"
                            tone="danger"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {state && state.totalPages > 1 ? (
        <nav className="mt-6 flex items-center gap-3 text-sm" aria-label="Queue pages">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={state.page <= 1}
            className="rounded border border-neutral-300 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-neutral-600">
            Page {state.page} of {state.totalPages} · {state.totalItems} image(s)
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(state.totalPages, current + 1))}
            disabled={state.page >= state.totalPages}
            className="rounded border border-neutral-300 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <dt className="text-xs text-neutral-500">{label}</dt>
      {/* `—` rather than 0 until the real count has loaded, so an
          unloaded queue is never mistaken for an empty one. */}
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="break-words text-neutral-800">{children}</dd>
    </div>
  );
}

function ActionButton({
  busy,
  onClick,
  label,
  tone = 'primary',
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
  tone?: 'primary' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        tone === 'danger'
          ? 'rounded border border-red-300 px-3 py-1.5 text-sm text-red-800 hover:bg-red-50 disabled:opacity-50'
          : 'btn btn-primary btn-sm'
      }
    >
      {busy ? 'Saving…' : label}
    </button>
  );
}
