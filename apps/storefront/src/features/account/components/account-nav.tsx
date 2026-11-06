'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCommerce } from '@/lib/commerce-context';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/account', label: 'Overview' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/wishlist', label: 'Wishlist' },
  { href: '/account/returns', label: 'Returns' },
];

export function AccountNav() {
  const pathname = usePathname();
  const { account } = useCommerce();
  return (
    <aside className="rounded-2xl border border-ink-200 bg-white p-5">
      <div className="mb-4 border-b border-ink-100 pb-4">
        <p className="font-display text-lg">{account?.fullName ?? 'Welcome'}</p>
        <p className="truncate text-xs text-ink-500">{account?.email ?? 'Signed out'}</p>
      </div>
      <nav aria-label="Account sections" className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            item.href === '/account' ? pathname === '/account' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-ink-900 text-cream-50'
                  : 'text-ink-700 hover:bg-ink-50 hover:text-ink-900',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
