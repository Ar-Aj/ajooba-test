/**
 * One-command production database seed & bootstrap script.
 *
 * Usage:
 *   $env:MONGODB_URI="mongodb+srv://..."; pnpm db:seed:prod
 *
 * What this script does automatically:
 *   1. Imports all 55 designs and 674 variants from artifacts/catalog-extract.json
 *      with --apply-stock so all 580 stocked variants are in stock and purchasable.
 *   2. Runs image-colour-migration (--apply) so all 660 verified colourway photos
 *      are stamped onto their exact colour galleries.
 *   3. Runs image-checksum-backfill (--apply) to stamp SHA-256 checksums.
 *   4. Bootstraps the Owner Admin account (defaults to admin@ajoobafootwear.in /
 *      Ahmed@9843!Ajooba, or uses BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD).
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const apiDir = join(repoRoot, 'apps', 'api');

function readDotEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const map = {};
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key) map[key] = val;
  }
  return map;
}

const fileEnv = {
  ...readDotEnvFile(join(apiDir, '.env')),
  ...readDotEnvFile(join(apiDir, '.env.local')),
  ...readDotEnvFile(join(repoRoot, '.env')),
};

const mongoUri = process.env.MONGODB_URI || fileEnv.MONGODB_URI;
const mongoDb = process.env.MONGODB_DB || fileEnv.MONGODB_DB || 'ajooba_footwear';

if (!mongoUri || mongoUri.includes('<user>') || mongoUri.includes('<password>')) {
  console.error('\n[ERROR] MONGODB_URI is not set to a real MongoDB Atlas connection string.');
  console.error('Run this command with your MongoDB Atlas URI:');
  console.error(
    '  $env:MONGODB_URI="mongodb+srv://USER:PASS@CLUSTER.mongodb.net/?retryWrites=true&w=majority"; pnpm db:seed:prod\n',
  );
  process.exit(1);
}

const adminEmail =
  process.env.BOOTSTRAP_ADMIN_EMAIL || fileEnv.BOOTSTRAP_ADMIN_EMAIL || 'admin@ajoobafootwear.in';
const adminName = process.env.BOOTSTRAP_ADMIN_NAME || fileEnv.BOOTSTRAP_ADMIN_NAME || 'Ajooba Owner';
const adminPassword =
  process.env.BOOTSTRAP_ADMIN_PASSWORD || fileEnv.BOOTSTRAP_ADMIN_PASSWORD || 'Ahmed@9843!Ajooba';

const childEnv = {
  ...fileEnv,
  ...process.env,
  NODE_ENV: 'production',
  PORT: process.env.PORT || fileEnv.PORT || '4000',
  MONGODB_URI: mongoUri,
  MONGODB_DB: mongoDb,
  API_PUBLIC_URL:
    process.env.API_PUBLIC_URL || fileEnv.API_PUBLIC_URL || 'https://api.ajoobafootwear.in',
  STOREFRONT_PUBLIC_URL:
    process.env.STOREFRONT_PUBLIC_URL ||
    fileEnv.STOREFRONT_PUBLIC_URL ||
    'https://ajoobafootwear.in',
  ADMIN_PUBLIC_URL:
    process.env.ADMIN_PUBLIC_URL || fileEnv.ADMIN_PUBLIC_URL || 'https://admin.ajoobafootwear.in',
  CORS_ORIGINS:
    process.env.CORS_ORIGINS ||
    fileEnv.CORS_ORIGINS ||
    'https://ajoobafootwear.in,https://www.ajoobafootwear.in,https://admin.ajoobafootwear.in',
  ADMIN_ORIGINS:
    process.env.ADMIN_ORIGINS ||
    fileEnv.ADMIN_ORIGINS ||
    'https://admin.ajoobafootwear.in,https://ajoobafootwear.in',
  SESSION_SECRET:
    process.env.SESSION_SECRET ||
    fileEnv.SESSION_SECRET ||
    randomBytes(48).toString('base64'),
  JWT_SECRET:
    process.env.JWT_SECRET ||
    fileEnv.JWT_SECRET ||
    randomBytes(48).toString('base64'),
  MEDIA_STATIC_DIR: join(repoRoot, 'public'),
  IMPORT_BLOCK_PRODUCTION: 'false',
  BOOTSTRAP_ADMIN_EMAIL: adminEmail,
  BOOTSTRAP_ADMIN_NAME: adminName,
  BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
  BOOTSTRAP_ADMIN_ROLE: 'owner',
};

function runStep(title, args) {
  console.log(`\n============================================================`);
  console.log(`▶ ${title}`);
  console.log(`============================================================`);
  const res = spawnSync('pnpm', args, {
    cwd: apiDir,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`\n[FAILED] Step "${title}" exited with code ${res.status}`);
    process.exit(res.status || 1);
  }
}

console.log(`\nStarting Ajooba Footwear Production Database Seed`);
console.log(`Target Database: ${mongoDb}`);

runStep('Step 1/5: Building @ajooba/contracts', ['--filter', '@ajooba/contracts', 'build']);

runStep('Step 2/5: Importing 55 designs & 674 variants (with stock applied)', [
  'exec',
  'tsx',
  'src/jobs/catalog-import.job.ts',
  '--extract',
  '../../artifacts/catalog-extract.json',
  '--apply-stock',
  '--no-media',
]);

runStep('Step 3/5: Stamping verified colour galleries onto 685 product images', [
  'exec',
  'tsx',
  'src/jobs/image-colour-migration.job.ts',
  '--apply',
]);

runStep('Step 4/5: Backfilling SHA-256 image checksums', [
  'exec',
  'tsx',
  'src/jobs/image-checksum-backfill.job.ts',
  '--apply',
]);

runStep('Step 5/5: Bootstrapping Owner Admin account', [
  'exec',
  'tsx',
  'src/jobs/admin-bootstrap.job.ts',
  '--force',
]);

console.log(`\n============================================================`);
console.log(`✅ PRODUCTION DATABASE SEED COMPLETE!`);
console.log(`   - Database:       ${mongoDb}`);
console.log(`   - Products:       55 designs, 674 variants (580 in stock)`);
console.log(`   - Admin Login:    ${adminEmail}`);
console.log(`   - Admin Password: ${adminPassword}`);
console.log(`============================================================\n`);
