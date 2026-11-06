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
  /*
   * Navy, because the top bar and the sign-in band are navy. Letting the browser
   * draw its own status bar in the same tone keeps a phone from looking like a
   * website with an app inside it.
   */
  themeColor: '#0a121f',
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      {/*
        The shell is the whole viewport. `bg-background` is the warm paper the
        white sheets sit on, and `text-foreground` the warm ink. Nothing sets a
        page colour below this, so a new screen cannot accidentally land on a
        cool grey.
      */}
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
