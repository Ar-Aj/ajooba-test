import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AuthForm } from '@/features/auth/components/auth-form';

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Recover access to your Ajooba Footwear account.',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <div className="container-page py-10 md:py-16">
      <div className="mx-auto max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-display text-3xl">Reset your password</h1>
          <p className="mt-2 text-sm text-ink-500">
            Enter your email and we’ll send you a link to choose a new password.
          </p>
        </header>
        <div className="rounded-2xl border border-ink-200 bg-white p-6">
          <Suspense fallback={null}>
            <AuthForm mode="forgot" />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-ink-700 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
