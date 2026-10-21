import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vitest global setup.
 *
 * Loads `apps/api/.env.test` before any module reads `process.env`, so the
 * environment schema validates against known-safe test values. The values are
 * non-secret and are committed on purpose — see .env.test for the rationale.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

loadEnv({ path: path.join(here, '.env.test'), override: true });

process.env.NODE_ENV = 'test';
