import type { Metadata } from 'next';
import Link from 'next/link';
import { ProsePage, ProseSection } from '@/components/layout/prose-page';
import { fetchStoreSettings } from '@/lib/api';

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
  description: 'Find order, return and size-exchange help for Ajooba Footwear.',
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
  const settings = await fetchStoreSettings();
  const supportEmail =
    settings?.supportEmail && settings.supportEmail !== 'support@ajooba.in'
      ? settings.supportEmail
      : null;
  const supportPhone =
    settings?.supportPhone && settings.supportPhone !== '+919876543210'
      ? settings.supportPhone
      : null;

  return (
    <ProsePage
      title="Contact us"
      lede="For an existing order, sign in to check its status or request an eligible return or size exchange."
    >
      {designCode ? (
        <section className="rounded-2xl border border-gold-300 bg-gold-50 px-5 py-4">
          <p className="text-sm font-medium text-gold-900">
            Your enquiry is about design {designCode}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gold-800">
            Keep this code handy when asking about this design: <strong>{designCode}</strong>.
          </p>
        </section>
      ) : null}

      <ProseSection heading="Customer care">
        {supportEmail || supportPhone ? (
          <ul className="space-y-2 text-ink-700">
            {supportEmail ? (
              <li>
                Email:{' '}
                <a className="underline underline-offset-4" href={`mailto:${supportEmail}`}>
                  {supportEmail}
                </a>
              </li>
            ) : null}
            {supportPhone ? (
              <li>
                Phone:{' '}
                <a className="underline underline-offset-4" href={`tel:${supportPhone}`}>
                  {supportPhone}
                </a>
              </li>
            ) : null}
          </ul>
        ) : (
          <p>
            A customer-care email address or phone number has not been configured yet. For an
            existing order, sign in to view the latest status or open an eligible return or size
            exchange request.
          </p>
        )}
      </ProseSection>

      <ProseSection heading="Order and exchange help">
        <p>
          Order history and request status are available in your account. A size exchange must be
          for the same design and colour, requested within 10 days of delivery, and approved after
          the replacement size is checked for stock.
        </p>
        <p>
          <Link href="/account/orders" className="font-medium underline underline-offset-4">
            View your orders
          </Link>
          {' · '}
          <Link href="/account/exchanges" className="font-medium underline underline-offset-4">
            Size exchanges
          </Link>
          {' · '}
          <Link href="/returns" className="font-medium underline underline-offset-4">
            Return policy
          </Link>
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
            — current delivery charges and payment availability at checkout.
          </li>
          <li>
            <Link href="/returns" className="font-medium text-ink-900 underline underline-offset-4">
              Returns &amp; exchanges
            </Link>{' '}
            — the 10-day window, return approval and how size exchanges work.
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
    </ProsePage>
  );
}
