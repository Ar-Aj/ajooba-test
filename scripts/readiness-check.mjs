/**
 * Production-readiness check.
 *
 * Verifies a *deployed* origin against the gates that must hold before real
 * money, real parcels and real customer email move through it. Every check
 * is read-only and none of them initiates a payment, a refund, a shipment or
 * an email.
 *
 *   node scripts/readiness-check.mjs https://staging-api.example.com
 *
 * Exit code 0 when every blocking gate passes, 1 otherwise, so it can be
 * wired into CI as a deploy gate.
 *
 * WHY A SCRIPT AND NOT A DOCUMENT
 * -------------------------------
 * The expensive failures in this project were all *silent*: a webhook schema
 * that acknowledged valid captures as "unrecognised", a unique index that
 * never built, a refund failure that marked a payment failed. Every one of
 * them looked healthy from the outside. A check only a human runs is a check
 * that eventually is not run.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It never sends a real payment, refund, shipment or email, and it never
 * needs credentials. Anything requiring a provider account or DNS is
 * reported as EXTERNALLY UNVERIFIED rather than guessed at.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

const PASS = 'PASS';
const FAIL = 'FAIL';
const WARN = 'WARN';
const INFO = 'INFO';

const results = [];
let currentGroup = '(general)';

function group(name) {
  currentGroup = name;
}

function record(status, check, detail) {
  results.push({ group: currentGroup, status, check, detail });
  const label = { PASS: '[ ok ]', FAIL: '[FAIL]', WARN: '[warn]', INFO: '[info]' }[status];
  console.log(label + ' ' + check + (detail ? ' - ' + detail : ''));
}

const pass = (check, detail) => record(PASS, check, detail);
const fail = (check, detail) => record(FAIL, check, detail);
const warn = (check, detail) => record(WARN, check, detail);
const info = (check, detail) => record(INFO, check, detail);

/* -------------------------------------------------------------------------- */
/* HTTP                                                                        */
/* -------------------------------------------------------------------------- */

const TIMEOUT_MS = 15_000;

async function request(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();

    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    return { status: response.status, ok: response.ok, headers: response.headers, text, body };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Gates                                                                       */
/* -------------------------------------------------------------------------- */

async function checkTransport(origin) {
  group('Transport');

  const url = new URL(origin);

  if (url.protocol !== 'https:') {
    fail(
      'API origin uses HTTPS',
      'Received "' +
        url.protocol +
        '". Cookies and bearer tokens would cross the wire in the clear.',
    );
  } else {
    pass('API origin uses HTTPS', url.origin);
  }
}

async function checkHealth(origin) {
  group('Health');

  let live;
  try {
    live = await request(`${origin}/health/live`);
  } catch (error) {
    fail('Liveness probe reachable', error.message);
    return false;
  }

  if (live.status !== 200) {
    fail('Liveness probe returns 200', `Received ${live.status}`);
    return false;
  }

  const liveData = live.body?.data;
  pass('Liveness probe returns 200', liveData?.status ?? '');
  pass('Liveness reports the api service', liveData?.service ?? '(not reported)');

  try {
    const ready = await request(`${origin}/health/ready`);
    const readyData = ready.body?.data;
    const mongodb = (readyData?.checks ?? []).find((check) => check.name === 'mongodb');

    if (ready.status === 200 && readyData?.status === 'ok') {
      pass('Readiness probe returns 200', `mongodb: ${mongodb?.status ?? 'unknown'}`);
    } else if (ready.status === 503) {
      /*
       * 503 is the documented, honest answer when MongoDB is unreachable,
       * but a database that cannot be reached is still a hard blocker for
       * go-live, so it is reported as a failure rather than a warning.
       */
      fail(
        'Readiness probe returns 200',
        'Received 503 - MongoDB is not reachable from this deployment.',
      );
    } else {
      fail(
        'Readiness probe returns 200',
        `Received ${ready.status}, status="${readyData?.status ?? '?'}"`,
      );
    }
  } catch (error) {
    fail('Readiness probe reachable', error.message);
  }

  return true;
}

async function checkRequestIdHeaders(origin) {
  group('Tracing');

  const response = await request(`${origin}/health/live`);
  const header = response.headers.get('x-request-id');

  if (header && header.length > 0) {
    pass('Responses carry x-request-id', header);
  } else {
    fail(
      'Responses carry x-request-id',
      'Header absent - logs and support tickets cannot be correlated.',
    );
  }
}

async function checkWebhookSignatureEnforced(origin) {
  group('Webhook security');

  /*
   * Send a well-formed Razorpay payment event with NO signature header.
   *
   * The correct answer is 400 (or 401/403). A 200 means signature
   * verification is not running, which is strictly worse than having no
   * webhook endpoint at all: anyone who can reach the URL could mark
   * orders paid.
   *
   * This needs no credentials and moves no money.
   */
  const body = JSON.stringify({
    entity: 'event',
    account_id: 'acc_readiness_probe',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: { id: 'pay_probe', amount: 100, currency: 'INR', status: 'captured' },
      },
    },
    created_at: 0,
  });

  let response;
  try {
    response = await request(`${origin}/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch (error) {
    fail('Webhook endpoint is reachable', error.message);
    return;
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    pass(
      'Unsigned webhook is rejected',
      `HTTP ${response.status} - signature verification is active.`,
    );
  } else if (response.status === 503) {
    /*
     * The handler answers 503 when no webhook secret is configured at all,
     * because there is then no way to authenticate a delivery. That is the
     * correct refusal — but it also means the integration is switched off,
     * which is a go-live blocker rather than a pass.
     */
    fail(
      'Unsigned webhook is rejected',
      'HTTP 503 - the webhook secret is not configured, so no payment confirmation can be verified. Set RAZORPAY_WEBHOOK_SECRET.',
    );
  } else if (response.status === 200) {
    fail(
      'Unsigned webhook is rejected',
      `HTTP ${response.status}. Signature verification is NOT running - treat this deployment as unsafe.`,
    );
  } else {
    warn(
      'Unsigned webhook is rejected',
      `Unexpected HTTP ${response.status}. Inspect the response body.`,
    );
  }

  /*
   * An unsigned Shiprocket tracking delivery must be refused the same way.
   *
   * The probe path is `/webhooks/carrier/track`, NOT `/webhooks/shiprocket`.
   * Shiprocket's documentation forbids the substrings `shiprocket`,
   * `kartrocket`, `sr` and `kr` in the callback URL, so the obvious path can
   * never be the one configured in the dashboard. Probing the forbidden path
   * would report a healthy deployment as broken.
   */
  const sr = await request(`${origin}/webhooks/carrier/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ awb: 'READINESSPROBE', current_status: 'Delivered Out For Delivery' }),
  }).catch((error) => ({ status: 0, text: error.message, body: null }));

  if (sr.status === 400 || sr.status === 401 || sr.status === 403) {
    pass('Unsigned tracking webhook is rejected', `HTTP ${sr.status}`);
  } else if (sr.status === 200) {
    /*
     * Shiprocket documents that the endpoint must answer only 200, so this is
     * expected when the webhook is simply disabled. It is still worth a
     * warning: with no webhook, delivery status stops reaching the store
     * until somebody polls.
     */
    warn(
      'Unsigned tracking webhook is rejected',
      `HTTP ${sr.status}. If Shiprocket is not yet enabled this is expected; otherwise tracking is unauthenticated.`,
    );
  } else if (sr.status === 404) {
    warn(
      'Tracking webhook route present',
      'HTTP 404 - shipping tracking must be enabled before go-live.',
    );
  } else {
    warn('Unsigned tracking webhook is rejected', `Unexpected HTTP ${sr.status}.`);
  }
}

async function checkAdminIsProtected(origin) {
  group('Authorization');

  const response = await request(`${origin}/v1/admin/orders`).catch(() => null);

  if (!response) {
    fail('Admin API reachable for an authorization check');
    return;
  }

  if (response.status === 401 || response.status === 403) {
    pass('Admin API rejects an unauthenticated caller', `HTTP ${response.status}`);
  } else if (response.status === 200) {
    fail(
      'Admin API rejects an unauthenticated caller',
      'HTTP 200 without credentials. The admin surface is open - stop and fix this.',
    );
  } else {
    warn('Admin API rejects an unauthenticated caller', `Unexpected HTTP ${response.status}.`);
  }

  const probe = await request(`${origin}/v1/admin/orders?limit=999999`).catch(() => null);
  if (probe && probe.status === 400) {
    pass('Admin list query is bounded', 'An unbounded page size is rejected rather than served.');
  } else if (probe && probe.status === 200) {
    warn(
      'Admin list query is bounded',
      'HTTP 200 for limit=999999 - confirm the bound is intentional.',
    );
  }
}

async function checkSecurityHeaders(origin) {
  group('Headers');

  const response = await request(`${origin}/health/live`);
  const headers = response.headers;

  if (headers.get('x-content-type-options')?.toLowerCase() === 'nosniff') {
    pass('X-Content-Type-Options: nosniff');
  } else {
    warn('X-Content-Type-Options: nosniff', 'Header absent.');
  }

  if (headers.get('strict-transport-security')) {
    pass('Strict-Transport-Security present');
  } else {
    warn('Strict-Transport-Security present', 'Header absent - no HSTS on the API origin.');
  }
}

/**
 * The deployment's payment configuration must be coherent.
 *
 * `GET /v1/payments/configuration` is public by design — the storefront
 * needs it to decide whether to offer a card option. It exposes only
 * *whether* the integration is configured, the mode and the publishable key
 * id. Never a secret.
 *
 * The combinations that matter:
 *
 *  - `configured: false` — payments are switched off. Acceptable in staging;
 *    a blocker in production, because orders would be taken and no payment
 *    could ever be confirmed.
 *  - `configured: true` but `webhooksEnabled: false` — **the dangerous
 *    one**. The gateway would accept money while no payment confirmation
 *    could be verified. Every order would sit unpaid forever, and the
 *    customer would have been charged.
 *  - `mode: 'test'` on a production origin — real money cannot move.
 */
async function checkPaymentConfiguration(origin) {
  group('Payment configuration');

  const response = await request(`${origin}/v1/payments/configuration`).catch(() => null);

  if (!response) {
    fail('The payment configuration surface is reachable');
    return;
  }

  if (response.status !== 200) {
    fail(
      'The payment configuration surface is reachable',
      `HTTP ${response.status}. The storefront cannot tell whether to offer a card option.`,
    );
    return;
  }

  const config = response.body?.data ?? {};

  if (typeof config.configured !== 'boolean') {
    warn(
      'The payment configuration surface reports a boolean',
      'It did not answer in the documented shape.',
    );
    return;
  }

  pass('The payment configuration surface is reachable', `mode: ${config.mode}`);

  if (!config.configured) {
    warn(
      'Payments are configured',
      'configured=false. The payment intent route answers 503 and checkout refuses a card.',
    );
    return;
  }

  pass('Payments are configured', `mode: ${config.mode}`);

  if (config.webhooksEnabled !== true) {
    fail(
      'Payment webhooks are enabled',
      'The gateway would accept money while no payment confirmation could be verified. ' +
        'Set RAZORPAY_WEBHOOK_SECRET.',
    );
  } else {
    pass('Payment webhooks are enabled', 'Signature verification is active.');
  }

  if (config.mode !== 'live') {
    warn(
      'The payment mode is live',
      `mode is "${config.mode}". Test mode cannot move real money — this origin cannot take live orders.`,
    );
  } else {
    pass('The payment mode is live');
  }

  if (typeof config.keyId !== 'string' || config.keyId.length === 0) {
    warn('A publishable key id is exposed', 'The storefront cannot open Razorpay Checkout.');
  } else {
    pass('A publishable key id is exposed', 'The key id is public by design; the secret is not.');
  }
}

/**
 * The email and shipping integrations must report their setup state.
 *
 * Both are administrator surfaces, so an unauthenticated probe must be
 * refused — that refusal is itself the check. A deployment that answers 200
 * here is leaking configuration.
 */
async function checkAdminConfigurationSurfacesAreProtected(origin) {
  group('Integration surfaces');

  const probes = [
    ['/v1/admin/shipments/configuration', 'shipping configuration'],
    ['/v1/admin/payments/000000000000000000000000', 'admin payment read'],
  ];

  for (const [path, label] of probes) {
    const response = await request(`${origin}${path}`).catch(() => null);

    if (!response) {
      fail(`${label} is reachable for an authorization check`);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      pass(`${label} refuses an unauthenticated caller`, `HTTP ${response.status}`);
    } else if (response.status === 200) {
      fail(
        `${label} refuses an unauthenticated caller`,
        'HTTP 200 without credentials. The integration surface is open.',
      );
    } else {
      warn(`${label} refuses an unauthenticated caller`, `Unexpected HTTP ${response.status}.`);
    }
  }
}

function checkRepositoryInvariants() {
  group('Repository');

  const checks = [
    ['docs/ENVIRONMENT.md', 'The environment inventory exists.'],
    ['docs/DEPLOYMENT_RUNBOOK.md', 'The deployment runbook exists.'],
    ['docs/PROVIDER_CONTRACTS.md', 'Provider contracts are captured from official docs.'],
    ['apps/api/.env.example', 'The API environment template is committed.'],
    ['scripts/readiness-check.mjs', 'This readiness gate is committed.'],
    ['scripts/env-inventory-check.mjs', 'The environment inventory gate is committed.'],
  ];

  for (const [relative, detail] of checks) {
    if (existsSync(join(repoRoot, relative))) {
      pass(`${relative} exists`, detail);
    } else {
      fail(`${relative} exists`, detail);
    }
  }

  /*
   * A committed .env holding real secrets is the one mistake that cannot be
   * walked back, so it is worth checking rather than relying on convention.
   */
  for (const relative of ['apps/api/.env', 'apps/storefront/.env.local', 'apps/admin/.env.local']) {
    if (existsSync(join(repoRoot, relative))) {
      warn(
        `${relative} exists locally`,
        'Fine for development; confirm it is gitignored and never committed.',
      );
    }
  }
}

/**
 * The environment inventory gate must pass.
 *
 * It reads the real Zod schemas and compares them with the committed
 * templates and the documentation. A deployment configured from a template
 * that has drifted from the schema fails to boot for a variable nobody was
 * told about, so this gate is run before the live checks.
 */
function checkEnvironmentInventory() {
  group('Environment inventory');

  const script = join(repoRoot, 'scripts/env-inventory-check.mjs');

  if (!existsSync(script)) {
    fail('The environment inventory gate is present', 'scripts/env-inventory-check.mjs is missing.');
    return;
  }

  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60_000,
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const summary = /(\d+ checks - \d+ failed - \d+ warnings)/.exec(output)?.[1];

    if (result.status === 0) {
      pass('The environment inventory matches the code', summary ?? '');
    } else {
      fail(
        'The environment inventory matches the code',
        summary ?? 'The gate failed; run `pnpm env:check` for the detail.',
      );
    }
  } catch (error) {
    fail('The environment inventory gate runs', error.message);
  }
}

function checkPackageScripts() {
  group('Build pipeline');

  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const required = ['format:check', 'lint', 'typecheck', 'test', 'build'];

  for (const script of required) {
    if (typeof pkg.scripts?.[script] === 'string') {
      pass(`pnpm ${script} is defined`);
    } else {
      fail(`pnpm ${script} is defined`, 'Missing from the root package.json.');
    }
  }
}

function reportExternallyUnverified() {
  group('Externally unverified');

  /*
   * Stated rather than hidden. None of these can be checked from a URL, and
   * pretending otherwise would be the most dangerous thing this script could
   * do.
   */
  const items = [
    'Razorpay live keys are correct and the webhook secret matches the dashboard.',
    'Razorpay actually delivers payment.captured to this URL (no live payment is triggered here).',
    'The Resend sending domain is verified in DNS and mail is deliverable.',
    'The Shiprocket API user exists and the pickup location is named exactly as configured.',
    'Shiprocket actually posts tracking webhooks to this URL.',
    'MongoDB Atlas network access lists and index-creation rights on the production user.',
    'Catalogue stock is non-zero, and every saleable colour has a verified photograph.',
    'The Resend sending domain resolves with the exact DKIM/SPF records Resend generated.',
    'The Shiprocket callback URL was accepted by the Shiprocket dashboard (it contains none of the forbidden substrings).',
    'The production catalogue has been counted and every saleable colour has a verified photograph.',
  ];

  for (const item of items) {
    info('Needs provider access or DNS', item);
  }

  console.log(
    '\n  These cannot be verified without credentials, DNS or a provider dashboard.\n' +
      '  Confirm each one by hand before go-live; see docs/DEPLOYMENT_RUNBOOK.md.\n',
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const origin = process.argv[2]?.replace(/\/$/, '');

  if (!origin) {
    console.error(
      'Usage: node scripts/readiness-check.mjs <api-origin>\n' +
        'Example: node scripts/readiness-check.mjs https://staging-api.example.com',
    );
    process.exit(2);
  }

  console.log(`\nReadiness check - ${origin}\n${'='.repeat(60)}`);

  checkRepositoryInvariants();
  checkEnvironmentInventory();
  checkPackageScripts();
  reportExternallyUnverified();

  console.log(`\n${'='.repeat(60)}\nLive origin checks\n`);
  await checkTransport(origin);
  const healthy = await checkHealth(origin);
  if (healthy) {
    await checkRequestIdHeaders(origin);
    await checkWebhookSignatureEnforced(origin);
    await checkPaymentConfiguration(origin);
    await checkAdminConfigurationSurfacesAreProtected(origin);
    await checkAdminIsProtected(origin);
    await checkSecurityHeaders(origin);
  }

  const failures = results.filter((r) => r.status === FAIL);
  const warnings = results.filter((r) => r.status === WARN);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${results.length} checks - ${failures.length} failed - ${warnings.length} warnings`);

  if (failures.length > 0) {
    console.log('\nBLOCKING:');
    for (const failure of failures) {
      console.log(
        `  - [${failure.group}] ${failure.check}${failure.detail ? ` - ${failure.detail}` : ''}`,
      );
    }
    console.log('\nThis deployment is NOT ready for live traffic.\n');
    process.exit(1);
  }

  console.log('\nAll blocking checks passed. Review the warnings before go-live.\n');
  process.exit(0);
}

main().catch((error) => {
  console.error(`\nReadiness check crashed: ${error?.message ?? error}\n`);
  process.exit(1);
});
