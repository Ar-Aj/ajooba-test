'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdminApiError,
  applyImportPlan,
  createImportPlan,
  getImportPlan,
  listImportPlans,
  type ImportPlanSummary,
} from '@/lib/catalog-api';

/**
 * Controlled catalogue import (G-6).
 *
 * ## Why this screen is shaped the way it is
 *
 * The source extract lives on a developer's machine. No deployment target
 * can read `C:`, so this screen **uploads the file contents in the request
 * body** rather than naming a path on the server — a path field here would
 * be an arbitrary-file-read primitive, not an import control.
 *
 * The workflow is deliberately three steps, and each step is a gate:
 *
 *  1. **Dry run.** Produces a plan and writes nothing to the catalogue.
 *  2. **Review.** The operator reads the target database and the
 *     create/update/quarantine/reject counts.
 *  3. **Apply.** Requires typing the confirmation *and* the plan's checksum.
 *
 * The checksum is the important one: if the uploaded file changes between
 * the dry run and the approval, the plan no longer describes what would be
 * written, so the API refuses. "Apply" can never happen by accident or by
 * acting on a stale report.
 */

/** A SHA-256 hex digest, for the operator to confirm against the plan. */
function isChecksum(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value.trim());
}

export function ImportControl() {
  const [plans, setPlans] = useState<ImportPlanSummary[]>([]);
  const [sourceFilename, setSourceFilename] = useState('');
  const [payload, setPayload] = useState('');
  const [selected, setSelected] = useState<ImportPlanSummary | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const result = await listImportPlans(20);
      setPlans(result.items);
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Could not load import plans.') });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Read the chosen file in the browser.
   *
   * The file never touches the server until "Run dry run" is pressed, and it
   * is sent as text in a JSON body rather than as multipart or a path.
   */
  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setPayload(text);
      setSourceFilename(file.name);
      setNotice({
        kind: 'ok',
        text: `Loaded ${file.name} (${Math.round(text.length / 1024)} KB). Nothing has been sent yet.`,
      });
    } catch {
      setNotice({ kind: 'error', text: 'Could not read that file.' });
    }
  }

  async function dryRun() {
    if (!payload || !sourceFilename) {
      setNotice({ kind: 'error', text: 'Choose an extract file first.' });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const plan = await createImportPlan({ payload, sourceFilename });
      setSelected(plan);
      setConfirmation('');
      await reload();
      setNotice({
        kind: 'ok',
        text: `Dry run complete against "${plan.targetDatabase}". Nothing was written.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Dry run failed.') });
    } finally {
      setBusy(false);
    }
  }

  /** Re-read a plan from the API before offering to apply it. */
  async function review(planId: string) {
    try {
      setSelected(await getImportPlan(planId));
      setConfirmation('');
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Could not load the plan.') });
    }
  }

  async function apply() {
    if (!selected) return;
    if (!isChecksum(confirmation)) {
      setNotice({
        kind: 'error',
        text: 'Paste the plan checksum exactly. This is what proves the approved report still matches the file.',
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await applyImportPlan(selected.planId, confirmation.trim());
      setSelected(null);
      setConfirmation('');
      setPayload('');
      setSourceFilename('');
      if (fileInput.current) fileInput.current.value = '';
      await reload();
      setNotice({
        kind: 'ok',
        text:
          `Applied to "${result.targetDatabase}": ${result.applied.designsCreated} design(s) created, ` +
          `${result.applied.designsUpdated} updated, ${result.applied.variantsCreated} SKU(s) created, ` +
          `${result.skipped} quarantined row(s) skipped, ${result.failed.length} failed.`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Import not applied.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="text-sm font-medium">
          1 · Upload an extract for a dry run
        </h2>

        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4">
          <label className="block text-sm">
            <span className="block font-medium">Extract JSON file</span>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              onChange={(event) => void onFileChange(event)}
              className="mt-2 block w-full text-sm"
            />
          </label>

          {sourceFilename ? (
            <p className="mt-2 text-xs text-neutral-600">
              {sourceFilename} · {Math.round(payload.length / 1024)} KB, held in this browser only.
            </p>
          ) : null}

          <label className="mt-3 block text-sm">
            <span className="block font-medium">Or paste the JSON</span>
            <textarea
              value={payload}
              onChange={(event) => {
                setPayload(event.target.value);
                setSourceFilename(sourceFilename || 'pasted-extract.json');
              }}
              rows={4}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
              placeholder='{ "products": [...] }'
            />
          </label>

          <button
            type="button"
            onClick={() => void dryRun()}
            disabled={busy || payload.length === 0}
            className="mt-3 btn btn-primary btn-sm"
          >
            {busy ? 'Working…' : 'Run dry run'}
          </button>

          <p className="mt-2 text-xs text-neutral-500">
            A dry run writes nothing to the catalogue. It records a plan you can read, then approve
            or discard.
          </p>
        </div>
      </section>

      <section aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="text-sm font-medium">
          2 · Review and approve
        </h2>

        {notice ? (
          <p
            role="status"
            className={`mt-3 rounded border px-3 py-2 text-sm ${
              notice.kind === 'ok'
                ? 'border-green-300 bg-green-50 text-green-900'
                : 'border-red-300 bg-red-50 text-red-900'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {selected ? (
          <div className="mt-3 rounded-lg border border-neutral-300 bg-white p-4">
            <h3 className="text-sm font-medium">Plan ready for review</h3>

            {/* The operator must be able to see which database this would
                write to before approving anything. */}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Field label="Source file">{selected.sourceFilename}</Field>
              <Field label="Target database">{selected.targetDatabase}</Field>
              <Field label="Status">{selected.status}</Field>
              <Field label="Requested by">{selected.requestedByEmail ?? 'unknown'}</Field>
            </dl>

            <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
              <Stat label="Designs new" value={selected.counts.designsToCreate} />
              <Stat label="Designs update" value={selected.counts.designsToUpdate} />
              <Stat label="SKUs new" value={selected.counts.variantsToCreate} />
              <Stat label="SKUs update" value={selected.counts.variantsToUpdate} />
            </dl>

            <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
              <Stat label="Quarantined" value={selected.counts.quarantine} />
              <Stat label="Rejected" value={selected.counts.reject} />
              <Stat label="Conflicts" value={selected.counts.conflicts} />
            </dl>

            <p className="mt-3 text-xs text-neutral-700">
              Quarantined and rejected rows are never applied automatically. They stay out of the
              catalogue for a human to resolve. Stock is never imported: every SKU the importer
              writes starts at zero and unsellable.
            </p>

            <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-2">
              <p className="text-xs text-neutral-600">Payload checksum</p>
              <p className="mt-1 break-all font-mono text-xs">{selected.payloadChecksum}</p>
            </div>

            <label className="mt-3 block text-sm">
              <span className="block font-medium">
                Paste the checksum to authorise{' '}
                <span className="font-normal text-neutral-600">(required)</span>
              </span>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder={selected.payloadChecksum}
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy || !isChecksum(confirmation)}
                className="rounded bg-red-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                3 · Apply import
              </button>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-50"
              >
                Discard plan
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-600">
            Run a dry run first. Nothing can be applied without reading a report you have approved.
          </p>
        )}

        <h3 className="mt-6 text-sm font-medium">Recent plans</h3>
        {plans.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">No imports have been planned yet.</p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-2">Plan</th>
                <th className="py-2">Database</th>
                <th className="py-2">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.planId} className="border-b border-neutral-100">
                  <td className="py-2 font-mono">{plan.planId}</td>
                  <td className="py-2">{plan.targetDatabase}</td>
                  <td className="py-2">{plan.status}</td>
                  <td className="py-2 text-right">
                    {plan.status === 'dry-run' ? (
                      <button
                        type="button"
                        onClick={() => void review(plan.planId)}
                        className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
                      >
                        Review
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{children}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-200 p-2">
      <p className="text-[0.75rem] text-neutral-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}
