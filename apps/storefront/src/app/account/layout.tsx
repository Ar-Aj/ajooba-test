import type { Metadata } from 'next';
import { AccountNav } from '@/features/account/components/account-nav';

export const metadata: Metadata = {
  title: 'My account',
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page py-8 md:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl md:text-4xl">My account</h1>
        <p className="mt-2 text-sm text-ink-500">
          Orders, addresses, your wishlist and returns — all in one place.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr] lg:gap-10">
        <AccountNav />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
