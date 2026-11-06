'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker shipped from /sw.js.
 *
 * - Only registers in production-like environments (HTTPS or localhost).
 * - Skips registration on bare `http://` non-localhost hosts because the
 *   service worker would 404 and the browser would log a misleading error.
 * - Never unregisters a previously installed SW — we want upgrades to land
 *   naturally on the next navigation.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // In development (`next dev`), never cache `/_next/static/` chunks via a
    // service worker — unhashed dev chunks cause hydration mismatches if served
    // from Cache Storage after a hot reload or server restart. Actively
    // unregister any previously installed worker and clear caches in dev.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          for (const registration of registrations) {
            registration.unregister().catch(() => {});
          }
        })
        .catch(() => {});

      if ('caches' in window) {
        window.caches
          .keys()
          .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
          .catch(() => {});
      }
      return;
    }

    const isSecure =
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!isSecure) return;

    // Register at idle so it never competes with hydration.
    const handle = window.setTimeout(() => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* Swallow network/permission errors. The page must still load. */
      });
    }, 1500);
    return () => window.clearTimeout(handle);
  }, []);
  return null;
}
