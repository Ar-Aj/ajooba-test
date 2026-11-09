import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiRequestError, fetchCategories, fetchProductBySlug } from '@/lib/api';
import { storefrontEnv } from '@/lib/env';
import { mediaUrl } from '@/lib/media';
import { ProductGallerySection } from '@/features/catalog/components/product-gallery-section';
import { ProductAttributes } from '@/features/catalog/components/product-attributes';
import { PageViewTracker } from '@/components/track/page-view-tracker';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ServiceUnavailable } from '@/components/ui/empty-states';

/**
 * Product detail page.
 *
 * Renders a single real product. When the product genuinely does not exist the
 * page returns a proper 404 via `notFound()`. When the catalogue API is
 * unreachable it renders an explicit "temporarily unavailable" message — showing
 * a 404 for a product that may well exist would be a lie, and showing
 * placeholder product details would be worse.
 *
 * ## The category name is resolved, not guessed
 *
 * The breadcrumb reads the live taxonomy to turn the product's
 * `subcategorySlug` into a display name. It used to read
 * `getSubcategory()` — a hardcoded four-entry map — so a design in an
 * administrator-created category showed its raw slug in the breadcrumb, or the
 * wrong label entirely if a slug had been reused.
 */

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;

  let product = null;
  try {
    product = await fetchProductBySlug(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnavailable) {
      return { title: 'Product' };
    }
    throw error;
  }

  if (!product) {
    return { title: 'Product not found', robots: { index: false, follow: true } };
  }

  const description = product.description.slice(0, 160) || `${product.title} from Ajooba Footwear.`;

  // Prefer a verified image for the social card; never surface a quarantined one.
  const socialImage = product.images.find((image) => image.colour) ?? product.images[0];

  return {
    title: product.title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.title,
      description,
      type: 'website',
      images: socialImage
        ? [{ url: mediaUrl(socialImage.url), alt: socialImage.alt }]
        : [{ url: '/og.png', width: 1200, height: 630 }],
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;

  let product = null;
  let categories: Awaited<ReturnType<typeof fetchCategories>> = [];
  try {
    [product, categories] = await Promise.all([fetchProductBySlug(slug), fetchCategories()]);
  } catch (error) {
    if (error instanceof ApiRequestError && error.isUnavailable) {
      return (
        <div className="container-page py-16">
          <ServiceUnavailable what="this product" />
        </div>
      );
    }
    throw error;
  }

  if (!product) {
    notFound();
  }

  const category = categories.find((entry) => entry.slug === product.subcategorySlug);
  const categoryName = category?.displayName ?? product.subcategory;
  const categoryHref = category
    ? `/products?subcategory=${encodeURIComponent(category.slug)}`
    : undefined;

  // The design's lead verified image, used only for the sr-only reference below.
  const primary = product.images.find((image) => image.colour);

  return (
    <div className="container-page pt-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:py-10">
      {/*
        Counted in the browser, once, on mount. A server render happens for
        crawlers, for prefetches and sometimes twice for one visitor; counting
        those would inflate every view by a factor nobody can reproduce.
      */}
      <PageViewTracker
        kind="product"
        productId={product.id}
        categorySlug={product.subcategorySlug}
        categoryName={categoryName}
      />

      <Breadcrumbs
        className="mb-6 md:mb-8"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Shop', href: '/products' },
          { label: categoryName, href: categoryHref },
          { label: product.title },
        ]}
      />

      {/* JSON-LD: real product data only. No AggregateRating / review counts,
          because we do not collect or publish reviews. */}
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.title,
            description: product.description,
            sku: product.code,
            brand: { '@type': 'Brand', name: product.brand },
            category: categoryName,
            // Only verified images. Quarantined ones carry no `colour` and are
            // withheld from the storefront and from this structured data.
            image: product.images
              .filter((image) => image.colour)
              .map((image) => mediaUrl(image.url)),
            offers: {
              '@type': 'AggregateOffer',
              priceCurrency: 'INR',
              lowPrice: Math.min(
                ...product.variants.map((variant) => variant.sellingPrice),
                product.sellingPrice,
              ),
              highPrice: Math.max(
                ...product.variants.map((variant) => variant.sellingPrice),
                product.sellingPrice,
              ),
              offerCount: product.variants.length,
              availability: product.inStock
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock',
            },
          }).replace(/</g, '\\u003c'),
        }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Home',
                item: new URL('/', storefrontEnv.NEXT_PUBLIC_SITE_URL).toString(),
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'Shop',
                item: new URL('/products', storefrontEnv.NEXT_PUBLIC_SITE_URL).toString(),
              },
              ...(categoryHref
                ? [
                    {
                      '@type': 'ListItem',
                      position: 3,
                      name: categoryName,
                      item: new URL(categoryHref, storefrontEnv.NEXT_PUBLIC_SITE_URL).toString(),
                    },
                  ]
                : []),
              {
                '@type': 'ListItem',
                position: categoryHref ? 4 : 3,
                name: product.title,
                item: new URL(
                  `/products/${encodeURIComponent(product.slug)}`,
                  storefrontEnv.NEXT_PUBLIC_SITE_URL,
                ).toString(),
              },
            ],
          }).replace(/</g, '\\u003c'),
        }}
      />

      <ProductGallerySection product={product} />

      <ProductAttributes product={product} />

      {primary ? <p className="sr-only">Reference image {primary.sourceFile}</p> : null}
    </div>
  );
}
