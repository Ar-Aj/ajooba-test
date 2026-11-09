import type { MetadataRoute } from 'next';
import { fetchProducts } from '@/lib/api';
import { storefrontEnv } from '@/lib/env';

export const revalidate = 3600;

const PUBLIC_ROUTES = [
  '/',
  '/products',
  '/about',
  '/contact',
  '/shipping',
  '/returns',
  '/refund-policy',
  '/terms',
  '/privacy',
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = new URL(storefrontEnv.NEXT_PUBLIC_SITE_URL).origin;
  const entries: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((path) => ({
    url: new URL(path, origin).toString(),
    changeFrequency: path === '/' || path === '/products' ? 'daily' : 'monthly',
    priority: path === '/' ? 1 : path === '/products' ? 0.9 : 0.5,
  }));

  try {
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 499) {
      const result = await fetchProducts({ page, pageSize: 100 });
      for (const product of result.items) {
        entries.push({
          url: new URL(`/products/${encodeURIComponent(product.slug)}`, origin).toString(),
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
      totalPages = result.totalPages;
      page += 1;
    }
  } catch {
    // Keep the public pages available in the sitemap during a catalogue outage.
  }

  return entries;
}
