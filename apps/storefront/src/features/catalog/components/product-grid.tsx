import type { Product } from '@ajooba/contracts';
import Link from 'next/link';
import { mediaUrl } from '@/lib/env';

/**
 * Product grid.
 *
 * Renders real products from the API. When the catalogue is empty it renders
 * an explicit empty state — it never substitutes placeholder or sample
 * products.
 */

interface ProductGridProps {
  products: readonly Product[];
  totalItems: number;
}

export function ProductGrid({ products, totalItems }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
        <h2 className="text-base font-medium">No products found</h2>
        <p className="mt-2 text-sm text-neutral-600">
          The catalogue is empty for these filters. Browse the full catalogue to see every design.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-flex h-10 items-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
        >
          Clear filters
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-neutral-600">
        {totalItems} {totalItems === 1 ? 'design' : 'designs'}
      </p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => {
          const primary = product.images[0];
          return (
            <li key={product.id}>
              <Link
                href={`/products/${product.slug}`}
                className="group block overflow-hidden rounded-lg border border-neutral-200"
              >
                <div className="aspect-square bg-neutral-100">
                  {primary ? (
                    <img
                      src={mediaUrl(primary.url)}
                      alt={primary.alt}
                      width={600}
                      height={600}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  ) : null}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium">{product.title}</p>
                  <p className="mt-1 text-sm text-neutral-600">
                    ₹{product.sellingPrice.toLocaleString('en-IN')}
                    {product.mrp > product.sellingPrice ? (
                      <span className="ml-2 text-neutral-400 line-through">
                        ₹{product.mrp.toLocaleString('en-IN')}
                      </span>
                    ) : null}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
