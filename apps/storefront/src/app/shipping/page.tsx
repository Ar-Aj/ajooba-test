import type { Metadata } from 'next';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Shipping',
  description:
    'How Ajooba Footwear orders are dispatched, what delivery costs, and where we ship across India.',
  alternates: { canonical: '/shipping' },
};

export default function ShippingPage() {
  return (
    <ProsePage
      title="Shipping"
      lede="We dispatch every order by hand from our packing unit in Uttar Pradesh."
    >
      <ProseSection heading="Delivery times and charges">
        <ProseList
          items={[
            'Orders placed before 2pm IST on a working day are dispatched the same day.',
            'Metro cities: 2–4 working days. Rest of India: 4–7 working days.',
            'Shipping is free on orders above ₹1,499. Below that, a flat ₹99 courier fee applies.',
            'Express delivery is available for ₹149 and reaches metro cities in 2 working days.',
            'Cash on delivery is available on orders up to ₹10,000.',
          ]}
        />
      </ProseSection>

      <ProseSection heading="What we ship to">
        <p>
          We ship to every serviceable PIN code in India. Some remote or tribal-area PIN codes are
          served by courier at a higher rate, and some are not served at all — if that happens you
          will be told before your order is dispatched, and you can choose to cancel for a full
          refund.
        </p>
        <p>
          We do not currently ship internationally. If you are outside India and want to order,
          write to us and we will tell you honestly what is and is not possible.
        </p>
      </ProseSection>

      <ProseSection heading="Tracking">
        <p>
          You will receive an email with the tracking link as soon as the courier collects your
          parcel. Tracking can take up to 24 hours to show the first scan, because the parcel is
          scanned in at the origin hub before it moves.
        </p>
        <p>You can also check the status of any order from your account page.</p>
      </ProseSection>

      <ProseSection heading="If something goes wrong">
        <p>
          If your parcel is delayed beyond the promised window, or arrives damaged, contact us with
          your order reference and a photograph of the packaging. We will arrange a replacement or a
          refund — you will not need to chase the courier.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
