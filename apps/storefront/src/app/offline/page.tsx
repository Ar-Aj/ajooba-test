import type { Metadata } from 'next';
import { ServiceUnavailable } from '@/components/ui/empty-states';

export const metadata: Metadata = {
  title: 'Offline',
  description: 'You are offline — Ajooba Footwear.',
  robots: { index: false, follow: false },
};

/**
 * Offline fallback page, served by the service worker when a navigation
 * fails with no network. It must be static and self-contained — the service
 * worker serves it from the cache.
 */
export default function OfflinePage() {
  return (
    <div className="container-page py-16">
      <ServiceUnavailable what="the internet" className="mx-auto max-w-xl" />
      <div className="mx-auto mt-6 max-w-xl text-center">
        <p className="text-sm text-ink-500">
          Pages you have already visited may still open. Try again once you have a connection, or
          call us on +91 80000 12345.
        </p>
      </div>
    </div>
  );
}
