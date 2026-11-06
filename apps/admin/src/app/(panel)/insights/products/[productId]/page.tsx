import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import type { InteractionProductProfile } from '@ajooba/contracts';
import {
  EmptyState,
  HeaderFact,
  PageHeader,
  Panel,
  WindowTabs,
} from '@/components/layout/page-header';
import { Metric, MetricRow } from '@/components/ui/metric';
import { Status } from '@/components/ui/status';
import {
  ActionMatrix,
  Funnel,
  ProductTable,
  SessionStrip,
  ShareList,
  count,
  share,
} from '@/components/insights/insight-parts';
import { OpsApiError, fetchProductSpectrumProfile } from '@/lib/ops';
import { relativeTime } from '@/lib/format';

/**
 * One design, read closely.
 *
 * ## The question this screen answers
 *
 * *This design was looked at. What did people do on it, and who are they.* The
 * spectrum answers the first half for every design at once; this answers it for
 * one design with names attached.
 *
 * ## Why the buttons come before the customer list
 *
 * The block order is the order the question is asked. First: which control is
 * carrying this design (the matrix). Then: how far people get (the funnel).
 * Then: who they are, so somebody can act. A customer list at the top would look
 * more useful and would be read as "here are some names", which is not a
 * merchandising decision.
 *
 * ## What the two rates mean, side by side
 *
 * `Add / viewed` is conversion from the shelf: of everyone who opened the page,
 * how many bought. `Add / configured` is conversion from intent: of everyone who
 * chose a colour or a size, how many bought. A design that is strong on the
 * second and weak on the first is being found by the wrong people. A design weak
 * on both has a shelf problem. The screen prints both, always, because one
 * without the other is a number that gets misread.
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

export default async function ProductProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { productId } = await params;
  const query = await searchParams;
  const days = readDays(query.days);

  // A malformed id would reach the API and come back as a cast error; the
  // contract validates it as an ObjectId, so this is a clean 404 instead.
  if (!/^[0-9a-fA-F]{24}$/.test(productId)) notFound();

  let profile: InteractionProductProfile | null = null;
  let failure: string | null = null;
  let missing = false;

  try {
    profile = await fetchProductSpectrumProfile(productId, { days, limit: 25 });
  } catch (error) {
    if (error instanceof OpsApiError && error.status === 404) {
      missing = true;
    } else {
      failure =
        error instanceof OpsApiError
          ? error.message
          : 'This design could not be read. This is unexpected.';
    }
  }

  const hrefFor = (nextDays: number) =>
    nextDays === 30
      ? `/insights/products/${productId}`
      : `/insights/products/${productId}?days=${nextDays}`;

  if (missing) {
    return (
      <>
        <PageHeader eyebrow="Insights → Product spectrum" title="Design not found" />
        <div className="page-body">
          <div className="sheet p-6">
            <p className="text-[1.0625rem] font-semibold text-ink-900">No events for that id</p>
            <p className="mt-1.5 max-w-2xl text-[1rem] text-ink-600">
              Nothing was ever recorded against this design id, so there is no profile to show.
            </p>
            <Link href="/insights/products" className="btn btn-primary btn-sm mt-5">
              Back to the spectrum
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (failure || !profile) {
    return (
      <>
        <PageHeader eyebrow="Insights → Product spectrum" title="Design" />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="text-[1.0625rem] font-semibold text-ink-900">
              This design could not be read
            </p>
            <p className="mt-1.5 max-w-2xl text-[1rem] text-ink-600">{failure}</p>
          </div>
        </div>
      </>
    );
  }

  const product = profile.product;
  const title = product?.title ?? 'A design no longer in the catalogue';
  const empty = profile.totals.productViews === 0 && profile.totals.taps === 0;

  const addRate = profile.funnel.viewed === 0 ? 0 : profile.funnel.addedToCart / profile.funnel.viewed;
  const intentRate =
    profile.funnel.configured === 0 ? 0 : profile.funnel.addedToCart / profile.funnel.configured;

  return (
    <>
      <PageHeader
        eyebrow={`Insights → Product spectrum → ${product?.categoryName ?? 'Uncatalogued'}`}
        title={title}
        description={
          product
            ? `${product.code} — every view, tap and customer this design earned in the window. The two rates separate being found from being wanted.`
            : 'The events recorded against this id are still shown; the catalogue entry itself is no longer present.'
        }
        meta={
          <>
            <HeaderFact label="Window" value={`${profile.window.days} days`} />
            <HeaderFact label="Views" value={count(profile.totals.productViews)} tone="brand" />
            <HeaderFact label="Taps" value={count(profile.totals.taps)} />
            <HeaderFact label="Added" value={count(profile.totals.addToCart)} />
            <HeaderFact label="Saved" value={count(profile.totals.wishlistAdds)} />
          </>
        }
        actions={
          <>
            <Link href="/insights/products" className="btn btn-secondary btn-sm">
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              All designs
            </Link>
            <WindowTabs windows={WINDOWS} active={days} hrefFor={hrefFor} />
          </>
        }
      />

      <div className="page-body">
        {empty ? (
          <div className="sheet">
            <EmptyState
              title="No activity in this window"
              description="Nobody opened this design during the selected period. Widen the window, or check the spectrum for what was moving."
              action={
                <Link href={hrefFor(90)} className="btn btn-secondary btn-sm">
                  Widen to 90 days
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <MetricRow columns={4}>
              <Metric
                label="Add / viewed"
                value={share(addRate)}
                context="Of everyone who opened the page, how many added it."
                accent
              />
              <Metric
                label="Add / configured"
                value={profile.funnel.configured === 0 ? '—' : share(intentRate)}
                context={
                  profile.funnel.configured === 0
                    ? 'Nobody chose a colour or a size'
                    : 'Of everyone who picked a colour or size, how many added it'
                }
                tone={
                  profile.funnel.configured >= 3 && profile.funnel.addedToCart === 0
                    ? 'waiting'
                    : 'default'
                }
              />
              <Metric
                label="Configured"
                value={count(profile.funnel.configured)}
                context="Sessions that chose a colour or a size"
              />
              <Metric
                label="Customers"
                value={count(profile.totals.identifiedVisitors)}
                context={`Of ${count(profile.totals.visitors)} sessions, these were signed in`}
              />
            </MetricRow>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Panel
                title="What they pressed"
                description="Every control on this design, ranked by how often it was touched."
                className="lg:col-span-2"
              >
                {profile.actions.length === 0 ? (
                  <EmptyState
                    title="No button was pressed"
                    description="This design was opened but nothing on it was touched — which is a finding about the page, not an absence of data."
                    className="px-0 py-10"
                  />
                ) : (
                  <ActionMatrix actions={profile.actions} limit={12} />
                )}
              </Panel>

              <Panel
                title="How far they got"
                description="Sessions that did each thing, scoped to this design."
              >
                <Funnel
                  steps={[
                    {
                      label: 'Opened the design',
                      value: profile.funnel.viewed,
                      hint: 'Sessions that read this page.',
                    },
                    {
                      label: 'Chose a colour or size',
                      value: profile.funnel.configured,
                      hint: 'The first sign of intent.',
                    },
                    {
                      label: 'Added to cart',
                      value: profile.funnel.addedToCart,
                      hint: 'Sessions that put this design in a cart.',
                    },
                    {
                      label: 'Reached checkout',
                      value: profile.funnel.startedCheckout,
                      hint: 'Sessions that took it to checkout.',
                    },
                    {
                      label: 'Ordered',
                      value: profile.funnel.ordered,
                      hint: 'Sessions that completed an order.',
                    },
                  ]}
                />
              </Panel>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Panel
                title="Sessions per day"
                description="Distinct visitors, not events. Quiet days are drawn, not skipped."
                className="lg:col-span-2"
              >
                <SessionStrip points={profile.trend} />
              </Panel>

              <Panel
                title="Where on the page"
                description="The surface that received this design's taps."
              >
                <ShareList
                  rows={profile.surfaces}
                  limit={6}
                  emptyLabel="No taps recorded against a surface."
                />
              </Panel>
            </div>

            <div className="mt-6">
              <Panel
                title="Customers who engaged"
                description="Signed-in people who touched this design. Configured marks the ones who picked a size or colour — the list to ring."
                actions={<Status tone="active">{count(profile.customers.length)} named</Status>}
                flush
              >
                {profile.customers.length === 0 ? (
                  <EmptyState
                    title="Nobody signed in engaged with this design"
                    description="The activity above came from anonymous sessions. Those count in every figure, but there is no one to contact about them."
                  />
                ) : (
                  <div className="table-scroll scrollbar-soft">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Customer</th>
                          <th scope="col" className="text-right">
                            Views
                          </th>
                          <th scope="col" className="text-right">
                            Taps
                          </th>
                          <th scope="col" className="text-right">
                            Added
                          </th>
                          <th scope="col" className="text-right">
                            Saved
                          </th>
                          <th scope="col">Intent</th>
                          <th scope="col" className="text-right">
                            Last seen
                          </th>
                          <th scope="col" className="w-12">
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.customers.map((customer) => {
                          const name =
                            [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
                            'Unnamed';
                          return (
                            <tr key={customer.customerId} className="group">
                              <td>
                                <Link
                                  href={`/insights/customers/${customer.customerId}`}
                                  className="flex flex-col gap-0.5"
                                >
                                  <span className="font-medium text-ink-900 group-hover:text-rose-800">
                                    {name}
                                  </span>
                                  <span className="truncate text-[0.8125rem] text-ink-500">
                                    {customer.email}
                                  </span>
                                </Link>
                              </td>
                              <td className="text-right tabular-nums">{count(customer.views)}</td>
                              <td className="text-right tabular-nums">{count(customer.taps)}</td>
                              <td className="text-right tabular-nums font-medium">
                                {count(customer.addToCart)}
                              </td>
                              <td className="text-right tabular-nums">
                                {count(customer.wishlistAdds)}
                              </td>
                              <td>
                                {customer.addToCart > 0 ? (
                                  <Status tone="active">Bought</Status>
                                ) : customer.wishlistAdds > 0 ? (
                                  <Status tone="waiting">Saved only</Status>
                                ) : customer.configured ? (
                                  <Status tone="waiting">Configured</Status>
                                ) : (
                                  <Status tone="neutral">Browsed</Status>
                                )}
                              </td>
                              <td className="text-right text-[0.9375rem] text-ink-500">
                                {relativeTime(customer.lastSeenAt)}
                              </td>
                              <td>
                                <Link
                                  href={`/insights/customers/${customer.customerId}`}
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
                )}
              </Panel>
            </div>

            <div className="mt-6">
              <Panel
                title="What else they looked at"
                description="Designs the same sessions touched. Read this as cross-sell evidence, not as a recommendation — it is what happened, not what should."
                flush
              >
                {profile.alsoViewed.length === 0 ? (
                  <EmptyState
                    title="Nothing else was opened alongside this design"
                    description="Every session that touched this design looked at nothing else in the window."
                  />
                ) : (
                  <ProductTable
                    products={profile.alsoViewed}
                    hrefFor={(item) => `/insights/products/${item.productId}`}
                  />
                )}
              </Panel>
            </div>

            <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-400">
              <Status tone="active">Recording</Status>
              <span>Read {relativeTime(profile.generatedAt)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {profile.window.since.slice(0, 10)} → {profile.window.until.slice(0, 10)}
              </span>
              <span aria-hidden="true">·</span>
              <span>Scoped to this design only</span>
            </p>
          </>
        )}
      </div>
    </>
  );
}
