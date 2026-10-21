import Link from 'next/link';

/**
 * 404 page.
 *
 * Used when a product slug does not exist in the catalogue. It is a real
 * page, not a redirect, and it never suggests a product that may not exist.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh">
      <div className="container-page py-16">
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
          <h1 className="text-lg font-medium">Page not found</h1>
          <p className="mt-2 text-sm text-neutral-600">
            The page or product you are looking for is not in the catalogue.
          </p>
          <Link
            href="/products"
            className="mt-6 inline-flex h-10 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
          >
            Browse all footwear
          </Link>
        </div>
      </div>
    </main>
  );
}
