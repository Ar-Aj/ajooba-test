import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { DashboardMetrics } from '@ajooba/contracts';
import {
  EmptyState,
  HeaderFact,
  PageHeader,
  Panel,
  WindowTabs,
} from '@/components/layout/page-header';
import { BarSeries, ProportionBar, Sparkline } from '@/components/ui/charts';
import { Figure, Metric } from '@/components/ui/metric';
import { Status, orderStatusTone } from '@/components/ui/status';
import {
  OpsApiError,
  fetchCustomers,
  fetchDashboard,
  type CustomerRow,
  type Page,
} from '@/lib/ops';
import { compact, dateOnly, dateTime, relativeTime, rupees } from '@/lib/format';
import { adminEnv } from '@/lib/env';

/**
 * The dashboard.
 *
 * ## Everything here is derived, nothing is invented
 *
 * Every figure comes from `GET /v1/admin/dashboard`, which aggregates live
 * orders, order items, returns and customers at request time. There is no
 * metrics collection, no seeded fixture and no fallback number: an empty
 * database produces an empty dashboard that says so. That rule is load-bearing â€”
 * a shop showing zero revenue on its first day is telling the truth, and a
 * cheerful flat line at zero is not.
 *
 * ## Why the layout is a ledger and not a grid of cards
 *
 * An operator opens this screen to answer three questions in order: *is anything
 * waiting for me, how did the window go, and what sold.* The page is laid out in
 * exactly that order â€” attention strip, then the money row with its shape, then
 * the detail. Metrics are on one ruled row rather than floating tiles, because
 * figures that share a baseline can be compared and figures in separate boxes
 * cannot.
 *
 * ## The window
 *
 * `?days=` is validated by the API (1â€“365) and defaults to 30. The control is
 * links, not a client-side selector, so the window is in the URL: an operator can
 * bookmark the fortnight before a sale, and the server renders the right numbers
 * on the first paint.
 */

export const dynamic = 'force-dynamic';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

function readDays(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return WINDOWS.some((window) => window.days === parsed) ? parsed : 30;
}

/** Naively-summed daily revenue; the API's own total is authoritative. */
function seriesOf(metrics: DashboardMetrics, key: 'orders' | 'revenue'): number[] {
  return metrics.daily.map((day) => day[key]);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = readDays(params.days);

  let metrics: DashboardMetrics | null = null;
  let recentCustomers: Page<CustomerRow> | null = null;
  let failure: string | null = null;

  try {
    metrics = await fetchDashboard(days);
  } catch (error) {
    failure =
      error instanceof OpsApiError
        ? error.message
        : 'The dashboard could not be loaded. This is unexpected.';
  }

  /*
   * The "who just joined" strip is one cheap read and never allowed to take the
   * dashboard down with it: an operator locked out of the revenue figures because
   * a secondary list failed would be a self-inflicted outage.
   */
  if (metrics) {
    try {
      recentCustomers = await fetchCustomers({ pageSize: 5 });
    } catch {
      recentCustomers = null;
    }
  }

  if (failure || !metrics) {
    return (
      <>
        <PageHeader
          eyebrow="Overview"
          title="Dashboard"
          description="Live trading figures, read from the orders and returns in this environment."
        />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The dashboard could not be read</p>
            <p className="step-sm mt-1.5 max-w-2xl text-ink-600">{failure}</p>
            <p className="step-sm mt-3 max-w-2xl text-ink-500">
              Nothing has been changed. Reload this page once the API is answering.
            </p>
            <Link href="/" className="btn btn-primary mt-5">
              Retry
            </Link>
          </div>
        </div>
      </>
    );
  }

  const hasOrders = metrics.totalOrders > 0;
  const revenueSeries = seriesOf(metrics, 'revenue');
  const orderSeries = seriesOf(metrics, 'orders');
  const totalStatusOrders =
    metrics.pendingOrders +
    metrics.processingOrders +
    metrics.shippedOrders +
    metrics.completedOrders +
    metrics.cancelledOrders;

  const attentionCount = metrics.pendingOrders + metrics.openReturns;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Live trading figures, aggregated from the orders, returns and customers in this environment at the moment this page was requested."
        meta={
          <>
            <HeaderFact label="Window" value={`${days} days`} />
            <HeaderFact label="Read at" value={dateTime(metrics.generatedAt)} />
            <HeaderFact
              label="Awaiting action"
              value={attentionCount}
              tone={attentionCount > 0 ? 'waiting' : 'default'}
            />
          </>
        }
        actions={
          <WindowTabs
            windows={WINDOWS}
            active={days}
            hrefFor={(nextDays) => (nextDays === 30 ? '/' : `/?days=${nextDays}`)}
          />
        }
      />

      <div className="page-body">
        {/* ---- attention, first because it is why they opened the page --- */}
        {attentionCount > 0 ? (
          <div className="mb-6 border border-gold-300 bg-gold-50">
            <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="step-sm font-medium text-gold-800">
                  {attentionCount} {attentionCount === 1 ? 'item needs' : 'items need'} you
                </p>
                <p className="step-sm mt-0.5 text-gold-800/80">
                  {metrics.pendingOrders > 0
                    ? `${metrics.pendingOrders} order${metrics.pendingOrders === 1 ? '' : 's'} placed but not yet processing`
                    : null}
                  {metrics.pendingOrders > 0 && metrics.openReturns > 0 ? ' Â· ' : null}
                  {metrics.openReturns > 0
                    ? `${metrics.openReturns} return${metrics.openReturns === 1 ? '' : 's'} open`
                    : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {metrics.pendingOrders > 0 ? (
                  <Link href="/orders?status=placed" className="btn btn-secondary btn-sm">
                    Review orders
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Link>
                ) : null}
                {metrics.openReturns > 0 ? (
                  <Link href="/orders?status=returns" className="btn btn-secondary btn-sm">
                    Review returns
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* ---- the money row -------------------------------------------- */}
        <div className="grid grid-cols-1 border border-border bg-border sm:grid-cols-2 lg:grid-cols-4 [&>*]:border-b [&>*]:border-border lg:[&>*]:border-b-0 [&>*]:border-r-0 sm:[&>*]:border-r sm:[&>*:last-child]:border-r-0">
          <Metric
            label="Revenue"
            value={rupees(metrics.totalRevenue)}
            context={`Paid orders only, in the last ${days} days`}
            emphasis
          />
          <Metric
            label="Orders"
            value={compact(metrics.totalOrders)}
            context={`${metrics.completedOrders} completed Â· ${metrics.cancelledOrders} cancelled`}
          />
          <Metric
            label="Average order"
            value={rupees(metrics.averageOrderValue)}
            context={
              metrics.totalOrders === 0
                ? 'No paid orders to average yet'
                : 'Revenue divided by paid orders'
            }
          />
          <Metric
            label="Units sold"
            value={compact(metrics.totalUnitsSold)}
            context="Pairs dispatched from paid orders"
          />
        </div>

        {/* ---- shape of the window -------------------------------------- */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Panel
            title="Daily revenue"
            description={`Every day in the window, oldest first. ${rupees(metrics.totalRevenue)} in total.`}
            className="lg:col-span-2"
          >
            <Sparkline
              data={revenueSeries}
              height={72}
              label={
                hasOrders
                  ? `Peak day ${rupees(Math.max(...revenueSeries, 0))} Â· quietest ${rupees(Math.min(...revenueSeries, 0))}`
                  : 'No paid orders in this window.'
              }
            />
            <div className="mt-4">
              <BarSeries
                data={orderSeries}
                labels={metrics.daily.map(
                  (day) => `${dateOnly(day.date)} â€” ${day.orders} orders`,
                )}
                emptyLabel="No orders were placed in this window."
                barClassName="bg-ink-800"
              />
            </div>
          </Panel>

          <Panel
            title="Order status"
            description={`${compact(totalStatusOrders)} orders in the window.`}
          >
            {totalStatusOrders === 0 ? (
              <EmptyState
                title="No orders yet"
                description="Order statuses appear here as soon as the first order is placed."
                className="px-0 py-10"
              />
            ) : (
              <>
                <ProportionBar
                  segments={[
                    { label: 'Placed', value: metrics.pendingOrders, className: 'bg-gold-400' },
                    {
                      label: 'Processing',
                      value: metrics.processingOrders,
                      className: 'bg-ink-800',
                    },
                    { label: 'Shipped', value: metrics.shippedOrders, className: 'bg-ink-500' },
                    { label: 'Completed', value: metrics.completedOrders, className: 'bg-ink-300' },
                    {
                      label: 'Cancelled',
                      value: metrics.cancelledOrders,
                      className: 'bg-claret-600',
                    },
                  ]}
                />
                <div className="mt-4">
                  <Figure
                    label="Placed"
                    value={String(metrics.pendingOrders)}
                    tone={metrics.pendingOrders > 0 ? 'waiting' : 'default'}
                  />
                  <Figure label="Processing" value={String(metrics.processingOrders)} />
                  <Figure label="Shipped" value={String(metrics.shippedOrders)} />
                  <Figure label="Completed" value={String(metrics.completedOrders)} />
                  <Figure
                    label="Cancelled"
                    value={String(metrics.cancelledOrders)}
                    tone={metrics.cancelledOrders > 0 ? 'fault' : 'default'}
                  />
                </div>
              </>
            )}
          </Panel>
        </div>

        {/* ---- what sold ------------------------------------------------ */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Panel
            title="Best-selling designs"
            description="Ranked by units sold from paid orders."
            className="lg:col-span-2"
            flush
          >
            {metrics.topProducts.length === 0 ? (
              <EmptyState
                title="Nothing sold in this window"
                description="Designs appear here once a paid order includes them."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col" className="w-10 text-right">
                        #
                      </th>
                      <th scope="col">Design</th>
                      <th scope="col" className="text-right">
                        Units
                      </th>
                      <th scope="col" className="text-right">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.topProducts.map((product, index) => (
                      <tr key={product.productId}>
                        <td className="text-right tabular-nums text-ink-400">{index + 1}</td>
                        <td>
                          <span className="flex items-baseline gap-2">
                            <span className="font-mono text-[0.75rem] text-ink-500">
                              {product.code}
                            </span>
                            <span className="truncate text-ink-900">{product.title}</span>
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{product.unitsSold}</td>
                        <td className="text-right tabular-nums">{rupees(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="space-y-6">
            <Panel title="Money out" description="Refunds and open returns across all time.">
              <Figure
                label="Open returns"
                value={String(metrics.openReturns)}
                tone={metrics.openReturns > 0 ? 'waiting' : 'default'}
              />
              <Figure
                label="Refunded"
                value={rupees(metrics.refundedAmount)}
                tone={metrics.refundedAmount > 0 ? 'fault' : 'default'}
              />
              <Figure
                label="New customers"
                value={String(metrics.totalCustomers)}
                note={`${days}d`}
              />
            </Panel>

            <Panel title="Recently joined" description="The five most recent customer records.">
              {!recentCustomers || recentCustomers.items.length === 0 ? (
                <p className="step-sm text-ink-500">
                  No customer accounts yet. They appear as shoppers register.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {recentCustomers.items.map((customer) => (
                    <li
                      key={customer.id}
                      className="flex items-baseline justify-between gap-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="step-sm block truncate text-ink-900">
                          {customer.firstName} {customer.lastName}
                        </span>
                        <span className="step-xs block truncate text-ink-400">
                          {customer.email}
                        </span>
                      </span>
                      <span className="step-xs shrink-0 whitespace-nowrap text-ink-400">
                        {relativeTime(customer.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/customers" className="btn btn-secondary btn-sm mt-3 w-full">
                All customers
              </Link>
            </Panel>
          </div>
        </div>

        {/* ---- the honest empty state ----------------------------------- */}
        {!hasOrders ? (
          <div className="mt-6 border border-dashed border-border-strong bg-white p-6">
            <p className="step-md font-medium text-ink-900">No orders have been placed yet</p>
            <p className="step-sm mt-1.5 max-w-2xl text-ink-600">
              Every figure on this page is computed from live records, so on a new store they are
              zero. Nothing here is seeded or sampled â€” the dashboard will fill in as orders
              arrive.
            </p>
            <p className="step-sm mt-3 max-w-2xl text-ink-500">
              To see the shop as a customer does,{' '}
              <a
                href={adminEnv.NEXT_PUBLIC_SITE_URL}
                className="link-underline font-medium text-ink-800"
                target="_blank"
                rel="noreferrer"
              >
                open the storefront
              </a>
              . To stock it, run a catalogue import.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/catalog/imports" className="btn btn-primary btn-sm">
                Catalogue import
              </Link>
              <Link href="/catalog/products" className="btn btn-secondary btn-sm">
                Browse products
              </Link>
            </div>
          </div>
        ) : null}

        {/* A status line, so the page says out loud when it was read. */}
        <p className="step-xs mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-400">
          <Status tone={attentionCount > 0 ? 'waiting' : 'active'}>
            {attentionCount > 0 ? 'Action needed' : 'All clear'}
          </Status>
          <span>Read {relativeTime(metrics.generatedAt)}</span>
          <span aria-hidden="true">Â·</span>
          <span>Window {days} days</span>
          <span aria-hidden="true">Â·</span>
          <span className="flex items-center gap-1.5">
            Orders
            <Status tone={orderStatusTone('processing')}>{hasOrders ? 'live' : 'none'}</Status>
          </span>
        </p>
      </div>
    </>
  );
}
