import type { Metadata } from 'next';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Refund policy',
  description: 'How Ajooba Footwear return requests and confirmed payment refunds are handled.',
  alternates: { canonical: '/refund-policy' },
};

export default function RefundPolicyPage() {
  return (
    <ProsePage
      title="Refund policy"
      lede="A return approval and a completed refund are separate steps."
    >
      <ProseSection heading="How a refund is handled">
        <ProseList
          items={[
            'Submit a return request from your account within 10 days of delivery. Our team reviews the request and confirms how to send the item back.',
            'The returned item is checked before a refund is approved.',
            'For eligible online payments, the refund is sent through the payment provider to the original payment method.',
            'A refund is shown as complete only after the provider confirms it. Your bank may take additional time to post the credit.',
          ]}
        />
        <p>
          Cash-on-delivery refunds are not sent through the online payment provider and require a
          manual payout process. The refund must be reconciled by the team.
        </p>
      </ProseSection>

      <ProseSection heading="Cancellations">
        <p>
          Cancellation availability depends on the order status. Check the order in your account;
          the team must stop fulfillment and confirm any applicable refund before a cancellation is
          complete.
        </p>
      </ProseSection>

      <ProseSection heading="Failed or pending payments">
        <p>
          A payment can remain pending while the provider confirms its result. Check your order
          status before placing a second order. If a payment was captured, the team must reconcile
          it against the order before the payment or refund is considered complete.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
