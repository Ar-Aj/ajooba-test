import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopE2eProcesses } from './process-registry.js';

/**
 * End-to-end global teardown.
 *
 * Stops the child processes (the API, the storefront and the admin panel)
 * and the throwaway MongoDB instance, then removes the handshake file.
 *
 * Stopping the children explicitly matters on Windows: `pnpm` spawns a
 * grandchild `node` process, and killing only the parent would leave the
 * grandchild holding the port. The whole tree is terminated instead.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.resolve(here, '..', '..', 'node_modules', '.cache', 'ajooba-e2e');
const stateFile = path.join(stateDir, 'state.json');

export default async function globalTeardown(): Promise<void> {
  process.stdout.write('[e2e-teardown] Stopping the end-to-end stack.\n');

  await stopE2eProcesses();

  await rm(stateFile, { force: true });
  process.stdout.write('[e2e-teardown] Cleaned up the end-to-end handshake file.\n');
}
