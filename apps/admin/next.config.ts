import type { NextConfig } from 'next';

const adminBasePath = process.env.VERCEL ? '/admin' : '';

/**
 * Next.js configuration for the admin panel.
 *
 * The admin panel is never indexed by search engines and is protected at the
 * edge. It is also the only application that may hold admin credentials.
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
  basePath: adminBasePath,
  env: {
    NEXT_PUBLIC_ADMIN_BASE_PATH: adminBasePath,
  },
  reactStrictMode: true,
  poweredByHeader: false,
  distDir: resolveDistDir(),

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
