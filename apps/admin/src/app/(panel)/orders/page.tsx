import Link from 'next/link';
import { ChevronRight, Search } from 'lucide-react';
import { ORDER_STATUSES, type Order } from '@ajooba/contracts';
import { EmptyState, HeaderFact, PageHeader, Panel } from '@/components/layout/page-header';
import { FilterCount, Pagination, queryString } from '@/components/ui/pagination';
import { Status, orderStatusTone, paymentStatusTone } from '@/components/ui/status';
import { OpsApiError, fetchOrders, type Page } from '@/lib/ops';
import { dateTime, relativeTime, rupees } from '@/lib/format';
import { cn } from '@/lib/format';

/**
 * The orders list.
 *
 * ## The shape of this screen
 *
 * A single table, one row per order, filtered by a status rail above it. No cards,
 * no accordions, no expandable rows: an operator working through a morning's
 * orders is doing one thing â€” scanning a column of states for the ones that need
 * them â€” and anything that interrupts that column costs them time on every row.
 *
 * ## Filters are the URL
 *
 * Every filter is a link, so the state is shareable, bookmarkable, and survives
 * the back button. Status is a rail of links rather than a `<select>` because the
 * counts are the useful part: "Placed 12" tells an operator whether to care
 * before they click.
 *
 * ## Which numbers are shown
 *
 * The **total** amount is what the customer paid, and it is the only money figure
 * in the row. Subtotal, shipping and tax live on the detail screen where they can
 * be added up. A table with four money columns is a table nobody reads.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/** The rail's own labels, so the words match the panel everywhere. */
const STATUS_LABELS: Readonly<Record<string, string>> = {
  placed: 'Placed',
  processing: 'Processing',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = firstValue(params.status);
  const paymentStatus = firstValue(params.paymentStatus);
  const search = firstValue(params.orderNumber);
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  let result: Page<Order> | null = null;
  let failure: string | null = null;

  try {
    result = await fetchOrders({
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(search ? { orderNumber: search } : {}),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'The orders could not be read.';
  }

  /*
   * The rail's counts come from the unfiltered list's totals, which the API
   * returns only for the current filter. Rather than eight extra requests, the
   * rail shows the count only for the active filter â€” a count that is always
   * correct beats five counts that are one round-trip stale.
   */
  const href = (overrides: Record<string, string | number | undefined>) =>
    `/orders${queryString({
      status: overrides.status ?? status,
      paymentStatus: overrides.paymentStatus ?? paymentStatus,
      orderNumber: overrides.orderNumber ?? search,
      page: overrides.page,
    })}`;

  return (
    <>
      <PageHeader
        eyebrow="Sell Â· Orders"
        title="Orders"
        description="Every order placed on the storefront, newest first. Opening one shows the frozen line items, the delivery address and the only status moves the API will accept."
        meta={
          result ? (
            <>
              <HeaderFact label="Orders" value={result.totalItems} />
              <HeaderFact
                label="Page"
                value={`${result.page} / ${Math.max(1, Math.ceil(result.totalItems / PAGE_SIZE))}`}
              />
              {status ? (
                <HeaderFact label="Filter" value={STATUS_LABELS[status] ?? status} />
              ) : null}
              {paymentStatus ? <HeaderFact label="Payment" value={paymentStatus} /> : null}
            </>
          ) : null
        }
        actions={
          /* A real form, so the search is a URL and works without JavaScript. */
          <form action="/orders" method="get" className="flex items-center gap-2">
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <label htmlFor="order-number" className="sr-only">
              Order number
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <input
                id="order-number"
                name="orderNumber"
                type="search"
                defaultValue={search ?? ''}
                placeholder="Order number"
                className="field w-44 pl-8"
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm">
              Find
            </button>
          </form>
        }
      />

      <div className="page-body">
        {/* ---- status rail ------------------------------------------------ */}
        <nav
          aria-label="Filter by status"
          className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0"
        >
          <ul className="flex items-baseline gap-5 whitespace-nowrap">
            <li>
              <Link
                href={href({ status: undefined, page: undefined })}
                aria-current={!status ? 'page' : undefined}
                className={cn(
                  'step-sm link-underline',
                  !status ? 'font-medium text-ink-950' : 'text-ink-500 hover:text-ink-900',
                )}
              >
                All
              </Link>
            </li>
            {ORDER_STATUSES.map((value) => (
              <li key={value}>
                <Link
                  href={href({ status: value, page: undefined })}
                  aria-current={status === value ? 'page' : undefined}
                  className={cn(
                    'step-sm link-underline',
                    status === value
                      ? 'font-medium text-ink-950'
                      : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  {STATUS_LABELS[value] ?? value}
                  {status === value && result ? <FilterCount count={result.totalItems} /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {failure ? (
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The orders could not be read</p>
            <p className="step-sm mt-1.5 text-ink-600">{failure}</p>
            <p className="step-sm mt-3 text-ink-500">Nothing has been changed. Reload to retry.</p>
          </div>
        ) : (
          <Panel flush>
            {!result || result.items.length === 0 ? (
              <EmptyState
                title={status ? 'No orders with that status' : 'No orders yet'}
                description={
                  status
                    ? 'Nothing is waiting in this state. Clear the filter to see every order.'
                    : 'Orders appear here the moment a customer completes checkout. Nothing on this screen is sampled.'
                }
                action={
                  status ? (
                    <Link href="/orders" className="btn btn-secondary">
                      Clear filter
                    </Link>
                  ) : (
                    <Link href="/" className="btn btn-secondary">
                      Back to dashboard
                    </Link>
                  )
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Placed</th>
                        <th scope="col">Customer</th>
                        <th scope="col" className="text-center">
                          Items
                        </th>
                        <th scope="col">Payment</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="text-right">
                          Total
                        </th>
                        <th scope="col" className="w-8">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((order) => (
                        <tr key={order.id} className="group">
                          <td className="font-mono text-[0.75rem] font-medium text-ink-900">
                            <Link href={`/orders/${order.id}`} className="hover:underline">
                              {order.orderNumber}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap">
                            <span title={dateTime(order.placedAt)} className="text-ink-700">
                              {relativeTime(order.placedAt)}
                            </span>
                          </td>
                          <td className="max-w-[16rem]">
                            <Link href={`/orders/${order.id}`} className="block min-w-0">
                              <span className="block truncate text-ink-900">
                                {order.customerName}
                              </span>
                              <span className="block truncate text-[0.75rem] text-ink-400">
                                {order.customerEmail}
                              </span>
                            </Link>
                          </td>
                          <td className="text-center tabular-nums text-ink-700">
                            {order.items.reduce((sum, item) => sum + item.quantity, 0)}
                          </td>
                          <td>
                            <Status tone={paymentStatusTone(order.paymentStatus)}>
                              {order.paymentStatus.replace(/_/g, ' ')}
                            </Status>
                          </td>
                          <td>
                            <Status tone={orderStatusTone(order.status)}>{order.status}</Status>
                          </td>
                          <td className="text-right tabular-nums font-medium text-ink-900">
                            {rupees(order.totalAmount)}
                          </td>
                          <td className="text-right">
                            <Link
                              href={`/orders/${order.id}`}
                              aria-label={`Open order ${order.orderNumber}`}
                              className="inline-flex p-1 text-ink-300 transition-colors group-hover:text-ink-700"
                            >
                              <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                            </Link>
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
                  hrefFor={(next) => href({ page: next === 1 ? undefined : next })}
                />
              </>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
