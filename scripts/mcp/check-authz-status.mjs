/**
 * Reports whether this mongod ENFORCES authorization, and whether the
 * `ajooba_mcp` user's `read` role is actually being applied.
 *
 * Read-only: issues only buildInfo / getCmdLineOpts / connectionStatus.
 * Run: node scripts/mcp/check-authz-status.mjs
 */
import { createRequire } from 'node:module';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);

function loadDriver() {
  try {
    return require('mongodb').MongoClient;
  } catch {
    const pnpmDir = resolve(ROOT, 'node_modules', '.pnpm');
    const match = readdirSync(pnpmDir)
      .filter((n) => n.startsWith('mongodb@'))
      .sort()
      .reverse()
      .find((n) => existsSync(resolve(pnpmDir, n, 'node_modules', 'mongodb')));
    return require(resolve(pnpmDir, match, 'node_modules', 'mongodb')).MongoClient;
  }
}
const MongoClient = loadDriver();

const uri = readFileSync(resolve(ROOT, '.env.mcp'), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('MDB_MCP_CONNECTION_STRING='))
  .slice('MDB_MCP_CONNECTION_STRING='.length);

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
await client.connect();

const opts = await client.db('admin').command({ getCmdLineOpts: 1 });
const security = opts.parsed?.security ?? {};
console.log('=== mongod startup options ===');
console.log('security block        :', JSON.stringify(security));
console.log('authorization enabled :', security.authorization ?? false);
console.log('keyFile present       :', Boolean(security.keyFile));

const status = await client.db('admin').command({ connectionStatus: 1 });
console.log('\n=== current session ===');
console.log('authenticatedUsers    :', JSON.stringify(status.authInfo.authenticatedUsers));
console.log('authenticatedUserRoles:', JSON.stringify(status.authInfo.authenticatedUserRoles));

console.log('\nInterpretation:');
if (!security.authorization && !security.keyFile) {
  console.log('  authorization is DISABLED. MongoDB verifies the password');
  console.log('  (auth works) but does not enforce roles — every authenticated');
  console.log('  user gets full access to every database. A `read` role is');
  console.log('  recorded but NOT applied.');
} else {
  console.log('  authorization is ENABLED — the `read` role is enforced.');
}

await client.close();