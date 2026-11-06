import type { Metadata } from 'next';
import Link from 'next/link';
import { ProsePage, ProseSection, ProseList } from '@/components/layout/prose-page';

/**
 * Contact page.
 *
 * The product page's "Ask about this design" link lands here with a
 * `?design=<code>` query parameter. The code is echoed back to the customer
 * so they do not have to remember and retype it, and so our support team
 * knows which design the enquiry is about from the first line of the email.
 */

export const metadata: Metadata = {
  title: 'Contact us',
  description:
    'Reach Ajooba Footwear customer care for order help, sizing advice, returns and anything else.',
  alternates: { canonical: '/contact' },
};

/**
 * Design codes look like `A11` — a letter followed by two digits. Anything
 * else is treated as an untrusted value and ignored rather than echoed into
 * the page, so the parameter can never be used to inject markup.
 */
function readDesignCode(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const trimmed = raw.trim().toUpperCase();
  return /^A\d{2}$/.test(trimmed) ? trimmed : undefined;
}

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const designCode = readDesignCode(params.design);

  return (
    <ProsePage
      title="Contact us"
      lede="Customer care is open Monday to Saturday, 10am to 7pm IST. We answer email within one working day."
    >
      {designCode ? (
        <section className="rounded-2xl border border-gold-300 bg-gold-50 px-5 py-4">
          <p className="text-sm font-medium text-gold-900">
            Your enquiry is about design {designCode}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gold-800">
            Please include <strong>{designCode}</strong> when you write to us — it lets us check the
            sizes we have made and the stock position for that design straight away.
          </p>
        </section>
      ) : null}

      <ProseSection heading="Reach us directly">
        <ProseList
          items={[
            'Email: care@ajoobafootwear.com — we reply within one working day.',
            'Phone: +91 80000 12345 — Monday to Saturday, 10am to 7pm IST.',
            'WhatsApp: the same number, for order updates and sizing advice.',
          ]}
        />
      </ProseSection>

      <ProseSection heading="What to tell us when you write">
        <p>
          If your question is about an order, please include your order reference. It is the long
          code in your confirmation email, and it lets us find your parcel immediately rather than
          searching through orders.
        </p>
        <p>
          If it is about fit, it helps to know your usual UK size in the shoes you already own, and
          whether you usually wear a half size up.
        </p>
      </ProseSection>

      <ProseSection heading="Common questions">
        <p>
          These are the questions we get most often. The fuller versions live in the pages linked
          below.
        </p>
        <ul className="list-disc space-y-2 pl-5 marker:text-gold-600">
          <li>
            <Link
              href="/shipping"
              className="font-medium text-ink-900 underline underline-offset-4"
            >
              Shipping
            </Link>{' '}
            — delivery times, charges and cash on delivery.
          </li>
          <li>
            <Link href="/returns" className="font-medium text-ink-900 underline underline-offset-4">
              Returns &amp; exchanges
            </Link>{' '}
            — the 10-day window, reverse pickup and how refunds work.
          </li>
          <li>
            <Link
              href="/refund-policy"
              className="font-medium text-ink-900 underline underline-offset-4"
            >
              Refund policy
            </Link>{' '}
            — where the money goes and how long it takes.
          </li>
          <li>
            <Link href="/terms" className="font-medium text-ink-900 underline underline-offset-4">
              Terms of use
            </Link>{' '}
            — orders, pricing, and your rights.
          </li>
          <li>
            <Link href="/privacy" className="font-medium text-ink-900 underline underline-offset-4">
              Privacy
            </Link>{' '}
            — what we collect and what we never do with it.
          </li>
        </ul>
      </ProseSection>

      <ProseSection heading="Press and partnerships">
        <p>
          For wholesale enquiries, press samples or collaboration opportunities, write to the same
          address with “Enquiry” in the subject line and we will route it to the right person.
        </p>
      </ProseSection>
    </ProsePage>
  );
}
