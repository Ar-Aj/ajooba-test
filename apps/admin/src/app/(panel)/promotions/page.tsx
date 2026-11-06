import { HeaderFact, PageHeader } from '@/components/layout/page-header';
import { PromotionsBoard } from '@/features/promotions/components/promotions-board';
import { OpsApiError, fetchCoupons, type Page } from '@/lib/ops';
import type { Coupon } from '@ajooba/contracts';
import Link from 'next/link';

/**
 * Promotions.
 *
 * The board itself is a client component â€” it has to be, because pausing a coupon
 * and previewing a discount are interactive â€” but the **first paint is server
 * rendered**: the coupon list arrives in the HTML rather than after a spinner.
 *
 * ## The rule this screen protects
 *
 * A coupon's code is immutable. The API's update contract omits it, because a
 * code is a thing customers have already shared â€” in a story, in a WhatsApp
 * forward, on a printed card â€” and silently changing it breaks every one of those
 * at once, with no error for the customer. Editing here changes the value, the
 * window and the limits. To get a new code, create a new coupon.
 */

export const dynamic = 'force-dynamic';

export default async function PromotionsPage() {
  let coupons: Page<Coupon> | null = null;
  let failure: string | null = null;

  try {
    coupons = await fetchCoupons({ pageSize: 100 });
  } catch (error) {
    failure = error instanceof OpsApiError ? error.message : 'The coupons could not be read.';
  }

  return (
    <>
      <PageHeader
        eyebrow="Sell Â· Promotions"
        title="Promotions"
        description="Discount codes and the windows they are valid in. A code cannot be renamed once it exists; a discount is always calculated by the same rule checkout uses, never re-implemented here."
        meta={
          coupons ? (
            <>
              <HeaderFact label="Coupons" value={coupons.totalItems} />
              <HeaderFact
                label="Active"
                value={coupons.items.filter((coupon) => coupon.isActive).length}
              />
            </>
          ) : null
        }
      />

      <div className="page-body">
        {failure ? (
          <div className="sheet p-6" role="alert">
            <p className="step-md font-medium text-ink-900">The coupons could not be read</p>
            <p className="step-sm mt-1.5 text-ink-600">{failure}</p>
            <p className="step-sm mt-3 text-ink-500">Nothing has been changed. Reload to retry.</p>
            <Link href="/" className="btn btn-secondary mt-5">
              Back to dashboard
            </Link>
          </div>
        ) : (
          <PromotionsBoard initial={coupons?.items ?? []} />
        )}
      </div>
    </>
  );
}
