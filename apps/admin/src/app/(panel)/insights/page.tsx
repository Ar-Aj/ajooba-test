import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  ACTION_LABELS,
  DEVICE_LABELS,
  SURFACE_LABELS,
  type InteractionBucketRow,
  type InteractionInsights,
} from '@ajooba/contracts';
import {
  EmptyState,
  HeaderFact,
  Panel,
  PageHeader,
  WindowTabs,
} from '@/components/layout/page-header';
import { Metric, Figure } from '@/components/ui/metric';
import { Status } from '@/components/ui/status';
import {
  ActivityStrip,
  CategoryTable,
  Funnel,
  ProductTable,
  ShareList,
  count,
  share,
} from '@/components/insights/insight-parts';
import { OpsApiError, fetchInsights } from '@/lib/ops';
import { dateTime, relativeTime } from '@/lib/format';

/**
 * The interaction report.
 *
 * ## The question this screen answers
 *
 * *Where is attention going, and where does it stop.* Every block is one view of
 * that: the funnel says how far shoppers get, the surfaces say which part of the
 * shop they touch, the products say which designs hold them, the categories
 * roll that up, and the devices say how they are holding the shop itself.
 *
 * ## Why the store-wide view and the category view are one screen
 *
 * A category report is the store report filtered to a slug. Two screens with two
 * implementations would eventually disagree — one counting a tap on a product
 * card as a grid tap and the other as a product tap — and an operator comparing
 * them would have no way to know which was right. Here, the filter is a query
 * parameter on the same aggregation, so the totals reconcile by construction.
 *
 * ## What this screen refuses to do
 *
 * It does not show a percentage change against a previous period. The reporting
 * window has no earlier period to compare against on a young shop, and a "+40%"
 * over a fortnight of trading is a number with no denominator. The trend strip
 * shows the shape instead, which is honest at any age.
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

function readCategory(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  // Matches the contract's slug pattern; an invalid value is ignored rather than
  // sent to the API, because a 400 on a bookmarked URL would look like an outage.
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : undefined;
}

/** Turn a raw bucket list into the labelled rows the share lists render. */
function labelled(
  rows: InteractionInsights['surfaces'] | InteractionInsights['actions'],
  labels: Readonly<Record<string, string>>,
): InteractionBucketRow[] {
  return rows.map((row) => ({ ...row, label: labels[row.key] ?? row.label }));
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = readDays(params.days);
  const categorySlug = readCategory(params.category);

  let insights: InteractionInsights | null = null;
  let failure: string | null = null;

  try {
    insights = await fetchInsights({
      days,
      limit: 20,
      ...(categorySlug ? { categorySlug } : {}),
    });
  } catch (error) {
    failure =
      error instanceof OpsApiError
        ? error.message
        : 'The interaction report could not be read. This is unexpected.';
  }

  const windowHref = (nextDays: number) => {
    const query = new URLSearchParams();
    if (nextDays !== 30) query.set('days', String(nextDays));
    if (categorySlug) query.set('category', categorySlug);
    const suffix = query.toString();
    return suffix ? `/insights?${suffix}` : '/insights';
  };

  if (failure || !insights) {
    return (
      <>
        <PageHeader
          eyebrow="Insights"
          title="Interactions"
          description="Every tap, view and cart action recorded by the storefront, read from the events this environment has collected."
        />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="step-md font-semibold text-ink-900">The report could not be read</p>
            <p className="step-sm mt-1.5 max-w-2xl text-ink-600">{failure}</p>
            <p className="step-sm mt-3 max-w-2xl text-ink-500">
              Nothing has been changed. Reload once the API is answering.
            </p>
          </div>
        </div>
      </>
    );
  }

  const { totals, funnel, window: window_, products, categories } = insights;
  const activeCategory = categorySlug
    ? categories.find((category) => category.slug === categorySlug)
    : undefined;

  const surfaces = labelled(insights.surfaces, SURFACE_LABELS);
  const actions = labelled(insights.actions, ACTION_LABELS);

  const empty = totals.taps === 0;

  return (
    <>
      <PageHeader
        eyebrow={activeCategory ? `Insights → ${activeCategory.name}` : 'Insights'}
        title={activeCategory ? `${activeCategory.name} interactions` : 'Interactions'}
        description={
          activeCategory
            ? `Every tap inside ${activeCategory.name} — the designs that hold attention there, and the ones that do not. The figures are scoped to this category, not the whole shop.`
            : 'What shoppers touched, in the order they touched it. Recorded by the storefront itself — consent-gated, first-party, and never joined to an ad network.'
        }
        meta={
          <>
            <HeaderFact label="Window" value={`${window_.days} days`} />
            <HeaderFact label="Taps" value={count(totals.taps)} tone="brand" />
            <HeaderFact label="Visitors" value={count(totals.visitors)} />
            <HeaderFact label="Read at" value={dateTime(insights.generatedAt)} />
          </>
        }
        actions={<WindowTabs windows={WINDOWS} active={days} hrefFor={windowHref} />}
      />

      <div className="page-body">
        {activeCategory ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="step-sm text-blue-900">
              Filtered to <strong className="font-semibold">{activeCategory.name}</strong>. Product
              and category tables below are scoped to it.
            </p>
            <Link
              href={(() => {
                // Rebuild from scratch rather than editing the current href with
                // a regex: the parameter may be first, last, or absent, and a
                // string edit that gets that wrong leaves a dangling `?` or `&`.
                const query = new URLSearchParams();
                if (days !== 30) query.set('days', String(days));
                const suffix = query.toString();
                return suffix ? `/insights?${suffix}` : '/insights';
              })()}
              className="btn btn-secondary btn-sm"
            >
              Clear filter
            </Link>
          </div>
        ) : null}

        {empty ? (
          <div className="sheet">
            <EmptyState
              title="No interaction recorded in this window"
              description="The report is computed from events the storefront sends as shoppers browse. A quiet window, or a storefront that has not been visited yet, produces exactly these zeros. Open the shop and click a design to see this fill in."
              action={
                <>
                  <Link href="/insights/customers" className="btn btn-primary btn-sm">
                    See identified visitors
                  </Link>
                  <Link href="/catalog/products" className="btn btn-secondary btn-sm">
                    Browse the catalogue
                  </Link>
                </>
              }
            />
          </div>
        ) : (
          <>
            {/* ---- the headline row ------------------------------------- */}
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-white">
                <Metric
                  label="Taps"
                  value={count(totals.taps)}
                  context={`Across ${count(totals.visitors)} visitors in ${window_.days} days`}
                  emphasis
                />
              </div>
              <div className="bg-white">
                <Metric
                  label="Product views"
                  value={count(totals.productViews)}
                  context={`${count(totals.identifiedVisitors)} signed in, the rest anonymous`}
                />
              </div>
              <div className="bg-white">
                <Metric
                  label="Added to cart"
                  value={count(totals.addToCart)}
                  context={
                    funnel.browsed === 0
                      ? 'No sessions to convert from'
                      : `${share(funnel.addedToCart / funnel.browsed)} of visitors`
                  }
                />
              </div>
              <div className="bg-white">
                <Metric
                  label="Searches"
                  value={count(totals.searches)}
                  context={
                    totals.searches === 0
                      ? 'Nobody used the search box'
                      : 'What they typed is ranked below'
                  }
                />
              </div>
            </div>

            {/* ---- the funnel and the trend ----------------------------- */}
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
              <Panel
                title="The funnel"
                description="Sessions that did each thing, in the window."
                className="lg:col-span-1"
              >
                <Funnel
                  steps={[
                    {
                      label: 'Browsed the shop',
                      value: funnel.browsed,
                      hint: 'Distinct sessions with any event at all.',
                    },
                    {
                      label: 'Opened a design',
                      value: funnel.viewedDesign,
                      hint: 'Sessions that read at least one product page.',
                    },
                    {
                      label: 'Added to cart',
                      value: funnel.addedToCart,
                      hint: 'Sessions that put something in the cart.',
                    },
                    {
                      label: 'Started checkout',
                      value: funnel.startedCheckout,
                      hint: 'Sessions that reached the checkout.',
                    },
                    {
                      label: 'Ordered',
                      value: funnel.ordered,
                      hint: 'Sessions that completed an order.',
                    },
                  ]}
                />
              </Panel>

              <Panel
                title="When they came"
                description={`Taps per day across ${window_.days} days. Quiet days are drawn, not skipped.`}
                className="lg:col-span-2"
              >
                <ActivityStrip points={insights.trend} />
                <div className="mt-5 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                  <Figure
                    label="Designs touched"
                    value={String(products.length)}
                    note="in the top 20"
                  />
                  <Figure
                    label="Categories touched"
                    value={String(categories.length)}
                    note="with any activity"
                  />
                  <Figure
                    label="Saved to wishlist"
                    value={count(totals.wishlistAdds)}
                    note="across the shop"
                  />
                </div>
              </Panel>
            </div>

            {/* ---- where the taps landed -------------------------------- */}
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Panel
                title="Where they tapped"
                description="The part of the shop that received the tap."
              >
                <ShareList rows={surfaces} />
              </Panel>
              <Panel
                title="What they did"
                description="The action itself, ranked by how often it happened."
              >
                <ShareList rows={actions} />
              </Panel>
            </div>

            {/* ---- designs ---------------------------------------------- */}
            <div className="mt-5">
              <Panel
                title="Designs"
                description="Every design that was touched in the window, ranked by views. The add rate is over sessions, not page loads."
                actions={
                  <Status tone={products.length > 0 ? 'active' : 'neutral'}>
                    {products.length} ranked
                  </Status>
                }
                flush
              >
                {products.length === 0 ? (
                  <EmptyState
                    title="No design was opened"
                    description="Product-level activity appears here as soon as somebody opens a design page."
                  />
                ) : (
                  <ProductTable products={products} />
                )}
              </Panel>
            </div>

            {/* ---- categories ------------------------------------------- */}
            <div className="mt-5">
              <Panel
                title="Categories"
                description="The same taps, rolled up one level. Open a category to filter the whole report to it."
                flush
              >
                {categories.length === 0 ? (
                  <EmptyState
                    title="No category activity"
                    description="A category appears here once a design inside it is touched."
                  />
                ) : (
                  <CategoryTable categories={categories} activeSlug={categorySlug} />
                )}
              </Panel>
            </div>

            {/* ---- searches and devices --------------------------------- */}
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
              <Panel
                title="What they searched for"
                description="The typed terms, ranked. Misspellings are kept as typed."
                className="lg:col-span-2"
              >
                {insights.topSearchTerms.length === 0 ? (
                  <p className="step-sm text-ink-500">
                    Nobody used the search box in this window. Searches appear here with the exact
                    term entered, including terms that returned nothing — those are the useful ones.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {insights.topSearchTerms.map((term) => (
                      <li
                        key={term.term}
                        className="flex items-baseline justify-between gap-4 py-2.5"
                      >
                        <span className="step-sm min-w-0 truncate text-ink-800">{term.term}</span>
                        <span className="step-sm shrink-0 tabular-nums font-medium text-ink-900">
                          {count(term.count)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="How they browsed" description="Sessions by device class.">
                {insights.devices.length === 0 ? (
                  <p className="step-sm text-ink-500">No device data in this window.</p>
                ) : (
                  <ul className="space-y-3">
                    {insights.devices.map((device) => (
                      <li key={device.device}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="step-sm text-ink-800">
                            {DEVICE_LABELS[device.device]}
                          </span>
                          <span className="step-xs tabular-nums text-ink-500">
                            {count(device.sessions)} sessions
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-200">
                          <div
                            className="h-full rounded-full bg-ink-800"
                            style={{ width: `${Math.max(device.share * 100, 2)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 flex flex-col gap-2">
                  <Link href="/insights/products" className="btn btn-secondary btn-sm w-full">
                    Product spectrum
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                  </Link>
                  <Link href="/insights/customers" className="btn btn-secondary btn-sm w-full">
                    Customer spectrum
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                  </Link>
                </div>
              </Panel>
            </div>

            <p className="step-xs mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-400">
              <Status tone="active">Recording</Status>
              <span>Read {relativeTime(insights.generatedAt)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {window_.since} → {window_.until}
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
