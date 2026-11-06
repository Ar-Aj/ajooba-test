import { mongo } from 'mongoose';
import type { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Graceful shutdown for the throwaway `mongod`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `mongodb-memory-server` stops a standalone `mongod` by sending it a
 * `SIGINT`. On Windows that signal does not reach the process the way it
 * does on POSIX, so `mongod` keeps running, the library waits out its
 * hardcoded 10-second grace period, then sends `SIGKILL` — and the
 * library's own promise rejects with
 * `Process "mongodProcess" didnt exit`.
 *
 * That rejection propagates out of the teardown and turns a **fully
 * passing** suite into a failed run with a non-zero exit code. The tests
 * themselves are green; only the exit code lies.
 *
 * `mongod` does, however, implement the MongoDB `shutdown` command, which
 * is the supported way to ask it to stop. The library already uses exactly
 * this technique for replica sets — it is only the standalone path that
 * skips it. Sending the command ourselves before calling `stop()` makes
 * `mongod` exit within milliseconds, so the library's `killProcess` finds
 * the process already gone and returns immediately.
 *
 * THE COMMAND REJECTS — THAT IS EXPECTED
 * --------------------------------------
 * A successful `shutdown` closes the connection that carried the command,
 * so the driver sees the socket reset before the reply arrives. The
 * library treats that exact error (`ECONNRESET`, or "connection … closed")
 * as success. We do the same, and we verify the outcome by waiting for the
 * process to actually exit rather than trusting the command's reply.
 */

/** How long to wait for `mongod` to exit after the shutdown command. */
const EXIT_TIMEOUT_MS = 15_000;

/**
 * True when the error is the expected "the connection died because the
 * server is shutting down" failure rather than a real problem.
 */
function isExpectedShutdownError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;

  return (
    message.includes('ECONNRESET') ||
    message.includes('connection closed') ||
    message.includes('Topology closed') ||
    message.includes('socket hang up') ||
    error.name === 'MongoNetworkError'
  );
}

/**
 * Ask `mongod` to shut down and wait for the process to exit.
 *
 * Returns `true` when the process is confirmed gone, `false` when the
 * shutdown could not be completed. A `false` result is not fatal: the
 * caller still calls `server.stop()`, which is the library's own cleanup
 * path and will force the process down if it is still alive.
 */
export async function shutdownMongoServer(server: MongoMemoryServer): Promise<boolean> {
  const instance = server.instanceInfo?.instance;
  const mongod = instance?.mongodProcess;

  // Nothing to do when the server never started, or is already stopped.
  if (!mongod || mongod.exitCode !== null || mongod.signalCode !== null) {
    return true;
  }

  const uri = server.getUri();

  try {
    const client = new mongo.MongoClient(uri, {
      serverSelectionTimeoutMS: 5_000,
      directConnection: true,
    });

    try {
      await client.connect();
      await client.db('admin').command({ shutdown: 1, force: true, timeoutSecs: 1 });
    } catch (error) {
      if (!isExpectedShutdownError(error)) {
        throw error;
      }
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch {
    // The shutdown command could not be delivered. Fall through: `stop()`
    // still terminates the process, it just takes the slow path.
    return false;
  }

  // Wait for the process to actually exit, so `stop()` does not have to.
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), EXIT_TIMEOUT_MS);

    mongod.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  return exited || mongod.exitCode !== null || mongod.signalCode !== null;
}
