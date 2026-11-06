/**
 * Mint a short-lived administrator access token for local verification.
 *
 * The admin panel keeps its session in an httpOnly cookie called
 * `ajooba_admin_token`, whose value is exactly the access token the API
 * issued. Automated browser verification therefore does not need the owner's
 * password: it needs a token signed the way the API signs one. This script
 * mints one with the API's **own** token service, so the token is byte-for-byte
 * the shape the API accepts — no parallel signing logic to drift.
 *
 * It is **read-only**. It never creates, promotes or modifies an account. It
 * reads the active administrator record and copies that account's real role
 * and permissions into the token, so the token grants exactly what the account
 * already holds.
 *
 * Refuses to run against a database whose name does not look like a
 * development or test database.
 *
 *     pnpm --filter @ajooba/api exec tsx scripts/admin-token.ts <output-file>
 */
import { writeFile } from 'node:fs/promises';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { AdminUserModel } from '../src/models/admin-user.model.js';
import { issueAccessToken } from '../src/services/token.service.js';
import { env } from '../src/config/env.js';

const DEV_DATABASE = /dev|test|local/i;

async function main(): Promise<void> {
  // When MONGODB_DB is unset the connection string names the database, so fall
  // back to the URI and evaluate whichever one actually applies.
  const database = env.MONGODB_DB ?? env.MONGODB_URI;

  if (!DEV_DATABASE.test(database)) {
    throw new Error(
      `Refusing to mint a token for database "${database}" — not a development database.`,
    );
  }

  await connectToDatabase();

  const admin = await AdminUserModel.findOne({ isActive: true })
    .select('email role permissions')
    .lean<{ _id: unknown; email: string; role: string; permissions?: string[] } | null>();

  await disconnectFromDatabase();

  if (!admin) {
    throw new Error('No active administrator exists in this database.');
  }

  const token = await issueAccessToken({
    sub: String(admin._id),
    kind: 'admin',
    email: admin.email,
    role: admin.role as never,
    ...(admin.permissions ? { permissions: admin.permissions as never } : {}),
  });

  /*
   * Write the token to a file as well as stdout.
   *
   * The API logs to stdout during connect/disconnect, so a shell that captures
   * stdout gets the token mixed with log lines. The file is the reliable
   * channel; stdout stays for a human running the command by hand.
   */
  const outFile = process.argv[2];
  if (outFile) {
    await writeFile(outFile, token, 'utf8');
  }

  process.stdout.write(token);
}

await main();
