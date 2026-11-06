import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthForm } from '@/features/auth/components/auth-form';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create an Ajooba Footwear account.',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <div className="container-page py-10 md:py-16">
      <div className="mx-auto max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-display text-3xl">Create an account</h1>
          <p className="mt-2 text-sm text-ink-500">
            Save your addresses, track your orders, and keep a wishlist that follows you across
            visits.
          </p>
        </header>
        <div className="rounded-2xl border border-ink-200 bg-white p-6">
          <Suspense fallback={null}>
            <AuthForm mode="register" />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-sm">
          Already a customer?{' '}
          <Link href="/login" className="font-medium text-ink-900 underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
