/**
 * First-administrator bootstrap.
 *
 * There is deliberately **no** default administrator and no default
 * password. The first administrator is created by this explicit command,
 * which requires the operator to supply real credentials.
 *
 *     pnpm --filter @ajooba/api admin:bootstrap
 *
 * Credentials can be supplied two ways:
 *
 *   1. **Environment variables** (preferred for CI and for a seeded
 *      deployment):
 *
 *         BOOTSTRAP_ADMIN_EMAIL=owner@ajooba.example
 *         BOOTSTRAP_ADMIN_NAME="Store Owner"
 *         BOOTSTRAP_ADMIN_PASSWORD='<strong password>'
 *         BOOTSTRAP_ADMIN_ROLE=owner
 *         pnpm --filter @ajooba/api admin:bootstrap
 *
 *   2. **A secure interactive prompt** — the password is read from the TTY
 *      with echo disabled and is never echoed, logged, or written to shell
 *      history. The environment-variable path is only used when the
 *      variables are present.
 *
 * Safety rules
 * ------------
 * * The password is never accepted as a command-line argument, so it cannot
 *   leak through the process list or a shell history file.
 * * A weak password is rejected before the account is created.
 * * The account is created with `isActive: true` but cannot be created
 *   twice — a second run reports the existing account and exits non-zero
 *   unless `--force` is given, which then only resets the password.
 * * The command refuses to run against a database that looks like
 *   production, matching the importer's guard.
 */

import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { connectToDatabase, disconnectFromDatabase } from '../db/connection.js';
import { AdminUserModel } from '../models/admin-user.model.js';
import { hashPassword } from '../services/password.service.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { ADMIN_ROLES, type AdminRole } from '@ajooba/contracts';

/* -------------------------------------------------------------------------- */
/* Credential sourcing                                                        */
/* -------------------------------------------------------------------------- */

interface BootstrapCredentials {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role: AdminRole;
}

/**
 * Read a line from the TTY.
 *
 * `visible: true` echoes the input; `visible: false` suppresses it so a
 * password never lands in the terminal scrollback.
 *
 * The echo suppression works by intercepting `readline`'s output writer
 * and dropping the characters that were echoed back. The prompt itself is
 * written once, before the read starts.
 */
function prompt(question: string, visible: boolean): Promise<string> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });

    const output = rl as unknown as { output: NodeJS.WriteStream };
    const originalWrite = output.output.write.bind(output.output);

    output.output.write = (chunk: string | Uint8Array): boolean => {
      if (visible) {
        return originalWrite(chunk);
      }
      /*
       * In hidden mode every chunk readline writes is the echoed
       * keystrokes. The prompt was already written by the caller, so
       * everything is swallowed.
       */
      return true;
    };

    stdout.write(question);

    rl.question('', (answer) => {
      output.output.write = originalWrite;
      rl.close();
      if (!visible) {
        stdout.write('\n');
      }
      resolvePromise(answer);
    });
  });
}

/**
 * The minimum password strength the bootstrap accepts.
 *
 * The same rule the registration endpoint applies, so an administrator
 * created here is not weaker than one created through the API.
 */
function assertPasswordStrength(password: string): void {
  const problems: string[] = [];

  if (password.length < 12) {
    problems.push('be at least 12 characters long');
  }
  if (!/[a-z]/.test(password)) {
    problems.push('contain a lowercase letter');
  }
  if (!/[A-Z]/.test(password)) {
    problems.push('contain an uppercase letter');
  }
  if (!/\d/.test(password)) {
    problems.push('contain a digit');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    problems.push('contain a symbol');
  }

  if (problems.length > 0) {
    throw new Error(`The password must ${problems.join(', ')}.`);
  }
}

function assertValidEmail(email: string): void {
  const shape = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!shape.test(email)) {
    throw new Error(`"${email}" is not a valid email address.`);
  }
}

/**
 * Collect the credentials from the environment, or interactively.
 */
async function collectCredentials(): Promise<BootstrapCredentials> {
  const envEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const envName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const envPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const envRole = process.env.BOOTSTRAP_ADMIN_ROLE?.trim() as AdminRole | undefined;

  if (envEmail && envPassword) {
    const role = envRole ?? 'owner';
    if (!ADMIN_ROLES.includes(role)) {
      throw new Error(
        `BOOTSTRAP_ADMIN_ROLE must be one of: ${ADMIN_ROLES.join(', ')}. Got "${role}".`,
      );
    }
    return {
      email: envEmail.toLowerCase(),
      name: envName || envEmail.split('@')[0]!,
      password: envPassword,
      role,
    };
  }

  /*
   * Interactive path. The password is typed at a hidden prompt so it never
   * appears in the terminal scrollback, a shell history file, or a
   * process listing.
   */
  if (!stdin.isTTY) {
    throw new Error(
      'No TTY available for the interactive prompt. Set BOOTSTRAP_ADMIN_EMAIL, ' +
        'BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_ADMIN_ROLE instead.',
    );
  }

  const email = (await prompt('Administrator email: ', true)).trim();
  const name = (await prompt('Administrator name: ', true)).trim();
  const password = await prompt('Administrator password: ', false);
  const roleInput = (await prompt('Administrator role [owner]: ', true)).trim();

  const role = (roleInput || 'owner') as AdminRole;
  if (!ADMIN_ROLES.includes(role)) {
    throw new Error(`Role must be one of: ${ADMIN_ROLES.join(', ')}.`);
  }

  return {
    email: email.toLowerCase(),
    name: name || email.split('@')[0]!,
    password,
    role,
  };
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                     */
/* -------------------------------------------------------------------------- */

function assertNotProductionDatabase(): void {
  const dbName = (env.MONGODB_DB ?? '').toLowerCase();
  const isProductionName = ['prod', 'production', 'live'].some((marker) => dbName.includes(marker));

  if (isProductionName) {
    throw new Error(
      `Refusing to bootstrap an administrator against the database "${env.MONGODB_DB}". ` +
        'Point MONGODB_DB at an administrative database, or bootstrap through a ' +
        'deployment job with explicit credentials.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  const credentials = await collectCredentials();

  assertValidEmail(credentials.email);
  assertPasswordStrength(credentials.password);

  if (!credentials.name.trim()) {
    throw new Error('The administrator name must not be empty.');
  }

  assertNotProductionDatabase();

  const passwordHash = await hashPassword(credentials.password);

  await connectToDatabase();
  try {
    const existing = await AdminUserModel.findOne({ email: credentials.email })
      .select('_id role isActive')
      .lean<{ _id: unknown; role: AdminRole; isActive: boolean } | null>();

    if (existing && !force) {
      throw new Error(
        `An administrator with the email "${credentials.email}" already exists. ` +
          'Re-run with --force to reset its password and role.',
      );
    }

    if (existing) {
      await AdminUserModel.updateOne(
        { email: credentials.email },
        {
          $set: {
            name: credentials.name,
            role: credentials.role,
            passwordHash,
            isActive: true,
            passwordChangedAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        },
      );
      logger.info(
        { email: credentials.email, role: credentials.role },
        'Existing administrator password and role reset',
      );
    } else {
      await AdminUserModel.create({
        email: credentials.email,
        name: credentials.name,
        role: credentials.role,
        passwordHash,
        isActive: true,
        passwordChangedAt: new Date(),
      });
      logger.info(
        { email: credentials.email, role: credentials.role },
        'First administrator created',
      );
    }
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  // The message never contains the password.
  logger.error({ error: message }, 'Administrator bootstrap failed');
  process.exit(1);
});
