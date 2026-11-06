import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    /*
     * The setup file binds `MONGODB_URI` to the throwaway in-memory MongoDB
     * before the application's own environment module is imported. It must
     * run first — see tests/helpers/bootstrap.ts.
     */
    setupFiles: ['./tests/helpers/bootstrap.ts'],
    /*
     * The in-memory MongoDB is started once, in the controller process, and
     * torn down once at the end of the run. Each worker then uses its own
     * database inside that server, so parallel test files stay isolated.
     */
    globalSetup: ['./tests/helpers/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
    },
    /*
     * The suite creates indexes and runs aggregations, and a single fork
     * keeps resource usage predictable on a developer machine. The
     * per-worker database keeps the isolation guarantee regardless.
     *
     * NOTE: `poolOptions` was removed in Vitest 4 — pool settings are now
     * top-level options.
     */
    pool: 'forks',
    singleFork: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
