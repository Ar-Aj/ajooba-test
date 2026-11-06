'use client';

import { readJSON, writeJSON } from './safe-storage';
import type { CartLine } from './commerce-types';

const KEY = 'ajooba-cart-v1';

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export const cartStore = {
  list(): CartLine[] {
    return readJSON<CartLine[]>(KEY, []);
  },
  save(lines: CartLine[]): void {
    writeJSON(KEY, lines);
    notify();
  },
  /**
   * Add a variant to the cart. If a line for the same `variantSku` already
   * exists, its `quantity` is incremented up to the per-line `max`.
   */
  add(input: Omit<CartLine, 'id' | 'addedAt'> & { id?: string }): CartLine[] {
    const lines = cartStore.list();
    const existing = lines.find((l) => l.variantSku === input.variantSku);
    if (existing) {
      existing.quantity = Math.min(10, existing.quantity + input.quantity);
      cartStore.save(lines);
      return lines;
    }
    const newLine: CartLine = {
      ...input,
      id: input.id ?? `cl-${Math.random().toString(36).slice(2, 10)}`,
      addedAt: new Date().toISOString(),
    };
    lines.push(newLine);
    cartStore.save(lines);
    return lines;
  },
  remove(id: string): CartLine[] {
    const next = cartStore.list().filter((l) => l.id !== id);
    cartStore.save(next);
    return next;
  },
  updateQuantity(id: string, quantity: number): CartLine[] {
    const lines = cartStore.list();
    const line = lines.find((l) => l.id === id);
    if (!line) return lines;
    if (quantity <= 0) {
      cartStore.save(lines.filter((l) => l.id !== id));
      return cartStore.list();
    }
    line.quantity = Math.min(10, Math.max(1, Math.floor(quantity)));
    cartStore.save(lines);
    return lines;
  },
  clear(): CartLine[] {
    cartStore.save([]);
    return [];
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
