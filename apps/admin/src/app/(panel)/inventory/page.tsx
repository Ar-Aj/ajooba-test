import Link from 'next/link';
import { Search } from 'lucide-react';
import { EmptyState, HeaderFact, PageHeader, Panel } from '@/components/layout/page-header';
import { Pagination, queryString } from '@/components/ui/pagination';
import { Status, stockLevel } from '@/components/ui/status';
import { StockAdjustDialog } from '@/features/inventory/components/stock-adjust-dialog';
import {
  OpsApiError,
  fetchInventory,
  fetchStockMovements,
  type InventoryRow,
  type Page,
} from '@/lib/ops';
import { cn, dateTime } from '@/lib/format';
import { adminPath } from '@/lib/public-path';

/**
 * Stock.
 *
 * ## Two lists, one screen, and why they are side by side
 *
 * The left list is *where stock is*; the right is *how it got there*. Separating
 * them into two screens would mean an operator who spots an implausible number
 * cannot see why it is implausible without navigating away and losing their
 * place. The ledger is the answer to every "why is this 47" question, so it sits
 * next to the number.
 *
 * ## Stock is adjusted, never set
 *
 * There is no route that writes a level and no field here that accepts one. Every
 * change is a signed delta with a reason, appended to a movement ledger. That is
 * what makes "why is this 47" answerable at all, and it is why the control asks
 * for a change and shows the resulting level before committing it.
 *
 * ## Severity is text, not colour
 *
 * "Low · 3" and "Out of stock" are words first. The tone only reinforces them, so
 * the screen survives being viewed in greyscale or by someone who cannot
 * distinguish the two hues — and there are only two.
 */

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;
const LEDGER_PAGE_SIZE = 12;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = firstValue(params.search)?.trim() || undefined;
  const productCode = firstValue(params.productCode)?.trim() || undefined;
  const inStock = firstValue(params.inStock);
  const page = Math.max(1, Number(firstValue(params.page)) || 1);

  let result: Page<InventoryRow> | null = null;
  let movements: Page<Awaited<ReturnType<typeof fetchStockMovements>>['items'][number]> | null =
    null;
  let failure: string | null = null;

  try {
    [result, movements] = await Promise.all([
      fetchInventory({
        ...(search ? { search } : {}),
        ...(productCode ? { productCode } : {}),
        // The contract takes the string 'true' | 'false', not a boolean.
        ...(inStock === 'true' || inStock === 'false' ? { inStock } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
      fetchStockMovements({ pageSize: LEDGER_PAGE_SIZE }),
    ]);
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'The stock could not be read.';
  }

  const hrefFor = (next: Record<string, string | number | undefined>) =>
    `/inventory${queryString({
      search,
      productCode,
      inStock,
      page: next.page,
    })}`;

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Stock"
        title="Stock"
        description="Every SKU with its on-hand count. Stock is never typed over — each adjustment is a signed change with a reason, and the ledger beside it records who made it and when."
        meta={
          result ? (
            <>
              <HeaderFact label="SKUs" value={result.totalItems} />
              {search ? <HeaderFact label="SKU contains" value={`“${search}”`} /> : null}
              {productCode ? <HeaderFact label="Design" value={productCode} /> : null}
              {inStock === 'true' ? <HeaderFact label="Filter" value="In stock" /> : null}
              {inStock === 'false' ? (
                <HeaderFact label="Filter" value="Out of stock" tone="fault" />
              ) : null}
            </>
          ) : null
        }
        actions={
          <form
            action={adminPath('/inventory')}
            method="get"
            className="flex flex-wrap items-center gap-2"
          >
            <label htmlFor="stock-search" className="sr-only">
              Search by SKU
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <input
                id="stock-search"
                name="search"
                type="search"
                defaultValue={search ?? ''}
                placeholder="SKU"
                className="field w-40 pl-8"
              />
            </div>
            <label htmlFor="stock-design" className="sr-only">
              Design code
            </label>
            <input
              id="stock-design"
              name="productCode"
              type="text"
              defaultValue={productCode ?? ''}
              placeholder="Design (A01)"
              className="field w-32"
            />
            <label htmlFor="stock-state" className="sr-only">
              Availability
            </label>
            <select
              id="stock-state"
              name="inStock"
              defaultValue={inStock ?? ''}
              className="field w-36"
            >
              <option value="">Any level</option>
              <option value="true">In stock</option>
              <option value="false">Out of stock</option>
            </select>
            <button type="submit" className="btn btn-secondary btn-sm">
              Filter
            </button>
            {search || productCode || inStock ? (
              <Link href="/inventory" className="btn btn-quiet btn-sm">
                Clear
              </Link>
            ) : null}
          </form>
        }
      />

      <div className="grid grid-cols-1 gap-6 px-4 py-6 md:px-8 xl:grid-cols-3">
        {/* ---- the levels ------------------------------------------------ */}
        <div className="xl:col-span-2">
          {failure ? (
            <div className="sheet p-6" role="alert">
              <p className="step-md font-medium text-ink-900">The stock could not be read</p>
              <p className="step-sm mt-1.5 text-ink-600">{failure}</p>
              <p className="step-sm mt-3 text-ink-500">
                Nothing has been changed. Reload to retry.
              </p>
            </div>
          ) : (
            <Panel flush>
              {!result || result.items.length === 0 ? (
                <EmptyState
                  title={
                    search || productCode || inStock
                      ? 'No SKUs match those filters'
                      : 'No stock records yet'
                  }
                  description={
                    search || productCode || inStock
                      ? 'Clear the filters to see every SKU in the catalogue.'
                      : 'SKUs appear once the catalogue has been imported. Stock starts at zero, because a listing template is not a warehouse ledger.'
                  }
                  action={
                    search || productCode || inStock ? (
                      <Link href="/inventory" className="btn btn-secondary">
                        Clear filters
                      </Link>
                    ) : (
                      <Link href="/catalog/imports" className="btn btn-primary">
                        Catalogue import
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
                          <th scope="col">Design</th>
                          <th scope="col">Colour</th>
                          <th scope="col" className="text-center">
                            Size
                          </th>
                          <th scope="col">SKU</th>
                          <th scope="col" className="text-right">
                            On hand
                          </th>
                          <th scope="col">Level</th>
                          <th scope="col" className="w-20">
                            <span className="sr-only">Adjust</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.items.map((row) => {
                          const level = stockLevel(row.stock);
                          return (
                            <tr key={row.variantId}>
                              <td className="font-mono text-[0.75rem] font-medium text-ink-900">
                                {row.productCode}
                              </td>
                              <td className="text-ink-700">{row.colour}</td>
                              <td className="text-center tabular-nums text-ink-700">{row.size}</td>
                              <td className="font-mono text-[0.75rem] text-ink-400">{row.sku}</td>
                              <td
                                className={cn(
                                  'text-right tabular-nums font-medium',
                                  row.stock === 0 ? 'text-claret-700' : 'text-ink-900',
                                )}
                              >
                                {row.stock}
                              </td>
                              <td>
                                <Status tone={level.tone}>{level.label}</Status>
                              </td>
                              <td className="text-right">
                                <StockAdjustDialog
                                  variantId={row.variantId}
                                  sku={row.sku}
                                  productCode={row.productCode}
                                  colour={row.colour}
                                  size={row.size}
                                  stock={row.stock}
                                />
                              </td>
                            </tr>
                          );
                        })}
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
                </>
              )}
            </Panel>
          )}
        </div>

        {/* ---- the ledger ------------------------------------------------ */}
        <div>
          <Panel
            title="Movement ledger"
            description="The most recent adjustments, newest first."
            flush
          >
            {!movements || movements.items.length === 0 ? (
              <EmptyState
                title="No movements recorded"
                description="Every adjustment appends an entry here, with the reason, the actor and the resulting level."
                className="px-4 py-10"
              />
            ) : (
              <ul className="divide-y divide-border">
                {movements.items.map((movement) => (
                  <li key={movement.id} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <span className="font-mono text-[0.75rem] font-medium text-ink-900">
                          {movement.productCode}
                        </span>
                        <span className="step-xs ml-1.5 text-ink-500">
                          {movement.reason.replace(/-/g, ' ')}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 tabular-nums text-[0.8125rem] font-medium',
                          movement.delta > 0 ? 'text-ink-900' : 'text-claret-700',
                        )}
                      >
                        {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                      </span>
                    </div>
                    <p className="step-xs mt-0.5 flex items-baseline justify-between gap-2 text-ink-400">
                      <span className="truncate">
                        {movement.stockBefore} → {movement.stockAfter} · {movement.sku}
                      </span>
                      <span className="shrink-0" title={dateTime(movement.createdAt)}>
                        {movement.actorLabel}
                      </span>
                    </p>
                    {movement.note ? (
                      <p className="step-xs mt-1 italic text-ink-500">“{movement.note}”</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="mt-4 border border-border bg-panel-50 p-4">
            <p className="label-cap text-ink-400">Why a ledger</p>
            <p className="step-sm mt-1.5 text-ink-600">
              A stock level on its own cannot be explained. Every change here is recorded with its
              reason, the operator who made it, and the level before and after — so a discrepancy is
              always traceable to a moment, a person and a cause.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
