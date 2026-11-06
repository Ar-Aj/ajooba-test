import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { setE2eMongoServer, spawnTracked } from './process-registry.js';
import {
  ADMIN_PORT,
  API_PORT,
  DEAD_API_PORT,
  DEAD_STOREFRONT_PORT,
  STOREFRONT_PORT,
} from './constants.js';

/**
 * End-to-end global setup.
 *
 * WHAT THIS BOOTS
 * ---------------
 * A complete, isolated stack:
 *
 *   1. a **throwaway MongoDB** (`mongodb-memory-server`), on a loopback port;
 *   2. the **real API** (`apps/api/src/server.ts`), started as a child process
 *      with an environment that points at that MongoDB;
 *   3. the **real storefront** (`apps/storefront`), built for production and
 *      started as a child process, pointed at that API;
 *   4. the **real admin panel** (`apps/admin`), built for production and
 *      started as a child process, pointed at that API.
 *
 * WHY THE FRONTENDS ARE BUILT HERE
 * --------------------------------
 * `NEXT_PUBLIC_*` variables are **inlined into the JavaScript bundle at build
 * time** by Next.js. They are not read from the environment when the server
 * starts. Setting `NEXT_PUBLIC_API_URL` on a `next start` process therefore
 * has no effect: the bundle still contains whatever value was present when
 * `next build` ran.
 *
 * That is not a theoretical problem. The storefront's server components read
 * `API_INTERNAL_URL` at *runtime* (that one works), but the browser bundle
 * reads `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_MEDIA_BASE_URL`, which are
 * baked in. A storefront built for `http://localhost:4000` would try to reach
 * the API on port 4000 while the E2E API listens on 4200, and every browser
 * request would fail with a connection error.
 *
 * So the two Next.js applications are **built by this setup**, with the E2E
 * environment supplied as build-time variables, and then started. This is
 * also the honest thing to do: it proves the production build works, rather
 * than testing a development-mode server that behaves differently.
 *
 * The build output is written to a **separate** directory from the developer's
 * normal `.next` build, so running the E2E suite never invalidates the
 * developer's own build cache and never leaves a half-built `.next` behind.
 *
 * WHY A SEPARATE PROCESS FOR THE API
 * ----------------------------------
 * The API validates its environment **once at import time** and freezes it.
 * Booting it in-process would mean the Playwright global setup shares a
 * module registry with the test workers, so a test that mutated `process.env`
 * could silently change what the application believes. Running the API as its
 * own process makes the environment it sees exactly the environment this
 * file wrote — which is the same isolation guarantee the Vitest suite relies
 * on, and the same reason the API boots with an explicit environment rather
 * than inheriting the developer's shell.
 *
 * NOTHING REAL IS TOUCHED
 * -----------------------
 * The MongoDB is a throwaway instance on a loopback port. No provider
 * credential is set, so Razorpay, Resend and Shiprocket are all in their
 * "not configured" state and the code paths that would move money, send
 * email or book a parcel are never entered. The storefront's
 * `EMAIL_ALLOWLIST` is irrelevant here because no email is ever attempted.
 *
 * FIXTURES
 * --------
 * The catalogue fixtures are seeded **directly into the throwaway database**
 * using the application's own Mongoose models, so they carry real schema
 * defaults, real index behaviour and real field names. They are obviously
 * synthetic (`E2E ...`), so a failure can never be mistaken for a real
 * catalogue problem.
 *
 * Stock is set deliberately and explicitly. This is *not* the production
 * catalogue — it is a synthetic fixture in a throwaway database — and the
 * E2E tests need a purchasable variant to exercise the buy path at all.
 * The production catalogue's zero-stock state is untouched.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** Where the handshake file is written. Inside `node_modules`, never committed. */
const stateDir = path.join(repoRoot, 'node_modules', '.cache', 'ajooba-e2e');
const stateFile = path.join(stateDir, 'state.json');

/** Ports. Chosen to be unlikely to collide with the dev servers (3000/3001/4000). */
/* The port values themselves live in `./constants.ts`, shared with the specs. */

const DB_NAME = 'ajooba_e2e';

/** How long to wait for the throwaway `mongod` to accept connections. */
const STARTUP_TIMEOUT_MS = 120_000;

/**
 * How long to wait for a `next build` to finish.
 *
 * A cold production build of a Next.js app is slow — minutes, not seconds —
 * and the very first one also has to compile the whole dependency tree.
 */
const BUILD_TIMEOUT_MS = 900_000;

/**
 * The `distDir` the E2E builds write to.
 *
 * Deliberately NOT `.next`: the developer's own production build must survive
 * an E2E run untouched, and an E2E run must never leave a build whose
 * inlined `NEXT_PUBLIC_*` values point at a throwaway port behind it.
 */
const E2E_DIST_DIR = '.next-e2e';

interface E2EState {
  readonly mongoUri: string;
  readonly apiPort: number;
  readonly storefrontPort: number;
  readonly adminPort: number;
  readonly deadStorefrontPort: number;
  readonly apiPid: number;
  readonly storefrontPid: number;
  readonly adminPid: number;
  readonly deadStorefrontPid: number;
}

/** The child processes started by this run, so teardown can stop them. */
const children: ChildProcess[] = [];

let mongoServer: MongoMemoryServer | undefined;
function log(message: string): void {
  process.stdout.write(`[e2e-setup] ${message}\n`);
}

/**
 * Wait for a URL to answer with an HTTP response.
 *
 * Polls rather than sleeping a fixed amount, so a slow machine is not
 * penalised and a fast machine is not delayed.
 */
async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status > 0) {
        return;
      }
    } catch {
      // Not up yet.
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label} at ${url}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/**
 * Start a child process and capture its output.
 *
 * The output is forwarded to the Playwright console so a boot failure is
 * diagnosable from the test log alone.
 */
function startProcess(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  const forward = (stream: NodeJS.ReadableStream | null): void => {
    stream?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trimEnd();
      if (text) {
        process.stdout.write(`[${label}] ${text}\n`);
      }
    });
  };

  forward(child.stdout);
  forward(child.stderr);

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stdout.write(`[${label}] exited with code ${code} (signal ${signal})\n`);
    }
  });

  children.push(child);
  spawnTracked(child);
  return child;
}

/**
 * Run a command to completion, streaming its output, and fail loudly.
 *
 * Used for the production builds. A build that fails must abort the whole
 * E2E run rather than produce a stack of confusing browser failures against
 * a missing or half-built application.
 */
async function runCommand(
  label: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  log(`Building ${label}…`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const forward = (stream: NodeJS.ReadableStream | null): void => {
      stream?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trimEnd();
        if (text) {
          process.stdout.write(`[${label}:build] ${text}\n`);
        }
      });
    };

    forward(child.stdout);
    forward(child.stderr);

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} build timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} build failed with code ${String(code)} (signal ${String(signal)}). ` +
            'See the build output above.',
        ),
      );
    });
  });

  log(`${label} build finished.`);
}

/**
 * Seed the synthetic catalogue.
 *
 * The seeding runs as a **separate process inside `apps/api`**, not as an
 * in-process import here. Two reasons:
 *
 *  1. The fixtures must be written through the application's own Mongoose
 *     models, so they carry the real schema defaults, the real field names
 *     and the real index definitions. Importing those models from the
 *     repository root resolves `mongoose` from the root `node_modules`
 *     while the models resolve it from `apps/api/node_modules` — two
 *     different Mongoose copies, two different model registries, and a
 *     connection the seeding code cannot see.
 *  2. Those models import `src/config/env.js`, which validates the
 *     environment once at import time. Running the seeding inside the API
 *     package with an explicit environment means that validation runs
 *     exactly as it does for the real server, instead of being bypassed.
 *
 * See `apps/api/scripts/seed-e2e-fixtures.ts`.
 */
async function seedFixtures(apiEnv: NodeJS.ProcessEnv): Promise<void> {
  await runCommand(
    'seed',
    'pnpm',
    ['exec', 'tsx', 'scripts/seed-e2e-fixtures.ts'],
    path.join(repoRoot, 'apps', 'api'),
    apiEnv,
    300_000,
  );
}

export default async function globalSetup(): Promise<void> {
  log('Starting the end-to-end stack.');

  // 1. The throwaway database.
  mongoServer = await MongoMemoryServer.create({
    instance: { dbName: DB_NAME, launchTimeout: STARTUP_TIMEOUT_MS },
  });
  const mongoUri = mongoServer.getUri();
  setE2eMongoServer(mongoServer);
  log(`Throwaway MongoDB ready at ${mongoUri}`);

  // 2. Build the API's environment. It is needed both to seed the fixtures
  //    (the seeding script validates the environment exactly as the server
  //    does) and to start the server.
  const apiEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(API_PORT),
    MONGODB_URI: mongoUri,
    MONGODB_DB: DB_NAME,
    API_PUBLIC_URL: `http://127.0.0.1:${API_PORT}`,
    STOREFRONT_PUBLIC_URL: `http://127.0.0.1:${STOREFRONT_PORT}`,
    ADMIN_PUBLIC_URL: `http://127.0.0.1:${ADMIN_PORT}`,
    CORS_ORIGINS: `http://127.0.0.1:${STOREFRONT_PORT},http://127.0.0.1:${ADMIN_PORT}`,
    ADMIN_ORIGINS: `http://127.0.0.1:${ADMIN_PORT}`,
    SESSION_SECRET: 'e2e-only-session-secret-value-at-least-32-chars',
    JWT_SECRET: 'e2e-only-jwt-secret-value-at-least-32-characters',
    BCRYPT_COST: '4',
    LOG_LEVEL: 'warn',
    // Every rate limit is raised so the suite is not throttled by a limit
    // that exists to protect production. Every request in the run comes from
    // the same loopback address.
    RATE_LIMIT_AUTH_MAX: '1000000',
    RATE_LIMIT_REFRESH_MAX: '1000000',
    RATE_LIMIT_REGISTER_MAX: '1000000',
    RATE_LIMIT_CHECKOUT_MAX: '1000000',
    RATE_LIMIT_COUPON_MAX: '1000000',
    RATE_LIMIT_PASSWORD_MAX: '1000000',
    RATE_LIMIT_ANALYTICS_MAX: '1000000',
    RATE_LIMIT_ADMIN_WRITE_MAX: '1000000',
    // No provider credentials. Payments, email and shipping are therefore all
    // in their "not configured" state for the whole run.
    RESEND_API_KEY: '',
    RESEND_FROM_EMAIL: '',
    SHIPROCKET_API_EMAIL: '',
    SHIPROCKET_API_PASSWORD: '',
    RAZORPAY_KEY_ID: '',
    RAZORPAY_KEY_SECRET: '',
    RAZORPAY_WEBHOOK_SECRET: '',
    RAZORPAY_MODE: 'test',
  };

  // 3. Seed the synthetic catalogue through the application's own models.
  await seedFixtures(apiEnv);

  // 4. The API, in its own process with an explicit environment.
  const api = startProcess(
    'api',
    'pnpm',
    ['exec', 'tsx', 'src/server.ts'],
    path.join(repoRoot, 'apps', 'api'),
    apiEnv,
  );

  await waitForHttp(`http://127.0.0.1:${API_PORT}/health/live`, 120_000, 'the API');
  log(`API listening on http://127.0.0.1:${API_PORT}`);

  /*
   * 5. The storefront.
   *
   * The build happens HERE, with the E2E URLs as build-time variables,
   * because `NEXT_PUBLIC_*` is inlined into the bundle by `next build`.
   */
  const storefrontEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(STOREFRONT_PORT),
    API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${STOREFRONT_PORT}`,
    NEXT_PUBLIC_MEDIA_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    CATALOG_REVALIDATE_SECONDS: '0',
    // Keep the E2E build out of the developer's `.next` directory.
    NEXT_DIST_DIR: E2E_DIST_DIR,
  };

  await runCommand(
    'storefront',
    'pnpm',
    ['exec', 'next', 'build'],
    path.join(repoRoot, 'apps', 'storefront'),
    storefrontEnv,
    BUILD_TIMEOUT_MS,
  );

  const storefront = startProcess(
    'storefront',
    'pnpm',
    [
      'exec',
      'next',
      'start',
      '--port',
      String(STOREFRONT_PORT),
      '--hostname',
      '127.0.0.1',
    ],
    path.join(repoRoot, 'apps', 'storefront'),
    storefrontEnv,
  );

  await waitForHttp(`http://127.0.0.1:${STOREFRONT_PORT}/`, 180_000, 'the storefront');
  log(`Storefront listening on http://127.0.0.1:${STOREFRONT_PORT}`);

  /*
   * 6. The error-recovery storefront.
   *
   * The SAME build, started with an `API_INTERNAL_URL` that points at a port
   * nothing is listening on. The catalogue is rendered by a server component,
   * so a browser-level request interception cannot simulate an API outage;
   * this second instance can.
   *
   * `API_INTERNAL_URL` is read at runtime by the server bundle, so the build
   * is reused verbatim — no second build, no divergence between the two
   * instances.
   */
  const deadStorefrontEnv: NodeJS.ProcessEnv = {
    ...storefrontEnv,
    PORT: String(DEAD_STOREFRONT_PORT),
    API_INTERNAL_URL: `http://127.0.0.1:${DEAD_API_PORT}`,
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${DEAD_STOREFRONT_PORT}`,
  };

  const deadStorefront = startProcess(
    'storefront:no-api',
    'pnpm',
    [
      'exec',
      'next',
      'start',
      '--port',
      String(DEAD_STOREFRONT_PORT),
      '--hostname',
      '127.0.0.1',
    ],
    path.join(repoRoot, 'apps', 'storefront'),
    deadStorefrontEnv,
  );

  await waitForHttp(
    `http://127.0.0.1:${DEAD_STOREFRONT_PORT}/`,
    180_000,
    'the error-recovery storefront',
  );
  log(`Error-recovery storefront listening on http://127.0.0.1:${DEAD_STOREFRONT_PORT}`);

  // 7. The admin panel, pointed at the same API.
  const adminEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(ADMIN_PORT),
    API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${ADMIN_PORT}`,
    NEXT_PUBLIC_MEDIA_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    NEXT_DIST_DIR: E2E_DIST_DIR,
  };

  await runCommand(
    'admin',
    'pnpm',
    ['exec', 'next', 'build'],
    path.join(repoRoot, 'apps', 'admin'),
    adminEnv,
    BUILD_TIMEOUT_MS,
  );

  const admin = startProcess(
    'admin',
    'pnpm',
    [
      'exec',
      'next',
      'start',
      '--port',
      String(ADMIN_PORT),
      '--hostname',
      '127.0.0.1',
    ],
    path.join(repoRoot, 'apps', 'admin'),
    adminEnv,
  );

  await waitForHttp(`http://127.0.0.1:${ADMIN_PORT}/login`, 180_000, 'the admin panel');
  log(`Admin panel listening on http://127.0.0.1:${ADMIN_PORT}`);

  const state: E2EState = {
    mongoUri,
    apiPort: API_PORT,
    storefrontPort: STOREFRONT_PORT,
    adminPort: ADMIN_PORT,
    deadStorefrontPort: DEAD_STOREFRONT_PORT,
    apiPid: api.pid ?? 0,
    storefrontPid: storefront.pid ?? 0,
    adminPid: admin.pid ?? 0,
    deadStorefrontPid: deadStorefront.pid ?? 0,
  };

  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');

  log('End-to-end stack is ready.');
}
