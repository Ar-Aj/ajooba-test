import type { Metadata } from 'next';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Ajooba Footwear collects, why we collect it, and what we never do with it.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <ProsePage
      title="Privacy policy"
      lede="What we collect, why, and — just as importantly — what we never do with it."
    >
      <ProseSection heading="What we collect">
        <ProseList
          items={[
            'Contact details you give us: name, email address, mobile number and delivery address.',
            'Order details: what you bought, where it went, and the status of the parcel.',
            'Technical basics: the pages you visited and the search terms you used, so we can see which pages are not working.',
          ]}
        />
        <p>
          We do not collect your card number, CVV or UPI credentials. Payments are handled entirely
          by our payment provider’s page, and we only ever receive a reference that lets us confirm
          a payment succeeded.
        </p>
      </ProseSection>

      <ProseSection heading="What we use it for">
        <ProseList
          items={[
            'To take your order, deliver it, and handle return or size-exchange requests.',
            'To send you order confirmations, account recovery links and delivery updates.',
            'To answer your questions, and to fix pages that are not working.',
          ]}
        />
      </ProseSection>

      <ProseSection heading="Who we share it with">
        <p>
          Only the people who need it in order to do their job: our courier partner, which receives
          your name, address and mobile number so the parcel can reach you; our payment processor,
          which confirms the payment; and our hosting and email providers, which host the site and
          send the emails.
        </p>
        <p>We do not sell your details, and we do not rent them out.</p>
      </ProseSection>

      <ProseSection heading="Your rights">
        <p>
          You can ask us to show you what we hold, correct it, or delete it. Check the contact page
          for available support details or manage your profile from your account.
        </p>
        <p>
          We keep order records for as long as tax and accounting rules require, which is longer
          than we would like, but it is the law.
        </p>
      </ProseSection>

      <ProseSection heading="This website">
        <p>
          The site works offline to a limited degree: static pages and images are cached by your
          browser so the shop is not completely unusable on a poor connection. When you sign in,
          your profile, saved addresses and wishlist are stored with your customer account and
          cached in your browser — never in a shared cache.
        </p>
        <p>
          We use essential browser storage to keep your shopping cart, local cache, accessibility
          preferences and sign-in state on this device, alongside cookie-free event analytics.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
