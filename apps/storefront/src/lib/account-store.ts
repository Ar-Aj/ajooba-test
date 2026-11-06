'use client';

import { readJSON, writeJSON } from './safe-storage';

/**
 * Account / session placeholder.
 *
 * Auth is **not implemented** in this phase (`docs/API_CONTRACT.md` § 1.5
 * and `docs/ARCHITECTURE.md` § Deliberate non-goals). The customer surfaces
 * still need a way to let a logged-out person explore the account section:
 * the local account record is a single name + email per device, stored in
 * localStorage, never sent anywhere. It exists so that header state and
 * route guards can show a coherent "you're signed in as X" experience
 * without ever making a real auth claim.
 */

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
