import { type Metadata, type Viewport } from 'next';
import { Suspense } from 'react';
import { storefrontEnv } from '@/lib/env';
import { ToastProvider } from '@/components/ui/toast';
import { CommerceProvider } from '@/lib/commerce-context';
import { SiteHeader } from '@/components/layout/header';
import { SiteFooter } from '@/components/layout/footer';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { ServiceWorkerRegistrar } from '@/components/pwa/sw-registrar';
import { ConsentBanner } from '@/components/pwa/consent-banner';
import { A11yBootstrap } from '@/components/a11y/accessibility-controls';
import { fetchCategories } from '@/lib/api';
import './globals.css';

// Vercel service bindings are runtime-only, so service-bound API reads must
// happen in request-time functions instead of static generation.
export const dynamic = 'force-dynamic';

/**
 * Root layout for the customer storefront.
 *
 * Providers mount in a fixed order:
 *   1. `CommerceProvider` — local cart/wishlist/address/order/return/account state
 *   2. `ToastProvider` — surfaces user-visible feedback
 *
 * The header carries the global search, mobile nav, account, wishlist and
 * cart surfaces; the PWA pieces are small client components that mount in
 * idle and never block render.
 */

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#181512',
};

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(storefrontEnv.NEXT_PUBLIC_SITE_URL),
    title: {
      default: 'Ajooba Footwear',
      template: '%s | Ajooba Footwear',
    },
    description:
      'Explore Ajooba Footwear designs, check product details and review the total at checkout.',
    applicationName: 'Ajooba Footwear',
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
        { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
      ],
      apple: [{ url: '/icons/icon-192.png' }],
    },
    openGraph: {
      type: 'website',
      siteName: 'Ajooba Footwear',
      locale: 'en_IN',
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /*
   * One read of the taxonomy per request, shared by the header and the footer.
   *
   * The layout is the only place that can do this: both the rail and the
   * footer's shop column need the same list, and fetching it twice per render
   * would double a read that never changes between the two consumers.
   *
   * A failure returns an empty list (see `fetchCategories`), so both surfaces
   * degrade to "Shop all" rather than the storefront refusing to render.
   */
  const categories = await fetchCategories();

  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <A11yBootstrap />
        <CommerceProvider>
          <ToastProvider>
            <ServiceWorkerRegistrar />
            {/* SiteHeader reads useSearchParams — must be in a Suspense boundary
                so that pages can be statically pre-rendered. */}
            <Suspense fallback={null}>
              <SiteHeader categories={categories} />
            </Suspense>
            <main id="main" className="min-h-[60dvh]">
              {children}
            </main>
            <SiteFooter categories={categories} />
            <InstallPrompt />
            <ConsentBanner />
          </ToastProvider>
        </CommerceProvider>
      </body>
    </html>
  );
}
