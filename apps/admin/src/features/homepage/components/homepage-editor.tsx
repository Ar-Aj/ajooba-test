'use client';

import { useMemo, useState } from 'react';
import type { HomepageSectionInput, ResolvedHomepageSection } from '@ajooba/contracts';
import { HOMEPAGE_SECTION_TYPES, SECTION_LAYOUTS, PRODUCT_SOURCE_MODES } from '@ajooba/contracts';
import { ProductPicker } from './product-picker';

/**
 * The homepage merchandising editor.
 *
 * What this screen promises, and how each promise is kept:
 *
 *  - **Real operations.** "Save" PUTs the whole page to the API. There is no
 *    local-only state pretending to be persisted; the response is the source
 *    of truth for what is now live.
 *  - **Real catalogue data.** Products come from the picker, which searches
 *    the database. Categories come from the catalogue's four real
 *    sub-categories — none are invented here.
 *  - **Honest feedback.** The server's own error text is shown verbatim, and
 *    a failed save leaves the editor holding the user's unsaved draft so
 *    nothing is silently lost.
 */

const CATEGORY_OPTIONS = [
  { slug: 'mojri-jutti', label: 'Mojri & Jutti' },
  { slug: 'shoe', label: 'Formal Shoes' },
  { slug: 'sandal', label: 'Sandals' },
  { slug: 'chappal', label: 'Chappal' },
];

type Draft = {
  key: string;
  position: number;
  isVisible: boolean;
  startsAt: string | null;
  endsAt: string | null;
  config: HomepageSectionInput;
};

/** A blank section of the chosen type, with sensible defaults. */
function blankSection(type: HomepageSectionInput['type']): HomepageSectionInput {
  const shared = {
    position: 0,
    isVisible: true,
    startsAt: null,
    endsAt: null,
  };
  switch (type) {
    case 'hero':
      return {
        ...shared,
        type: 'hero',
        heading: 'Hand-finished mojris for the celebrations ahead',
        subheading: '',
        bannerId: '',
        ctaHref: '/products',
        ctaLabel: 'Shop the collection',
      } as HomepageSectionInput;
    case 'category-grid':
      return {
        ...shared,
        type: 'category-grid',
        heading: 'Shop by category',
        subheading: '',
        layout: 'grid',
        categorySlugs: ['mojri-jutti', 'shoe', 'sandal', 'chappal'],
      } as HomepageSectionInput;
    case 'new-arrivals':
      return {
        ...shared,
        type: 'new-arrivals',
        heading: 'New arrivals',
        subheading: '',
        layout: 'grid',
        mode: 'automatic',
        productIds: [],
        limit: 8,
      } as HomepageSectionInput;
    case 'featured':
      return {
        ...shared,
        type: 'featured',
        heading: "Ajooba's Mehbooba",
        subheading:
          'One prized design across every shade. Hover or touch the studio frame to zoom into the stitch work, slide to compare colourways side by side, or fan the 3D colour deck.',
        layout: 'spotlight',
        mode: 'manual',
        productIds: [],
        limit: 1,
        spotlightProductId: null,
      } as HomepageSectionInput;
    case 'trending':
      return {
        ...shared,
        type: 'trending',
        heading: 'Popular picks',
        subheading: '',
        layout: 'grid',
        mode: 'manual',
        productIds: [],
        limit: 4,
      } as HomepageSectionInput;
    case 'deal':
      /*
       * The campaign window lives on the section's own `startsAt`/`endsAt`
       * (the Draft), not on the config, so the countdown and the
       * visibility check can never disagree about when it ends.
       */
      return {
        ...shared,
        type: 'deal',
        heading: 'Limited-time offer',
        subheading: '',
        layout: 'grid',
        mode: 'manual',
        productIds: [],
        limit: 4,
        discountType: 'percentage',
        discountValue: 10,
      } as HomepageSectionInput;
    case 'colour-shop':
      return {
        ...shared,
        type: 'colour-shop',
        heading: 'Shop by colour',
        subheading: '',
        colours: [],
        limit: 8,
      } as HomepageSectionInput;
    case 'collection-spotlight':
      return {
        ...shared,
        type: 'collection-spotlight',
        heading: 'Occasion wear',
        subheading: '',
        layout: 'rail',
        categorySlug: 'mojri-jutti',
        mode: 'category',
        productIds: [],
        limit: 8,
      } as HomepageSectionInput;
  }
}

export function HomepageEditor({
  initialSections,
  initialVersion,
}: {
  initialSections: ResolvedHomepageSection[];
  initialVersion: number;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initialSections.map((section) => ({
      key: section.id,
      position: section.position,
      isVisible: section.isVisible,
      startsAt: section.startsAt,
      endsAt: section.endsAt,
      config: section.config as unknown as HomepageSectionInput,
    })),
  );
  const [version, setVersion] = useState(initialVersion);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [previewWidth, setPreviewWidth] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');

  const totalSelected = useMemo(
    () =>
      drafts.reduce(
        (sum, d) => sum + ((d.config as { productIds?: string[] }).productIds?.length ?? 0),
        0,
      ),
    [drafts],
  );

  function addSection(type: HomepageSectionInput['type']) {
    setDrafts((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        position: prev.length,
        isVisible: true,
        // A deal needs a real campaign window, or it would never go live.
        startsAt: type === 'deal' ? new Date(Date.now() - 60_000).toISOString() : null,
        endsAt: type === 'deal' ? new Date(Date.now() + 86_400_000).toISOString() : null,
        config: blankSection(type),
      },
    ]);
  }

  function updateConfig(key: string, patch: Record<string, unknown>) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === key ? { ...d, config: { ...d.config, ...patch } as HomepageSectionInput } : d,
      ),
    );
  }

  function move(index: number, direction: -1 | 1) {
    setDrafts((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const current = next[index];
      const neighbour = next[target];
      // Both are defined: `target` is bounds-checked above.
      next[index] = neighbour as Draft;
      next[target] = current as Draft;
      return next.map((d, i) => ({ ...d, position: i }));
    });
  }

  function remove(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key).map((d, i) => ({ ...d, position: i })));
  }

  async function handleSave(publish: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          publish,
          sections: drafts.map((d, i) => ({
            position: i,
            isVisible: d.isVisible,
            startsAt: d.startsAt,
            endsAt: d.endsAt,
            config: d.config,
          })),
        }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        data?: { sections: ResolvedHomepageSection[]; version?: number };
        error?: { message: string };
      };

      if (!response.ok || !body.ok) {
        // The draft is intentionally left in place so the work is not lost.
        setMessage({
          kind: 'error',
          text: body.error?.message ?? 'Save failed. Your changes have not been published.',
        });
        return;
      }

      const saved = body.data?.sections ?? [];
      setDrafts(
        saved.map((section) => ({
          key: section.id,
          position: section.position,
          isVisible: section.isVisible,
          startsAt: section.startsAt,
          endsAt: section.endsAt,
          config: section.config as unknown as HomepageSectionInput,
        })),
      );
      /*
       * Adopt the server's new concurrency token so a follow-up save
       * succeeds. Fabricating one here (e.g. Date.now()) would lock the
       * editor out of its second save.
       */
      if (typeof body.data?.version === 'number') {
        setVersion(body.data.version);
      }
      setMessage({
        kind: 'ok',
        text: publish
          ? `Published ${saved.length} section(s).`
          : `Saved draft with ${saved.length} section(s).`,
      });
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the API. Your changes are still here.' });
    } finally {
      setBusy(false);
    }
  }

  const previewClass =
    previewWidth === 'mobile'
      ? 'max-w-[390px]'
      : previewWidth === 'tablet'
        ? 'max-w-[768px]'
        : 'max-w-none';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-500">
            {drafts.length} section(s) · {totalSelected} product reference(s)
          </span>
        </div>

        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`mt-4 rounded-lg border p-3 text-sm ${
              message.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-green-200 bg-green-50 text-green-800'
            }`}
          >
            {message.text}
          </p>
        ) : null}

        <div className="mt-6 space-y-4">
          {drafts.map((draft, index) => (
            <section key={draft.key} className="rounded-xl border border-neutral-200 bg-white p-5">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-neutral-900">
                  {index + 1}.{' '}
                  {String((draft.config as { heading?: string }).heading ?? draft.config.type)}
                </h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-neutral-600">
                    <input
                      type="checkbox"
                      checked={draft.isVisible}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((d) =>
                            d.key === draft.key ? { ...d, isVisible: e.target.checked } : d,
                          ),
                        )
                      }
                    />
                    Visible
                  </label>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move section up"
                    className="rounded border border-neutral-200 px-2 py-1 text-xs disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === drafts.length - 1}
                    aria-label="Move section down"
                    className="rounded border border-neutral-200 px-2 py-1 text-xs disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(draft.key)}
                    aria-label="Remove section"
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-700"
                  >
                    Remove
                  </button>
                </div>
              </header>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-neutral-600">
                  Heading
                  <input
                    type="text"
                    value={String((draft.config as { heading?: string }).heading ?? '')}
                    onChange={(e) => updateConfig(draft.key, { heading: e.target.value })}
                    className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                  />
                </label>

                <label className="block text-xs text-neutral-600">
                  Short copy
                  <input
                    type="text"
                    value={String((draft.config as { subheading?: string }).subheading ?? '')}
                    onChange={(e) => updateConfig(draft.key, { subheading: e.target.value })}
                    className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                  />
                </label>

                {'layout' in draft.config ? (
                  <label className="block text-xs text-neutral-600">
                    Layout
                    <select
                      value={(draft.config as { layout: string }).layout}
                      onChange={(e) => updateConfig(draft.key, { layout: e.target.value })}
                      className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    >
                      {SECTION_LAYOUTS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {'mode' in draft.config ? (
                  <label className="block text-xs text-neutral-600">
                    Product source
                    <select
                      value={(draft.config as { mode: string }).mode}
                      onChange={(e) => updateConfig(draft.key, { mode: e.target.value })}
                      className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    >
                      {PRODUCT_SOURCE_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {'limit' in draft.config ? (
                  <label className="block text-xs text-neutral-600">
                    Number of products
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={Number((draft.config as { limit: number }).limit ?? 8)}
                      onChange={(e) => updateConfig(draft.key, { limit: Number(e.target.value) })}
                      className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    />
                  </label>
                ) : null}

                {draft.config.type === 'category-grid' ? (
                  <fieldset className="sm:col-span-2">
                    <legend className="text-xs text-neutral-600">Categories</legend>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {CATEGORY_OPTIONS.map((category) => {
                        const current =
                          (draft.config as { categorySlugs: string[] }).categorySlugs ?? [];
                        const checked = current.includes(category.slug);
                        return (
                          <label key={category.slug} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                updateConfig(draft.key, {
                                  categorySlugs: checked
                                    ? current.filter((s) => s !== category.slug)
                                    : [...current, category.slug],
                                })
                              }
                            />
                            {category.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}

                {draft.config.type === 'collection-spotlight' ? (
                  <label className="block text-xs text-neutral-600">
                    Collection
                    <select
                      value={(draft.config as { categorySlug: string }).categorySlug}
                      onChange={(e) => updateConfig(draft.key, { categorySlug: e.target.value })}
                      className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                    >
                      {CATEGORY_OPTIONS.map((c) => (
                        <option key={c.slug} value={c.slug}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {draft.config.type === 'hero' ? (
                  <>
                    <label className="block text-xs text-neutral-600">
                      Banner id
                      <input
                        type="text"
                        value={(draft.config as { bannerId: string }).bannerId}
                        onChange={(e) => updateConfig(draft.key, { bannerId: e.target.value })}
                        placeholder="Existing banner id"
                        className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-neutral-600">
                      Link to
                      <input
                        type="text"
                        value={(draft.config as { ctaHref: string }).ctaHref}
                        onChange={(e) => updateConfig(draft.key, { ctaHref: e.target.value })}
                        className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </label>
                    <p className="sm:col-span-2 text-xs text-amber-800">
                      Banner artwork is 16:9. Upload and schedule it under Content → Banners; this
                      section only positions it.
                    </p>
                  </>
                ) : null}

                {draft.config.type === 'deal' ? (
                  <>
                    <label className="block text-xs text-neutral-600">
                      Discount
                      <div className="mt-1 flex gap-2">
                        <select
                          value={(draft.config as { discountType: string }).discountType}
                          onChange={(e) =>
                            updateConfig(draft.key, { discountType: e.target.value })
                          }
                          className="h-9 rounded-md border border-neutral-300 px-2 text-sm"
                        >
                          <option value="percentage">Percentage off</option>
                          <option value="fixed">Fixed rupees off</option>
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={Number((draft.config as { discountValue: number }).discountValue)}
                          onChange={(e) =>
                            updateConfig(draft.key, { discountValue: Number(e.target.value) })
                          }
                          className="h-9 w-24 rounded-md border border-neutral-300 px-2 text-sm"
                        />
                      </div>
                    </label>
                    <label className="block text-xs text-neutral-600">
                      Campaign starts
                      <input
                        type="datetime-local"
                        value={draft.startsAt?.slice(0, 16) ?? ''}
                        onChange={(e) =>
                          setDrafts((prev) =>
                            prev.map((d) =>
                              d.key === draft.key
                                ? {
                                    ...d,
                                    startsAt: e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : null,
                                  }
                                : d,
                            ),
                          )
                        }
                        className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-neutral-600">
                      Campaign ends
                      <input
                        type="datetime-local"
                        value={draft.endsAt?.slice(0, 16) ?? ''}
                        onChange={(e) =>
                          setDrafts((prev) =>
                            prev.map((d) =>
                              d.key === draft.key
                                ? {
                                    ...d,
                                    endsAt: e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : null,
                                  }
                                : d,
                            ),
                          )
                        }
                        className="mt-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm"
                      />
                    </label>
                    <p className="sm:col-span-2 text-xs text-neutral-500">
                      The countdown reads this stored end time, and the same value decides whether
                      the section is still live. Once it passes, the deal disappears on its own.
                    </p>
                  </>
                ) : null}

                {draft.config.type === 'colour-shop' ? (
                  <p className="sm:col-span-2 text-xs text-neutral-500">
                    Colours are intersected with the colours the catalogue actually sells, so a tile
                    can never advertise a colour that does not exist.
                  </p>
                ) : null}
              </div>

              {'productIds' in draft.config ? (
                <div className="mt-5 border-t border-neutral-100 pt-4">
                  {draft.config.type === 'featured' ? (
                    <>
                      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <strong>Ajooba&apos;s Mehbooba (Multi-Shade Buying Studio):</strong> Only
                        products with <strong>2 or more colour variants</strong> from the database
                        are shown below. Choose <strong>1 model</strong> to display all of its
                        colourways interactively on the homepage.
                      </p>
                      <ProductPicker
                        minColours={2}
                        singleSelect
                        selectedIds={
                          (draft.config as { spotlightProductId?: string | null })
                            .spotlightProductId
                            ? [
                                String(
                                  (draft.config as { spotlightProductId?: string | null })
                                    .spotlightProductId,
                                ),
                              ]
                            : ((draft.config as { productIds: string[] }).productIds ?? []).slice(
                                0,
                                1,
                              )
                        }
                        onToggle={(id) => {
                          updateConfig(draft.key, {
                            mode: 'manual',
                            layout: 'spotlight',
                            limit: 1,
                            productIds: [id],
                            spotlightProductId: id,
                          });
                        }}
                      />
                    </>
                  ) : (
                    <ProductPicker
                      selectedIds={(draft.config as { productIds: string[] }).productIds ?? []}
                      onToggle={(id) => {
                        const current = (draft.config as { productIds: string[] }).productIds ?? [];
                        updateConfig(draft.key, {
                          productIds: current.includes(id)
                            ? current.filter((p) => p !== id)
                            : [...current, id],
                        });
                      }}
                    />
                  )}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <select
            value=""
            onChange={(e) =>
              e.target.value && addSection(e.target.value as HomepageSectionInput['type'])
            }
            aria-label="Add a section"
            className="h-10 rounded-md border border-neutral-300 px-3 text-sm"
          >
            <option value="">Add a section…</option>
            {HOMEPAGE_SECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => handleSave(false)}
            disabled={busy}
            className="h-10 rounded-md border border-neutral-300 px-4 text-sm font-medium disabled:opacity-60"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={busy}
            className="btn btn-primary btn-sm"
          >
            Publish
          </button>
        </div>
      </div>

      {/* Live-ish preview at the three supported widths. */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="flex items-center gap-2">
          {(['mobile', 'tablet', 'desktop'] as const).map((width) => (
            <button
              key={width}
              type="button"
              onClick={() => setPreviewWidth(width)}
              aria-pressed={previewWidth === width}
              className={`rounded-md px-3 py-1.5 text-xs capitalize ${
                previewWidth === width
                  ? 'bg-ink-900 text-white'
                  : 'border border-neutral-300 text-neutral-700'
              }`}
            >
              {width}
            </button>
          ))}
        </div>

        <div
          className={`mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 ${previewClass} mx-auto`}
        >
          {drafts.length === 0 ? (
            <p className="p-8 text-center text-sm text-neutral-500">
              No sections yet. Add one to begin.
            </p>
          ) : (
            <ol className="divide-y divide-neutral-200">
              {drafts.map((draft) => {
                const config = draft.config as Record<string, unknown>;
                const hidden = !draft.isVisible;
                return (
                  <li
                    key={draft.key}
                    className={`p-4 ${hidden ? 'bg-neutral-100/70 opacity-60' : ''}`}
                  >
                    <p className="text-[0.75rem] uppercase tracking-widest text-neutral-400">
                      {draft.config.type}
                    </p>
                    <p className="mt-1 text-sm font-medium text-neutral-900">
                      {String(config.heading ?? 'Untitled section')}
                    </p>
                    {config.subheading ? (
                      <p className="mt-1 text-xs text-neutral-500">{String(config.subheading)}</p>
                    ) : null}
                    {Array.isArray(config.productIds) && config.productIds.length > 0 ? (
                      <p className="mt-2 text-xs text-brand-700">
                        {config.productIds.length} product(s) selected
                      </p>
                    ) : null}
                    {hidden ? (
                      <p className="mt-2 text-xs font-medium text-neutral-500">Hidden</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
