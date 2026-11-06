import request from 'supertest';
import type { Application } from 'express';
import { beforeAll, beforeEach, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { connectToDatabase, disconnectFromDatabase } from '../../src/db/connection.js';
import { resetDatabase } from './factories.js';

/**
 * Shared API test helpers.
 *
 * The application is created once per test file and mounted with supertest,
 * so no socket is opened and the tests exercise the real Express stack —
 * middleware, validation, routing, the error handler and the response
 * envelope — exactly as a client would.
 */

/** The Express application under test. */
export const app: Application = createApp();

/**
 * Connect to the throwaway in-memory database.
 *
 * The URI was bound to the in-memory server by `tests/helpers/bootstrap.ts`
 * and validated by the isolation guard before this module could be
 * imported. The application connects to it through the *same* Mongoose
 * connection code the server uses — there is no test-only connection path.
 */
export async function connect(): Promise<void> {
  await connectToDatabase();
}

/** Close the connection and empty the database. */
export async function disconnect(): Promise<void> {
  await resetDatabase();
  await disconnectFromDatabase();
}

/**
 * Wire up the standard lifecycle for a test file.
 *
 * Call this once at the top of a test file. It connects to the throwaway
 * database, empties it before **every** test (so a test can never see
 * another test's documents), and closes the connection at the end.
 *
 * The per-test reset matters: a test that asserts "the catalogue is empty"
 * would otherwise fail because an earlier test in the same file added a
 * product.
 */
export function useApi(): void {
  beforeAll(async () => {
    await connect();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnect();
  });
}

/** A supertest agent bound to the application. */
export function api() {
  return request(app);
}

/** Narrow a supertest body to a successful envelope. */
export function success<T>(body: unknown): T {
  const envelope = body as { ok?: boolean; data?: unknown };
  if (!envelope.ok || envelope.data === undefined) {
    throw new Error(`Expected a success envelope, received: ${JSON.stringify(body)}`);
  }
  return envelope.data as T;
}

/** Narrow a supertest body to a failure envelope. */
export function failure(body: unknown): { code: string; message: string; details?: unknown } {
  const envelope = body as {
    ok?: boolean;
    error?: { code: string; message: string; details?: unknown };
  };
  if (envelope.ok || !envelope.error) {
    throw new Error(`Expected a failure envelope, received: ${JSON.stringify(body)}`);
  }
  return envelope.error;
}

/** The bearer authorization header for a token. */
export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
