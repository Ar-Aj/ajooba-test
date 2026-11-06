import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { InteractionProductSpectrumRow } from '@ajooba/contracts';
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
import { OpsApiError, fetchProductSpectrum } from '@/lib/ops';
import { relativeTime } from '@/lib/format';

/**
 * The product spectrum.
 *
 * ## The question this screen answers
 *
 * *Which design's shelf works, and which one's does not.* Every column is a
 * different failure mode, and that is the whole point of the screen:
 *
 *   - **Views high, taps low** — the design is being found, but nobody touches it.
 *     That is a photography or a title problem, not a buy-box problem.
 *   - **Configured high, added low** — they picked a size or a colour and left.
 *     That is a price, stock or sizing problem, and it is invisible in any
 *     view-based report.
 *   - **Added high, kept low** — they add and unpick. Something on the cart or the
 *     delivery promise is putting them off.
 *
 * The two rate columns are the ones that make this a merchandising screen rather
 * than a traffic screen. `Add / viewed` answers "does this convert from the
 * grid"; `Add / configured` answers "does this convert once somebody is
 * interested". A design can be bad at the first and excellent at the second, and
 * the two fixes are opposite.
 *
 * ## Why the buttons are here and not only on the drill-down
 *
 * Because "the top button on this design is *chose a colour*" is a finding in
 * itself, and it costs one column. An operator scanning fifty designs for the one
 * that needs attention should not have to open fifty pages.
 */

export const dynamic = 'force-dynamic';

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

const SORTS = [
  { key: 'taps', label: 'Most tapped' },
  { key: 'views', label: 'Most seen' },
  { key: 'addToCart', label: 'Most added' },
  { key: 'wishlist', label: 'Most saved' },
  { key: 'rate', label: 'Best converted' },
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

export default async function ProductSpectrumPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = readDays(params.days);
  const sort = readSort(params.sort);

  let response: Awaited<ReturnType<typeof fetchProductSpectrum>> | null = null;
  let failure: string | null = null;

  try {
    response = await fetchProductSpectrum({ days, limit: 50, sort });
  } catch (error) {
    failure =
      error instanceof OpsApiError
        ? error.message
        : 'The product spectrum could not be read. This is unexpected.';
  }

  const hrefFor = (next: { days?: number; sort?: SortKey }) => {
    const query = new URLSearchParams();
    const nextDays = next.days ?? days;
    const nextSort = next.sort ?? sort;
    if (nextDays !== 30) query.set('days', String(nextDays));
    if (nextSort !== 'taps') query.set('sort', nextSort);
    const suffix = query.toString();
    return suffix ? `/insights/products?${suffix}` : '/insights/products';
  };

  if (failure || !response) {
    return (
      <>
        <PageHeader
          eyebrow="Insights → Product spectrum"
          title="Designs"
          description="Which buttons each design earns, and where interest stops short of the cart."
        />
        <div className="page-body">
          <div className="sheet p-6" role="alert">
            <p className="text-[1.0625rem] font-semibold text-ink-900">
              The spectrum could not be read
            </p>
            <p className="mt-1.5 max-w-2xl text-[1rem] text-ink-600">{failure}</p>
            <p className="mt-3 max-w-2xl text-[1rem] text-ink-500">
              Nothing has been changed. Reload once the API is answering.
            </p>
          </div>
        </div>
      </>
    );
  }

  const { items, designs, viewers, configurers, carters, window: window_ } = response;
  const empty = items.length === 0;

  // The lead figure: of everyone who configured a design, how many added one.
  const configureToCart = configurers === 0 ? 0 : carters / configurers;

  return (
    <>
      <PageHeader
        eyebrow="Insights → Product spectrum"
        title="Designs"
        description="Which buttons each design earns. Configured counts the sessions that chose a colour or a size; the two rates say whether a design converts from the shelf, and whether it converts once somebody has picked it up."
        meta={
          <>
            <HeaderFact label="Window" value={`${window_.days} days`} />
            <HeaderFact label="Designs seen" value={count(designs)} tone="brand" />
            <HeaderFact label="Configured" value={count(configurers)} />
            <HeaderFact label="Added" value={count(carters)} />
          </>
        }
        actions={<WindowTabs windows={WINDOWS} active={days} hrefFor={(next) => hrefFor({ days: next })} />}
      />

      <div className="page-body">
        {empty ? (
          <div className="sheet">
            <EmptyState
              title="No design was opened in this window"
              description="This screen reads from product-level events, so it fills in as soon as somebody opens a design on the storefront and touches something on it."
              action={
                <>
                  <Link href="/insights" className="btn btn-primary btn-sm">
                    The whole shop
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
            <MetricRow columns={4}>
              <Metric
                label="Sessions that saw a design"
                value={count(viewers)}
                context="Distinct sessions that opened a product page."
                accent
              />
              <Metric
                label="Configured a design"
                value={count(configurers)}
                context="Chose a colour or a size — intent short of the cart."
              />
              <Metric
                label="Added to cart"
                value={count(carters)}
                context={`${share(configureToCart)} of the sessions that configured one`}
              />
              <Metric
                label="Designs touched"
                value={count(designs)}
                context={`Across the last ${window_.days} days`}
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
                title="Every design, and what it earned"
                description="Ranked by the filter above, capped at fifty. Open a design for the customer list and the day-by-day shape."
                actions={
                  <Status tone="active">
                    {items.length} of {count(designs)}
                  </Status>
                }
                flush
              >
                <div className="table-scroll scrollbar-soft">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col" className="w-10 text-right">
                          #
                        </th>
                        <th scope="col">Design</th>
                        <th scope="col">Top button</th>
                        <th scope="col" className="text-right">
                          Views
                        </th>
                        <th scope="col" className="text-right">
                          Taps
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
                        <th scope="col" className="text-right">
                          Add / viewed
                        </th>
                        <th scope="col" className="text-right">
                          Add / configured
                        </th>
                        <th scope="col" className="w-12">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((product, index) => (
                        <ProductRow key={product.productId} product={product} index={index} />
                      ))}
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
            </p>
          </>
        )}
      </div>
    </>
  );
}

/**
 * One design's row.
 *
 * A component rather than an inline map body because the row carries the only
 * piece of judgement on the screen: when a design has been configured and not
 * added, that is the row worth a phone call, and it says so in words.
 */
function ProductRow({
  product,
  index,
}: {
  product: InteractionProductSpectrumRow;
  index: number;
}) {
  /*
   * The verdict. Deliberately conservative: a design needs a real amount of
   * configuration before "configured but not added" means anything, so the
   * threshold is three sessions. Below that the row shows the plain rate.
   */
  const stalled = product.configuredSessions >= 3 && product.addToCart === 0;
  const href = `/insights/products/${product.productId}`;

  return (
    <tr className="group">
      <td className="text-right tabular-nums text-ink-400">{index + 1}</td>
      <td>
        <Link href={href} className="flex flex-col gap-0.5">
          <span className="block max-w-[20rem] truncate font-medium text-ink-900 group-hover:text-rose-800">
            {product.title}
          </span>
          <span className="flex items-center gap-2 text-[0.8125rem] text-ink-500">
            <span className="font-mono">{product.code}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{product.categoryName}</span>
          </span>
        </Link>
      </td>
      <td>
        {product.topAction ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-[0.9375rem] text-ink-800">{product.topAction.label}</span>
            <span className="text-[0.8125rem] tabular-nums text-ink-400">
              {count(product.topAction.taps)} · {share(product.topAction.share)} of its taps
            </span>
          </span>
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </td>
      <td className="text-right tabular-nums">{count(product.views)}</td>
      <td className="text-right tabular-nums">{count(product.taps)}</td>
      <td className="text-right tabular-nums">{count(product.configuredSessions)}</td>
      <td className="text-right tabular-nums font-medium">{count(product.addToCart)}</td>
      <td className="text-right tabular-nums">{count(product.wishlistAdds)}</td>
      <td className="text-right tabular-nums">
        {product.views === 0 ? (
          <span className="text-ink-400">—</span>
        ) : (
          share(product.addToCartRate)
        )}
      </td>
      <td className="text-right tabular-nums">
        {product.configuredSessions === 0 ? (
          <span className="text-ink-400">—</span>
        ) : stalled ? (
          <Status tone="waiting">Stalled</Status>
        ) : (
          <span className="font-semibold text-ink-900">{share(product.intentRate)}</span>
        )}
      </td>
      <td>
        <Link
          href={href}
          aria-label={`Open ${product.title}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-rose-50 hover:text-rose-800"
        >
          <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
        </Link>
      </td>
    </tr>
  );
}
