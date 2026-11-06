'use client';

import { readJSON, writeJSON } from './safe-storage';

const KEY = 'ajooba-wishlist-v1';

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export interface WishlistItem {
  productId: string;
  productSlug: string;
  productTitle: string;
  productCode: string;
  unitPrice: number;
  unitMrp: number;
  imageUrl?: string;
  imageAlt?: string;
  addedAt: string;
}

export const wishlistStore = {
  list(): WishlistItem[] {
    return readJSON<WishlistItem[]>(KEY, []);
  },
  save(items: WishlistItem[]): void {
    writeJSON(KEY, items);
    notify();
  },
  add(input: Omit<WishlistItem, 'addedAt'>): WishlistItem[] {
    const items = wishlistStore.list();
    if (items.some((it) => it.productId === input.productId)) return items;
    items.push({ ...input, addedAt: new Date().toISOString() });
    wishlistStore.save(items);
    return items;
  },
  remove(productId: string): WishlistItem[] {
    const next = wishlistStore.list().filter((it) => it.productId !== productId);
    wishlistStore.save(next);
    return next;
  },
  toggle(input: Omit<WishlistItem, 'addedAt'>): {
    items: WishlistItem[];
    added: boolean;
  } {
    const items = wishlistStore.list();
    const exists = items.some((it) => it.productId === input.productId);
    if (exists) {
      wishlistStore.save(items.filter((it) => it.productId !== input.productId));
      return { items: wishlistStore.list(), added: false };
    }
    items.push({ ...input, addedAt: new Date().toISOString() });
    wishlistStore.save(items);
    return { items: wishlistStore.list(), added: true };
  },
  clear(): WishlistItem[] {
    wishlistStore.save([]);
    return [];
  },
  has(productId: string): boolean {
    return wishlistStore.list().some((it) => it.productId === productId);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
