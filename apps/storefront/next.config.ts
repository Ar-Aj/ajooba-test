import type { NextConfig } from 'next';

/**
 * Next.js configuration for the customer storefront.
 *
 * Note on images: the catalogue stores image paths as root-relative URLs
 * (`/products/AJ-A1/A1 - 1.jpg`) and the API serves that tree from its own
 * origin (or, in production, a CDN/object store). The storefront prefixes
 * them with `NEXT_PUBLIC_MEDIA_BASE_URL`.
 *
 * The storefront does NOT use `next/image` for catalogue photography. The
 * source files are up to ~2.4 MB each and there are 770 of them; optimising
 * them through the Next image pipeline would add a per-request cost to an
 * origin that already has to serve them. Instead the storefront renders
 * plain `<img>` elements with explicit `width`/`height`, `loading="lazy"`
 * and `decoding="async"`, and lets the browser's own image decoding and
 * the CDN handle delivery. This is a deliberate, documented trade-off.
 *
 * `remotePatterns` is still configured so that `next/image` may be used for
 * any future remote asset without a code change.
 */
/**
 * The build output directory.
 *
 * `NEXT_DIST_DIR` exists so the end-to-end suite can build this app with
 * throwaway URLs without clobbering the developer's own production build in
 * `.next`. It defaults to `.next`, so a normal build is completely
 * unaffected.
 *
 * The value is validated because it becomes a filesystem path: a value
 * containing a path separator or a parent-directory segment would write the
 * build outside the application directory.
 */
function resolveDistDir(): string {
  const configured = process.env.NEXT_DIST_DIR?.trim();

  if (!configured) return '.next';
  if (!/^[A-Za-z0-9._-]+$/.test(configured) || configured.includes('..')) {
    throw new Error(
      `NEXT_DIST_DIR must be a simple directory name (letters, digits, dot, dash, underscore). ` +
        `Received: ${configured}`,
    );
  }
  return configured;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: resolveDistDir(),

  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 414, 640, 750, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '4000',
        pathname: '/products/**',
      },
      {
        protocol: 'https',
        hostname: '**.r2.dev',
        pathname: '/products/**',
      },
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
        pathname: '/products/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      {
        // The service worker must never be cached for long, or a stale
        // worker can pin an old build. Everything else in `public/` is
        // content-addressed by the service worker's own cache strategy.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
          { key: 'Cache-Control', value: 'public, max-age=3600' },
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
