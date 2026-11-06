'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribes to one of the tiny local stores (see `src/lib/*-store.ts`) and
 * re-renders the consumer whenever the store reports a change.
 *
 * ## Why `useSyncExternalStore` and not `useState` + `useEffect`
 *
 * The stores read `localStorage`, which does not exist on the server. The
 * obvious shape — seed `useState` with the server value, then read the device in
 * an effect — compares a client tree built from the visitor's saved cart against
 * a server tree built from nothing. `useSyncExternalStore` is the primitive
 * React provides for this: it takes a **server snapshot** as well as a client
 * one, so React always has an answer that is valid for the pass it is doing.
 *
 * ## What `initialValue` means
 *
 * It is the server snapshot: the value the server rendered. It must equal what
 * the server produced — an empty list, `null` — because it is what React
 * measures hydration against.
 *
 * ## Why snapshots are cached
 *
 * `useSyncExternalStore` re-reads the snapshot on every render and re-renders
 * only when it changes *by identity*. The stores parse `localStorage` afresh, so
 * an uncached read returns a new array on every call and React would warn
 * ("The result of getSnapshot should be cached") and loop. Snapshots are cached
 * per subscription against their serialised form: identical content returns the
 * previous object, changed content returns a new one. Comparing content rather
 * than reference also keeps the stores' deliberate in-place edits (see
 * `cartStore.add`) visible, because the comparison happens after the write.
 */

/** One cached snapshot per subscription. */
const snapshotCache = new WeakMap<
  (listener: () => void) => () => void,
  { serialised: string; value: unknown }
>();

function cachedSnapshot<T>(read: () => T, subscribe: (listener: () => void) => () => void): T {
  const value = read();

  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? 'undefined';
  } catch {
    /* A store that cannot be serialised simply loses the identity cache. */
    return value;
  }

  const cached = snapshotCache.get(subscribe);
  if (cached && cached.serialised === serialised) return cached.value as T;

  snapshotCache.set(subscribe, { serialised, value });
  return value;
}

export function useLocalStore<T>(
  read: () => T,
  subscribe: (listener: () => void) => () => void,
  initialValue: T,
): T {
  const getSnapshot = useCallback(() => cachedSnapshot(read, subscribe), [read, subscribe]);
  const getServerSnapshot = useCallback(() => initialValue, [initialValue]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
