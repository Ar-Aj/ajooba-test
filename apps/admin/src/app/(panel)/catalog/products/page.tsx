import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { ProductManager } from '@/features/catalog/components/product-manager';

/**
 * Catalogue products.
 *
 * The manager itself is untouched: it already encodes rules that matter (a design
 * is addressed by its code and never duplicated, edits are written to the audit
 * log, a variant's SKU is immutable once created). This page is the shell around
 * it â€” a header that states those rules, and one surface that hosts the manager's
 * own panels.
 *
 * The header's description is not decoration. An operator who does not know that
 * "editing a design updates it in place" will create a second record for the same
 * design, and the catalogue will slowly fill with duplicates.
 */

export const dynamic = 'force-dynamic';

export default function CatalogProductsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Catalogue Â· Products"
        title="Products"
        description="Designs are addressed by their code (A01), never by name. Editing a design updates it in place â€” it is never duplicated â€” and every change is written to the audit log."
        actions={
          <Link href="/catalog/imports" className="btn btn-secondary btn-sm">
            Bulk import
          </Link>
        }
      />

      <div className="page-body">
        <ProductManager />
      </div>
    </>
  );
}
