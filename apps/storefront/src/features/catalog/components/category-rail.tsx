'use client';

import type { CategoryView } from '@ajooba/contracts';
import { TapLink } from '@/components/track/tap-link';
import { cn } from '@/lib/cn';
import { buildCatalogHref, type CatalogParams } from '../lib/catalog-params';

/**
 * The horizontal category rail on the listing page.
 *
 * A client component only so the taps can be recorded. The markup, the order and
 * the counts are exactly what the server passed down: this file decides nothing
 * about the taxonomy, and it deliberately does not re-fetch it. A rail that reads
 * the taxonomy a second time is a rail that can disagree with the header on the
 * same page.
 *
 * ## Why the rail exists in this shape
 *
 * A horizontal rail rather than a second dropdown: on a phone it scrolls, on a
 * laptop it sits on one line, and either way the shopper sees the whole
 * taxonomy at once and can jump between departments in one tap.
 */
export function CategoryRail({
  categories,
  active,
  params,
  basePath = '/products',
}: {
  categories: readonly CategoryView[];
  /** The selected slug, or undefined for "All". */
  active: string | undefined;
  params?: CatalogParams;
  basePath?: string;
}) {
  if (categories.length === 0) return null;

  const linkClass = (selected: boolean): string =>
    cn(
      'step-sm link-underline',
      selected ? 'font-semibold text-ink-950' : 'text-ink-600 hover:text-ink-950',
    );

  const hrefFor = (slug: string | undefined): string => {
    if (params) {
      return buildCatalogHref(params, { subcategory: slug }, basePath);
    }
    return slug ? `${basePath}?subcategory=${encodeURIComponent(slug)}` : basePath;
  };

  return (
    <nav
      aria-label="Categories"
      className="-mx-5 mb-8 overflow-x-auto px-5 scrollbar-none md:mx-0 md:px-0"
    >
      <ul className="flex items-baseline gap-6 whitespace-nowrap">
        <li>
          <TapLink
            href={hrefFor(undefined)}
            action="category-open"
            surface="catalog-toolbar"
            className={linkClass(!active)}
            aria-current={!active ? 'page' : undefined}
          >
            All
          </TapLink>
        </li>
        {categories.map((category) => (
          <li key={category.slug}>
            <TapLink
              href={hrefFor(category.slug)}
              action="category-open"
              surface="catalog-toolbar"
              detail={{ categorySlug: category.slug, categoryName: category.displayName }}
              className={linkClass(active === category.slug)}
              aria-current={active === category.slug ? 'page' : undefined}
            >
              {category.displayName}
              <span className="tnum step-xs ml-1.5 text-ink-500">{category.productCount}</span>
            </TapLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
