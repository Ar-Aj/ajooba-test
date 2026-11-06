/**
 * Safe `localStorage` access for SSR-safe client stores.
 *
 * The storefront's cart / wishlist / addresses / orders are local-only in
 * this phase (the API does not yet implement any of those surfaces —
 * `docs/API_CONTRACT.md` § 3.4). They MUST never be relied on from server
 * code, hence every getter / setter is also imported lazily inside a
 * `"use client"` boundary.
 */

const isBrowser = (): boolean => typeof window !== 'undefined';

export function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, value: T): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or permission errors are silently ignored — these stores are advisory. */
  }
}

export function remove(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* see writeJSON */
  }
}
