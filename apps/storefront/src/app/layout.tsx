import { type Metadata, type Viewport } from 'next';
import { storefrontEnv } from '@/lib/env';
import './globals.css';

/**
 * Root layout for the customer storefront.
 *
 * Metadata is derived from validated environment configuration, so no URL is
 * hardcoded in the markup.
 */

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#b85c29',
};

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(storefrontEnv.NEXT_PUBLIC_SITE_URL),
    title: {
      default: 'Ajooba Footwear',
      template: '%s | Ajooba Footwear',
    },
    description: 'Ajooba Footwear — ethnic footwear, mojris, juttis, sandals and chappals for men.',
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
