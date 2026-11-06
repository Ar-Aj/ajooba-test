'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { COLOUR_RAW_VALUES, SIZE_VALUES, type CatalogFacets } from '@ajooba/contracts';
import { Sheet } from '@/components/ui/sheet';
import {
  buildCatalogHref,
  COLOUR_SWATCHES,
  hasActiveFilters,
  type CatalogParams,
} from '../lib/catalog-params';
import { rupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import { trackTap } from '@/lib/track';

/**
 * The filter rail.
 *
 * ## Categories are the live taxonomy, not a constant
 *
 * The categorical filter reads `facets.categories` — the API's own list of
 * published categories with live counts. It used to read
 * `FEATURED_SUBCATEGORIES`, a hardcoded four-entry array, which meant a
 * category created in the admin could never be filtered on: it had an entry in
 * the header and none here, and choosing it required hand-editing the URL.
 *
 * When the facet read fails, the panel degrades to no category list at all
 * rather than to a stale hardcoded one. A wrong list is worse than a short one.
 *
 * ## Why radio-like controls, but not radios
 *
 * Each group allows at most one active value per group, and every control is a
 * `button` with `aria-pressed`. Real radios imply a form that is submitted;
 * these navigate immediately, which is what the URL-driven state model does
 * best. `aria-pressed` announces the same exclusivity without promising a
 * submit step that does not exist.
 */
export function FilterPanel({
  params,
  basePath = '/products',
  onNavigate,
  facets,
}: {
  params: CatalogParams;
  basePath?: string;
  onNavigate?: () => void;
  facets?: CatalogFacets | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const headingId = useId();

  const countFor = (group: 'subcategories' | 'colours' | 'sizes', value: string) =>
    facets?.[group]?.find((facet) => facet.value === value)?.count;

  const push = (changes: Partial<CatalogParams>) => {
    /*
     * One tap, one record, classified by what the change does to the shelf
     * rather than by which control was used: removing a filter and adding one
     * are different facts, and "cleared everything" is a third. The category in
     * play travels with the tap so the report can say which department people
     * narrow *within*.
     */
    const isClear = Object.values(changes).every((value) => value === undefined);
    trackTap(isClear ? 'clear-filter' : 'apply-filter', 'catalog-filter', {
      ...(params.subcategory ? { categorySlug: params.subcategory } : {}),
    });

    startTransition(() => {
      router.push(buildCatalogHref(params, changes, basePath));
      onNavigate?.();
    });
  };

  const categories = facets?.categories ?? [];
  const active = hasActiveFilters(params);

  return (
    <div
      className={cn('transition-opacity duration-200', pending && 'opacity-50')}
      aria-busy={pending}
    >
      {active ? (
        <button
          type="button"
          onClick={() =>
            push({
              subcategory: undefined,
              colour: undefined,
              size: undefined,
              minPrice: undefined,
              maxPrice: undefined,
              inStock: undefined,
            })
          }
          className="step-xs mb-8 text-ink-500 underline underline-offset-4 hover:text-claret-700"
        >
          Clear all filters
        </button>
      ) : null}

      {/* --- category ------------------------------------------------------ */}
      <fieldset className="mb-9">
        <legend id={headingId} className="label-cap mb-3 text-ink-400">
          Category
        </legend>
        <div>
          <Option
            label="All footwear"
            count={facets ? categories.reduce((total, c) => total + c.productCount, 0) : undefined}
            checked={!params.subcategory}
            onClick={() => push({ subcategory: undefined })}
          />
          {categories.map((category) => (
            <Option
              key={category.slug}
              label={category.displayName}
              count={category.productCount || countFor('subcategories', category.slug)}
              checked={params.subcategory === category.slug}
              onClick={() =>
                push({
                  subcategory: params.subcategory === category.slug ? undefined : category.slug,
                })
              }
            />
          ))}
        </div>
      </fieldset>

      {/* --- colour -------------------------------------------------------- */}
      <fieldset className="mb-9">
        <legend className="label-cap mb-3 text-ink-400">Colour</legend>
        <div className="flex flex-wrap gap-1.5">
          {COLOUR_RAW_VALUES.map((colour) => {
            const on = params.colour === colour;
            const count = countFor('colours', colour);
            return (
              <button
                key={colour}
                type="button"
                aria-pressed={on}
                onClick={() => push({ colour: on ? undefined : colour })}
                className={cn(
                  'btn-press step-xs inline-flex items-center gap-1.5 border px-2.5 py-1.5',
                  on
                    ? 'border-ink-900 bg-ink-900 text-cream-50'
                    : 'border-border text-ink-700 hover:border-ink-400 hover:text-ink-900',
                  count === 0 && !on ? 'opacity-45' : undefined,
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 border border-ink-900/15"
                  style={{ backgroundColor: COLOUR_SWATCHES[colour] ?? '#ccc' }}
                />
                {colour}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* --- size ---------------------------------------------------------- */}
      <fieldset className="mb-9">
        <legend className="label-cap mb-3 text-ink-400">UK size</legend>
        <div className="grid grid-cols-6 gap-1">
          {SIZE_VALUES.map((size) => {
            const on = params.size === size;
            const count = countFor('sizes', String(size));
            return (
              <button
                key={size}
                type="button"
                aria-pressed={on}
                onClick={() => push({ size: on ? undefined : size })}
                aria-label={`Size ${size}${count !== undefined ? `, ${count} designs` : ''}`}
                className={cn(
                  'btn-press tnum step-xs h-9 border',
                  on
                    ? 'border-ink-900 bg-ink-900 text-cream-50'
                    : 'border-border text-ink-700 hover:border-ink-400 hover:text-ink-900',
                  count === 0 && !on ? 'text-ink-300' : undefined,
                )}
              >
                {size}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* --- price --------------------------------------------------------- */}
      <fieldset className="mb-9">
        <legend className="label-cap mb-3 text-ink-400">Price</legend>
        <PriceRangeInput
          min={params.minPrice}
          max={params.maxPrice}
          onApply={(min, max) => push({ minPrice: min, maxPrice: max })}
        />
      </fieldset>

      {/* --- availability -------------------------------------------------- */}
      <fieldset>
        <legend className="label-cap mb-3 text-ink-400">Availability</legend>
        <label className="step-sm flex cursor-pointer items-center gap-2.5 text-ink-700">
          <input
            type="checkbox"
            checked={params.inStock === true}
            onChange={(event) => push({ inStock: event.target.checked ? true : undefined })}
            className="h-3.5 w-3.5 accent-ink-900"
          />
          In stock only
        </label>
        <p className="step-xs mt-1.5 pl-6 text-ink-400">Hides designs with no available size.</p>
      </fieldset>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Option({
  label,
  count,
  checked,
  onClick,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onClick}
      className={cn(
        'step-sm flex w-full items-baseline justify-between gap-3 py-1.5 text-left transition-colors',
        checked ? 'font-medium text-ink-950' : 'text-ink-600 hover:text-ink-900',
      )}
    >
      <span className="flex items-baseline gap-2">
        {/* The marker is a small filled square, not a ticked radio: the list is
            a set of links, and a radio would promise a form submit. */}
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0 translate-y-[-2px]',
            checked ? 'bg-ink-900' : 'bg-transparent',
          )}
        />
        {label}
      </span>
      {count !== undefined ? <span className="tnum step-xs text-ink-400">{count}</span> : null}
    </button>
  );
}

function PriceRangeInput({
  min,
  max,
  onApply,
}: {
  min: number | undefined;
  max: number | undefined;
  onApply: (min?: number, max?: number) => void;
}) {
  const [minValue, setMinValue] = useState(min?.toString() ?? '');
  const [maxValue, setMaxValue] = useState(max?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const lo = minValue.trim() === '' ? undefined : Number.parseInt(minValue, 10);
        const hi = maxValue.trim() === '' ? undefined : Number.parseInt(maxValue, 10);

        if (
          (lo !== undefined && !Number.isFinite(lo)) ||
          (hi !== undefined && !Number.isFinite(hi))
        ) {
          setError('Enter whole numbers only.');
          return;
        }
        if (lo !== undefined && hi !== undefined && lo > hi) {
          setError('Minimum cannot be greater than maximum.');
          return;
        }
        setError(null);
        onApply(
          lo !== undefined && lo >= 0 ? lo : undefined,
          hi !== undefined && hi >= 0 ? hi : undefined,
        );
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="price-min" className="sr-only">
          Minimum price
        </label>
        <input
          id="price-min"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Min"
          value={minValue}
          onChange={(event) => setMinValue(event.target.value)}
          className="tnum step-sm h-9 w-full border border-border bg-transparent px-2 text-ink-900 placeholder:text-ink-300 focus:border-ink-900 focus:outline-none"
        />
        <span aria-hidden="true" className="text-ink-300">
          –
        </span>
        <label htmlFor="price-max" className="sr-only">
          Maximum price
        </label>
        <input
          id="price-max"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="Max"
          value={maxValue}
          onChange={(event) => setMaxValue(event.target.value)}
          className="tnum step-sm h-9 w-full border border-border bg-transparent px-2 text-ink-900 placeholder:text-ink-300 focus:border-ink-900 focus:outline-none"
        />
      </div>

      {error ? (
        <p role="alert" className="step-xs mt-1.5 text-claret-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn-press step-xs mt-2 w-full border border-border py-2 text-ink-700 hover:border-ink-500 hover:text-ink-900"
      >
        Apply price
      </button>

      <p className="step-xs mt-2 text-ink-400">
        {min !== undefined ? `From ${rupees(min)}` : 'No minimum'}
        {max !== undefined ? ` · up to ${rupees(max)}` : ''}
      </p>
    </form>
  );
}

/**
 * The phone entry point.
 *
 * A bottom sheet rather than an inline block, because the filter rail on a
 * 390px screen would push the first product below three screenfuls of controls.
 * The trigger reports how many filters are on, so the shopper does not have to
 * open it to find out why the shelf is short.
 */
export function MobileFilterTrigger({
  params,
  facets,
}: {
  params: CatalogParams;
  facets?: CatalogFacets | null;
}) {
  const [open, setOpen] = useState(false);

  const count = [
    params.subcategory,
    params.colour,
    params.size,
    params.minPrice,
    params.maxPrice,
    params.inStock,
  ].filter((value) => value !== undefined).length;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          trackTap('open-filter', 'catalog-filter');
        }}
        className="btn-press step-sm inline-flex h-10 items-center gap-2 border border-border px-4 text-ink-700 hover:border-ink-500 hover:text-ink-900 lg:hidden"
      >
        Filter
        {count > 0 ? (
          <span className="tnum inline-flex h-4 min-w-4 items-center justify-center bg-ink-900 px-1 text-[0.625rem] font-semibold text-cream-50">
            {count}
          </span>
        ) : null}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        side="bottom"
        title="Filter"
        description="Narrow the shelf. Counts are live."
        footer={
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn-press step-sm w-full bg-ink-900 py-3 font-medium text-cream-50 hover:bg-ink-800"
          >
            Show results
          </button>
        }
      >
        <FilterPanel params={params} facets={facets} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
