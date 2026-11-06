import { logger } from '../config/logger.js';
import { CategoryModel } from '../models/category.model.js';
import { ProductModel } from '../models/product.model.js';

/**
 * Category taxonomy reconciliation.
 *
 * ## The defect this exists to prevent
 *
 * The catalogue and the taxonomy are two collections that were populated by
 * different code paths. The importer wrote `products.subcategorySlug`; nothing
 * ever wrote `categories`. The result was a store that looked healthy — 55
 * designs, 674 SKUs, a filter panel — and a taxonomy table with **zero rows**.
 *
 * That one empty collection then caused every downstream symptom:
 *
 *  - the admin category screen rendered an empty list, so there was nothing to
 *    assign a design to;
 *  - saving a design failed `422 Unknown category`, because writes validate
 *    against `categories` (correctly — a product pointing at a bucket that
 *    does not exist is a real bug);
 *  - the homepage editor refused every category section;
 *  - the storefront fell back to a hardcoded four-slug array.
 *
 * Seeding from the products that already exist is therefore not a convenience
 * feature. It is the migration that makes the taxonomy agree with the
 * catalogue it describes, and it must run before anyone opens the admin panel
 * against a freshly imported store.
 *
 * ## Rules
 *
 * * **Additive only.** An existing category is never modified. Display names,
 *   positions, visibility and status an administrator set are theirs.
 * * **Derived from real data.** Slugs come from `products`, never from a
 *   fixture. A store with no products seeds nothing.
 * * **Idempotent.** Running it on every boot is the point.
 * * **Never fatal.** If it fails the API still starts — a taxonomy problem
 *   must not take the shop offline — but it logs loudly, because the admin
 *   screen will be broken until it is resolved.
 */

/**
 * Curated presentation for the four categories the current catalogue ships.
 *
 * The workbook's raw values are inconsistent (`shoe` lowercase, `Chappal`
 * capitalised). A derived title-case name would render "Shoe" and "Chappal"
 * side by side, and the customer-facing labels we actually want ("Mojri &
 * Jutti", "Formal Shoes") cannot be derived from the slug at all. So the four
 * known slugs get their real names here, and anything imported later falls
 * back to a title-cased slug.
 */
const CURATED: Readonly<Record<string, { displayName: string; description: string }>> = {
  'mojri-jutti': {
    displayName: 'Mojri & Jutti',
    description: 'Hand-embroidered slip-ons for weddings, festivities and quiet evenings.',
  },
  shoe: {
    displayName: 'Formal Shoes',
    description: 'Patent, suede and leather dress shoes for the working wardrobe.',
  },
  sandal: {
    displayName: 'Sandals',
    description: 'Open- and closed-toe comfort styles for warm-weather days.',
  },
  chappal: {
    displayName: 'Chappal',
    description: 'Classic everyday Indian chappals in leather and suede.',
  },
};

/**
 * Order the curated categories the way a shopper thinks about the shop,
 * not the way the workbook happened to list them.
 */
const CURATED_ORDER: readonly string[] = ['mojri-jutti', 'shoe', 'sandal', 'chappal'];

/** `mojri-jutti` -> `Mojri Jutti`. Only used for slugs with no curated entry. */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export interface CategoryReconciliation {
  readonly created: readonly string[];
  readonly existing: readonly string[];
  /** Slugs that appeared on more than one product label — reported, not merged. */
  readonly ambiguous: readonly { slug: string; labels: readonly string[] }[];
}

/**
 * Create a category for every slug the catalogue actually uses.
 *
 * Returns what it did so the boot log and the admin endpoint can both report
 * it honestly rather than claiming success unconditionally.
 */
export async function reconcileCategoryTaxonomy(): Promise<CategoryReconciliation> {
  const rows = await ProductModel.aggregate<{
    _id: string;
    labels: string[];
    count: number;
  }>([
    { $match: { subcategorySlug: { $type: 'string', $ne: '' } } },
    {
      $group: {
        _id: '$subcategorySlug',
        labels: { $addToSet: '$subcategory' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, _id: 1 } },
  ]);

  if (rows.length === 0) {
    return { created: [], existing: [], ambiguous: [] };
  }

  const existingDocs = await CategoryModel.find({}).select('slug').lean<Array<{ slug: string }>>();
  const existingSlugs = new Set(existingDocs.map((doc) => doc.slug));

  const ambiguous = rows
    .filter((row) => row.labels.filter((label) => Boolean(label)).length > 1)
    .map((row) => ({ slug: row._id, labels: row.labels.filter((label) => Boolean(label)) }));

  /*
   * Position: the four curated categories first, in shopper order, then any
   * additional slugs alphabetically after them. `$exists: false` for the new
   * ones would leave gaps, so the sequence is computed from the full desired
   * list rather than from a counter over the inserts.
   */
  const desiredOrder = [
    ...CURATED_ORDER.filter((slug) => rows.some((row) => row._id === slug)),
    ...rows
      .map((row) => row._id)
      .filter((slug) => !CURATED_ORDER.includes(slug))
      .sort((a, b) => a.localeCompare(b)),
  ];

  const created: string[] = [];
  const existing: string[] = [];

  for (const [position, slug] of desiredOrder.entries()) {
    if (existingSlugs.has(slug)) {
      existing.push(slug);
      continue;
    }

    const row = rows.find((candidate) => candidate._id === slug);
    const curated = CURATED[slug];
    const sourceLabel = row?.labels.find((label) => Boolean(label)) ?? '';

    try {
      await CategoryModel.create({
        slug,
        displayName: curated?.displayName ?? titleCase(slug),
        description: curated?.description ?? '',
        position,
        parentSlug: null,
        isVisible: true,
        status: 'active',
        sourceSubcategory: sourceLabel,
      });
      created.push(slug);
    } catch (error) {
      /*
       * A duplicate-key error here means another process created the same
       * category between the read and the write. That is benign — the
       * category exists, which is all this function promises.
       */
      const code = (error as { code?: number }).code;
      if (code === 11000) {
        existing.push(slug);
        continue;
      }
      throw error;
    }
  }

  return { created, existing, ambiguous };
}

/**
 * Reconcile the taxonomy at boot.
 *
 * Non-fatal by design. A failed reconciliation is logged with enough detail
 * to act on, and the API continues serving — a broken taxonomy must degrade
 * the admin panel, not the shop.
 */
export async function reconcileCategoryTaxonomyAtBoot(): Promise<void> {
  try {
    const result = await reconcileCategoryTaxonomy();

    if (result.created.length > 0) {
      logger.info(
        { created: result.created, existing: result.existing.length },
        'Category taxonomy reconciled from the catalogue',
      );
    } else {
      logger.info(
        { categories: result.existing.length },
        'Category taxonomy already matches the catalogue',
      );
    }

    if (result.ambiguous.length > 0) {
      logger.warn(
        { ambiguous: result.ambiguous },
        'A category slug is described by more than one product label; the first was used',
      );
    }
  } catch (error) {
    logger.error(
      { err: error },
      'Category taxonomy reconciliation failed. The admin category screen will be empty ' +
        'until it succeeds. Re-run it from Admin > Categories > Rebuild from catalogue.',
    );
  }
}
