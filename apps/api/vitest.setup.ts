import { config as loadEnv } from 'dotenv';

/**
 * Vitest global setup entry point.
 *
 * Kept as a thin shim so that the ESLint `projectService` allow-list and
 * the TypeScript `include` list stay small and explicit, while the real
 * logic lives in `tests/helpers/` where it is type-checked like the rest of
 * the test code.
 */
loadEnv({ path: '.env.test', override: true });

await import('./tests/helpers/bootstrap.js');
