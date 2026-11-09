import type { MetadataRoute } from 'next';
import { storefrontEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account/', '/cart/', '/checkout/', '/login/', '/register/', '/search', '/api/'],
    },
    sitemap: new URL('/sitemap.xml', storefrontEnv.NEXT_PUBLIC_SITE_URL).toString(),
  };
}
