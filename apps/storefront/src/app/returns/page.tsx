import type { Metadata } from 'next';
import Link from 'next/link';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Returns & exchanges',
  description: 'How to request a return or same-design size exchange within 10 days of delivery.',
  alternates: { canonical: '/returns' },
};

export default function ReturnsPage() {
  return (
    <ProsePage
      title="Returns & exchanges"
      lede="Request a return or eligible size exchange within 10 days of delivery."
    >
      <ProseSection heading="The window">
        <p>
          Submit a return or exchange request from your account within 10 days of delivery. The
          request must be reviewed before you send the pair back.
        </p>
        <ProseList
          items={[
            'The pair must be unworn, with its original box, tags and packaging.',
            'Try a pair on indoors, on a clean surface, exactly as you would in a shop.',
            'The box must be in good enough condition to be resold — that is all we ask.',
          ]}
        />
      </ProseSection>

      <ProseSection heading="How it works">
        <ProseList
          items={[
            'Submit a request from your account with the item and reason.',
            'Our team reviews it and confirms the return or pickup instructions before you send the pair.',
            'The pair is checked after it reaches us. You can follow the request status in your account.',
            'For eligible paid orders, a refund is processed after approval and confirmed by the payment provider.',
          ]}
        />
        <p>
          Pickup arrangements and any applicable charges must be confirmed by the team before the
          return proceeds. Cash-on-delivery refunds require a separate manual payout process.
        </p>
      </ProseSection>

      <ProseSection heading="Exchanges and size swaps">
        <p>
          Request another size of the same design and colour from your account. The order must be
          within the 10-day window, the replacement size must be available, and staff must approve
          the request before a stock hold is made. A different price requires support review; this
          page does not collect or refund a price difference.
        </p>
      </ProseSection>

      <ProseSection heading="What we cannot accept">
        <ProseList
          items={[
            'Pairs that have been worn outdoors, or with visible scuffing or creasing.',
            'Pairs with the sole visibly worn down.',
            'Items returned without the original box, tags or packaging.',
            'Orders placed more than 10 days after delivery.',
          ]}
        />
        <p>The returned pair is inspected before the request is approved or a refund is started.</p>
      </ProseSection>

      <ProseSection heading="Faulty items">
        <p>
          If your pair arrives damaged or develops a problem, include the order reference and a
          photograph when submitting a return request from your account, or check the{' '}
          <Link href="/contact" className="font-medium text-ink-900 underline underline-offset-4">
            contact page
          </Link>{' '}
          for available support options.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
