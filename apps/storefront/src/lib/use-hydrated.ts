'use client';

import { useSyncExternalStore } from 'react';

/**
 * `false` on the server and during this component's own hydration render,
 * `true` immediately afterwards.
 *
 * ## The problem this solves
 *
 * Device-local state (cart, wishlist, account) lives in `localStorage`, so the
 * server renders "0 saved". The provider reads the real value on mount. That is
 * correct *for the provider* — but context does not carry "which pass am I in".
 *
 * The header sits inside a `Suspense` boundary (it calls `useSearchParams`, which
 * forces one for static prerendering). React can commit the provider, read the
 * visitor's saved wishlist, and only *then* hydrate the header. The header's
 * hydration render then compares "1 saved" from context against the server's
 * "0 saved" in the HTML:
 *
 *     Hydration failed ... aria-label="Wishlist, 1 saved" / "Wishlist, 0 saved"
 *
 * Gating on `ready` from context does not help, because `ready` is itself state
 * that has already flipped by the time the deferred subtree hydrates. The flag
 * has to be asked for *by the component that renders the markup*, so that the
 * answer belongs to that component's pass.
 *
 * ## Why this works
 *
 * `useSyncExternalStore` returns its **server** snapshot during hydration, per
 * component, no matter how late that component hydrates. Returning `false` there
 * and `true` from the client snapshot gives every consumer a reliable "am I past
 * hydration?" — and the store-derived markup stays at the server's value until
 * the true answer arrives one commit later.
 */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
