import type { Metadata } from 'next';
import { ProsePage, ProseSection } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The terms that apply when you shop on the Ajooba Footwear website.',
  alternates: { canonical: '/terms' },
};

export default function TermsPage() {
  return (
    <ProsePage title="Terms of use" lede="The straightforward rules for shopping with us.">
      <ProseSection heading="Orders and acceptance">
        <p>
          Placing an order is an offer to buy. The contract is formed when we send you a dispatch
          confirmation, not when you press “place order”. We may decline an order — for example if
          an item turns out to be out of stock, if the price was listed in error, or if we cannot
          ship to your address. If we decline, you are refunded in full.
        </p>
      </ProseSection>

      <ProseSection heading="Pricing">
        <p>
          Prices are shown in Indian Rupees. Shipping and any applicable tax are confirmed at
          checkout before you pay.
        </p>
        <p>
          If a price is listed in error, we will contact you before dispatch and you can confirm the
          corrected price or cancel for a full refund.
        </p>
      </ProseSection>

      <ProseSection heading="Product descriptions and photography">
        <p>
          Product photographs and descriptions are provided for the listed design. Colours may
          appear differently on different screens; review the selected colourway and product details
          before ordering.
        </p>
      </ProseSection>

      <ProseSection heading="Your account">
        <p>
          You are responsible for keeping your login details to yourself and for activity that
          happens under your account. Tell us promptly if you think someone else has accessed it.
        </p>
      </ProseSection>

      <ProseSection heading="Intellectual property">
        <p>
          The Ajooba name, logo, product designs, photography and the content of this site belong to
          us or to the people who license it to us. You may not reproduce them commercially without
          permission.
        </p>
      </ProseSection>

      <ProseSection heading="Liability">
        <p>
          We are responsible for delivering the goods as described. Beyond that, and to the extent
          the law allows, our liability for any loss arising from your use of this site is limited
          to the amount you paid for the order concerned. Nothing here limits your rights as a
          consumer under Indian law.
        </p>
      </ProseSection>

      <ProseSection heading="Governing law">
        <p>
          These terms are governed by the laws of India, subject to applicable consumer protection
          laws. If you are a consumer resident elsewhere, you keep the mandatory protections of the
          law of your own jurisdiction.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
