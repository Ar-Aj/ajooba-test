'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  activeFilterChips,
  buildCatalogHref,
  SORT_OPTIONS,
  type CatalogParams,
} from '../lib/catalog-params';
import { MobileFilterTrigger } from './filter-panel';
import { rupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import { trackTap } from '@/lib/track';
import type { CatalogFacets } from '@ajooba/contracts';

/**
 * The strip above the shelf.
 *
 * Three things, in the order a shopper wants them: how many designs matched,
 * a way to narrow further on a phone, and a way to reorder. Everything else —
 * the active filters — sits on a second line as removable chips, so a shopper
 * can always see exactly why the shelf is shorter than the catalogue.
 *
 * The chips resolve their labels from the live facets, not from the hardcoded
 * `FEATURED_SUBCATEGORIES` map. That map rendered a raw slug as the chip label
 * for any category an administrator created, so a filter chip could read
 * "bridal-jutti" instead of "Bridal Jutti".
 */
export function CatalogToolbar({
  params,
  totalItems,
  basePath = '/products',
  facets,
}: {
  params: CatalogParams;
  totalItems: number;
  basePath?: string;
  facets?: CatalogFacets | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const chips = activeFilterChips(params);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="step-sm text-ink-600" aria-live="polite">
          {pending ? (
            <span className="text-ink-400">Updating…</span>
          ) : (
            <>
              <span className="tnum font-medium text-ink-900">{totalItems}</span>{' '}
              {totalItems === 1 ? 'design' : 'designs'}
            </>
          )}
        </p>

        <div className="flex items-center gap-2">
          <MobileFilterTrigger params={params} facets={facets} />

          <label htmlFor="catalog-sort" className="sr-only">
            Sort products
          </label>
          <div className="relative">
            <select
              id="catalog-sort"
              value={params.sort}
              onChange={(event) => {
                const sort = event.target.value as CatalogParams['sort'];
                trackTap('sort-change', 'catalog-toolbar', {
                  ...(params.subcategory ? { categorySlug: params.subcategory } : {}),
                });
                startTransition(() => {
                  router.push(buildCatalogHref(params, { sort, page: 1 }, basePath));
                });
              }}
              className="step-sm h-10 appearance-none border border-border bg-transparent py-0 pl-3 pr-9 text-ink-800 hover:border-ink-400 focus:border-ink-900 focus:outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.6rem] text-ink-400"
            >
              ▾
            </span>
          </div>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="step-xs mr-1 text-ink-400">Filtering by</span>
          {chips.map((chip) => (
            <button
              key={String(chip.key)}
              type="button"
              onClick={() => {
                trackTap('clear-filter', 'catalog-toolbar', {
                  ...(params.subcategory ? { categorySlug: params.subcategory } : {}),
                });
                startTransition(() => {
                  router.push(buildCatalogHref(params, { [chip.key]: undefined }, basePath));
                });
              }}
              className={cn(
                'btn-press step-xs inline-flex items-center gap-2 border border-border bg-cream-100 px-2.5 py-1.5 text-ink-700',
                'hover:border-ink-500 hover:text-ink-900',
              )}
            >
              {formatChip(chip.key, chip.value, facets)}
              <span aria-hidden="true" className="text-ink-400">
                ×
              </span>
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                router.push(basePath);
              })
            }
            className="step-xs ml-1 px-2 py-1.5 text-ink-500 underline underline-offset-4 hover:text-claret-700"
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}

function formatChip(key: string, value: unknown, facets?: CatalogFacets | null): string {
  if (key === 'subcategory') {
    const slug = String(value);
    const category = facets?.categories.find((entry) => entry.slug === slug);
    // Fall back to the slug de-slugified rather than to a hardcoded map: a
    // category id always contains its own readable name.
    return category?.displayName ?? slug.replace(/-/g, ' ');
  }
  if (key === 'inStock') {
    return value === true ? 'In stock' : 'Out of stock';
  }
  if (key === 'minPrice' || key === 'maxPrice') {
    return `${key === 'minPrice' ? 'Min' : 'Max'} ${rupees(Number(value))}`;
  }
  if (key === 'size') {
    return `UK ${String(value)}`;
  }
  return String(value);
}
