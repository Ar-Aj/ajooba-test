'use client';

import { useState } from 'react';
import type { Coupon } from '@ajooba/contracts';
import { cn, dateOnly, rupees } from '@/lib/format';
import { Status } from '@/components/ui/status';
import { adminPath } from '@/lib/public-path';

/**
 * Promotions.
 *
 * ## Two things this screen is careful about
 *
 * **A coupon's *code* is immutable.** The API's update contract omits it, because
 * a code is what customers have already shared; changing it silently breaks every
 * link and post that mentions it. Editing a coupon here changes its value, its
 * window, its limits — never its code. Creating a new one is the way to get a new
 * code.
 *
 * **A discount is previewed, not predicted.** The panel does not compute a
 * discount by re-implementing the pricing rules in the browser: it asks the API
 * (`POST /v1/admin/coupons/:id/preview`), which runs the same
 * `computeDiscount` the checkout runs. Two implementations of a pricing rule is
 * two answers to the same question, and the customer would get the one the
 * operator never saw.
 *
 * ## Why the list is cards and not a table
 *
 * A coupon carries seven or eight facts that all matter (type, value, floor,
 * ceiling, window, usage, used, scope) and a table of eight columns on this width
 * forces every one of them to be truncated. A card lets each fact be labelled,
 * and affordability is what a coupon is.
 */

type CouponDraft = {
  code: string;
  type: 'percentage' | 'fixed';
  value: string;
  minOrderAmount: string;
  maxDiscountAmount: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  isActive: boolean;
  description: string;
  productCodes: string;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  // `datetime-local` wants `YYYY-MM-DDTHH:mm` in **local** time, not ISO/UTC.
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function blankDraft(): CouponDraft {
  return {
    code: '',
    type: 'percentage',
    value: '',
    minOrderAmount: '0',
    maxDiscountAmount: '',
    startsAt: toLocalInput(new Date().toISOString()),
    endsAt: '',
    usageLimit: '',
    isActive: true,
    description: '',
    productCodes: '',
  };
}

function draftFrom(coupon: Coupon): CouponDraft {
  return {
    code: coupon.code,
    type: coupon.type,
    value: String(coupon.value),
    minOrderAmount: String(coupon.minOrderAmount),
    maxDiscountAmount: coupon.maxDiscountAmount === null ? '' : String(coupon.maxDiscountAmount),
    startsAt: toLocalInput(coupon.startsAt),
    endsAt: toLocalInput(coupon.endsAt),
    usageLimit: coupon.usageLimit === null ? '' : String(coupon.usageLimit),
    isActive: coupon.isActive,
    description: coupon.description,
    productCodes: coupon.productCodes.join(', '),
  };
}

/** The payload the API's create/update contracts accept. */
function toPayload(draft: CouponDraft, mode: 'create' | 'update'): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: draft.type,
    value: Number(draft.value || 0),
    minOrderAmount: Number(draft.minOrderAmount || 0),
    maxDiscountAmount: draft.maxDiscountAmount === '' ? null : Number(draft.maxDiscountAmount),
    startsAt: fromLocalInput(draft.startsAt) ?? new Date().toISOString(),
    endsAt: fromLocalInput(draft.endsAt),
    usageLimit: draft.usageLimit === '' ? null : Number(draft.usageLimit),
    isActive: draft.isActive,
    description: draft.description.trim(),
    productCodes: draft.productCodes
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean),
  };

  // `code` is only ever sent on create: the update contract refuses it.
  if (mode === 'create') payload.code = draft.code.trim();
  return payload;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | number>,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const params = new URLSearchParams({ path });
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) search.set(key, String(value));
    params.set('query', search.toString());
  }

  try {
    const response = await fetch(adminPath('/api/admin/promotions?' + params.toString()), {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: T;
      error?: { message?: string };
    };

    if (!response.ok || !payload.ok || payload.data === undefined) {
      return { ok: false, message: payload.error?.message ?? 'The request was refused.' };
    }
    return { ok: true, data: payload.data as T };
  } catch {
    return { ok: false, message: 'Could not reach the admin API. Nothing has been changed.' };
  }
}

export function PromotionsBoard({ initial }: { initial: readonly Coupon[] }) {
  const [coupons, setCoupons] = useState<readonly Coupon[]>(initial);
  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'edit'; coupon: Coupon } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function afterSave(saved: Coupon, mode: 'create' | 'edit') {
    setCoupons((current) =>
      mode === 'create'
        ? [saved, ...current]
        : current.map((coupon) => (coupon.id === saved.id ? saved : coupon)),
    );
    setEditing(null);
    setNotice(
      mode === 'create' ? `Coupon ${saved.code} created.` : `Coupon ${saved.code} updated.`,
    );
    setError(null);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="step-xs tabular-nums text-ink-500">
            {coupons.length} {coupons.length === 1 ? 'coupon' : 'coupons'}
            <span className="mx-2 text-ink-300" aria-hidden="true">
              ·
            </span>
            {coupons.filter((coupon) => coupon.isActive).length} active
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ mode: 'create' })}
          className="btn btn-primary"
        >
          New coupon
        </button>
      </div>

      {notice ? (
        <div className="mb-4 border border-border bg-panel-50 px-4 py-2.5" role="status">
          <p className="step-sm text-ink-700">{notice}</p>
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 border border-red-200 bg-red-50 px-4 py-2.5" role="alert">
          <p className="step-sm text-red-800">{error}</p>
        </div>
      ) : null}

      {coupons.length === 0 ? (
        <div className="sheet px-6 py-14 text-center">
          <p className="step-md font-medium text-ink-800">No coupons yet</p>
          <p className="step-sm mx-auto mt-1.5 max-w-md text-ink-500">
            A coupon is created with a code, a discount and a validity window. Every code is unique
            and immutable once created, because customers will already have shared it.
          </p>
          <button
            type="button"
            onClick={() => setEditing({ mode: 'create' })}
            className="btn btn-primary mt-5"
          >
            Create the first coupon
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {coupons.map((coupon) => {
            const exhausted = coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit;
            const ended = coupon.endsAt !== null && new Date(coupon.endsAt) < new Date();
            const notStarted = new Date(coupon.startsAt) > new Date();
            const state = !coupon.isActive
              ? { label: 'Paused', tone: 'neutral' as const }
              : exhausted
                ? { label: 'Used up', tone: 'neutral' as const }
                : ended
                  ? { label: 'Expired', tone: 'neutral' as const }
                  : notStarted
                    ? { label: 'Scheduled', tone: 'waiting' as const }
                    : { label: 'Live', tone: 'active' as const };

            return (
              <li key={coupon.id} className="sheet flex flex-col">
                <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                  <div className="min-w-0">
                    <p className="font-mono text-[0.9375rem] font-semibold tracking-wide text-ink-900">
                      {coupon.code}
                    </p>
                    <p className="step-xs mt-0.5 text-ink-500">
                      {coupon.type === 'percentage'
                        ? `${coupon.value}% off`
                        : `${rupees(coupon.value)} off`}
                      {coupon.minOrderAmount > 0
                        ? ` · minimum ${rupees(coupon.minOrderAmount)}`
                        : ' · no minimum'}
                    </p>
                  </div>
                  <Status tone={state.tone}>{state.label}</Status>
                </div>

                <dl className="flex-1 space-y-1 p-4">
                  {coupon.description ? (
                    <p className="step-sm mb-2 text-ink-600">{coupon.description}</p>
                  ) : null}
                  <Row
                    label="Window"
                    value={`${dateOnly(coupon.startsAt)} → ${coupon.endsAt ? dateOnly(coupon.endsAt) : 'open'}`}
                  />
                  <Row
                    label="Ceiling"
                    value={
                      coupon.maxDiscountAmount === null
                        ? 'No cap'
                        : rupees(coupon.maxDiscountAmount)
                    }
                  />
                  <Row
                    label="Used"
                    value={`${coupon.usedCount}${coupon.usageLimit === null ? '' : ` of ${coupon.usageLimit}`}`}
                    tone={exhausted ? 'waiting' : 'default'}
                  />
                  <Row
                    label="Scope"
                    value={
                      coupon.productCodes.length === 0
                        ? 'Whole basket'
                        : `${coupon.productCodes.length} design${coupon.productCodes.length === 1 ? '' : 's'}`
                    }
                  />
                  {coupon.productCodes.length > 0 ? (
                    <p className="pt-1 font-mono text-[0.75rem] leading-relaxed text-ink-400">
                      {coupon.productCodes.join(' · ')}
                    </p>
                  ) : null}
                </dl>

                <div className="flex items-center justify-between gap-2 border-t border-border p-3">
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: 'edit', coupon })}
                    className="btn btn-secondary btn-sm"
                  >
                    Edit
                  </button>
                  <CouponActions
                    coupon={coupon}
                    onResult={({ message, tone, updated }) => {
                      if (updated) {
                        setCoupons((current) =>
                          current.map((entry) => (entry.id === updated.id ? updated : entry)),
                        );
                      }
                      if (tone === 'error') {
                        setError(message);
                        setNotice(null);
                      } else {
                        setNotice(message);
                        setError(null);
                      }
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <CouponEditor
          mode={editing.mode}
          coupon={editing.mode === 'edit' ? editing.coupon : null}
          onClose={() => setEditing(null)}
          onSaved={afterSave}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function Row({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'waiting';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="step-xs text-ink-400">{label}</dt>
      <dd
        className={cn(
          'step-xs tabular-nums',
          tone === 'waiting' ? 'font-medium text-gold-700' : 'text-ink-700',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pause / resume / delete                                                    */
/* -------------------------------------------------------------------------- */

function CouponActions({
  coupon,
  onResult,
}: {
  coupon: Coupon;
  onResult: (result: { message: string; tone: 'ok' | 'error'; updated?: Coupon }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggle() {
    setBusy('toggle');
    const result = await call<Coupon>('PATCH', `/${coupon.id}`, { isActive: !coupon.isActive });
    setBusy(null);
    if (result.ok) {
      onResult({
        message: `${result.data.code} ${result.data.isActive ? 'resumed' : 'paused'}.`,
        tone: 'ok',
        updated: result.data,
      });
    } else {
      onResult({ message: result.message, tone: 'error' });
    }
  }

  async function remove() {
    setBusy('delete');
    const result = await call<{ deleted: boolean }>('DELETE', `/${coupon.id}`);
    setBusy(null);
    setConfirmDelete(false);
    if (result.ok) {
      // A deleted coupon is gone from the server; the board is refreshed by a
      // reload rather than by removing the row locally, because the count and
      // the list must agree and only the server knows the new count.
      onResult({ message: `${coupon.code} deleted. Reload to refresh the list.`, tone: 'ok' });
      window.location.reload();
    } else {
      onResult({ message: result.message, tone: 'error' });
    }
  }

  if (confirmDelete) {
    return (
      <span className="flex items-center gap-2">
        <span className="step-xs text-red-800">Delete for good?</span>
        <button
          type="button"
          onClick={() => setConfirmDelete(false)}
          disabled={busy !== null}
          className="btn btn-quiet btn-sm"
        >
          No
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="btn btn-danger btn-sm"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete'}
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        className="btn btn-quiet btn-sm text-red-800 hover:bg-red-50"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={toggle}
        disabled={busy !== null}
        className="btn btn-secondary btn-sm"
      >
        {busy === 'toggle' ? 'Saving…' : coupon.isActive ? 'Pause' : 'Resume'}
      </button>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

function CouponEditor({
  mode,
  coupon,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  coupon: Coupon | null;
  onClose: () => void;
  onSaved: (saved: Coupon, mode: 'create' | 'edit') => void;
}) {
  const [draft, setDraft] = useState<CouponDraft>(coupon ? draftFrom(coupon) : blankDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    subtotal: number;
    discountAmount: number;
    totalAfterDiscount: number;
  } | null>(null);
  const [previewSubtotal, setPreviewSubtotal] = useState('1999');
  const [previewBusy, setPreviewBusy] = useState(false);

  function set<K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const result =
      mode === 'create'
        ? await call<Coupon>('POST', '', toPayload(draft, 'create'))
        : await call<Coupon>('PATCH', `/${coupon?.id ?? ''}`, toPayload(draft, 'update'));
    setBusy(false);
    if (result.ok) onSaved(result.data, mode);
    else setError(result.message);
  }

  /**
   * Ask the API what this coupon is worth.
   *
   * Note that this only works for a **saved** coupon, because the route is
   * `/coupons/:id/preview` and a draft has no id. That is a real limitation and
   * the panel says so rather than pretending: a new coupon is previewed after it
   * is created, and its code can be paused in the meantime.
   */
  async function runPreview() {
    if (!coupon) return;
    setPreviewBusy(true);
    const result = await call<{
      subtotal: number;
      discountAmount: number;
      totalAfterDiscount: number;
    }>('POST', `/${coupon.id}/preview`, { subtotal: Number(previewSubtotal || 0) });
    setPreviewBusy(false);
    if (result.ok) setPreview(result.data);
    else setError(result.message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-start sm:p-6">
      <div
        className="absolute inset-0 bg-ink-950/50"
        onClick={() => (busy ? undefined : onClose())}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coupon-title"
        className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto bg-white shadow-[var(--shadow-elevated)] scrollbar-soft"
      >
        <div className="sheet-head sticky top-0 z-10">
          <h2 id="coupon-title" className="step-md font-semibold text-ink-900">
            {mode === 'create' ? 'New coupon' : `Edit ${coupon?.code}`}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-quiet btn-sm">
            Close
          </button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Code"
              hint={
                mode === 'create'
                  ? 'Letters, digits, hyphen and underscore. Cannot change later.'
                  : 'A code is immutable — customers have already shared it.'
              }
            >
              <input
                type="text"
                value={draft.code}
                readOnly={mode === 'edit'}
                onChange={(event) => set('code', event.target.value.toUpperCase())}
                placeholder="DIWALI25"
                className={cn(
                  'field font-mono',
                  mode === 'edit' ? 'bg-panel-100 text-ink-500' : '',
                )}
              />
            </Field>

            <Field label="Type">
              <select
                value={draft.type}
                onChange={(event) => set('type', event.target.value as 'percentage' | 'fixed')}
                className="field"
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </Field>

            <Field label={draft.type === 'percentage' ? 'Percent off' : 'Rupees off'}>
              <input
                type="number"
                min={1}
                max={draft.type === 'percentage' ? 100 : undefined}
                value={draft.value}
                onChange={(event) => set('value', event.target.value)}
                className="field tnum"
              />
            </Field>

            <Field label="Minimum order (₹)" hint="Zero means the coupon applies to any basket.">
              <input
                type="number"
                min={0}
                value={draft.minOrderAmount}
                onChange={(event) => set('minOrderAmount', event.target.value)}
                className="field tnum"
              />
            </Field>

            <Field label="Maximum discount (₹)" hint="Blank means uncapped.">
              <input
                type="number"
                min={1}
                value={draft.maxDiscountAmount}
                onChange={(event) => set('maxDiscountAmount', event.target.value)}
                className="field tnum"
                placeholder="No cap"
              />
            </Field>

            <Field label="Usage limit" hint="Blank means unlimited.">
              <input
                type="number"
                min={1}
                value={draft.usageLimit}
                onChange={(event) => set('usageLimit', event.target.value)}
                className="field tnum"
                placeholder="Unlimited"
              />
            </Field>

            <Field label="Starts">
              <input
                type="datetime-local"
                value={draft.startsAt}
                onChange={(event) => set('startsAt', event.target.value)}
                className="field"
              />
            </Field>

            <Field label="Ends" hint="Blank means it never expires.">
              <input
                type="datetime-local"
                value={draft.endsAt}
                onChange={(event) => set('endsAt', event.target.value)}
                className="field"
              />
            </Field>

            <Field
              label="Restrict to designs"
              hint="Comma-separated design codes. Blank applies to the whole basket."
              full
            >
              <input
                type="text"
                value={draft.productCodes}
                onChange={(event) => set('productCodes', event.target.value)}
                placeholder="A01, A14, B07"
                className="field font-mono"
              />
            </Field>

            <Field label="Description" hint="Shown to the customer when they apply the code." full>
              <input
                type="text"
                value={draft.description}
                maxLength={300}
                onChange={(event) => set('description', event.target.value)}
                placeholder="Festive offer — 25% off all mojris"
                className="field"
              />
            </Field>
          </div>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
              className="checkbox"
            />
            <span className="step-sm text-ink-700">
              Active — a paused coupon is rejected at checkout even if its dates are current.
            </span>
          </label>

          {/* ---- preview ------------------------------------------------ */}
          <div className="mt-5 border border-border bg-panel-50 p-4">
            <p className="label-cap text-ink-400">What it is worth</p>
            {mode === 'create' ? (
              <p className="step-sm mt-1.5 text-ink-600">
                A preview is computed by the server against a basket, so it needs the coupon to
                exist first. Create it, then reopen it to check the arithmetic.
              </p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label htmlFor="preview-subtotal" className="sr-only">
                    Basket subtotal
                  </label>
                  <input
                    id="preview-subtotal"
                    type="number"
                    min={0}
                    value={previewSubtotal}
                    onChange={(event) => setPreviewSubtotal(event.target.value)}
                    className="field tnum w-32"
                  />
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={previewBusy}
                    className="btn btn-secondary btn-sm"
                  >
                    {previewBusy ? 'Calculating…' : 'Preview discount'}
                  </button>
                </div>
                {preview ? (
                  <p className="step-sm mt-2 tabular-nums text-ink-800">
                    Basket {rupees(preview.subtotal)} → discount{' '}
                    <span className="font-medium">{rupees(preview.discountAmount)}</span> → customer
                    pays <span className="font-medium">{rupees(preview.totalAfterDiscount)}</span>.
                  </p>
                ) : (
                  <p className="step-xs mt-1.5 text-ink-500">
                    Calculated by the same rule checkout uses, so the preview and the till agree.
                  </p>
                )}
              </>
            )}
          </div>

          {error ? (
            <p
              role="alert"
              className="step-sm mt-4 border border-red-200 bg-red-50 p-2.5 text-red-800"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={busy} className="btn btn-primary">
              {busy ? 'Saving…' : mode === 'create' ? 'Create coupon' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  full = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <span className="label-cap block text-ink-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <p className="step-xs mt-1 text-ink-400">{hint}</p> : null}
    </div>
  );
}
