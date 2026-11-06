'use client';

import { readJSON, writeJSON } from './safe-storage';
import type { Address } from './commerce-types';

const KEY = 'ajooba-addresses-v1';

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export const addressStore = {
  list(): Address[] {
    return readJSON<Address[]>(KEY, []);
  },
  save(items: Address[]): void {
    writeJSON(KEY, items);
    notify();
  },
  upsert(input: Address): Address[] {
    const items = addressStore.list();
    const idx = items.findIndex((a) => a.id === input.id);
    if (idx === -1) {
      items.push(input);
    } else {
      items[idx] = input;
    }
    addressStore.save(items);
    return items;
  },
  remove(id: string): Address[] {
    const next = addressStore.list().filter((a) => a.id !== id);
    addressStore.save(next);
    return next;
  },
  default(): Address | undefined {
    return addressStore.list().find((a) => a.isDefault);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
