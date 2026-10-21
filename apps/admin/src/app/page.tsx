import Link from 'next/link';
import { BRAND_NAME } from '@ajooba/contracts';
import { apiUrl } from '@/lib/env';

/**
 * Admin dashboard shell.
 *
 * This screen deliberately shows NO revenue figures, order counts, customer
 * counts or product statistics.
 *
 * Why: the platform has no transaction data yet. Rendering "₹0 revenue" or
 * an invented growth chart would be misleading in a production-facing screen.
 * Every metric on this dashboard will be computed from live order data once
 * the commerce flows exist. Until then, the dashboard states plainly that
 * there is no data yet.
 */

/** Health targets, built from validated env — never hardcoded URLs. */
const platformStatus = [
  { label: 'Storefront', href: process.env.NEXT_PUBLIC_SITE_URL ?? null, note: 'env' },
  { label: 'API health', href: apiUrl('/health/ready'), note: 'env' },
  { label: 'Admin health', href: '/api/health', note: 'route' },
];

export default function AdminDashboardPage() {
  return (
    <main className="min-h-dvh">
      <header className="border-b border-neutral-200 bg-white">
        <div className="container-page flex h-16 items-center justify-between">
          <p className="text-lg font-semibold tracking-tight">{BRAND_NAME} — Admin</p>
          <nav aria-label="Admin" className="flex items-center gap-4 text-sm">
            <Link href="/" className="hover:text-brand-600">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <div className="container-page py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

        <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-8">
          <h2 className="text-base font-medium">No store data yet</h2>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            The catalogue import has not been run against this environment, and no orders have been
            placed. Dashboard metrics are computed from live records only — this panel will not
            display sample revenue, sample orders or sample customers.
          </p>
          <p className="mt-4 text-sm text-neutral-600">
            Run the catalogue import against the target environment, then reload this page.
          </p>
        </div>

        <section className="mt-10" aria-labelledby="platform-status">
          <h2 id="platform-status" className="text-sm font-medium">
            Platform status
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {platformStatus.map((item) => (
              <div key={item.label} className="rounded-lg border border-neutral-200 bg-white p-4">
                <dt className="text-sm text-neutral-500">{item.label}</dt>
                <dd className="mt-1">
                  {item.href ? (
                    <a
                      href={item.href}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <span className="text-sm text-neutral-400">Not configured</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
