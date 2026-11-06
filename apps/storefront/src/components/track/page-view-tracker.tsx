'use client';

import { useEffect } from 'react';
import { trackCategoryView, trackProductView } from '@/lib/track';

/**
 * Records that one page was opened.
 *
 * ## Why a component rather than a call in the page
 *
 * Product and category pages are server components. They must not record
 * anything: a server render can happen for a crawler, for a Next.js prefetch,
 * or twice for one visitor, and counting those would inflate every page view by
 * a factor nobody can reproduce. A client component mounts once in a browser
 * and therefore sees exactly the renders a person saw.
 *
 * ## Deduplicated per mount
 *
 * React 18 development mode mounts twice on purpose. The dependency list is the
 * identity of the page, so a change of product or category records again, and a
 * re-render of the same page does not. The queue in `track.ts` is not a
 * deduplicator, so the guard is here.
 */
export function PageViewTracker({
  kind,
  productId,
  categorySlug,
  categoryName,
}: {
  kind: 'product' | 'category';
  productId?: string;
  categorySlug?: string;
  categoryName?: string;
}) {
  useEffect(() => {
    if (kind === 'product' && productId) {
      trackProductView({
        productId,
        ...(categorySlug ? { categorySlug } : {}),
        ...(categoryName ? { categoryName } : {}),
      });
      return;
    }
    if (kind === 'category' && categorySlug) {
      trackCategoryView({
        slug: categorySlug,
        ...(categoryName ? { name: categoryName } : {}),
      });
    }
  }, [kind, productId, categorySlug, categoryName]);

  return null;
}
