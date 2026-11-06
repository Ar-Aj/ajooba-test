import { spawn, type ChildProcess } from 'node:child_process';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { shutdownMongoServer } from './mongo-shutdown.js';

/**
 * Shared state between the E2E global setup and global teardown.
 *
 * Playwright loads both modules in the same process, so a module-level
 * registry is the simplest way for the teardown to reach the child
 * processes the setup started.
 */

/** The child processes started by the E2E run. */
export const e2eProcesses: ChildProcess[] = [];

/** The throwaway MongoDB instance, so it can be stopped explicitly. */
let e2eMongoServer: MongoMemoryServer | undefined;

/** Record the throwaway MongoDB instance. */
export function setE2eMongoServer(server: MongoMemoryServer): void {
  e2eMongoServer = server;
}

/**
 * Stop every child process.
 *
 * On Windows the child is `pnpm`, which itself spawned `node`/`tsx`. Killing
 * only the parent would leave the grandchild holding the port, so the whole
 * process *tree* is terminated.
 */
export async function stopE2eProcesses(): Promise<void> {
  for (const child of e2eProcesses) {
    if (child.pid === undefined || child.exitCode !== null) {
      continue;
    }

    const pid = child.pid;

    if (process.platform === 'win32') {
      // `taskkill /T` kills the process tree.
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          shell: true,
        });
        killer.on('exit', () => resolve());
        killer.on('error', () => resolve());
      });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Already gone.
        }
      }
    }
  }

  e2eProcesses.length = 0;

  if (e2eMongoServer) {
    // `mongod` is asked to shut down gracefully first. On Windows the
    // library's own `SIGINT` does not reach `mongod`, so `stop()` would
    // otherwise wait out a 10-second grace period, force-kill the process
    // and reject — failing the run even though every test passed. See
    // `tests/e2e/mongo-shutdown.ts` for the full explanation.
    await shutdownMongoServer(e2eMongoServer);
    await e2eMongoServer.stop();
    e2eMongoServer = undefined;
  }
}

/** Spawn a child process and register it for teardown. */
export function spawnTracked(child: ChildProcess): ChildProcess {
  e2eProcesses.push(child);
  return child;
}
