'use client';

import type { CustomerAddress } from '@ajooba/contracts';
import { CustomerAuthError, customerApiRequest, customerSession } from './customer-session';
import { readJSON, writeJSON } from './safe-storage';
import type { Address } from './commerce-types';

const KEY = 'ajooba-addresses-v1';
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export function fromApiAddress(addr: CustomerAddress): Address {
  const digits = addr.phone.replace(/\D/g, '').slice(-10);
  return {
    id: addr.id,
    label: addr.label || 'Home',
    fullName: addr.fullName,
    phone: digits || addr.phone,
    line1: addr.line1,
    ...(addr.line2 ? { line2: addr.line2 } : {}),
    city: addr.city,
    state: addr.state,
    postalCode: addr.postalCode,
    country: 'India',
    isDefault: Boolean(addr.isDefault),
  };
}

function toApiPayload(input: Omit<Address, 'id'>) {
  const digits = input.phone.replace(/\D/g, '').slice(-10);
  return {
    label: input.label || 'Home',
    fullName: input.fullName.trim(),
    phone: digits.length === 10 ? `+91${digits}` : input.phone.trim(),
    line1: input.line1.trim(),
    line2: input.line2?.trim() ?? '',
    city: input.city.trim(),
    state: input.state,
    postalCode: input.postalCode.trim(),
    country: 'India',
    isDefault: Boolean(input.isDefault),
  };
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
    if (input.isDefault) {
      for (const existing of items) {
        existing.isDefault = false;
      }
    }
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
    if (next.length > 0 && !next.some((a) => a.isDefault)) {
      next[0] = { ...next[0]!, isDefault: true };
    }
    addressStore.save(next);
    return next;
  },
  clear(): Address[] {
    addressStore.save([]);
    return [];
  },
  default(): Address | undefined {
    return addressStore.list().find((a) => a.isDefault) ?? addressStore.list()[0];
  },
  /**
   * Fetch the signed-in customer's saved addresses from `/v1/addresses` and
   * update the reactive local cache.
   */
  async syncFromServer(): Promise<Address[]> {
    if (!customerSession.read()) return addressStore.list();
    const response = await customerApiRequest<{ items: CustomerAddress[]; count: number }>(
      '/v1/addresses',
    );
    const items = response.items.map(fromApiAddress);
    addressStore.save(items);
    return items;
  },
  /**
   * Create or update an address in `/v1/addresses` when signed in, falling back
   * to browser storage only when offline or unauthenticated.
   */
  async saveRemote(input: Omit<Address, 'id'> & { id?: string }): Promise<Address> {
    const fallbackAddress: Address = {
      ...input,
      id: input.id ?? `addr-${Math.random().toString(36).slice(2, 10)}`,
    };

    if (!customerSession.read()) {
      addressStore.upsert(fallbackAddress);
      return fallbackAddress;
    }

    const payload = toApiPayload(input);
    try {
      if (input.id && OBJECT_ID_RE.test(input.id)) {
        const updated = await customerApiRequest<CustomerAddress>(
          `/v1/addresses/${encodeURIComponent(input.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
        );
        const mapped = fromApiAddress(updated);
        addressStore.upsert(mapped);
        return mapped;
      }

      const created = await customerApiRequest<CustomerAddress>('/v1/addresses', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const mapped = fromApiAddress(created);
      const current = addressStore.list().filter((a) => a.id !== input.id);
      if (mapped.isDefault) {
        for (const item of current) item.isDefault = false;
      }
      addressStore.save([mapped, ...current.filter((a) => a.id !== mapped.id)]);
      return mapped;
    } catch (error) {
      if (
        error instanceof CustomerAuthError &&
        (error.code === 'UNREACHABLE' || error.code === 'NO_API')
      ) {
        addressStore.upsert(fallbackAddress);
        return fallbackAddress;
      }
      throw error;
    }
  },
  /**
   * Mark an address as the default delivery address on the server and locally.
   */
  async makeDefaultRemote(id: string): Promise<void> {
    const previous = addressStore.list();
    addressStore.save(
      previous.map((item) => ({
        ...item,
        isDefault: item.id === id,
      })),
    );

    if (!customerSession.read() || !OBJECT_ID_RE.test(id)) return;

    try {
      await customerApiRequest<CustomerAddress>(`/v1/addresses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
    } catch (error) {
      if (
        error instanceof CustomerAuthError &&
        (error.code === 'UNREACHABLE' || error.code === 'NO_API')
      ) {
        return;
      }
      addressStore.save(previous);
      throw error;
    }
  },
  /**
   * Remove an address from `/v1/addresses` and update local state.
   */
  async removeRemote(id: string): Promise<void> {
    const previous = addressStore.list();
    addressStore.remove(id);

    if (!customerSession.read() || !OBJECT_ID_RE.test(id)) return;

    try {
      const response = await customerApiRequest<{
        deleted: boolean;
        items: CustomerAddress[];
        count: number;
      }>(`/v1/addresses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      addressStore.save(response.items.map(fromApiAddress));
    } catch (error) {
      if (
        error instanceof CustomerAuthError &&
        (error.code === 'UNREACHABLE' || error.code === 'NO_API')
      ) {
        return;
      }
      addressStore.save(previous);
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
