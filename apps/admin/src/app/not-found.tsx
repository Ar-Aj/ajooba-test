import Link from 'next/link';

/**
 * 404 page for the admin panel.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh">
      <div className="container-page py-16">
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
          <h1 className="text-lg font-medium">Page not found</h1>
          <p className="mt-2 text-sm text-neutral-600">That admin screen does not exist.</p>
          <Link
            href="/"
            className="mt-6 inline-flex h-10 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
