/**
 * Public, browser-safe media URL helper.
 *
 * The full, validated environment (including the server-only
 * `API_INTERNAL_URL`) lives in `@/lib/env`. That module parses
 * `process.env` at load time and throws on missing variables — including
 * ones that are intentionally absent in the browser. A Client Component
 * importing `@/lib/env` would crash at hydration, replacing the whole page
 * with the error boundary. So this module exists: it reads exactly one
 * public variable and exposes the URL helper without any validation.
 *
 * The catalogue stores image URLs as root-relative paths starting with
 * `/products/...`, e.g. `/products/AJ-A57/A57-BLK-1.jpeg`. The production
 * media server (API in dev, CDN in prod) is configured under
 * `NEXT_PUBLIC_MEDIA_BASE_URL`. The storefront's own static assets (logo,
 * banners, icons, manifest, service worker, OG image) live under
 * `apps/storefront/public/` and must resolve as same-origin paths.
 *
 * Decision rule (kept simple and explicit so the test can pin it down):
 *   - a path starting with `/products/`   — prefix with the media base
 *   - any other path                       — leave as root-relative
 *
 * The dev setup currently configures the API to serve the catalogue media
 * tree from `MEDIA_STATIC_DIR/public/products`, so `product` paths hit the
 * API; the storefront's own `/banner`, `/images`, `/icons` are its own.
 */
const MEDIA_BASE_URL = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '/').replace(/\/$/, '');

/** Build a URL for a public asset whose path is root-relative. */
export function mediaUrl(path: string): string {
  if (!path) return '/';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  // Same-origin assets — leave the path root-relative.
  if (!suffix.startsWith('/products/')) return suffix;
  // Catalogue media — prefix with the configured media origin.
  if (MEDIA_BASE_URL === '' || MEDIA_BASE_URL === '/') return suffix;
  return `${MEDIA_BASE_URL}${suffix}`;
}
