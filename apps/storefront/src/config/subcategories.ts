/**
 * Featured subcategories surfaced on the storefront home and shop pages.
 *
 * The catalogue has exactly four subcategories (per `docs/catalog-audit.md`
 * §3.3) with the spelling preserved verbatim from the workbook. We map each
 * raw value to a canonical slug and a customer-friendly display label, the
 * same pair that `packages/contracts/src/catalog/types.ts` ships.
 *
 * The customer labels avoid the in-workbook spelling/casing quirks (e.g.
 * `shoe` in lowercase, `Mojri / Jutti` with title-case). The raw value is
 * preserved as `raw` so a future import worker can round-trip back to the
 * workbook column. The combination (slug + raw) is unique by construction.
 */

export interface FeaturedSubcategory {
  slug: 'mojri-jutti' | 'shoe' | 'sandal' | 'chappal';
  /** Verbatim workbook `Sub-category` value. */
  raw: 'Mojri / Jutti' | 'shoe' | 'sandal' | 'Chappal';
  /** Customer-facing label. */
  label: string;
  /** A short tagline for the home cards. */
  blurb: string;
}

export const FEATURED_SUBCATEGORIES: readonly FeaturedSubcategory[] = [
  {
    slug: 'mojri-jutti',
    raw: 'Mojri / Jutti',
    label: 'Mojri & Jutti',
    blurb: 'Hand-embroidered slip-ons for weddings, festivities and quiet evenings.',
  },
  {
    slug: 'shoe',
    raw: 'shoe',
    label: 'Formal Shoes',
    blurb: 'Smart styles for work and special occasions.',
  },
  {
    slug: 'sandal',
    raw: 'sandal',
    label: 'Sandals',
    blurb: 'Open- and closed-toe comfort styles for warm-weather days.',
  },
  {
    slug: 'chappal',
    raw: 'Chappal',
    label: 'Chappal',
    blurb: 'Everyday chappals for a relaxed look.',
  },
] as const;

export function getSubcategory(slug: string): FeaturedSubcategory | undefined {
  return FEATURED_SUBCATEGORIES.find((s) => s.slug === slug);
}
