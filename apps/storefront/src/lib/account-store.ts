'use client';

import { readJSON, writeJSON } from './safe-storage';

/** A display-only mirror of the authenticated customer for the client header. */

export interface LocalAccount {
  fullName: string;
  email: string;
  phone?: string;
  /** ISO timestamp the record was created — purely informational. */
  joinedAt: string;
}

const KEY = 'ajooba-account-v1';

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export const accountStore = {
  read(): LocalAccount | null {
    return readJSON<LocalAccount | null>(KEY, null);
  },
  write(account: LocalAccount): void {
    writeJSON(KEY, account);
    notify();
  },
  signOut(): void {
    writeJSON<null>(KEY, null);
    notify();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
