import type { Metadata } from 'next';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Shipping',
  description:
    'Shipping charges, delivery availability and tracking information for Ajooba Footwear orders.',
  alternates: { canonical: '/shipping' },
};

export default function ShippingPage() {
  return (
    <ProsePage
      title="Shipping"
      lede="Your shipping charge is shown in the order total before you pay."
    >
      <ProseSection heading="Delivery times and charges">
        <ProseList
          items={[
            'The current shipping charge and order total are confirmed at checkout before payment.',
            'Courier availability and delivery estimates can vary by destination PIN code.',
            'Cash on delivery appears at checkout only when the store has enabled it and the order total is within the configured limit.',
          ]}
        />
      </ProseSection>

      <ProseSection heading="Delivery availability">
        <p>
          Courier serviceability depends on the destination PIN code and is checked when your order
          is processed.
        </p>
        <p>International delivery is not currently offered.</p>
      </ProseSection>

      <ProseSection heading="Tracking">
        <p>
          When the carrier provides tracking details, we share them after dispatch. The first scan
          may take time to appear in the carrier system.
        </p>
        <p>Order and dispatch status are available from your account under Orders.</p>
      </ProseSection>

      <ProseSection heading="If something goes wrong">
        <p>
          If a parcel arrives damaged or with the wrong item, submit a return request from your
          account within 10 days of delivery with your order reference and a photograph of the
          packaging, or check the contact page for available support options.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
