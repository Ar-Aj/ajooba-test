import type { Metadata } from 'next';
import { ExchangesClient } from '@/features/account/components/exchanges-client';

export const metadata: Metadata = {
  title: 'Size exchanges',
  robots: { index: false, follow: false },
};

export default function ExchangesPage() {
  return (
    <div>
      <h2 className="mb-2 font-display text-xl">Size exchanges</h2>
      <p className="mb-6 max-w-prose text-sm text-ink-500">
        Request another available size for the same design and colour within 10 days of delivery.
      </p>
      <ExchangesClient />
    </div>
  );
}
