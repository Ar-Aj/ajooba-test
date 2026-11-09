import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { InteractionCustomerSpectrumRow } from '@ajooba/contracts';
import {
  EmptyState,
  HeaderFact,
  PageHeader,
  Panel,
  WindowTabs,
} from '@/components/layout/page-header';
import { Metric, MetricRow } from '@/components/ui/metric';
import { Status } from '@/components/ui/status';
import { count, share } from '@/components/insights/insight-parts';
import { OpsApiError, fetchCustomerSpectrum } from '@/lib/ops';
import { relativeTime } from '@/lib/format';

/**
 * The customer spectrum.
 *
 * ## The question this screen answers
 *
 * *Who is circling something, and what are they circling.* Not "who visited" —
 * that is a traffic number with nobody to ring at the end of it. This list is
 * ranked by intent, and every row names the design the person pressed the most
 * buttons on, because a call list with a product name in it is a call list
 * somebody actually uses.
 *
 * ## Why "configured" is a column and views are not the first one
 *
 * Choosing a size is a commitment short of money. A customer with four configured
 * sessions and no order is deciding; a customer with forty views is browsing. The
 * list therefore leads with taps and configuration, keeps views as context, and
 * gives the add rate per design seen rather than per page load — the same
 * denominator the product spectrum uses, so the two screens agree.
 *
 * ## The intent marks
 *
 *  - **Stalled** — configured a design repeatedly and never added it. The one row
 *    worth a phone call today.
 *  - **Saved only** — a wishlist save, no cart. Interested, not convinced.
 *  - **In cart** — added and stopped. A nudge or a delivery question.
 *  - **Ordered** — completed. The row to study, not to chase.
 */

export const dynamic = 'force-dynamic';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const SORTS = [
  { key: 'taps', label: 'Most engaged' },
  { key: 'addToCart', label: 'Added most' },
  { key: 'wishlist', label: 'Saved most' },
  { key: 'views', label: 'Most designs seen' },
] as const;

type SortKey = (typeof SORTS)[number]['key'];

function readDays(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return WINDOWS.some((window) => window.days === parsed) ? parsed : 30;
}

function readSort(raw: string | string[] | undefined): SortKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SORTS.some((sort) => sort.key === value) ? (value as SortKey) : 'taps';
}

/** The signal, in one word, in the order a salesperson would care about it. */
function intentOf(row: InteractionCustomerSpectrumRow): {
  label: string;
  tone: 'active' | 'waiting' | 'neutral' | 'fault';
} {
  if (row.addToCart > 0) return { label: 'In cart', tone: 'active' };
  if (row.wishlistAdds > 0) return { label: 'Saved only', tone: 'waiting' };
  if (row.configuredSessions > 0) return { label: 'Stalled', tone: 'waiting' };
  return { label: 'Browsing', tone: 'neutral' };
}

export default async function CustomerSpectrumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = readDays(params.days);
  const sort = readSort(params.sort);

  let response: Awaited<ReturnType<typeof fetchCustomerSpectrum>> | null = null;
  let failure: string | null = null;

  try {
    response = await fetchCustomerSpectrum({ days, limit: 50, sort });
  } catch (error) {
    failure =
      error instanceof OpsApiError
        ? error.message
        : 'The customer spectrum could not be read. This is unexpected.';
  }

  const hrefFor = (next: { days?: number; sort?: SortKey }) => {
    const query = new URLSearchParams();
    const nextDays = next.days ?? days;
    const nextSort = next.sort ?? sort;
    if (nextDays !== 30) query.set('days', String(nextDays));
    if (nextSort !== 'taps') query.set('sort', nextSort);
    const suffix = query.toString();
    return suffix ? `/insights/customers?${suffix}` : '/insights/customers';
  };

  if (failure || !response) {
    return (
      <>
        <PageHeader
          eyebrow="Insights → Customer spectrum"
          title="Customers"
          description="Who touched what, ranked by intent rather than traffic."
        />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="text-[1.0625rem] font-semibold text-ink-900">
              The spectrum could not be read
            </p>
            <p className="mt-1.5 max-w-2xl text-[1rem] text-ink-600">{failure}</p>
          </div>
        </div>
      </>
    );
  }

  const { items, customers, configured, carters, wishlisted, window: window_ } = response;
  const empty = items.length === 0;

  return (
    <>
      <PageHeader
        eyebrow="Insights → Customer spectrum"
        title="Customers"
        description="Signed-in people with recorded activity, each naming the design they pressed the most buttons on. Open one to see every design and every control they touched."
        meta={
          <>
            <HeaderFact label="Window" value={`${window_.days} days`} />
            <HeaderFact label="Identified" value={count(customers)} tone="brand" />
            <HeaderFact label="Configured" value={count(configured)} />
            <HeaderFact label="Added" value={count(carters)} />
            <HeaderFact label="Saved" value={count(wishlisted)} />
          </>
        }
        actions={
          <WindowTabs windows={WINDOWS} active={days} hrefFor={(next) => hrefFor({ days: next })} />
        }
      />

      <div className="page-body">
        {empty ? (
          <div className="sheet">
            <EmptyState
              title="No signed-in customer touched anything in this window"
              description="This list only holds identified people, because an anonymous session has nobody to ring. Anonymous browsing still counts in full on the store-wide report and the product spectrum."
              action={
                <>
                  <Link href="/insights" className="btn btn-primary btn-sm">
                    The whole shop
                  </Link>
                  <Link href="/insights/products" className="btn btn-secondary btn-sm">
                    Product spectrum
                  </Link>
                </>
              }
            />
          </div>
        ) : (
          <>
            <MetricRow columns={4}>
              <Metric
                label="Identified customers"
                value={count(customers)}
                context="Signed in while browsing, in this window."
                accent
              />
              <Metric
                label="Chose a colour or size"
                value={count(configured)}
                context="The first real sign of intent to buy."
              />
              <Metric
                label="Added to cart"
                value={count(carters)}
                context={`${share(customers === 0 ? 0 : carters / customers)} of the identified list`}
              />
              <Metric
                label="Saved to wishlist"
                value={count(wishlisted)}
                context="Interested, but not committed to a cart."
              />
            </MetricRow>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[0.8125rem] font-medium text-ink-500">Rank by</span>
              {SORTS.map((option) => (
                <Link
                  key={option.key}
                  href={hrefFor({ sort: option.key })}
                  aria-current={option.key === sort ? 'page' : undefined}
                  className={
                    option.key === sort
                      ? 'btn-press rounded-full bg-rose-500 px-3.5 py-1.5 text-[0.875rem] font-semibold text-ink-900 shadow-[inset_0_0_0_1px_var(--color-rose-600)]'
                      : 'btn-press rounded-full border border-border-strong bg-white px-3.5 py-1.5 text-[0.875rem] font-medium text-ink-600 hover:border-rose-400 hover:text-rose-800'
                  }
                >
                  {option.label}
                </Link>
              ))}
            </div>

            <div className="mt-4">
              <Panel
                title="Every identified customer, and what they did"
                description="Ranked by the filter above, capped at fifty. The design named is the one they pressed the most buttons on."
                actions={<Status tone="active">{items.length} listed</Status>}
                flush
              >
                <div className="table-scroll scrollbar-soft">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col" className="w-10 text-right">
                          #
                        </th>
                        <th scope="col">Customer</th>
                        <th scope="col">Circling</th>
                        <th scope="col" className="text-right">
                          Taps
                        </th>
                        <th scope="col" className="text-right">
                          Designs
                        </th>
                        <th scope="col" className="text-right">
                          Configured
                        </th>
                        <th scope="col" className="text-right">
                          Added
                        </th>
                        <th scope="col" className="text-right">
                          Saved
                        </th>
                        <th scope="col">Signal</th>
                        <th scope="col" className="text-right">
                          Last seen
                        </th>
                        <th scope="col" className="w-12">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((row, index) => {
                        const name =
                          [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Unnamed';
                        const intent = intentOf(row);
                        const href = `/insights/customers/${row.customerId}`;
                        return (
                          <tr key={row.customerId} className="group">
                            <td className="text-right tabular-nums text-ink-400">{index + 1}</td>
                            <td>
                              <Link href={href} className="flex flex-col gap-0.5">
                                <span className="font-medium text-ink-900 group-hover:text-rose-800">
                                  {name}
                                </span>
                                <span className="truncate text-[0.8125rem] text-ink-500">
                                  {row.email}
                                </span>
                              </Link>
                            </td>
                            <td>
                              {row.topProduct ? (
                                <Link
                                  href={`/insights/products/${row.topProduct.productId}`}
                                  className="flex max-w-[18rem] flex-col gap-0.5"
                                >
                                  <span className="truncate text-[0.9375rem] text-ink-800 hover:text-rose-800">
                                    {row.topProduct.title}
                                  </span>
                                  <span className="text-[0.8125rem] text-ink-400">
                                    their most-tapped design
                                  </span>
                                </Link>
                              ) : (
                                <span className="text-ink-400">—</span>
                              )}
                            </td>
                            <td className="text-right tabular-nums font-medium">
                              {count(row.taps)}
                            </td>
                            <td className="text-right tabular-nums">{count(row.designsViewed)}</td>
                            <td className="text-right tabular-nums">
                              {count(row.configuredSessions)}
                            </td>
                            <td className="text-right tabular-nums">{count(row.addToCart)}</td>
                            <td className="text-right tabular-nums">{count(row.wishlistAdds)}</td>
                            <td>
                              <Status tone={intent.tone}>{intent.label}</Status>
                            </td>
                            <td className="text-right text-[0.9375rem] text-ink-500">
                              {relativeTime(row.lastSeenAt)}
                            </td>
                            <td>
                              <Link
                                href={href}
                                aria-label={`Open ${name}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-rose-50 hover:text-rose-800"
                              >
                                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>

            <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-400">
              <Status tone="active">Recording</Status>
              <span>Read {relativeTime(response.generatedAt)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {window_.since.slice(0, 10)} → {window_.until.slice(0, 10)}
              </span>
              <span aria-hidden="true">·</span>
              <span>First-party events only, consent-gated</span>
            </p>
          </>
        )}
      </div>
    </>
  );
}
