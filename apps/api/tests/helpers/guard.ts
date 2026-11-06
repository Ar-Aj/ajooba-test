import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Test-database isolation guard.
 *
 * The single most important safety property of this test suite is that it
 * can never touch a real database. A destructive test running against a
 * development or production cluster would destroy the catalogue, the
 * orders and the customer accounts — and the "isolated test configuration"
 * requirement exists precisely to make that impossible.
 *
 * The guard is deliberately paranoid and fails **loudly**:
 *
 *  1. The resolved `MONGODB_URI` must be byte-for-byte the URI published by
 *     the in-memory server in `global-setup.ts`. A developer's real
 *     `MONGODB_URI` therefore cannot reach a test, even if it is exported
 *     into the shell.
 *  2. That URI must point at a loopback address.
 *  3. The URI must not be an Atlas URI (`mongodb+srv://`).
 *  4. The database name must be the per-worker throwaway name, and must
 *     never look like a production database.
 *
 * If any check fails the whole test run aborts before a single document is
 * written.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the in-memory server published its URI. */
const stateFile = path.resolve(
  here,
  '..',
  '..',
  'node_modules',
  '.cache',
  'ajooba-tests',
  'mongo-memory.json',
);

/** Database names the operational guards in `src/jobs/*` treat as production. */
const PRODUCTION_NAME_MARKERS = ['prod', 'production', 'live'];

/** The prefix every throwaway test database name carries. */
export const TEST_DB_PREFIX = 'ajooba_test';

/** The handshake file written by `global-setup.ts`. */
export interface TestDatabaseHandshake {
  readonly uri: string;
  readonly dbName: string;
  readonly pid: number;
}

/**
 * Read the URI published by the in-memory server.
 *
 * Throws when the handshake file is missing, which means the global setup
 * did not run — the test suite must not fall back to a default URI.
 */
export function readTestDatabaseHandshake(): TestDatabaseHandshake {
  let raw: string;
  try {
    raw = readFileSync(stateFile, 'utf8');
  } catch {
    throw new Error(
      'The in-memory test database was never started. ' +
        'Vitest globalSetup (tests/helpers/global-setup.ts) did not run, so the suite ' +
        'refuses to continue rather than risk connecting to a real database.',
    );
  }

  const parsed = JSON.parse(raw) as TestDatabaseHandshake;
  if (!parsed.uri) {
    throw new Error('The in-memory test database handshake file is malformed.');
  }
  return parsed;
}

/**
 * The throwaway database name for this worker.
 *
 * Each Vitest worker gets its own database so that test files running in
 * parallel cannot see or clobber each other's documents. The name is
 * derived from the worker id, which is unique within the run.
 */
export function testDatabaseName(workerId: string | number | undefined): string {
  const suffix = String(workerId ?? '0').replace(/[^a-z0-9]/gi, '');
  return `${TEST_DB_PREFIX}_${suffix || '0'}`;
}

/**
 * Assert that a connection string points at the throwaway test database.
 *
 * Throws an `Error` describing exactly which rule was broken.
 */
export function assertIsolatedTestDatabase(
  uri: string | undefined,
  dbName: string | undefined,
  expectedUri: string,
): void {
  if (!uri) {
    throw new Error('MONGODB_URI is not set for the test run.');
  }

  if (uri !== expectedUri) {
    throw new Error(
      'Refusing to run the test suite against a non-isolated database.\n' +
        `  expected: ${expectedUri}\n` +
        `  actual:   ${redact(uri)}\n` +
        'The test suite only ever runs against the throwaway in-memory MongoDB. ' +
        'If this is a local run, make sure `pnpm --filter @ajooba/api test` is used so ' +
        'the Vitest globalSetup runs.',
    );
  }

  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/.test(uri)) {
    throw new Error(
      `Refusing to run the test suite against a non-loopback database: ${redact(uri)}`,
    );
  }

  if (uri.startsWith('mongodb+srv://')) {
    throw new Error(
      'Refusing to run the test suite against an Atlas cluster. ' +
        'The test suite must use a local throwaway database.',
    );
  }

  if (!dbName) {
    throw new Error('MONGODB_DB is not set for the test run.');
  }

  if (!dbName.startsWith(`${TEST_DB_PREFIX}_`)) {
    throw new Error(
      `Refusing to run the test suite against database "${dbName}". ` +
        `The test suite only uses databases named "${TEST_DB_PREFIX}_<worker>".`,
    );
  }

  const lowered = dbName.toLowerCase();
  if (PRODUCTION_NAME_MARKERS.some((marker) => lowered.includes(marker))) {
    throw new Error(
      `Refusing to run the test suite against a production-looking database: ${dbName}`,
    );
  }
}

/**
 * Remove any credentials from a connection string so it can be logged.
 */
export function redact(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, '//<credentials>@');
}
