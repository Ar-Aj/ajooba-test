import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthForm } from '@/features/auth/components/auth-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Ajooba Footwear account.',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="container-page py-10 md:py-16">
      <div className="mx-auto max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-display text-3xl">Sign in</h1>
          <p className="mt-2 text-sm text-ink-500">
            Welcome back. Use your email and password to access your orders and wishlist.
          </p>
        </header>
        <div className="rounded-2xl border border-ink-200 bg-white p-6">
          <Suspense fallback={null}>
            <AuthForm mode="login" />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/forgot-password" className="text-ink-700 underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </p>
        <div className="mt-6 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-xs text-ink-700">
          <p className="font-medium text-ink-900">One account, everywhere</p>
          <p className="mt-1 leading-relaxed">
            Sign in once and your orders, wishlist and saved addresses follow you to any device. We
            keep the details to ourselves — no advertising trackers, nothing sold on.
          </p>
        </div>
      </div>
    </div>
  );
}
