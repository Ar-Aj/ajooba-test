import type { Metadata } from 'next';
import Link from 'next/link';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Returns & exchanges',
  description:
    'Return or exchange Ajooba Footwear within 10 days of delivery, with a free reverse pickup.',
  alternates: { canonical: '/returns' },
};

export default function ReturnsPage() {
  return (
    <ProsePage
      title="Returns & exchanges"
      lede="Ten days, free reverse pickup, and no argument about it."
    >
      <ProseSection heading="The window">
        <p>
          You can return or exchange any pair within 10 days of delivery. Start the request from
          your account, or write to us if you would rather do it by email.
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
            'Submit the request from your account, choosing the items and the reason.',
            'We email a prepaid reverse pickup label. Print it, or show the QR code to the courier.',
            'The courier collects from your address, usually within 3 working days.',
            'Your refund is issued once the parcel reaches us and is checked.',
          ]}
        />
        <p>
          Reverse pickup is free. If you would rather not wait for a pickup, you are also welcome to
          ship the parcel back at your own cost to the address on your shipping label.
        </p>
      </ProseSection>

      <ProseSection heading="Exchanges and size swaps">
        <p>
          A size exchange is handled as a return plus a new order. That means your replacement pair
          ships as soon as your return is collected, so you are not left without shoes in the
          meantime. If you would prefer the new pair to ship only after the return is checked, say
          so on the request and we will do it that way.
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
        <p>
          If a pair does not meet these conditions we will send you a photograph and offer to return
          it at our cost, or to settle it as a partial refund. We will never simply refuse to reply.
        </p>
      </ProseSection>

      <ProseSection heading="Faulty items">
        <p>
          If something has come apart in normal use — the sole, the stitching, a broken buckle —
          that is not a return, that is a warranty claim. Send us a photograph and your order
          reference, and we will repair or replace the pair. Contact us through our{' '}
          <Link href="/contact" className="font-medium text-ink-900 underline underline-offset-4">
            customer care
          </Link>
          .
        </p>
      </ProseSection>
    </ProsePage>
  );
}
