import Link from 'next/link';
import { RETURN_STATUSES, type ReturnRequest, type ReturnStatus } from '@ajooba/contracts';
import { EmptyState, HeaderFact, PageHeader, Panel } from '@/components/layout/page-header';
import { Status } from '@/components/ui/status';
import { ReturnReviewActions } from '@/features/returns/components/return-review-actions';
import { OpsApiError, fetchAdmin, fetchReturns } from '@/lib/ops';
import { cn, dateTime, rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const LABELS: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  received: 'Received & inspected',
  refunded: 'Refunded',
};

function statusTone(status: ReturnStatus): 'neutral' | 'active' | 'waiting' | 'fault' {
  if (status === 'requested') return 'waiting';
  if (status === 'rejected') return 'fault';
  if (status === 'refunded') return 'neutral';
  return 'active';
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawStatus = first(params.status);
  const status = RETURN_STATUSES.includes(rawStatus as ReturnStatus)
    ? (rawStatus as ReturnStatus)
    : undefined;
  const page = Math.max(1, Number(first(params.page)) || 1);

  let result: Awaited<ReturnType<typeof fetchReturns>> | null = null;
  let failure: string | null = null;
  let canWrite = false;
  try {
    const [pageResult, admin] = await Promise.all([
      fetchReturns({ status, page, pageSize: PAGE_SIZE }),
      fetchAdmin(),
    ]);
    result = pageResult;
    canWrite = Boolean(admin?.permissions.includes('returns:write'));
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'Return requests could not be read.';
  }

  const href = (nextStatus?: ReturnStatus, nextPage?: number) => {
    const query = new URLSearchParams();
    if (nextStatus) query.set('status', nextStatus);
    if (nextPage && nextPage > 1) query.set('page', String(nextPage));
    return `/returns${query.size ? `?${query.toString()}` : ''}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Sell · Returns"
        title="Returns & refunds"
        description="Review each request, approve it, record the pair as received after inspection, then issue or reconcile the real provider refund. COD refunds require a manual support process."
        meta={result ? <HeaderFact label="Requests" value={result.totalItems} /> : null}
      />
      <div className="page-body space-y-5">
        <nav aria-label="Filter returns by status" className="overflow-x-auto">
          <ul className="flex gap-5 whitespace-nowrap">
            <li>
              <Link
                href={href()}
                aria-current={!status ? 'page' : undefined}
                className={cn(
                  'step-sm link-underline',
                  !status ? 'font-medium text-ink-950' : 'text-ink-500',
                )}
              >
                All
              </Link>
            </li>
            {RETURN_STATUSES.map((value) => (
              <li key={value}>
                <Link
                  href={href(value)}
                  aria-current={status === value ? 'page' : undefined}
                  className={cn(
                    'step-sm link-underline',
                    status === value ? 'font-medium text-ink-950' : 'text-ink-500',
                  )}
                >
                  {LABELS[value]}
                  {status === value && result ? (
                    <span className="ml-1.5 text-ink-400">{result.totalItems}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {failure ? (
          <div className="sheet p-6" role="alert">
            <h2 className="font-medium text-ink-900">The returns queue could not be read</h2>
            <p className="step-sm mt-1 text-ink-600">{failure}</p>
          </div>
        ) : (
          <Panel flush>
            {!result || result.items.length === 0 ? (
              <EmptyState
                title={
                  status ? `No ${LABELS[status].toLowerCase()} returns` : 'No return requests yet'
                }
                description="Customer requests appear here after an order is delivered and a return is requested."
                action={
                  status ? (
                    <Link className="btn btn-secondary" href="/returns">
                      Clear filter
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1100px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-cream-100/60">
                        <th className="px-4 py-3 label-cap">Request</th>
                        <th className="px-4 py-3 label-cap">Order / customer</th>
                        <th className="px-4 py-3 label-cap">Items</th>
                        <th className="px-4 py-3 label-cap">Refund amount</th>
                        <th className="px-4 py-3 label-cap">Status</th>
                        <th className="px-4 py-3 label-cap">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((request: ReturnRequest) => (
                        <tr
                          key={request.id}
                          className="border-b border-border align-top last:border-0"
                        >
                          <td className="px-4 py-4">
                            <p className="step-sm font-medium text-ink-900">
                              {request.returnNumber}
                            </p>
                            <p className="mt-1 text-xs text-ink-500">
                              {dateTime(request.requestedAt)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <Link
                              href={`/orders/${request.orderId}`}
                              className="step-sm link-underline text-ink-800"
                            >
                              {request.orderNumber}
                            </Link>
                            <p className="mt-1 text-xs text-ink-500">
                              Customer ID {request.customerId}
                            </p>
                            <p className="mt-1 text-xs text-ink-600">Reason: {request.reason}</p>
                            {request.reasonNote ? (
                              <p className="mt-1 max-w-xs text-xs text-ink-500">
                                “{request.reasonNote}”
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4 step-sm text-ink-800">
                            {request.items.map((item) => (
                              <p key={item.variantId} className="mb-1 last:mb-0">
                                {item.title} · {item.colour} · UK {item.size} × {item.quantity}
                              </p>
                            ))}
                          </td>
                          <td className="px-4 py-4">
                            <p className="step-sm font-medium text-ink-900">
                              {rupees(request.refundAmount)}
                            </p>
                            {request.refundRef ? (
                              <p className="mt-1 text-xs text-ink-500">
                                Provider ref: {request.refundRef}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4">
                            <Status tone={statusTone(request.status)}>
                              {LABELS[request.status]}
                            </Status>
                            {request.resolutionNote ? (
                              <p className="mt-2 max-w-xs text-xs text-ink-500">
                                {request.resolutionNote}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4">
                            <ReturnReviewActions request={request} canWrite={canWrite} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
                  <p className="step-xs text-ink-500">
                    Page {result.page} of {Math.max(1, Math.ceil(result.totalItems / PAGE_SIZE))}
                  </p>
                  <div className="flex gap-2">
                    {result.page > 1 ? (
                      <Link
                        className="btn btn-secondary btn-sm"
                        href={href(status, result.page - 1)}
                      >
                        Previous
                      </Link>
                    ) : null}
                    {result.page < Math.ceil(result.totalItems / PAGE_SIZE) ? (
                      <Link
                        className="btn btn-secondary btn-sm"
                        href={href(status, result.page + 1)}
                      >
                        Next
                      </Link>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
