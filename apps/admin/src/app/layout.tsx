import type { Metadata, Viewport } from 'next';
import { adminEnv } from '@/lib/env';
import './globals.css';

/**
 * Root layout for the admin panel.
 */

export const metadata: Metadata = {
  // Derived from validated env, never hardcoded, so preview/staging/production
  // emit correct absolute URLs without a code change.
  metadataBase: new URL(adminEnv.NEXT_PUBLIC_SITE_URL),
  title: {
    default: 'Ajooba Footwear — Admin',
    template: '%s | Ajooba Admin',
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
