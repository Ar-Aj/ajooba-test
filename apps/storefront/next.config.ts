import type { NextConfig } from 'next';

/**
 * Next.js configuration for the customer storefront.
 *
 * Note on images: the source product images live in `public/products/**` and
 * are served as static assets. `next/image` optimises them at request time
 * from the same origin, so no external image CDN or third-party loader is
 * configured (and no third-party image host needs whitelisting).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    // Catalogue images are large (up to ~2.4 MB source files); allow
    // optimization of remote-less local assets without a loader.
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // Consistent canonical product URLs.
      { source: '/product/:slug', destination: '/products/:slug', permanent: true },
      { source: '/shop', destination: '/products', permanent: true },
    ];
  },
};

export default nextConfig;
