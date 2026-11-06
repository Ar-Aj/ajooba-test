import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import {
  ACTION_LABELS,
  DEVICE_LABELS,
  SURFACE_LABELS,
  type CustomerInteractionProfile,
} from '@ajooba/contracts';
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
  ActivityStrip,
  CategoryTable,
  Funnel,
  ShareList,
  count,
  share,
} from '@/components/insights/insight-parts';
import { OpsApiError, fetchVisitorProfile } from '@/lib/ops';
import { dateTime, relativeTime } from '@/lib/format';

/**
 * One customer, as the sales desk sees them.
 *
 * ## The question this screen answers
 *
 * *What did this person try to buy, and where did they stop.* Not a score and not
 * a segment — the designs they opened, the buttons they pressed on each one, and
 * the moment they last looked.
 *
 * ## Why the design matrix is the centre of the screen
 *
 * The blocks above it are counts. Counts say somebody engaged; they do not say
 * *with what*. The matrix row for Mojri 12 — "chose a colour ×4, chose a size ×3,
 * never added" — is the sentence a salesperson repeats on a phone call. It is the
 * only block here that could not be produced by a generic analytics tool.
 *
 * ## Order of reading
 *
 * Totals, then the design matrix, then where their attention went, then the raw
 * event list as evidence. The evidence is last because it is the finding's proof,
 * not the finding; a screen that opens with raw events is a log, not a report.
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

export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { customerId } = await params;
  const query = await searchParams;
  const days = readDays(query.days);

  if (!/^[0-9a-fA-F]{24}$/.test(customerId)) notFound();

  let profile: CustomerInteractionProfile | null = null;
  let failure: string | null = null;
  let missing = false;

  try {
    profile = await fetchVisitorProfile(customerId, { days, limit: 25 });
  } catch (error) {
    if (error instanceof OpsApiError && error.status === 404) {
      missing = true;
    } else {
      failure =
        error instanceof OpsApiError
          ? error.message
          : 'This customer could not be read. This is unexpected.';
    }
  }

  const hrefFor = (nextDays: number) =>
    nextDays === 30
      ? `/insights/customers/${customerId}`
      : `/insights/customers/${customerId}?days=${nextDays}`;

  if (missing) {
    return (
      <>
        <PageHeader eyebrow="Insights → Customer spectrum" title="Customer not found" />
        <div className="page-body">
          <div className="sheet p-6">
            <p className="text-[1.0625rem] font-semibold text-ink-900">No events for that id</p>
            <p className="mt-1.5 max-w-2xl text-[1rem] text-ink-600">
              Nothing was ever recorded against this customer id, so there is no profile to show.
            </p>
            <Link href="/insights/customers" className="btn btn-primary btn-sm mt-5">
              Back to customers
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (failure || !profile) {
    return (
      <>
        <PageHeader eyebrow="Insights → Customer spectrum" title="Customer" />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="text-[1.0625rem] font-semibold text-ink-900">
              This profile could not be read
            </p>
            <p className="mt-1.5 max-w-2xl text-[1rem] text-ink-600">{failure}</p>
          </div>
        </div>
      </>
    );
  }

  const customer = profile.customer;
  const name = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'Unnamed customer'
    : 'A customer we no longer have an account for';

  const surfaces = profile.surfaces.map((row) => ({
    ...row,
    label: SURFACE_LABELS[row.key as keyof typeof SURFACE_LABELS] ?? row.label,
  }));
  const actions = profile.actions.map((row) => ({
    ...row,
    label: ACTION_LABELS[row.key as keyof typeof ACTION_LABELS] ?? row.label,
  }));

  const empty = profile.totals.taps === 0;
  const addRate =
    profile.totals.productViews === 0 ? 0 : profile.totals.addToCart / profile.totals.productViews;

  return (
    <>
      <PageHeader
        eyebrow={`Insights → Customer spectrum → ${customer?.isActive === false ? 'Deactivated' : 'Active'}`}
        title={name}
        description={
          customer
            ? `${customer.email}${customer.phone ? ` · ${customer.phone}` : ''} — every design they opened and every control they pressed in the window.`
            : 'The events recorded against this id are still shown; the account itself is no longer present.'
        }
        meta={
          <>
            <HeaderFact label="Window" value={`${profile.window.days} days`} />
            <HeaderFact label="Taps" value={count(profile.totals.taps)} tone="brand" />
            <HeaderFact label="Designs seen" value={count(profile.products.length)} />
            <HeaderFact label="Added" value={count(profile.totals.addToCart)} />
            <HeaderFact label="Saved" value={count(profile.totals.wishlistAdds)} />
          </>
        }
        actions={
          <>
            <Link href="/insights/customers" className="btn btn-secondary btn-sm">
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              All customers
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
              description="This person has not been recorded touching anything during the selected period. Widen the window, or check the store-wide report for what was happening."
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
                label="Taps"
                value={count(profile.totals.taps)}
                context={`Across ${profile.window.days} days`}
                accent
              />
              <Metric
                label="Designs opened"
                value={count(profile.products.length)}
                context={`${count(profile.totals.productViews)} page views in total`}
              />
              <Metric
                label="Add rate"
                value={share(addRate)}
                context="Adds divided by the designs they opened"
              />
              <Metric
                label="Saved to wishlist"
                value={count(profile.totals.wishlistAdds)}
                context="The strongest intent signal there is"
              />
            </MetricRow>

            {/* ---- the centre of the screen ------------------------------ */}
            <div className="mt-6">
              <Panel
                title="Designs they engaged with, and what they pressed"
                description="One block per design, ranked by the buttons they pressed on it. This is the list a salesperson reads before making a call."
                flush
              >
                {profile.productActions.length === 0 ? (
                  <EmptyState
                    title="No design was touched"
                    description="They browsed the shop — the categories and surfaces below — without pressing anything on a design page."
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {profile.productActions.map((item) => {
                      const configured = item.actions
                        .filter(
                          (action) =>
                            action.key === 'select-colour' || action.key === 'select-size',
                        )
                        .reduce((sum, action) => sum + action.taps, 0);
                      return (
                        <article key={item.productId} className="p-4 md:p-6">
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <div className="min-w-0">
                              <Link
                                href={`/insights/products/${item.productId}`}
                                className="group inline-flex items-center gap-1.5"
                              >
                                <span className="truncate text-[1.0625rem] font-semibold text-ink-900 group-hover:text-rose-800">
                                  {item.title}
                                </span>
                                <ArrowUpRight
                                  className="h-3.5 w-3.5 shrink-0 text-ink-300 group-hover:text-rose-700"
                                  strokeWidth={2}
                                />
                              </Link>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-ink-500">
                                <span className="font-mono">{item.code}</span>
                                <span aria-hidden="true">·</span>
                                <span>{item.categoryName}</span>
                                <span aria-hidden="true">·</span>
                                <span>last seen {relativeTime(item.lastSeenAt)}</span>
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {item.addToCart > 0 ? (
                                <Status tone="active">
                                  {count(item.addToCart)} add{item.addToCart === 1 ? '' : 's'}
                                </Status>
                              ) : configured > 0 ? (
                                <Status tone="waiting">Configured, not added</Status>
                              ) : item.wishlistAdds > 0 ? (
                                <Status tone="waiting">Saved only</Status>
                              ) : (
                                <Status tone="neutral">Viewed only</Status>
                              )}
                            </div>
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                            <div>
                              <dt className="label-cap">Views</dt>
                              <dd className="text-[1.0625rem] font-semibold tabular-nums text-ink-900">
                                {count(item.views)}
                              </dd>
                            </div>
                            <div>
                              <dt className="label-cap">Taps</dt>
                              <dd className="text-[1.0625rem] font-semibold tabular-nums text-ink-900">
                                {count(item.taps)}
                              </dd>
                            </div>
                            <div>
                              <dt className="label-cap">Configured</dt>
                              <dd className="text-[1.0625rem] font-semibold tabular-nums text-ink-900">
                                {count(configured)}
                              </dd>
                            </div>
                            <div>
                              <dt className="label-cap">Saved</dt>
                              <dd className="text-[1.0625rem] font-semibold tabular-nums text-ink-900">
                                {count(item.wishlistAdds)}
                              </dd>
                            </div>
                          </dl>

                          <div className="mt-4 rounded-lg border border-border bg-panel-100 p-3.5 md:p-4">
                            <p className="label-cap mb-2.5">What they pressed on this design</p>
                            {item.actions.length === 0 ? (
                              <p className="text-[0.9375rem] text-ink-500">
                                They opened it and pressed nothing.
                              </p>
                            ) : (
                              <ActionMatrix
                                actions={item.actions}
                                limit={8}
                                emptyLabel="They opened it and pressed nothing."
                              />
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Panel title="Where they tapped" description="The surfaces that received their taps.">
                <ShareList rows={surfaces} limit={6} />
              </Panel>

              <Panel
                title="What they did"
                description="Every control, across every design and page."
              >
                <ShareList rows={actions} limit={8} />
              </Panel>

              <Panel title="Their path" description="Distinct sessions that did each thing.">
                <Funnel
                  steps={[
                    {
                      label: 'Browsed',
                      value: profile.funnel.browsed,
                      hint: 'Sessions with any recorded event.',
                    },
                    {
                      label: 'Opened a design',
                      value: profile.funnel.viewedDesign,
                      hint: 'Sessions that read a design page.',
                    },
                    {
                      label: 'Added to cart',
                      value: profile.funnel.addedToCart,
                      hint: 'Sessions that put something in the cart.',
                    },
                    {
                      label: 'Started checkout',
                      value: profile.funnel.startedCheckout,
                      hint: 'Sessions that reached the checkout.',
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
                title="When they visited"
                description="Taps per day. Quiet days are drawn, not skipped."
                className="lg:col-span-2"
              >
                <ActivityStrip points={profile.trend} />
              </Panel>

              <Panel title="Account" description="What is known about this person.">
                {customer ? (
                  <dl className="space-y-3.5">
                    <div>
                      <dt className="label-cap">Email</dt>
                      <dd className="mt-0.5 break-all text-[0.9375rem] text-ink-900">
                        {customer.email}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Phone</dt>
                      <dd className="mt-0.5 text-[0.9375rem] text-ink-900">
                        {customer.phone || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Customer since</dt>
                      <dd className="mt-0.5 text-[0.9375rem] text-ink-900">
                        {dateTime(customer.createdAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Last signed in</dt>
                      <dd className="mt-0.5 text-[0.9375rem] text-ink-900">
                        {customer.lastLoginAt ? relativeTime(customer.lastLoginAt) : 'Never'}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Status</dt>
                      <dd className="mt-1">
                        <Status tone={customer.isActive ? 'active' : 'waiting'}>
                          {customer.isActive ? 'Active' : 'Deactivated'}
                        </Status>
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Devices</dt>
                      <dd className="mt-1.5 space-y-1">
                        {profile.devices.length === 0 ? (
                          <span className="text-[0.9375rem] text-ink-500">Not recorded</span>
                        ) : (
                          profile.devices.map((device) => (
                            <span
                              key={device.device}
                              className="flex items-baseline justify-between gap-3 text-[0.9375rem] text-ink-800"
                            >
                              <span>{DEVICE_LABELS[device.device]}</span>
                              <span className="tabular-nums text-ink-500">
                                {count(device.sessions)}
                              </span>
                            </span>
                          ))
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-[0.9375rem] leading-relaxed text-ink-500">
                    The account for this id is no longer present. The recorded events remain, since
                    they describe real visits that happened.
                  </p>
                )}
              </Panel>
            </div>

            <div className="mt-6">
              <Panel
                title="Categories they touched"
                description="The same activity rolled up by category — the same roll-up the store-wide report uses."
                flush
              >
                {profile.categories.length === 0 ? (
                  <EmptyState
                    title="No category activity"
                    description="A category appears once a design inside it is touched."
                  />
                ) : (
                  <CategoryTable categories={profile.categories} />
                )}
              </Panel>
            </div>

            <div className="mt-6">
              <Panel
                title="Most recent events"
                description={`The latest ${Math.min(profile.recent.length, 20)} of this person's events, newest first. The evidence behind every figure above.`}
                flush
              >
                {profile.recent.length === 0 ? (
                  <EmptyState title="No events" description="Nothing was recorded in this window." />
                ) : (
                  <ul className="divide-y divide-border">
                    {profile.recent.map((event) => (
                      <li key={event.id} className="px-4 py-3 md:px-6">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="text-[0.9375rem] font-medium text-ink-900">
                            {event.action
                              ? (ACTION_LABELS[event.action as keyof typeof ACTION_LABELS] ??
                                event.action)
                              : event.event}
                          </span>
                          <span className="text-[0.8125rem] tabular-nums text-ink-400">
                            {dateTime(event.occurredAt)}
                          </span>
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8125rem] text-ink-500">
                          {event.surface ? (
                            <span>
                              {SURFACE_LABELS[event.surface as keyof typeof SURFACE_LABELS] ??
                                event.surface}
                            </span>
                          ) : null}
                          {event.productTitle ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-ink-700">{event.productTitle}</span>
                            </>
                          ) : null}
                          {event.categoryName ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{event.categoryName}</span>
                            </>
                          ) : null}
                          <span aria-hidden="true">·</span>
                          <span>{DEVICE_LABELS[event.device]}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <p className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-400">
              <Status tone="active">Recording</Status>
              <span>Read {relativeTime(profile.generatedAt)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {profile.window.since.slice(0, 10)} → {profile.window.until.slice(0, 10)}
              </span>
            </p>
          </>
        )}
      </div>
    </>
  );
}
