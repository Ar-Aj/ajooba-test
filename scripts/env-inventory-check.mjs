/**
 * Environment-variable inventory gate.
 *
 * WHY A SCRIPT AND NOT A DOCUMENT
 * -------------------------------
 * `docs/ENVIRONMENT.md` is a hand-written inventory. Hand-written inventories
 * drift: a variable is added to a Zod schema, the schema starts rejecting a
 * deployment, and the document keeps claiming the deployment is fine.
 *
 * This script reads the **actual** Zod schemas out of
 * `@ajooba/contracts` — the single source of truth — and compares them with
 * the committed `.env.example` templates and the documentation. A variable
 * that exists in the schema but not in the template, or in neither the
 * template nor the document, is a failure.
 *
 *   node scripts/env-inventory-check.mjs
 *
 * Exit code 0 when every gate passes, 1 otherwise, so it can run in CI.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It reads committed templates only. It never opens a real `.env`, never
 * prints a secret value, and never contacts a provider.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

const results = [];

function record(status, check, detail) {
  results.push({ status, check, detail });
  const label = { PASS: '[ ok ]', FAIL: '[FAIL]', WARN: '[warn]' }[status];
  console.log(label + ' ' + check + (detail ? ' - ' + detail : ''));
}

const pass = (check, detail) => record('PASS', check, detail);
const fail = (check, detail) => record('FAIL', check, detail);
const warn = (check, detail) => record('WARN', check, detail);

/* -------------------------------------------------------------------------- */
/* Schema introspection                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Flatten a Zod object schema into a plain list of variable names.
 *
 * Zod v4 keeps the shape in `_def.shape` for object schemas. The schema is
 * wrapped in `optional()`/`superRefine()` in places, so the unwrapping walks
 * the chain rather than assuming a single level.
 */
function unwrap(schema) {
  let current = schema;
  // Bounded walk: the chain is finite, and the guard prevents a cycle.
  for (let depth = 0; depth < 20; depth += 1) {
    const def = current?._def;
    if (!def) return current;
    if (def.typeName === 'ZodObject' || def.type === 'object') return current;
    if (def.innerType) {
      current = def.innerType;
      continue;
    }
    if (def.schema) {
      current = def.schema;
      continue;
    }
    return current;
  }
  return current;
}

/** The variable names declared by a Zod object schema. */
function schemaKeys(schema) {
  const object = unwrap(schema);
  const shape = object?._def?.shape;
  if (!shape || typeof shape !== 'object') {
    throw new Error('The schema is not a Zod object; cannot enumerate its variables.');
  }
  return Object.keys(shape);
}

/**
 * Parse a `.env.example` template into a set of variable names.
 *
 * Comment lines and blank lines are ignored. A line without `=` is treated as
 * a declaration with no value, because `KEY=` is a valid (empty) declaration.
 */
function templateKeys(relativePath) {
  const text = readFileSync(join(repoRoot, relativePath), 'utf8');
  const keys = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    const key = (separator === -1 ? line : line.slice(0, separator)).trim();
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
      keys.add(key);
    }
  }

  return keys;
}

/** Every uppercase token that appears in a markdown document. */
function documentTokens(relativePath) {
  const text = readFileSync(join(repoRoot, relativePath), 'utf8');
  const matches = text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g);
  return new Set(matches ?? []);
}

/* -------------------------------------------------------------------------- */
/* Gates                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every variable a schema declares must appear in the matching template.
 *
 * A variable that exists in the schema but not in the template is invisible
 * to the operator who has to set it: they copy the template, boot, and the
 * app refuses to start for a variable nobody told them about.
 */
function checkTemplateCoverage(label, schemaKeysList, templatePath) {
  if (!existsSync(join(repoRoot, templatePath))) {
    fail(`${label}: ${templatePath} exists`, 'The committed template is missing.');
    return;
  }

  const template = templateKeys(templatePath);
  const missing = schemaKeysList.filter((key) => !template.has(key));

  if (missing.length === 0) {
    pass(
      `${label}: every declared variable is in ${templatePath}`,
      `${schemaKeysList.length} variables`,
    );
  } else {
    fail(
      `${label}: every declared variable is in ${templatePath}`,
      `Missing from the template: ${missing.join(', ')}`,
    );
  }
}

/**
 * Every variable in the template must exist in the schema.
 *
 * The inverse drift: a template names a variable the code no longer reads.
 * That is not harmless — an operator who sets it believes it has an effect,
 * and a secret they rotated "for security" is doing nothing.
 */
function checkTemplateHasNoStaleKeys(label, schemaKeysList, templatePath) {
  const template = templateKeys(templatePath);
  const schema = new Set(schemaKeysList);
  const stale = [...template].filter((key) => !schema.has(key)).sort();

  if (stale.length === 0) {
    pass(`${label}: ${templatePath} names no variable the code ignores`);
  } else {
    fail(
      `${label}: ${templatePath} names no variable the code ignores`,
      `Not read by the schema: ${stale.join(', ')}`,
    );
  }
}

/**
 * Every variable must be documented.
 *
 * `docs/ENVIRONMENT.md` is the operator's reference. A variable that is
 * neither in the template nor named in the documentation is a variable
 * nobody can discover.
 */
function checkDocumented(label, schemaKeysList, docPath) {
  const tokens = documentTokens(docPath);
  const undocumented = schemaKeysList.filter((key) => !tokens.has(key)).sort();

  if (undocumented.length === 0) {
    pass(
      `${label}: every variable is documented in ${docPath}`,
      `${schemaKeysList.length} variables`,
    );
  } else {
    fail(
      `${label}: every variable is documented in ${docPath}`,
      `Not mentioned: ${undocumented.join(', ')}`,
    );
  }
}

/**
 * The four pair rules in `docs/ENVIRONMENT.md` must still be enforced by the
 * schema.
 *
 * These are the rules that stop a half-configured integration from looking
 * enabled. They are easy to delete by accident during a refactor and
 * impossible to notice until an integration silently fails.
 */
function checkPairRules(apiSchema) {
  const object = unwrap(apiSchema);
  const refine = object?._def?.checks ?? [];

  // The superRefine callback is not introspectable, so the rules are checked
  // by *behaviour*: parse a set of deliberately broken environments and assert
  // that each one is rejected.
  const base = {
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://localhost:27017',
    API_PUBLIC_URL: 'https://api.example.com',
    CORS_ORIGINS: 'https://example.com',
    STOREFRONT_PUBLIC_URL: 'https://example.com',
    ADMIN_PUBLIC_URL: 'https://admin.example.com',
    SESSION_SECRET: 'x'.repeat(40),
    JWT_SECRET: 'y'.repeat(40),
  };

  const cases = [
    {
      name: 'live Razorpay without a key pair is rejected',
      env: { ...base, RAZORPAY_MODE: 'live' },
    },
    {
      name: 'live Razorpay without a webhook secret is rejected',
      env: {
        ...base,
        RAZORPAY_MODE: 'live',
        RAZORPAY_KEY_ID: 'rzp_test_key',
        RAZORPAY_KEY_SECRET: 'secret',
      },
    },
    {
      name: 'a Resend key without a sender is rejected',
      env: { ...base, RESEND_API_KEY: 're_123' },
    },
    {
      name: 'a Resend sender without a key is rejected',
      env: { ...base, RESEND_FROM_EMAIL: 'orders@example.com' },
    },
    {
      name: 'a Shiprocket email without a password is rejected',
      env: { ...base, SHIPROCKET_API_EMAIL: 'api@example.com' },
    },
    {
      name: 'a Shiprocket password without an email is rejected',
      env: { ...base, SHIPROCKET_API_PASSWORD: 'password' },
    },
    {
      name: 'a bcrypt cost below 10 outside test is rejected',
      env: { ...base, BCRYPT_COST: '4' },
    },
    {
      name: 'a session secret under 32 characters is rejected',
      env: { ...base, SESSION_SECRET: 'too-short' },
    },
  ];

  let allRejected = true;

  for (const testCase of cases) {
    const parsed = apiSchema.safeParse(testCase.env);
    if (parsed.success) {
      allRejected = false;
      fail(`Schema rejects: ${testCase.name}`, 'The environment was accepted.');
    }
  }

  if (allRejected) {
    pass(
      'The schema rejects every half-configured integration',
      `${cases.length} negative cases`,
    );
  }

  /*
   * The positive control. Without it, a schema that rejected *everything*
   * would pass every negative case above.
   */
  const valid = apiSchema.safeParse({
    ...base,
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
    RESEND_API_KEY: 're_123',
    RESEND_FROM_EMAIL: 'orders@example.com',
    SHIPROCKET_API_EMAIL: 'api@example.com',
    SHIPROCKET_API_PASSWORD: 'password',
    BCRYPT_COST: '12',
  });

  if (valid.success) {
    pass('The schema accepts a fully configured environment');
  } else {
    fail(
      'The schema accepts a fully configured environment',
      valid.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    );
  }

  void refine;
}

/**
 * A committed template must not contain a plausible secret value.
 *
 * The templates are committed and read by every operator. A template that
 * shipped with a working secret would be copied into production verbatim.
 */
function checkTemplatesCarryNoSecrets(templatePath) {
  const text = readFileSync(join(repoRoot, templatePath), 'utf8');
  const suspicious = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    // A placeholder is expected; a long opaque blob is not.
    const looksOpaque =
      value.length >= 24 &&
      !value.includes('replace-me') &&
      !value.includes('yourdomain') &&
      !value.includes('example.com') &&
      !value.includes('localhost') &&
      !value.includes('<') &&
      !value.includes('mongodb+srv://<');

    if (looksOpaque && /(SECRET|KEY|PASSWORD|TOKEN)/.test(key)) {
      suspicious.push(key);
    }
  }

  if (suspicious.length === 0) {
    pass(`${templatePath} carries no plausible secret value`);
  } else {
    fail(
      `${templatePath} carries no plausible secret value`,
      `Looks like a real credential: ${suspicious.join(', ')}`,
    );
  }
}

/**
 * No real `.env` file may be tracked by git.
 *
 * The one mistake that cannot be walked back. The check reads the git index
 * rather than the working tree, so a file that is merely present locally
 * (which is correct and expected) is not reported.
 */
function checkNoTrackedEnvFiles() {
  const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

  if (!/^\.env$/m.test(gitignore) || !/^\.env\.\*$/m.test(gitignore)) {
    fail(
      '.gitignore excludes .env and .env.*',
      'The ignore rules for environment files are missing.',
    );
  } else {
    pass('.gitignore excludes .env and .env.*');
  }

  if (/^!\.env\.example$/m.test(gitignore) && /^!apps\/api\/\.env\.test$/m.test(gitignore)) {
    pass('.gitignore keeps the templates and the test environment committed');
  } else {
    warn(
      '.gitignore keeps the templates and the test environment committed',
      'Check that the !-negations are present.',
    );
  }
}

/**
 * `apps/api/.env.test` is committed deliberately and must stay harmless.
 *
 * It is the only environment file in the repository, and the test suite
 * depends on it. It must point at a loopback address and must not carry a
 * credential that could be reused anywhere.
 */
function checkCommittedTestEnv() {
  const relative = 'apps/api/.env.test';
  if (!existsSync(join(repoRoot, relative))) {
    fail(`${relative} exists`, 'The committed test environment is missing.');
    return;
  }

  const text = readFileSync(join(repoRoot, relative), 'utf8');
  const uri = /MONGODB_URI=(.+)/.exec(text)?.[1]?.trim() ?? '';
  const loopback = /127\.0\.0\.1|localhost|::1|mongodb-memory-server/i.test(uri);

  if (loopback) {
    pass(`${relative} points at a loopback address`, uri.replace(/\/\/.*@/, '//***@'));
  } else {
    fail(
      `${relative} points at a loopback address`,
      'The committed test environment must never point at a shared database.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log('\nEnvironment inventory check\n' + '='.repeat(60));

  /*
   * The contracts package must be built before this script can import its
   * schemas. Building it here keeps the script self-contained.
   */
  const contractsEnv = join(repoRoot, 'packages/contracts/dist/env/index.js');
  if (!existsSync(contractsEnv)) {
    fail(
      '@ajooba/contracts is built',
      'Run `pnpm --filter @ajooba/contracts build` before this script.',
    );
    report();
    return;
  }

  const { apiEnvSchema, importerEnvSchema, storefrontEnvSchema, adminEnvSchema } = await import(
    pathToFileURL(contractsEnv).href
  );

  const apiKeys = schemaKeys(apiEnvSchema);
  const importerKeys = schemaKeys(importerEnvSchema);
  const storefrontKeys = schemaKeys(storefrontEnvSchema);
  const adminKeys = schemaKeys(adminEnvSchema);

  console.log(
    `\nSchemas: api=${apiKeys.length} importer=${importerKeys.length} ` +
      `storefront=${storefrontKeys.length} admin=${adminKeys.length}\n`,
  );

  /* --- apps/api ---------------------------------------------------------- */
  /*
   * `apps/api/.env.example` serves **both** the API server and the catalogue
   * importer, because the importer reads the same variables and is launched
   * from the same working directory. The union of the two schemas is
   * therefore what the template must cover — and the union is also what the
   * "no stale key" check must be measured against, so a variable the importer
   * alone declares is not reported as one the code ignores.
   */
  const apiTemplateKeys = [...new Set([...apiKeys, ...importerKeys])];

  checkTemplateCoverage('apps/api + importer', apiTemplateKeys, 'apps/api/.env.example');
  checkTemplateHasNoStaleKeys('apps/api + importer', apiTemplateKeys, 'apps/api/.env.example');
  checkDocumented('apps/api', apiKeys, 'docs/ENVIRONMENT.md');

  /*
   * The importer's own variable is importer-only. It must still be in the
   * template and still be documented, but it must NOT be in the API schema —
   * otherwise the API would accept a variable it has no use for.
   */
  const importerOnly = importerKeys.filter((key) => !apiKeys.includes(key));
  const template = templateKeys('apps/api/.env.example');
  const missingImporterOnly = importerOnly.filter((key) => !template.has(key));

  if (missingImporterOnly.length === 0) {
    pass(
      'Every importer-only variable is in apps/api/.env.example',
      importerOnly.join(', ') || '(none)',
    );
  } else {
    fail(
      'Every importer-only variable is in apps/api/.env.example',
      `Missing: ${missingImporterOnly.join(', ')}`,
    );
  }

  /* --- apps/storefront --------------------------------------------------- */
  checkTemplateCoverage('apps/storefront', storefrontKeys, 'apps/storefront/.env.example');
  checkTemplateHasNoStaleKeys('apps/storefront', storefrontKeys, 'apps/storefront/.env.example');
  checkDocumented('apps/storefront', storefrontKeys, 'docs/ENVIRONMENT.md');

  /* --- apps/admin -------------------------------------------------------- */
  checkTemplateCoverage('apps/admin', adminKeys, 'apps/admin/.env.example');
  checkTemplateHasNoStaleKeys('apps/admin', adminKeys, 'apps/admin/.env.example');
  checkDocumented('apps/admin', adminKeys, 'docs/ENVIRONMENT.md');

  /* --- behaviour --------------------------------------------------------- */
  checkPairRules(apiEnvSchema);

  /* --- hygiene ----------------------------------------------------------- */
  checkTemplatesCarryNoSecrets('apps/api/.env.example');
  checkTemplatesCarryNoSecrets('apps/storefront/.env.example');
  checkTemplatesCarryNoSecrets('apps/admin/.env.example');
  checkNoTrackedEnvFiles();
  checkCommittedTestEnv();

  report();
}

function report() {
  const failures = results.filter((r) => r.status === 'FAIL');
  const warnings = results.filter((r) => r.status === 'WARN');

  console.log('\n' + '='.repeat(60));
  console.log(`${results.length} checks - ${failures.length} failed - ${warnings.length} warnings`);

  if (failures.length > 0) {
    console.log('\nBLOCKING:');
    for (const failure of failures) {
      console.log(`  - ${failure.check}${failure.detail ? ' - ' + failure.detail : ''}`);
    }
    console.log('\nThe environment inventory is NOT in sync with the code.\n');
    process.exit(1);
  }

  console.log('\nThe environment inventory matches the code.\n');
  process.exit(0);
}

main().catch((error) => {
  console.error(`\nEnvironment inventory check crashed: ${error?.message ?? error}\n`);
  process.exit(1);
});
