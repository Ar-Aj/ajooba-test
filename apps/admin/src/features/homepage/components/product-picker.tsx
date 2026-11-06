'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import type { ProductPickerRow } from '@ajooba/contracts';
import { adminPath } from '@/lib/public-path';

/**
 * The admin product picker.
 *
 * It searches the **real** catalogue through the API and shows each row's
 * parent identifier, category, colours and actual imagery. Problems are
 * surfaced explicitly rather than hidden: a product with no image or no
 * sellable variant is badged so an administrator cannot promote it without
 * knowing.
 *
 * When `minColours` is provided (e.g. `minColours={2}` for Ajooba's Mehbooba),
 * only products with at least that many colour variants in the database are
 * listed, and `singleSelect` restricts selection to 1 displayed model.
 */
export function ProductPicker({
  selectedIds,
  onToggle,
  minColours,
  singleSelect = false,
}: {
  selectedIds: readonly string[];
  onToggle: (productId: string) => void;
  minColours?: number;
  singleSelect?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ProductPickerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams({ page: '1', pageSize: '60' });
          if (search) params.set('search', search);

          const response = await fetch(
            adminPath('/api/admin/proxy?path=/homepage/products&params=' + params.toString()),
            { signal: controller.signal },
          );
          const body = (await response.json()) as {
            ok: boolean;
            data?: { items: ProductPickerRow[] };
            error?: { message: string };
          };

          if (!response.ok || !body.ok) {
            setError(body.error?.message ?? 'Could not load products.');
            return;
          }
          setRows(body.data?.items ?? []);
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            setError('Could not reach the API.');
          }
        } finally {
          setLoading(false);
        }
      },
      search ? 300 : 0,
    );

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [search]);

  const filteredRows = useMemo(() => {
    if (!minColours || minColours <= 1) return rows;
    return rows.filter((row) => row.colours.length >= minColours);
  }, [rows, minColours]);

  if (loading && rows.length === 0) {
    return <p className="py-6 text-sm text-neutral-500">Loading catalogue…</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="product-search" className="block text-sm font-medium text-neutral-700">
          {singleSelect && minColours && minColours >= 2
            ? `Choose 1 model with ${minColours}+ colour variants (${filteredRows.length} eligible in database)`
            : 'Search the catalogue'}
        </label>
        {singleSelect ? (
          <span className="text-xs font-medium text-brand-700">
            Single-model showcase · click any model below to display its colour variants
          </span>
        ) : null}
      </div>

      <input
        id="product-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Title or design code, e.g. A57, A46"
        className="mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 text-sm focus:border-brand-600 focus:outline-none"
      />

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {filteredRows.length === 0 && !loading ? (
        <p className="mt-4 text-sm text-neutral-500">
          {minColours && minColours >= 2
            ? `No catalogue entries with ${minColours}+ colour variants matched your search.`
            : 'No catalogue entries matched. The catalogue may be empty in this environment.'}
        </p>
      ) : null}

      <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1">
        {filteredRows.map((row) => {
          const selected = selectedIds.includes(row.id);
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onToggle(row.id)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                  selected
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                }`}
              >
                <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-neutral-100">
                  {row.imageUrl ? (
                    <Image
                      src={row.imageUrl}
                      alt={row.title}
                      width={48}
                      height={48}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[0.75rem] text-neutral-400">
                      No image
                    </span>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900">
                    {row.title}
                  </span>
                  <span className="block truncate text-xs text-neutral-500">
                    <code className="font-mono">{row.code}</code> · {row.subcategory} · ₹
                    {row.sellingPrice}
                  </span>
                  {row.colours.length > 0 ? (
                    <span className="mt-0.5 block truncate text-xs font-medium text-neutral-700">
                      {row.colours.length} {row.colours.length === 1 ? 'colour' : 'colours'}:{' '}
                      {row.colours.join(', ')}
                    </span>
                  ) : null}
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  {!row.hasImage ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[0.75rem] font-medium text-amber-800">
                      No image
                    </span>
                  ) : null}
                  {!row.hasSellableVariant ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[0.75rem] font-medium text-red-800">
                      Not purchasable
                    </span>
                  ) : null}
                  {row.hasQuarantinedImages ? (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[0.75rem] font-medium text-neutral-600">
                      Quarantined images
                    </span>
                  ) : null}
                  {selected ? (
                    <span className="text-[0.75rem] font-semibold text-brand-700">
                      {singleSelect ? 'Displayed model' : 'Selected'}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
