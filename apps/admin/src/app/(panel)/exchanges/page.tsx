import Link from 'next/link';
import { EXCHANGE_STATUSES, type ExchangeRequest, type ExchangeStatus } from '@ajooba/contracts';
import { EmptyState, HeaderFact, PageHeader, Panel } from '@/components/layout/page-header';
import { Status } from '@/components/ui/status';
import { ExchangeReviewActions } from '@/features/exchanges/components/exchange-review-actions';
import { OpsApiError, fetchAdmin, fetchExchanges } from '@/lib/ops';
import { dateTime, rupees } from '@/lib/format';
import { cn } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;
const LABELS: Record<ExchangeStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  received: 'Pair received',
  'replacement-shipped': 'Replacement shipped',
  completed: 'Completed',
};

function statusTone(status: ExchangeStatus): 'neutral' | 'active' | 'waiting' | 'fault' {
  if (status === 'requested') return 'waiting';
  if (status === 'rejected') return 'fault';
  if (status === 'completed') return 'neutral';
  return 'active';
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExchangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawStatus = first(params.status);
  const status = EXCHANGE_STATUSES.includes(rawStatus as ExchangeStatus)
    ? (rawStatus as ExchangeStatus)
    : undefined;
  const page = Math.max(1, Number(first(params.page)) || 1);

  let result: Awaited<ReturnType<typeof fetchExchanges>> | null = null;
  let failure: string | null = null;
  let canWrite = false;
  try {
    const [pageResult, admin] = await Promise.all([
      fetchExchanges({ status, page, pageSize: PAGE_SIZE }),
      fetchAdmin(),
    ]);
    result = pageResult;
    canWrite = Boolean(admin?.permissions.includes('orders:write'));
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'Exchange requests could not be read.';
  }

  const href = (nextStatus?: ExchangeStatus, nextPage?: number) => {
    const query = new URLSearchParams();
    if (nextStatus) query.set('status', nextStatus);
    if (nextPage && nextPage > 1) query.set('page', String(nextPage));
    return `/exchanges${query.size ? `?${query.toString()}` : ''}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Sell · Exchanges"
        title="Size exchanges"
        description="Review same-design size swaps. Approval holds the replacement stock; marking it shipped consumes that hold. A price mismatch cannot be approved through this workflow."
        meta={result ? <HeaderFact label="Requests" value={result.totalItems} /> : null}
      />
      <div className="page-body space-y-5">
        <nav aria-label="Filter exchanges by status" className="overflow-x-auto">
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
            {EXCHANGE_STATUSES.map((value) => (
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
            <h2 className="font-medium text-ink-900">The exchange queue could not be read</h2>
            <p className="step-sm mt-1 text-ink-600">{failure}</p>
          </div>
        ) : (
          <Panel flush>
            {!result || result.items.length === 0 ? (
              <EmptyState
                title={
                  status
                    ? `No ${LABELS[status].toLowerCase()} exchanges`
                    : 'No exchange requests yet'
                }
                description="Customer requests appear here after the order has been delivered and the exchange window is open."
                action={
                  status ? (
                    <Link className="btn btn-secondary" href="/exchanges">
                      Clear filter
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1050px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-cream-100/60">
                        <th className="px-4 py-3 label-cap">Request</th>
                        <th className="px-4 py-3 label-cap">Order / customer</th>
                        <th className="px-4 py-3 label-cap">Requested swap</th>
                        <th className="px-4 py-3 label-cap">Price check</th>
                        <th className="px-4 py-3 label-cap">Status</th>
                        <th className="px-4 py-3 label-cap">Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((exchange: ExchangeRequest) => (
                        <tr
                          key={exchange.id}
                          className="border-b border-border align-top last:border-0"
                        >
                          <td className="px-4 py-4">
                            <p className="step-sm font-medium text-ink-900">
                              {exchange.exchangeNumber}
                            </p>
                            <p className="mt-1 text-xs text-ink-500">
                              {dateTime(exchange.requestedAt)}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <Link
                              href={`/orders/${exchange.orderId}`}
                              className="step-sm link-underline text-ink-800"
                            >
                              {exchange.orderNumber}
                            </Link>
                            <p className="mt-1 text-xs text-ink-500">
                              Customer ID {exchange.customerId}
                            </p>
                          </td>
                          <td className="px-4 py-4 step-sm text-ink-800">
                            <p>
                              {exchange.originalItem.title} · {exchange.originalItem.colour}
                            </p>
                            <p className="mt-1 text-xs text-ink-500">
                              UK {exchange.originalItem.size} → UK {exchange.replacementItem.size} ·{' '}
                              {exchange.replacementItem.quantity} pair(s)
                            </p>
                            {exchange.reasonNote ? (
                              <p className="mt-2 max-w-xs text-xs text-ink-600">
                                “{exchange.reasonNote}”
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4 step-sm text-ink-700">
                            <p>Order: {rupees(exchange.originalItem.unitPrice)}</p>
                            <p>Replacement: {rupees(exchange.replacementItem.unitPrice)}</p>
                            {exchange.priceDifference !== 0 ? (
                              <p className="mt-1 text-xs text-claret-700">
                                Difference needs support/payment handling
                              </p>
                            ) : (
                              <p className="mt-1 text-xs text-ink-500">No price change</p>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <Status tone={statusTone(exchange.status)}>
                              {LABELS[exchange.status]}
                            </Status>
                            {exchange.resolutionNote ? (
                              <p className="mt-2 max-w-xs text-xs text-ink-500">
                                {exchange.resolutionNote}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4">
                            <ExchangeReviewActions exchange={exchange} canWrite={canWrite} />
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
