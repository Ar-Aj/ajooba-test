'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CategoryView } from '@ajooba/contracts';
import {
  AdminApiError,
  createCategory,
  listCategories,
  reorderCategories,
  retireCategory,
  seedCategories,
  updateCategory,
} from '@/lib/catalog-api';

/**
 * Category management (G-4).
 *
 * One canonical collection backs this screen and the storefront's category
 * navigation, so there is no second taxonomy to drift out of sync. Two
 * behaviours are enforced by the API rather than by this file, and are
 * surfaced here so an administrator understands why a save was refused:
 *
 *  - a category with products attached cannot be retired until they are
 *    reassigned;
 *  - a parent change that would create a cycle is rejected.
 */

type Notice = { kind: 'ok' | 'error'; text: string } | null;

interface CategoryForm {
  slug: string;
  displayName: string;
  description: string;
  parentSlug: string;
  seoTitle: string;
  seoDescription: string;
  isVisible: boolean;
}

const BLANK: CategoryForm = {
  slug: '',
  displayName: '',
  description: '',
  parentSlug: '',
  seoTitle: '',
  seoDescription: '',
  isVisible: true,
};

export function CategoryManager() {
  const [tree, setTree] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCategories();
      setTree(result.items);
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Could not load categories.') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Move a category one position among its siblings.
   *
   * The API renumbers positions so they stay contiguous, so the new order is
   * computed here over the whole sibling list and sent in full rather than
   * as a delta.
   */
  async function move(siblings: CategoryView[], slug: string, direction: -1 | 1) {
    const order = siblings.map((category) => category.slug);
    const index = order.indexOf(slug);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;

    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);

    try {
      const result = await reorderCategories(next);
      setTree(result.items);
      setNotice({ kind: 'ok', text: 'Order saved.' });
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Order not saved.') });
    }
  }

  async function retire(slug: string, productCount: number) {
    const confirmed = window.confirm(
      productCount > 0
        ? `Retire "${slug}"?\n\n${productCount} product(s) still reference it. The API will refuse until they are moved to another category.`
        : `Retire "${slug}"?\n\nIt stops appearing in navigation. Nothing is deleted.`,
    );
    if (!confirmed) return;

    try {
      await retireCategory(slug);
      await reload();
      setNotice({ kind: 'ok', text: `"${slug}" retired.` });
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Not retired.') });
    }
  }

  async function seed() {
    const confirmed = window.confirm(
      'Seed the category collection from the sub-categories already used by products?\n\nExisting categories are left alone; only new ones are added.',
    );
    if (!confirmed) return;

    try {
      const result = await seedCategories();
      await reload();
      setNotice({
        kind: 'ok',
        text: `Seeded. ${
          Object.values(result)
            .filter((value) => typeof value === 'number')
            .join(', ') || 'No new categories were needed.'
        }`,
      });
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Seed failed.') });
    }
  }

  const flat = flatten(tree);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Categories ({flat.length})</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void seed()}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Seed from products
          </button>
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className="btn btn-primary btn-sm"
          >
            {creating ? 'Cancel' : 'New category'}
          </button>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            notice.kind === 'ok'
              ? 'border-green-300 bg-green-50 text-green-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {creating ? (
        <CategoryForm
          slug={null}
          siblings={flat}
          onDone={async () => {
            setCreating(false);
            await reload();
            setNotice({ kind: 'ok', text: 'Category created.' });
          }}
          onCancel={() => setCreating(false)}
          onNotice={setNotice}
        />
      ) : null}

      {loading ? <p className="mt-4 text-sm text-neutral-600">Loading categories…</p> : null}

      {!loading && flat.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-600">
          No categories yet. Use &ldquo;Seed from products&rdquo; to create them from the
          sub-categories already in use, or add one manually.
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {tree.map((category) => (
          <li key={category.slug}>
            <CategoryRow
              category={category}
              depth={0}
              all={flat}
              isEditing={editing === category.slug}
              onEdit={() =>
                setEditing((current) => (current === category.slug ? null : category.slug))
              }
              onMove={move}
              onRetire={retire}
              onNotice={setNotice}
              onSaved={reload}
            />

            {category.children.length > 0 ? (
              <ul className="mt-2 space-y-2 pl-6">
                {category.children.map((child) => (
                  <li key={child.slug}>
                    <CategoryRow
                      category={child}
                      depth={1}
                      all={flat}
                      isEditing={editing === child.slug}
                      onEdit={() =>
                        setEditing((current) => (current === child.slug ? null : child.slug))
                      }
                      onMove={move}
                      onRetire={retire}
                      onNotice={setNotice}
                      onSaved={reload}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({
  category,
  depth,
  all,
  isEditing,
  onEdit,
  onMove,
  onRetire,
  onNotice,
  onSaved,
}: {
  category: CategoryView;
  depth: number;
  all: CategoryView[];
  isEditing: boolean;
  onEdit: () => void;
  onMove: (siblings: CategoryView[], slug: string, direction: -1 | 1) => Promise<void>;
  onRetire: (slug: string, productCount: number) => Promise<void>;
  onNotice: (notice: Notice) => void;
  onSaved: () => Promise<void>;
}) {
  /*
   * Siblings are the other categories at the same depth sharing a parent.
   * Ordering is scoped to that group so a move cannot silently reshuffle an
   * unrelated branch.
   */
  const siblings = all.filter(
    (entry) =>
      entry.position !== undefined &&
      (entry.parentSlug ?? null) === (category.parentSlug ?? null) &&
      entry.slug !== category.slug,
  );

  return (
    <div className="rounded border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{category.displayName}</p>
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                category.status === 'active'
                  ? 'bg-green-100 text-green-900'
                  : 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {category.status}
            </span>
            {!category.isVisible ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                Hidden from navigation
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-xs text-neutral-500">
            {category.slug} · {category.productCount} product(s)
          </p>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void onMove(siblings, category.slug, -1)}
            disabled={depth > 0 || siblings.length === 0}
            aria-label={`Move ${category.displayName} up`}
            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => void onMove(siblings, category.slug, 1)}
            disabled={depth > 0 || siblings.length === 0}
            aria-label={`Move ${category.displayName} down`}
            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
          >
            {isEditing ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={() => void onRetire(category.slug, category.productCount)}
            disabled={category.status === 'retired'}
            className="rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50 disabled:opacity-40"
          >
            Retire
          </button>
        </div>
      </div>

      {isEditing ? (
        <CategoryForm
          slug={category.slug}
          siblings={all}
          initial={category}
          onDone={async () => {
            onEdit();
            await onSaved();
            onNotice({ kind: 'ok', text: `"${category.displayName}" saved.` });
          }}
          onCancel={onEdit}
          onNotice={onNotice}
        />
      ) : null}
    </div>
  );
}

function CategoryForm({
  slug,
  siblings,
  initial,
  onDone,
  onCancel,
  onNotice,
}: {
  slug: string | null;
  siblings: CategoryView[];
  initial?: CategoryView;
  onDone: () => Promise<void>;
  onCancel: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [form, setForm] = useState<CategoryForm>(
    initial
      ? {
          slug: initial.slug,
          displayName: initial.displayName,
          description: initial.description,
          parentSlug: initial.parentSlug ?? '',
          seoTitle: initial.seoTitle ?? '',
          seoDescription: initial.seoDescription ?? '',
          isVisible: initial.isVisible,
        }
      : BLANK,
  );
  const [saving, setSaving] = useState(false);

  /*
   * The API rejects a parent change that would create a cycle. Offering only
   * top-level categories as parents keeps the tree at two levels, which is
   * what the storefront navigation renders.
   */
  const parentOptions = siblings.filter(
    (entry) => entry.parentSlug === null && entry.slug !== slug,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (initial) {
        await updateCategory(initial.slug, {
          displayName: form.displayName,
          description: form.description,
          parentSlug: form.parentSlug === '' ? null : form.parentSlug,
          seoTitle: form.seoTitle,
          seoDescription: form.seoDescription,
          isVisible: form.isVisible,
        });
      } else {
        await createCategory({
          slug: form.slug.trim().toLowerCase(),
          displayName: form.displayName,
          description: form.description,
          parentSlug: form.parentSlug === '' ? null : form.parentSlug,
          seoTitle: form.seoTitle,
          seoDescription: form.seoDescription,
        });
      }
      await onDone();
    } catch (error) {
      onNotice({
        kind: 'error',
        text: error instanceof AdminApiError ? error.message : 'Not saved.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-neutral-600">
          <span className="block">Slug</span>
          {/*
              The slug is the URL segment and the key the collection is
              addressed by, so it is fixed once products reference it.
          */}
          <input
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })}
            readOnly={Boolean(initial)}
            required
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            title="Lowercase kebab-case, e.g. mojri-jutti"
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-sm"
          />
        </label>

        <label className="block text-xs text-neutral-600">
          <span className="block">Display name</span>
          <input
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            required
            minLength={2}
            maxLength={80}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-xs text-neutral-600 sm:col-span-2">
          <span className="block">Description</span>
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={2}
            maxLength={500}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-xs text-neutral-600">
          <span className="block">Parent category</span>
          <select
            value={form.parentSlug}
            onChange={(event) => setForm({ ...form, parentSlug: event.target.value })}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">None (top level)</option>
            {parentOptions.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={form.isVisible}
            onChange={(event) => setForm({ ...form, isVisible: event.target.checked })}
            className="h-4 w-4"
          />
          Show in storefront navigation
        </label>

        <label className="block text-xs text-neutral-600">
          <span className="block">SEO title</span>
          <input
            value={form.seoTitle}
            onChange={(event) => setForm({ ...form, seoTitle: event.target.value })}
            maxLength={200}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-xs text-neutral-600">
          <span className="block">SEO description</span>
          <input
            value={form.seoDescription}
            onChange={(event) => setForm({ ...form, seoDescription: event.target.value })}
            maxLength={500}
            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="btn btn-primary btn-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save category' : 'Create category'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Depth-first flatten, so the parent select sees every existing category. */
function flatten(tree: CategoryView[]): CategoryView[] {
  return tree.flatMap((category) => [category, ...flatten([...category.children])]);
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}
