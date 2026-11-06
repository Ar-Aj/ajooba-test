/* Ajooba Footwear — service worker (conservative offline support)
 *
 * Strategy:
 *   - On install: pre-cache the manifest, off-page shell, and a tiny logo
 *     asset so the first visit can show *something* on cold start offline.
 *   - On fetch:
 *       - Same-origin GETs that are explicitly allow-listed (static assets)
 *         go through a stale-while-revalidate cache. This gives us speed and
 *         graceful upgrades; never used for navigations or private data.
 *       - All other requests (including ALL documents, /api/*, account/*,
 *         /checkout/*, /login/*) fall through to the network. We never
 *         cache them, by design — stale authenticated pages are how
 *         data leaks happen on shared devices.
 */

const VERSION = 'v2';
const STATIC_CACHE = `ajooba-static-${VERSION}`;
const PRECACHE = ['/', '/offline', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {
        /* precache is best-effort; offline is a progressive enhancement */
      }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const NEVER_CACHE_PREFIXES = [
  '/account',
  '/checkout',
  '/cart',
  '/login',
  '/register',
  '/forgot-password',
  '/api/',
];

const STATIC_ASSET_PREFIXES = ['/icons/', '/images/', '/_next/static/'];

function isNeverCached(url) {
  const path = url.pathname;
  return NEVER_CACHE_PREFIXES.some((p) => path.startsWith(p));
}

function isStaticAsset(url) {
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return false;
  }
  const path = url.pathname;
  return STATIC_ASSET_PREFIXES.some((p) => path.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache private surfaces.
  if (isNeverCached(url)) return;
  // Never cache HTML navigations — pages are dynamic.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        const offline = await cache.match('/offline');
        return (
          offline ||
          new Response(
            '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/offline"><title>Offline</title>',
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          )
        );
      }),
    );
    return;
  }

  // Static asset cache: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        const fetchPromise = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })(),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
