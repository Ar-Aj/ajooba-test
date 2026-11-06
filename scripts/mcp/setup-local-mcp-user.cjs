/**
 * One-time setup for the local MongoDB MCP development user.
 *
 * Creates a least-privilege, database-scoped user that the MCP server can
 * authenticate as. The password is generated locally and written ONLY to the
 * gitignored `.env.mcp` file - it is never printed to stdout or committed.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_NAME = 'ajooba_development';
const USER_NAME = 'ajooba_mcp';
const ADMIN_URI = 'mongodb://127.0.0.1:27017';

/**
 * Resolve the `mongodb` driver from this workspace.
 *
 * pnpm does not hoist the driver into the root `node_modules`, so the direct
 * require can fail. Resolve it the same way the importer does: ask pnpm where
 * the package lives, and fall back to a plain require for npm/Yarn layouts.
 */
function loadMongoClient() {
  try {
    return require('mongodb').MongoClient;
  } catch {
    /* not hoisted — fall through to the pnpm store */
  }

  const pnpmDir = path.resolve(__dirname, '..', '..', 'node_modules', '.pnpm');
  if (fs.existsSync(pnpmDir)) {
    const match = fs
      .readdirSync(pnpmDir)
      .filter((name) => name.startsWith('mongodb@'))
      .sort()
      .reverse()
      .find((name) => {
        const candidate = path.join(pnpmDir, name, 'node_modules', 'mongodb');
        return fs.existsSync(candidate);
      });
    if (match) {
      return require(path.join(pnpmDir, match, 'node_modules', 'mongodb')).MongoClient;
    }
  }

  throw new Error(
    'Could not resolve the `mongodb` driver. Run `pnpm install` at the repo root first.',
  );
}

const MongoClient = loadMongoClient();

async function main() {
  const password = crypto.randomBytes(32).toString('hex');

  const admin = new MongoClient(ADMIN_URI, { serverSelectionTimeoutMS: 8000 });
  await admin.connect();

  // Remove any previous incarnation of the user from BOTH possible homes so
  // the role set is exactly what we intend and there is no stale admin user.
  for (const home of ['admin', DB_NAME]) {
    try {
      await admin.db(home).command({ dropUser: USER_NAME });
      console.log(`[setup] removed previous user '${USER_NAME}' from ${home}`);
    } catch (error) {
      if (error.codeName !== 'UserNotFound') throw error;
    }
  }

  // Minimum required permissions: read-only access to the dev database only.
  //
  // The user is created IN the target database (not in `admin`) so that
  // `authSource=ajooba_development` works and so the credential is scoped to
  // the one database it may ever read.
  await admin.db(DB_NAME).command({
    createUser: USER_NAME,
    pwd: password,
    mechanisms: ['SCRAM-SHA-256'],
    roles: [{ role: 'read', db: DB_NAME }],
  });
  console.log(`[setup] created user '${USER_NAME}'@${DB_NAME} with role read@${DB_NAME}`);
  await admin.close();

  // The connection string carries the credential, so it must be encoded.
  const encodedPassword = encodeURIComponent(password);
  const connectionString = `mongodb://${USER_NAME}:${encodedPassword}@127.0.0.1:27017/${DB_NAME}?authSource=${DB_NAME}`;

  const envPath = path.resolve(__dirname, '..', '..', '.env.mcp');
  const contents = [
    '# ---------------------------------------------------------------------------',
    '# Ajooba Footwear - local MongoDB MCP environment (GIT-IGNORED)',
    '#',
    '# Consumed by Cursor via `.cursor/mcp.json` -> `envFile`.',
    '# Contains a database password: never commit, never copy into docs.',
    '# Regenerate with: node scripts/mcp/setup-local-mcp-user.cjs',
    '# ---------------------------------------------------------------------------',
    '',
    '# Connection string for the MongoDB MCP server (read-only user).',
    `MDB_MCP_CONNECTION_STRING=${connectionString}`,
    '',
    '# Read-only mode: allows read/connect/metadata operations only.',
    'MDB_MCP_READ_ONLY=true',
    '',
    '# No telemetry from the MCP server.',
    'MDB_MCP_TELEMETRY=disabled',
    '',
    '# Defensive: destructive tools are disabled in addition to read-only mode.',
    'MDB_MCP_DISABLED_TOOLS=drop-database,drop-collection,delete-many,delete-one,drop-index,drop-indexes,insert-many,insert-one,update-many,update-one,create-index,rename-collection',
    '',
  ].join('\n');

  fs.writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
  console.log(`[setup] wrote credentials to ${envPath} (git-ignored)`);
  console.log('[setup] password was NOT printed');
}

main().catch((error) => {
  console.error('[setup] FAILED:', error.message);
  process.exit(1);
});
