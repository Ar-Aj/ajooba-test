import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { afterAll } from 'vitest';
import mongoose from 'mongoose';
import {
  assertIsolatedTestDatabase,
  readTestDatabaseHandshake,
  testDatabaseName,
} from './guard.js';

/**
 * Vitest setup — loads the test environment and binds it to the throwaway
 * in-memory MongoDB.
 *
 * ORDER MATTERS
 * -------------
 * This module must run **before** `src/config/env.ts` is imported, because
 * that module validates `process.env` once, at import time, and freezes it.
 * The steps below therefore happen first:
 *
 *   1. load `apps/api/.env.test` (the committed, non-secret test config);
 *   2. read the URI published by the in-memory server;
 *   3. point `MONGODB_URI` at it and `MONGODB_DB` at this worker's own
 *      throwaway database;
 *   4. run the isolation guard.
 *
 * Only after step 4 is the application's own configuration validated, and it
 * is validated against a loopback throwaway database.
 *
 * The application database is unaffected by any of this: `src/db/connection.ts`
 * always connects to whatever `MONGODB_URI` the *server* environment
 * provides. Nothing here is read by the application outside the test run.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** `apps/api` — the package root. */
const packageRoot = path.resolve(here, '..', '..');

/*
 * Step 1 — the committed test configuration.
 *
 * `override: true` means a developer's own exported environment variables
 * (including a real `MONGODB_URI`) cannot leak into the test run.
 */
loadEnv({ path: path.join(packageRoot, '.env.test'), override: true });

process.env.NODE_ENV = 'test';

/*
 * Steps 2 & 3 — bind to the throwaway in-memory database.
 *
 * The worker id makes the database name unique per worker, so test files
 * running in parallel are isolated from one another.
 */
const handshake = readTestDatabaseHandshake();

process.env.MONGODB_URI = handshake.uri;
process.env.MONGODB_DB = testDatabaseName(process.env.VITEST_WORKER_ID);

/*
 * Step 4 — prove the binding is isolated before anything can touch it.
 */
assertIsolatedTestDatabase(process.env.MONGODB_URI, process.env.MONGODB_DB, handshake.uri);

/*
 * Close the driver when the test file finishes, so the worker process can
 * exit cleanly instead of hanging on an open socket.
 */
afterAll(async () => {
  await mongoose.disconnect();
});
