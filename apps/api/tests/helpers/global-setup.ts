import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { shutdownMongoServer } from './mongo-shutdown.js';

/**
 * Global test setup — the in-memory MongoDB instance.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API test suite needs a real MongoDB to exercise Mongoose models,
 * indexes, aggregations and the atomic stock operations. It must never
 * touch a real database, so the suite starts a **throwaway** `mongod` on a
 * loopback port, uses it for the duration of the run, and destroys it
 * afterwards.
 *
 * This is the ONLY place `mongodb-memory-server` is used. It is a
 * `devDependency` of `apps/api`, so it is never installed into a
 * production deployment and can never become the application database.
 *
 * The application itself NEVER reads this file. The application database is
 * always the persistent MongoDB named by the server-side `MONGODB_URI`
 * environment variable and reached through Mongoose — see
 * `src/db/connection.ts`.
 *
 * HOW THE URI REACHES THE TEST WORKERS
 * ------------------------------------
 * Vitest runs `globalSetup` in the controller process and the test files in
 * separate worker processes, so the URI cannot be passed in memory. It is
 * written to a file under `node_modules/.cache/` (never committed) and read
 * back by `tests/helpers/bootstrap.ts` **before** `src/config/env.ts` is
 * imported, so the application code under test sees a normal `MONGODB_URI`.
 *
 * The test database name is deliberately NOT one of the production-ish names
 * that `src/jobs/*` refuse to write to, and `tests/helpers/guard.ts`
 * re-checks the resolved connection string before any test runs.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the URI handshake file is written. Inside `node_modules`, so it is never committed. */
const stateDir = path.resolve(here, '..', '..', 'node_modules', '.cache', 'ajooba-tests');
const stateFile = path.join(stateDir, 'mongo-memory.json');

/** The database name the throwaway server hosts. */
const TEST_DB_NAME = 'ajooba_test';

let server: MongoMemoryServer | undefined;

/**
 * How long to wait for the throwaway `mongod` to accept connections.
 *
 * The library's default is 10 seconds, which is fine on a warm CI runner but
 * too tight on a cold Windows workstation: the first start of the process
 * pays for antivirus scanning and a cold page cache, and the server was
 * observed to still be initialising at the 10-second mark while starting
 * perfectly well a moment later.
 *
 * A too-short timeout does not fail safely — it aborts the whole suite with
 * "No test files found", which reads like a configuration mistake rather than
 * a slow machine. The timeout is therefore generous.
 */
const STARTUP_TIMEOUT_MS = 120_000;

/**
 * Start the throwaway MongoDB and publish its URI.
 */
export async function setup(): Promise<void> {
  server = await MongoMemoryServer.create({
    instance: { dbName: TEST_DB_NAME, launchTimeout: STARTUP_TIMEOUT_MS },
  });

  const uri = server.getUri();

  await mkdir(stateDir, { recursive: true });
  await writeFile(
    stateFile,
    JSON.stringify({ uri, dbName: TEST_DB_NAME, pid: process.pid }, null, 2),
    'utf8',
  );
}

/**
 * Destroy the throwaway MongoDB and remove the handshake file.
 */
export async function teardown(): Promise<void> {
  await rm(stateFile, { force: true });

  if (server) {
    // The worker processes have already exited by the time Vitest calls
    // teardown, so nothing holds a client socket open.
    //
    // `mongod` is asked to shut down gracefully first. On Windows the
    // library's own `SIGINT` does not reach `mongod`, so `stop()` would
    // otherwise wait out a 10-second grace period, force-kill the process
    // and reject — which fails the run even though every test passed. See
    // `tests/helpers/mongo-shutdown.ts` for the full explanation.
    await shutdownMongoServer(server);
    await server.stop();
    server = undefined;
  }
}
