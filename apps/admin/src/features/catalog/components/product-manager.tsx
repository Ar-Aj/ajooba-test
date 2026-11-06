'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AdminColourView,
  AdminProductView,
  AdminVariantView,
  CategoryView,
} from '@ajooba/contracts';
import {
  AdminApiError,
  archiveProduct,
  createProduct,
  createVariant,
  getProduct,
  listCategories,
  listColours,
  listProducts,
  listVariants,
  retireVariant,
  setStock,
  updateProduct,
  updateVariant,
} from '@/lib/catalog-api';

/**
 * The product manager (G-1) with its colourways and SKUs (G-2, G-3).
 *
 * ## The rules this screen has to respect
 *
 *  - **Address products by `code`.** The design code (`A01`) is the stable
 *    identifier; the slug is derived by the server from the title and changes
 *    whenever the title does, so it is never used as a key in this file.
 *  - **Never let a form make something sellable.** A new SKU is created at
 *    zero stock. Raising it requires the stock dialog, which demands a
 *    reason and the level the administrator believes is on hand.
 *  - **Only the server decides.** Every write re-reads the row from the API
 *    before the screen shows it as saved.
 */

type Notice = { kind: 'ok' | 'error'; text: string } | null;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  published: 'bg-green-100 text-green-900',
  archived: 'bg-red-100 text-red-900',
};

/** The editable fields of a design. */
interface ProductForm {
  title: string;
  description: string;
  subcategory: string;
  subcategorySlug: string;
  seoTitle: string;
  seoDescription: string;
  status: 'draft' | 'published' | 'archived';
}

export function ProductManager() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<AdminProductView[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [selected, setSelected] = useState<AdminProductView | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listProducts({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        pageSize: 24,
      });
      setProducts([...result.items]);
      setTotalItems(result.totalItems);
      setTotalPages(result.totalPages);
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Could not load products.') });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      try {
        const result = await listCategories();
        setCategories(result.items);
      } catch {
        // The category list is a convenience for the form; a failure here
        // must not hide the product list.
      }
    })();
  }, []);

  /** Re-read the one open design so the panel shows stored truth. */
  async function openDesign(code: string) {
    try {
      const product = await getProduct(code);
      setSelected(product);
      return product;
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error, 'Could not open the design.') });
      return null;
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      {/* A decision is only confirmed once the server has accepted it, so
          the notice here always describes stored state. */}
      {notice ? (
        <p
          role="status"
          className={`col-span-full rounded border px-3 py-2 text-sm ${
            notice.kind === 'ok'
              ? 'border-green-300 bg-green-50 text-green-900'
              : 'border-red-300 bg-red-50 text-red-900'
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <section aria-labelledby="design-list-heading">
        <div className="flex items-center justify-between">
          <h2 id="design-list-heading" className="text-sm font-medium">
            Designs
          </h2>
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            {creating ? 'Cancel' : 'New design'}
          </button>
        </div>

        {creating ? (
          <CreateDesignForm
            categories={categories}
            onDone={async (code) => {
              setCreating(false);
              await reload();
              const opened = await openDesign(code);
              if (opened) {
                setNotice({ kind: 'ok', text: `Design ${code} created.` });
              }
            }}
            onNotice={setNotice}
          />
        ) : null}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="sr-only">Search designs</span>
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search title or code"
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="sr-only">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>

        <p className="mt-2 text-xs text-neutral-500">
          {loading ? 'Loading…' : `${totalItems} design(s)`}
        </p>

        <ul className="mt-3 space-y-2">
          {products.map((product) => (
            <li key={product.code}>
              <button
                type="button"
                onClick={() => void openDesign(product.code)}
                aria-current={selected?.code === product.code}
                className={`w-full rounded border p-3 text-left hover:bg-neutral-50 ${
                  selected?.code === product.code
                    ? 'border-neutral-900 bg-neutral-50'
                    : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-neutral-600">{product.code}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLES[product.status]}`}>
                    {product.status}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-medium">{product.title}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {product.variantCount} SKU(s) · {product.totalStock} in stock ·{' '}
                  {product.colours.length} colour(s)
                </p>
                {product.pendingReviewColours.length > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {product.pendingReviewColours.length} colour(s) without a verified photo
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {totalPages > 1 ? (
          <nav className="mt-4 flex items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              className="rounded border border-neutral-300 px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-neutral-600">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              className="rounded border border-neutral-300 px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        ) : null}
      </section>

      <section aria-labelledby="design-detail-heading">
        <h2 id="design-detail-heading" className="text-sm font-medium">
          {selected ? `Design ${selected.code}` : 'No design selected'}
        </h2>

        {selected ? (
          <DesignPanel
            key={selected.code}
            product={selected}
            categories={categories}
            onNotice={setNotice}
            onChanged={async () => {
              await reload();
              await openDesign(selected.code);
            }}
          />
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-600">
            Choose a design on the left to edit it, manage its colourways, or set stock per SKU.
          </p>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create a design (G-1)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Create a parent design.
 *
 * `slug` is absent by design: the server derives it from the title and
 * de-duplicates it, so supplying one would create a second URL for the same
 * design. `status` defaults to `draft` here rather than `published`, so a
 * half-filled design cannot go live by accident.
 */
function CreateDesignForm({
  categories,
  onDone,
  onNotice,
}: {
  categories: CategoryView[];
  onDone: (code: string) => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subcategorySlug, setSubcategorySlug] = useState('');
  const [colours, setColours] = useState('');
  const [mrp, setMrp] = useState(0);
  const [price, setPrice] = useState(0);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await createProduct({
        code: code.trim().toUpperCase(),
        title,
        description,
        subcategory: categories.find((c) => c.slug === subcategorySlug)?.displayName ?? '',
        subcategorySlug,
        colours: colours
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        mrp,
        sellingPrice: price,
        status: 'draft',
      });
      await onDone(created.code);
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Design not created.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-medium">New design</h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Design code">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            required
            maxLength={3}
            placeholder="A61"
            pattern="^A\d{2}$"
            title="Two letters-and-digits form, e.g. A61"
            className="w-full rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
          />
        </Field>

        <Field label="Category">
          <select
            value={subcategorySlug}
            onChange={(event) => setSubcategorySlug(event.target.value)}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">Choose a category…</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.displayName}
                {category.status === 'retired' ? ' (retired)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" full>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={3}
            maxLength={200}
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="Description" full>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={3}
            maxLength={5000}
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="Colours sold" full>
          <input
            value={colours}
            onChange={(event) => setColours(event.target.value)}
            required
            placeholder="Ivory, Maroon"
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <span className="mt-1 block text-[0.75rem] text-neutral-500">
            Comma-separated. These are the only colours this design may ever be assigned to.
          </span>
        </Field>

        <Field label="MRP">
          <input
            value={mrp}
            onChange={(event) => setMrp(Number(event.target.value))}
            type="number"
            min={0}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="Selling price">
          <input
            value={price}
            onChange={(event) => setPrice(Number(event.target.value))}
            type="number"
            min={0}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </Field>
      </div>

      <button type="submit" disabled={saving} className="btn btn-primary btn-sm mt-4">
        {saving ? 'Creating…' : 'Create design as draft'}
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Design detail                                                             */
/* -------------------------------------------------------------------------- */

function DesignPanel({
  product,
  categories,
  onNotice,
  onChanged,
}: {
  product: AdminProductView;
  categories: CategoryView[];
  onNotice: (notice: Notice) => void;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<ProductForm>({
    title: product.title,
    description: product.description,
    subcategory: product.subcategory,
    subcategorySlug: product.subcategorySlug,
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    status: product.status,
  });
  const [saving, setSaving] = useState(false);
  const [colours, setColours] = useState<AdminColourView[]>([]);
  const [variants, setVariants] = useState<AdminVariantView[]>([]);
  const [addingColour, setAddingColour] = useState(false);

  const reloadVariants = useCallback(async () => {
    try {
      const [colourResult, variantResult] = await Promise.all([
        listColours(product.code),
        listVariants(product.code, { pageSize: 100 }),
      ]);
      setColours([...colourResult.items]);
      setVariants([...variantResult.items]);
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Could not load colourways.') });
    }
  }, [product.code, onNotice]);

  useEffect(() => {
    void reloadVariants();
  }, [reloadVariants]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      /*
       * The payload deliberately omits `code`, `slug`, `colours`, `mrp` and
       * `sellingPrice`: the code is the identity the API addresses by, the
       * slug is server-derived, and price comes from the SKUs. Sending any
       * of them from a form is how a design ends up duplicated.
       */
      await updateProduct(product.code, {
        title: form.title,
        description: form.description,
        subcategory: form.subcategory,
        subcategorySlug: form.subcategorySlug,
        seoTitle: form.seoTitle,
        seoDescription: form.seoDescription,
        status: form.status,
      });
      await onChanged();
      onNotice({ kind: 'ok', text: `${product.code} saved.` });
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Not saved.') });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    const confirmed = window.confirm(
      `Archive ${product.code}?\n\nIt leaves the storefront. Existing orders keep their history and nothing is deleted.`,
    );
    if (!confirmed) return;

    try {
      await archiveProduct(product.code);
      await onChanged();
      onNotice({ kind: 'ok', text: `${product.code} archived. Order history is untouched.` });
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Not archived.') });
    }
  }

  return (
    <div className="mt-3 space-y-6">
      <form onSubmit={save} className="rounded-lg border border-neutral-200 bg-white p-4">
        <h3 className="text-sm font-medium">Design details</h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Design code">
            {/* Immutable. The API keys the product by it. */}
            <input
              value={product.code}
              readOnly
              className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 font-mono text-sm"
            />
          </Field>

          <Field label="Status">
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value as ProductForm['status'] })
              }
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </Field>

          <Field label="Title" full>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
              minLength={3}
              maxLength={200}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Description" full>
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              required
              rows={3}
              maxLength={5000}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Category">
            <select
              value={form.subcategorySlug}
              onChange={(event) => {
                const slug = event.target.value;
                const match = categories.find((category) => category.slug === slug);
                setForm({
                  ...form,
                  subcategorySlug: slug,
                  // The display label follows the canonical category, so the
                  // two can never drift apart.
                  subcategory: match?.displayName ?? form.subcategory,
                });
              }}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">Choose a category…</option>
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.displayName}
                  {category.status === 'retired' ? ' (retired)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="SEO title">
            <input
              value={form.seoTitle}
              onChange={(event) => setForm({ ...form, seoTitle: event.target.value })}
              maxLength={200}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="SEO description" full>
            <textarea
              value={form.seoDescription}
              onChange={(event) => setForm({ ...form, seoDescription: event.target.value })}
              rows={2}
              maxLength={500}
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
            {saving ? 'Saving…' : 'Save design'}
          </button>
          <button
            type="button"
            onClick={() => void archive()}
            disabled={product.status === 'archived'}
            className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-800 hover:bg-red-50 disabled:opacity-40"
          >
            {product.status === 'archived' ? 'Already archived' : 'Archive design'}
          </button>
        </div>
      </form>

      {/* Colourways, then the SKUs inside them. */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Colourways ({colours.length}) and SKUs ({variants.length})
          </h3>
          <button
            type="button"
            onClick={() => setAddingColour((open) => !open)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            {addingColour ? 'Cancel' : 'Add colourway'}
          </button>
        </div>

        {addingColour ? (
          <AddVariantForm
            code={product.code}
            onDone={async () => {
              setAddingColour(false);
              await reloadVariants();
              onNotice({ kind: 'ok', text: 'Colourway added at zero stock.' });
            }}
            onNotice={onNotice}
          />
        ) : null}

        {colours.length === 0 ? (
          <p className="mt-4 rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">
            This design has no colourways yet, so it cannot be sold.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {colours.map((colour) => {
              const rows = variants.filter((variant) => variant.colour === colour.colour);
              return (
                <div key={colour.colour} className="rounded border border-neutral-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {colour.colour}{' '}
                        <span className="font-mono text-xs text-neutral-500">
                          ({colour.colourToken})
                        </span>
                      </p>
                      <p className="text-xs text-neutral-500">
                        {colour.verifiedImageCount} verified photo(s) · {colour.totalStock} in stock
                      </p>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        colour.photographyStatus === 'verified'
                          ? 'bg-green-100 text-green-900'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {colour.photographyStatus === 'verified'
                        ? 'Photography verified'
                        : 'No verified photo yet'}
                    </span>
                  </div>

                  {colour.verifiedImageCount === 0 ? (
                    <p className="px-3 py-2 text-xs text-amber-800">
                      This colour appears in no storefront gallery and none of its sizes can be
                      bought. Resolve it in the image review queue.
                    </p>
                  ) : null}

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2">Price</th>
                        <th className="px-3 py-2">Stock</th>
                        <th className="px-3 py-2">Sellable</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((variant) => (
                        <VariantRow
                          key={variant.sku}
                          variant={variant}
                          onNotice={onNotice}
                          onChanged={reloadVariants}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One SKU                                                                   */
/* -------------------------------------------------------------------------- */

function VariantRow({
  variant,
  onNotice,
  onChanged,
}: {
  variant: AdminVariantView;
  onNotice: (notice: Notice) => void;
  onChanged: () => Promise<void>;
}) {
  const [price, setPrice] = useState(variant.sellingPrice);
  const [mrp, setMrp] = useState(variant.mrp);
  const [saving, setSaving] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);

  async function savePrice() {
    setSaving(true);
    try {
      await updateVariant(variant.sku, { sellingPrice: price, mrp });
      await onChanged();
      onNotice({ kind: 'ok', text: `${variant.sku} price saved.` });
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Price not saved.') });
    } finally {
      setSaving(false);
    }
  }

  async function retire() {
    const confirmed = window.confirm(
      `Retire ${variant.sku}?\n\nIts stock is set to zero and it leaves sale. The SKU is kept, because historical orders reference it.`,
    );
    if (!confirmed) return;

    try {
      await retireVariant(variant.sku);
      await onChanged();
      onNotice({ kind: 'ok', text: `${variant.sku} retired.` });
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Not retired.') });
    }
  }

  return (
    <>
      <tr className="border-b border-neutral-100">
        <td className="px-3 py-2 font-mono text-xs">{variant.sku}</td>
        <td className="px-3 py-2">
          <input
            value={variant.size}
            readOnly
            aria-label={`Size for ${variant.sku}`}
            className="w-16 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-sm"
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            <input
              value={mrp}
              onChange={(event) => setMrp(Number(event.target.value))}
              aria-label={`MRP for ${variant.sku}`}
              className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <input
              value={price}
              onChange={(event) => setPrice(Number(event.target.value))}
              aria-label={`Selling price for ${variant.sku}`}
              className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
        </td>
        <td className="px-3 py-2 tabular-nums">
          {variant.stock}
          {variant.reservedStock > 0 ? (
            <span className="ml-1 text-xs text-neutral-500">({variant.reservedStock} held)</span>
          ) : null}
        </td>
        <td className="px-3 py-2">
          {variant.sellable ? (
            <span className="text-green-800">Yes</span>
          ) : (
            <span className="text-neutral-500">
              {variant.photographyStatus === 'verified' ? 'Out of stock' : 'No verified photo'}
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap justify-end gap-1">
            <button
              type="button"
              onClick={() => void savePrice()}
              disabled={saving}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setStockOpen((open) => !open)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
            >
              Stock
            </button>
            <button
              type="button"
              onClick={() => void retire()}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50"
            >
              Retire
            </button>
          </div>
        </td>
      </tr>

      {stockOpen ? (
        <tr className="border-b border-neutral-100 bg-amber-50/60">
          <td colSpan={6} className="px-3 py-3">
            <StockDialog
              sku={variant.sku}
              currentStock={variant.stock}
              onCancel={() => setStockOpen(false)}
              onDone={async (text) => {
                setStockOpen(false);
                await onChanged();
                onNotice({ kind: 'ok', text });
              }}
              onNotice={onNotice}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The only way to give a SKU stock.
 *
 * Nothing here invents a quantity: the administrator types the count they
 * observed, and the API demands the level they believed was on hand so a
 * stale tab cannot overwrite someone else's count.
 */
function StockDialog({
  sku,
  currentStock,
  onCancel,
  onDone,
  onNotice,
}: {
  sku: string;
  currentStock: number;
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('audit');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await setStock(sku, {
        quantity,
        reason,
        note,
        // The level this dialog was opened against. The API rejects the
        // write if it has moved since, which is the whole point.
        expectedCurrentStock: currentStock,
      });
      await onDone(`${sku} stock set to ${result.stockAfter}.`);
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Stock not changed.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="text-sm">
      <p className="font-medium">
        Set stock for <span className="font-mono">{sku}</span> — currently {currentStock}
      </p>
      <p className="mt-1 text-xs text-neutral-600">
        Enter the count you actually observed. Nothing is defaulted to a purchasable number.
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label="Quantity on hand">
          <input
            value={quantity}
            onChange={(event) => setQuantity(Math.max(0, Number(event.target.value)))}
            type="number"
            min={0}
            required
            className="w-24 rounded border border-neutral-300 px-2 py-1"
          />
        </Field>

        <Field label="Reason">
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="rounded border border-neutral-300 px-2 py-1"
          >
            <option value="audit">Stock audit</option>
            <option value="restock">Restock received</option>
            <option value="correction">Correction</option>
          </select>
        </Field>

        <Field label="Note">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="e.g. Physical count, Jaipur warehouse"
            className="w-56 rounded border border-neutral-300 px-2 py-1"
          />
        </Field>

        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Saving…' : 'Set stock'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Add a colourway                                                            */
/* -------------------------------------------------------------------------- */

function AddVariantForm({
  code,
  onDone,
  onNotice,
}: {
  code: string;
  onDone: () => Promise<void>;
  onNotice: (notice: Notice) => void;
}) {
  const [colour, setColour] = useState('');
  const [colourToken, setColourToken] = useState('');
  const [size, setSize] = useState(6);
  const [sku, setSku] = useState('');
  const [articleNumber, setArticleNumber] = useState(code);
  const [mrp, setMrp] = useState(0);
  const [price, setPrice] = useState(0);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await createVariant(code, {
        colour,
        colourToken,
        size,
        sku,
        articleNumber,
        mrp,
        sellingPrice: price,
      });
      await onDone();
    } catch (error) {
      onNotice({ kind: 'error', text: messageOf(error, 'Colourway not created.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-sm font-medium">Add a colourway to {code}</p>
      <p className="mt-1 text-xs text-neutral-600">
        The new SKU is created at zero stock and is not sellable until a photograph is verified and
        stock is counted.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Field label="Colour">
          <input
            value={colour}
            onChange={(event) => setColour(event.target.value)}
            required
            placeholder="Ivory"
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </Field>
        <Field label="Token">
          <input
            value={colourToken}
            onChange={(event) => setColourToken(event.target.value.toUpperCase())}
            required
            maxLength={5}
            placeholder="IVY"
            className="w-full rounded border border-neutral-300 px-2 py-1 font-mono"
          />
        </Field>
        <Field label="Size">
          <input
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
            type="number"
            min={1}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </Field>
        <Field label="Seller SKU" full>
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value.toUpperCase())}
            required
            placeholder={`AJ-${code}-OW-06`}
            className="w-full rounded border border-neutral-300 px-2 py-1 font-mono"
          />
        </Field>
        <Field label="Article number">
          <input
            value={articleNumber}
            onChange={(event) => setArticleNumber(event.target.value)}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </Field>
        <Field label="MRP">
          <input
            value={mrp}
            onChange={(event) => setMrp(Number(event.target.value))}
            type="number"
            min={0}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </Field>
        <Field label="Selling price">
          <input
            value={price}
            onChange={(event) => setPrice(Number(event.target.value))}
            type="number"
            min={0}
            required
            className="w-full rounded border border-neutral-300 px-2 py-1"
          />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Creating…' : 'Create colourway'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block text-xs text-neutral-600 ${full ? 'sm:col-span-2' : ''}`}>
      <span className="block">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}
