import { PageHeader } from '@/components/layout/page-header';
import { ImportControl } from '@/features/catalog/components/import-control';

/**
 * Catalogue import.
 *
 * Every import is a **dry run first**: it reports exactly what it would create,
 * change and refuse, and writes nothing. Applying requires the checksum of the
 * plan that was reviewed, so an approval can never be made against a stale
 * report â€” the case that matters when a second operator runs the dry run again
 * while the first is reading it.
 *
 * The importer never invents stock. A listing template is a marketplace export,
 * not a warehouse ledger, so a design arrives at zero until someone counts it.
 */

export const dynamic = 'force-dynamic';

export default function CatalogImportsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Catalogue Â· Imports"
        title="Catalogue import"
        description="A dry run reports every change and writes nothing. Applying requires the checksum of the plan you reviewed, so an approval can never be made against a stale report."
      />

      <div className="page-body">
        <ImportControl />
      </div>
    </>
  );
}
