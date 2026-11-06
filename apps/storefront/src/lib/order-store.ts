'use client';

import { readJSON, writeJSON } from './safe-storage';
import type { LocalOrder, LocalOrderLine } from './commerce-types';
import type { Address } from './commerce-types';

const KEY = 'ajooba-orders-v1';

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

function makeOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `AJ-LOC-${ts}-${rand}`;
}

export const orderStore = {
  list(): LocalOrder[] {
    return readJSON<LocalOrder[]>(KEY, []);
  },
  save(items: LocalOrder[]): void {
    writeJSON(KEY, items);
    notify();
  },
  place(input: {
    lines: LocalOrderLine[];
    subtotal: number;
    shipping: number;
    shippingAddress: Address;
  }): LocalOrder {
    const items = orderStore.list();
    const order: LocalOrder = {
      id: `o-${Math.random().toString(36).slice(2, 10)}`,
      number: makeOrderNumber(),
      lines: input.lines,
      subtotal: input.subtotal,
      shipping: input.shipping,
      total: input.subtotal + input.shipping,
      status: 'placed',
      placedAt: new Date().toISOString(),
      shippingAddress: input.shippingAddress,
      paymentState: 'unpaid',
      notes: ['local-test-order — payments not enabled'],
    };
    items.unshift(order);
    orderStore.save(items);
    return order;
  },
  getByNumber(number: string): LocalOrder | undefined {
    return orderStore.list().find((o) => o.number === number);
  },
  clear(): LocalOrder[] {
    orderStore.save([]);
    return [];
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
