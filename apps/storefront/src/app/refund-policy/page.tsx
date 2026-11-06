import type { Metadata } from 'next';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Refund policy',
  description: 'How and when Ajooba Footwear refunds are issued, and what happens to your money.',
  alternates: { canonical: '/refund-policy' },
};

export default function RefundPolicyPage() {
  return (
    <ProsePage
      title="Refund policy"
      lede="Where your money goes, how long it takes, and what we need from you."
    >
      <ProseSection heading="Where the money goes">
        <p>
          Refunds are issued to the original payment method. If you paid by UPI or card, the amount
          returns to the same account and the money appears as a credit — usually within 5 to 7
          working days of us processing it, depending on your bank.
        </p>
        <ProseList
          items={[
            'UPI, cards and net-banking: refunded to the original account.',
            'Cash on delivery: refunded by bank transfer to an account you nominate.',
            'Store credit, if you choose it: issued immediately, and valid for 12 months.',
          ]}
        />
        <p>
          We do not refund to a different person, account or method than the one used for the order.
          That is a standard fraud control, and we would rather explain it than quietly lose your
          money.
        </p>
      </ProseSection>

      <ProseSection heading="How long a refund takes">
        <ProseList
          items={[
            'The parcel must reach our workshop and be checked first — typically 2 to 4 days after pickup.',
            'Once checked, we process the refund within 24 hours.',
            'Your bank then takes 3 to 5 further working days to post it.',
          ]}
        />
        <p>
          You will get an email at each of those two points — when we receive the parcel, and when
          we process the refund — so you are never wondering whether it has been forgotten.
        </p>
      </ProseSection>

      <ProseSection heading="Cancellations before dispatch">
        <p>
          If you cancel before we dispatch, you get a full refund with no deductions. We dispatch
          the same working day for orders placed before 2pm, so if it is urgent, call us — that is
          faster than email.
        </p>
      </ProseSection>

      <ProseSection heading="Partial refunds">
        <p>
          If a pair comes back with wear, missing packaging or damage that is not our fault, we may
          offer a partial refund instead of sending it back. We will explain the reduction and show
          you the photographs that led to it. You are free to decline and return the item instead.
        </p>
      </ProseSection>

      <ProseSection heading="Failed or cancelled payments">
        <p>
          If a payment fails after the order is placed, the order is held for 24 hours while the
          payment is retried. If it cannot be completed, the order is cancelled automatically and
          nothing is charged. If money is debited but the order is cancelled, it is refunded in full
          to the same method.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
