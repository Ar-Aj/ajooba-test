import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const apiDir = path.join(repoRoot, 'apps', 'api');

const mongoUri = (process.argv[2] || process.env.MONGODB_URI || '').trim();
if (!mongoUri || !mongoUri.startsWith('mongodb')) {
  console.error(
    '\nUsage:\n  pnpm db:setup "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"\n',
  );
  process.exit(1);
}

const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@ajoobafootwear.in';
const adminName = process.env.BOOTSTRAP_ADMIN_NAME || 'Ajooba Owner';
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Ahmed@9843#Ajooba';

const sharedEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: '4000',
  MONGODB_URI: mongoUri,
  MONGODB_DB: process.env.MONGODB_DB || 'ajooba_footwear',
  API_PUBLIC_URL: 'https://api.ajoobafootwear.in',
  STOREFRONT_PUBLIC_URL: 'https://ajoobafootwear.in',
  ADMIN_PUBLIC_URL: 'https://admin.ajoobafootwear.in',
  CORS_ORIGINS:
    'https://ajoobafootwear.in,https://www.ajoobafootwear.in,https://admin.ajoobafootwear.in',
  ADMIN_ORIGINS: 'https://admin.ajoobafootwear.in,https://ajoobafootwear.in',
  SESSION_SECRET:
    '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e',
  JWT_SECRET:
    '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  IMPORT_BLOCK_PRODUCTION: 'false',
  RAZORPAY_MODE: 'test',
  MEDIA_STATIC_DIR: path.join(repoRoot, 'public'),
  BOOTSTRAP_ADMIN_EMAIL: adminEmail,
  BOOTSTRAP_ADMIN_NAME: adminName,
  BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
  BOOTSTRAP_ADMIN_ROLE: 'owner',
};

const steps = [
  {
    name: '1/4 Building @ajooba/contracts',
    cwd: repoRoot,
    args: ['--filter', '@ajooba/contracts', 'build'],
  },
  {
    name: '2/4 Importing 55 designs & 674 variants (with template stock)',
    cwd: apiDir,
    args: [
      'catalog:import',
      '--',
      '--extract',
      path.join(repoRoot, 'artifacts', 'catalog-extract.json'),
      '--apply-stock',
    ],
  },
  {
    name: '3/4 Stamping verified colour galleries & SHA-256 image checksums',
    cwd: apiDir,
    args: ['exec', 'tsx', 'src/jobs/image-colour-migration.job.ts', '--apply'],
  },
  {
    name: '3b/4 Backfilling SHA-256 image checksums',
    cwd: apiDir,
    args: ['exec', 'tsx', 'src/jobs/image-checksum-backfill.job.ts', '--apply'],
  },
  {
    name: `4/4 Bootstrapping owner admin (${adminEmail})`,
    cwd: apiDir,
    args: ['admin:bootstrap', '--', '--force'],
  },
];

for (const step of steps) {
  console.log(`\n==> ${step.name}...`);
  const res = spawnSync('pnpm', step.args, {
    cwd: step.cwd,
    env: sharedEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`\n[FAILED] Step failed: ${step.name} (exit code ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

console.log('\n============================================================');
console.log('Cloud database setup complete!');
console.log(`Database:       ${sharedEnv.MONGODB_DB}`);
console.log(`Admin Email:    ${adminEmail}`);
console.log(`Admin Password: ${adminPassword}`);
console.log('============================================================\n');
