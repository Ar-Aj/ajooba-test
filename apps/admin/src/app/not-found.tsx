import Link from 'next/link';

/**
 * 404 for the panel.
 *
 * Says what was not found and offers the one place an operator most likely meant
 * to be, rather than a generic apology. This page is reached from the inside — a
 * stale order link, a deleted product — so the reader already knows what they
 * were doing and needs a way back, not an explanation of URLs.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md border border-border bg-white p-8">
        <p className="label-cap text-ink-400">Not found</p>
        <h1 className="step-lg mt-1.5 text-ink-900">That screen does not exist</h1>
        <p className="step-sm mt-2 text-ink-600">
          The record may have been removed, or the link may be out of date. Nothing has been
          changed.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/" className="btn btn-primary">
            Dashboard
          </Link>
          <Link href="/orders" className="btn btn-secondary">
            Orders
          </Link>
          <Link href="/catalog/products" className="btn btn-secondary">
            Products
          </Link>
        </div>
      </div>
    </main>
  );
}
