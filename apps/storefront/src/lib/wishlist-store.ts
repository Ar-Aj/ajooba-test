'use client';

import { CustomerAuthError, customerApiRequest, customerSession } from './customer-session';
import { mediaUrl } from './media';
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

interface ApiWishlistProduct {
  id?: string;
  _id?: string;
  code: string;
  slug: string;
  title: string;
  mrp: number;
  sellingPrice: number;
  images?: Array<{ url: string; alt?: string }>;
}

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

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
  /**
   * Pull the signed-in customer's saved wishlist from `/v1/wishlist` and update
   * the reactive local cache so every surface reflects the account's items.
   */
  async syncFromServer(): Promise<WishlistItem[]> {
    if (!customerSession.read()) return wishlistStore.list();
    const existingById = new Map(wishlistStore.list().map((item) => [item.productId, item]));
    const response = await customerApiRequest<{ items: ApiWishlistProduct[]; count: number }>(
      '/v1/wishlist',
    );
    const now = new Date().toISOString();
    const mapped: WishlistItem[] = response.items
      .map((doc) => {
        const productId = doc.id ?? (typeof doc._id === 'string' ? doc._id : '');
        if (!productId) return null;
        const previous = existingById.get(productId);
        const firstImage = doc.images?.[0];
        return {
          productId,
          productSlug: doc.slug,
          productTitle: doc.title,
          productCode: doc.code,
          unitPrice: doc.sellingPrice,
          unitMrp: doc.mrp,
          ...(firstImage?.url
            ? { imageUrl: mediaUrl(firstImage.url), imageAlt: firstImage.alt ?? doc.title }
            : previous?.imageUrl
              ? { imageUrl: previous.imageUrl, imageAlt: previous.imageAlt }
              : {}),
          addedAt: previous?.addedAt ?? now,
        } satisfies WishlistItem;
      })
      .filter((item): item is WishlistItem => item !== null);
    wishlistStore.save(mapped);
    return mapped;
  },
  /**
   * Toggle a wishlist item and persist the change to `/v1/wishlist` when the
   * customer has an active API session.
   */
  async toggleRemote(input: Omit<WishlistItem, 'addedAt'>): Promise<{
    items: WishlistItem[];
    added: boolean;
  }> {
    const previous = wishlistStore.list();
    const localResult = wishlistStore.toggle(input);
    if (!customerSession.read() || !OBJECT_ID_RE.test(input.productId)) {
      return localResult;
    }

    try {
      if (localResult.added) {
        await customerApiRequest('/v1/wishlist', {
          method: 'POST',
          body: JSON.stringify({ productId: input.productId }),
        });
      } else {
        await customerApiRequest(`/v1/wishlist/${encodeURIComponent(input.productId)}`, {
          method: 'DELETE',
        });
      }
      return localResult;
    } catch (error) {
      if (
        error instanceof CustomerAuthError &&
        (error.code === 'UNREACHABLE' || error.code === 'NO_API')
      ) {
        return localResult;
      }
      wishlistStore.save(previous);
      throw error;
    }
  },
  /**
   * Remove a wishlist item and delete it from `/v1/wishlist` when signed in.
   */
  async removeRemote(productId: string): Promise<WishlistItem[]> {
    const previous = wishlistStore.list();
    const next = wishlistStore.remove(productId);
    if (!customerSession.read() || !OBJECT_ID_RE.test(productId)) {
      return next;
    }

    try {
      await customerApiRequest(`/v1/wishlist/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
      return next;
    } catch (error) {
      if (
        error instanceof CustomerAuthError &&
        (error.code === 'UNREACHABLE' || error.code === 'NO_API')
      ) {
        return next;
      }
      wishlistStore.save(previous);
      throw error;
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
