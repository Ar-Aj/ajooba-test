import { PageHeader } from '@/components/layout/page-header';
import { ImageReviewQueueScreen } from '@/features/catalog/components/image-review-queue';

/**
 * Image review.
 *
 * An image whose colour cannot be verified from its filename is quarantined: it
 * appears in no storefront gallery, and the colour it names cannot be sold until
 * a photograph is confirmed. That is a deliberate refusal rather than a
 * best-guess â€” a shopper who buys "maroon" and receives "brown" is a return, a
 * refund and a review, and all three cost more than a human confirming a
 * thumbnail.
 *
 * Every decision here requires a reason and is stored with the operator's name and
 * the time, so a disputed classification can always be traced back.
 */

export const dynamic = 'force-dynamic';

export default function CatalogImagesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Catalogue Â· Image review"
        title="Image review"
        description="Photographs whose colour could not be verified from the filename. Until one is confirmed, it appears in no gallery and its colour cannot be sold. Every decision requires a reason and is signed."
      />

      <div className="page-body">
        <ImageReviewQueueScreen />
      </div>
    </>
  );
}
