import type { Metadata } from 'next';
import Link from 'next/link';
import { ProsePage, ProseSection } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'About Ajooba Footwear',
  description: 'Explore Ajooba Footwear designs, product information and customer-care options.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <ProsePage
      title="About Ajooba Footwear"
      lede="Explore the current collection and check product details, available sizes and colourways before you order."
    >
      <ProseSection heading="The collection">
        <p>
          Browse the live catalogue to see the designs currently available. Each product page shows
          its listed colours, sizes, price and stock information.
        </p>
        <p>
          The catalogue and checkout use current store data. Review the delivery charge and final
          total at checkout before submitting an order.
        </p>
      </ProseSection>

      <ProseSection heading="Choosing a size">
        <p>
          Check the product page for the sizes available for that design. If a delivered order does
          not fit, you can request another size of the same design and colour within 10 days of
          delivery. The replacement size must be in stock and approved by the team.
        </p>
        <p>
          For other return requests, read the{' '}
          <Link href="/returns" className="font-medium underline underline-offset-4">
            returns and exchanges policy
          </Link>
          .
        </p>
      </ProseSection>

      <ProseSection heading="Need help?">
        <p>
          Visit the{' '}
          <Link href="/contact" className="font-medium text-ink-900 underline underline-offset-4">
            customer-care page
          </Link>{' '}
          for available contact details and account links.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
