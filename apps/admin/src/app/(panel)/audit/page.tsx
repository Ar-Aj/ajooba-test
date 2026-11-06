import Link from 'next/link';
import { HeaderFact, PageHeader } from '@/components/layout/page-header';
import { Pagination, queryString } from '@/components/ui/pagination';
import { Status } from '@/components/ui/status';
import { OpsApiError, fetchAuditLogs } from '@/lib/ops';
import { dateTime } from '@/lib/format';
import { cn } from '@/lib/format';
import { AUDIT_ACTIONS } from '@ajooba/contracts';

/**
 * The audit trail.
 *
 * ## Why this screen exists
 *
 * Every consequential action in this panel writes an entry: a stock adjustment, a
 * refund, a status change, an import, a sign-in. This is where an operator â€” or
 * the owner, three weeks later â€” can answer "who changed this, and when, and
 * why". Without it, the panel's other screens are a set of controls with no
 * memory, and a wrong number is unattributable.
 *
 * ## What it deliberately does not do
 *
 * It does not allow editing or deleting an entry. An audit trail that can be
 * edited is not an audit trail; it is a log. The API exposes only a read route
 * for exactly this reason.
 *
 * The `changes` column holds a JSON diff of before/after. It is rendered as a
 * compact, monospaced summary rather than a pretty-printed blob, because the
 * useful thing is to see the shape at a glance and then open the entity if you
 * need the detail.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Actions whose consequence is a person noticing, so they get the gold tone. */
const ATTENTION_ACTIONS = new Set(['refund', 'delete', 'stock-adjust', 'status-change']);

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const action = firstValue(params.action);
  const entity = firstValue(params.entity)?.trim() || undefined;
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  let result = null;
  let failure: string | null = null;

  try {
    result = await fetchAuditLogs({
      ...(action ? { action } : {}),
      ...(entity ? { entity } : {}),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'The audit log could not be read.';
  }

  const hrefFor = (next: Record<string, string | number | undefined>) =>
    `/audit${queryString({ action, entity, page: next.page })}`;

  return (
    <>
      <PageHeader
        eyebrow="Storefront Â· Audit trail"
        title="Audit trail"
        description="Every consequential action, with the operator who made it, the entity it touched and the moment it happened. Entries are append-only: nothing here can be edited or removed."
        meta={
          result ? (
            <>
              <HeaderFact label="Entries" value={result.totalItems} />
              {action ? <HeaderFact label="Action" value={action.replace(/-/g, ' ')} /> : null}
              {entity ? <HeaderFact label="Entity" value={entity} /> : null}
            </>
          ) : null
        }
      />

      <div className="page-body">
        <nav
          aria-label="Filter by action"
          className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0"
        >
          <ul className="flex items-baseline gap-5 whitespace-nowrap">
            <li>
              <Link
                href={hrefFor({ action: undefined, page: undefined })}
                aria-current={!action ? 'page' : undefined}
                className={cn(
                  'step-sm link-underline',
                  !action ? 'font-medium text-ink-950' : 'text-ink-500 hover:text-ink-900',
                )}
              >
                Everything
              </Link>
            </li>
            {AUDIT_ACTIONS.map((value) => (
              <li key={value}>
                <Link
                  href={hrefFor({ action: value, page: undefined })}
                  aria-current={action === value ? 'page' : undefined}
                  className={cn(
                    'step-sm link-underline',
                    action === value
                      ? 'font-medium text-ink-950'
                      : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  {value.replace(/-/g, ' ')}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {failure ? (
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The audit log could not be read</p>
            <p className="step-sm mt-1.5 text-ink-600">{failure}</p>
          </div>
        ) : !result || result.items.length === 0 ? (
          <div className="sheet px-6 py-14 text-center">
            <p className="step-md font-medium text-ink-800">
              {action || entity ? 'No entries match that filter' : 'No audit entries yet'}
            </p>
            <p className="step-sm mx-auto mt-1.5 max-w-md text-ink-500">
              {action || entity
                ? 'Clear the filter to see the whole trail.'
                : 'Entries appear as soon as anyone signs in, edits a product, adjusts stock or moves an order.'}
            </p>
          </div>
        ) : (
          <div className="sheet overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((entry) => (
                    <tr key={entry.id}>
                      <td
                        className="whitespace-nowrap text-ink-600"
                        title={dateTime(entry.createdAt)}
                      >
                        {dateTime(entry.createdAt)}
                      </td>
                      <td>
                        <Status tone={ATTENTION_ACTIONS.has(entry.action) ? 'waiting' : 'neutral'}>
                          {entry.action.replace(/-/g, ' ')}
                        </Status>
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="text-ink-800">{entry.entity}</span>
                        {entry.entityId ? (
                          <span className="ml-1.5 font-mono text-[0.75rem] text-ink-400">
                            {entry.entityId.slice(-6)}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[28rem]">
                        <span className="block truncate text-ink-700" title={entry.summary}>
                          {entry.summary}
                        </span>
                        {entry.changes ? (
                          <span className="block truncate font-mono text-[0.75rem] text-ink-400">
                            {Object.keys(entry.changes).join(' Â· ')}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[14rem]">
                        <span className="block truncate text-ink-800">{entry.actorEmail}</span>
                        <span className="label-cap block text-ink-400">{entry.actorRole}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={result.page}
              pageSize={PAGE_SIZE}
              totalItems={result.totalItems}
              totalPages={result.totalPages}
              hrefFor={(next) => hrefFor({ page: next === 1 ? undefined : next })}
            />
          </div>
        )}
      </div>
    </>
  );
}
