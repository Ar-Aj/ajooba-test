import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiRequestError, fetchProductBySlug } from '@/lib/api';
import { mediaUrl } from '@/lib/env';

/**
 * Product detail page.
 *
 * Renders a single real product. When the product genuinely does not exist the
 * page returns a proper 404 via `notFound()`.
 *
 * When the catalogue API is unreachable the page renders an explicit
 * "temporarily unavailable" message instead. Showing a 404 for a product that
 * may well exist would be a lie, and showing placeholder product details
 * would be worse.
 */

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

/** Rendered when the catalogue service cannot be reached. */
function ProductUnavailable() {
  return (
    <main className="min-h-dvh">
      <div className="container-page py-16">
        <div className="rounded-lg border border-dashed border-neutral-300 p-12 text-center">
          <h1 className="text-lg font-medium">Product temporarily unavailable</h1>
          <p className="mt-2 text-sm text-neutral-600">
            We could not reach the catalogue service. Please try again in a moment.
          </p>
        </div>
      </div>
    </main>
  );
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;

  let product = null;
  try {
    product = await fetchProductBySlug(slug);
  } catch (error) {
    // The API is down. Metadata cannot be generated from live data, so fall
    // back to a neutral title rather than failing the whole render.
    if (error instanceof ApiRequestError && error.isUnavailable) {
      return { title: 'Product' };
    }
    throw error;
  }

  if (!product) {
    return { title: 'Product not found' };
  }

  return {
    title: product.title,
    description: product.description.slice(0, 160),
    openGraph: {
      title: product.title,
      description: product.description.slice(0, 160),
      images: product.images[0] ? [mediaUrl(product.images[0].url)] : [],
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;

  let product = null;
  try {
    product = await fetchProductBySlug(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnavailable) {
      return <ProductUnavailable />;
    }
    throw error;
  }

  if (!product) {
    notFound();
  }

  const primary = product.images[0];

  return (
    <main className="min-h-dvh">
      <div className="container-page grid grid-cols-1 gap-8 py-8 lg:grid-cols-2 md:py-12">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
          {primary ? (
            <img
              src={mediaUrl(primary.url)}
              alt={primary.alt}
              width={800}
              height={800}
              className="h-auto w-full object-cover"
            />
          ) : null}
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{product.title}</h1>
          <p className="mt-3 text-xl font-medium">
            ₹{product.sellingPrice.toLocaleString('en-IN')}
            {product.mrp > product.sellingPrice ? (
              <span className="ml-3 text-base font-normal text-neutral-400 line-through">
                ₹{product.mrp.toLocaleString('en-IN')}
              </span>
            ) : null}
          </p>

          <dl className="mt-6 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-neutral-500">Category</dt>
              <dd>{product.subcategory}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-neutral-500">Colours</dt>
              <dd>{product.colours.join(', ')}</dd>
            </div>
          </dl>

          <div className="mt-6">
            <h2 className="text-sm font-medium">Available sizes</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {product.variants.map((variant) => (
                <li
                  key={variant.sku}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
                >
                  {variant.size}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-medium">Description</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-700">
              {product.description}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
