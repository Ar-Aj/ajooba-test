'use client';

import { readJSON, writeJSON } from './safe-storage';
import type { ReturnRequest } from './commerce-types';

const KEY = 'ajooba-returns-v1';

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export const returnStore = {
  list(): ReturnRequest[] {
    return readJSON<ReturnRequest[]>(KEY, []);
  },
  save(items: ReturnRequest[]): void {
    writeJSON(KEY, items);
    notify();
  },
  submit(input: {
    orderNumber: string;
    reason: ReturnRequest['reason'];
    description: string;
    lineSkus: string[];
  }): ReturnRequest {
    const items = returnStore.list();
    const next: ReturnRequest = {
      id: `r-${Math.random().toString(36).slice(2, 10)}`,
      orderNumber: input.orderNumber,
      reason: input.reason,
      description: input.description,
      lineSkus: input.lineSkus,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
    };
    items.unshift(next);
    returnStore.save(items);
    return next;
  },
  getById(id: string): ReturnRequest | undefined {
    return returnStore.list().find((r) => r.id === id);
  },
  listByOrder(orderNumber: string): ReturnRequest[] {
    return returnStore.list().filter((r) => r.orderNumber === orderNumber);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const RETURN_REASONS: Array<{
  id: ReturnRequest['reason'];
  label: string;
  hint: string;
}> = [
  {
    id: 'size-issue',
    label: 'Wrong size or fit',
    hint: 'The shoes fit differently from what you expected.',
  },
  {
    id: 'damaged',
    label: 'Damaged in transit',
    hint: 'Please describe the damage in the notes below.',
  },
  {
    id: 'quality-issue',
    label: 'Quality concern',
    hint: 'Materials, stitching, sole or finish issue.',
  },
  {
    id: 'wrong-item',
    label: 'Wrong item delivered',
    hint: 'Different colour, design, or size than ordered.',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Anything else — please describe in detail.',
  },
];
