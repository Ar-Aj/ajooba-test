import { PageHeader } from '@/components/layout/page-header';
import { CategoryManager } from '@/features/catalog/components/category-manager';

/**
 * Categories.
 *
 * One canonical category collection backs this screen, the storefront navigation,
 * the storefront filters and the homepage category entry points. That single
 * source is the point: a category invented here appears in all four without a
 * deployment, and a category renamed here is renamed everywhere at once.
 *
 * A category with products attached cannot be retired until they are moved â€”
 * which is why deleting one is a two-step operation and why the refusal is
 * explicit rather than silent.
 */

export const dynamic = 'force-dynamic';

export default function CatalogCategoriesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Catalogue Â· Categories"
        title="Categories"
        description="The live taxonomy. This list is what the storefront's navigation, its filters and the homepage all read from â€” there is no second copy of it anywhere in the platform."
      />

      <div className="page-body">
        <CategoryManager />
      </div>
    </>
  );
}
