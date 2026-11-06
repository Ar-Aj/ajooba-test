import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ServiceUnavailableError } from '../core/errors.js';

/**
 * MongoDB connection management.
 *
 * The connection string and database name come from platform-provided
 * environment variables, so development, staging and production each point at
 * their own cluster or database. Nothing is hardcoded.
 *
 * NOTE ON IMPORTS: Mongoose is a CommonJS module. A named import such as
 * `import { ConnectionStates } from 'mongoose'` compiles fine under
 * `verbatimModuleSyntax` but FAILS AT RUNTIME under Node's ESM loader
 * ("Named export 'ConnectionStates' not found"). The enum is therefore read
 * off the default export, which is the interop-safe form.
 */
const { ConnectionStates } = mongoose;

let connectionPromise: Promise<typeof mongoose> | null = null;

export const connectionState = {
  connected: false,
  connecting: false,
  lastError: null as string | null,
};

/**
 * Connect to MongoDB. Safe to call repeatedly — the underlying promise is
 * reused until the connection drops.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionState.connecting = true;

  connectionPromise = mongoose
    .connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB,
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      minPoolSize: 2,
      autoIndex: env.NODE_ENV !== 'production',
    })
    .then(async (instance) => {
      connectionState.connected = true;
      connectionState.connecting = false;
      connectionState.lastError = null;
      logger.info({ db: instance.connection.name }, 'MongoDB connected');

      /*
       * Make sure the schema's indexes actually exist.
       *
       * This is not belt-and-braces. `autoIndex` is a *fire-and-forget*
       * flag: Mongoose kicks off index builds in the background and does
       * not wait for them. Two things follow, and the second is expensive.
       *
       *  1. A model used immediately after connect can be written to before
       *     its indexes exist, so a query can run unindexed against a
       *     production collection.
       *  2. **A unique index that fails to build is not an error.** The
       *     insert still succeeds — it just no longer rejects the duplicate.
       *     That is how the email outbox's exactly-once guarantee was found
       *     to be decorative: `(template, idempotencyKey)` was declared
       *     unique in the schema, but the collection had not built it, so a
       *     second "shipped" email for the same order was enqueued and sent
       *     anyway. Duplicate customer emails, silently.
       *
       * So the indexes are built and *awaited* here, and any index that
       * could not be created is a hard failure at boot rather than a
       * surprise discovered in production.
       *
       * In production `autoIndex` is off (see the connect options above), so
       * this `ensureIndexes` call is the thing that actually provisions the
       * indexes there — which is exactly why it is not optional and why it
       * must not be allowed to fail quietly.
       */
      await ensureSchemaIndexes(instance);

      return instance;
    })
    .catch((error: unknown) => {
      connectionState.connected = false;
      connectionState.connecting = false;
      connectionState.lastError = error instanceof Error ? error.message : 'Unknown error';
      connectionPromise = null;
      throw error;
    });

  return connectionPromise;
}

/** Close the connection cleanly during shutdown. */
export async function disconnectFromDatabase(): Promise<void> {
  connectionPromise = null;
  connectionState.connected = false;
  connectionState.connecting = false;
  if (mongoose.connection.readyState !== ConnectionStates.disconnected) {
    await mongoose.connection.close();
    logger.info('MongoDB disconnected');
  }
}

/**
 * Build every model's indexes and refuse to continue if any of them fails.
 *
 * `Model.init()` is Mongoose's promise for "this model's indexes exist",
 * which `autoIndex` does not actually wait on. Awaiting `init()` on every
 * registered model is what turns a background, best-effort build into a
 * startup precondition.
 *
 * A failure is fatal by design. The indexes this project depends on are not
 * performance tuning — several are *correctness* constraints:
 *
 *  - `email_logs (template, idempotencyKey)` unique — the exactly-once
 *    guarantee for transactional email.
 *  - `webhook_events (eventId)` unique — webhook idempotency, which is what
 *    stops a redelivered `payment.captured` from settling an order twice.
 *  - the stock-movement and order-reference uniqueness indexes — without
 *    them, a race can decrement stock twice.
 *
 * Booting without them means running a store that can double-charge a
 * customer's inbox, double-settle a payment, or double-decrement stock. That
 * is strictly worse than refusing to start and saying why.
 */
async function ensureSchemaIndexes(instance: typeof mongoose): Promise<void> {
  /*
   * Importing the registry is what guarantees every model is registered.
   * It runs *before* the model list is read, so the list is complete
   * regardless of what else the application has happened to import.
   */
  await import('./models.js');

  const models = Object.values(instance.models);

  if (models.length === 0) {
    logger.warn('No Mongoose models are registered; skipping index provisioning.');
    return;
  }

  const results = await Promise.allSettled(models.map((model) => model.init()));
  const failures = results
    .map((result, index) => ({ result, model: models[index] }))
    .filter(
      (entry): entry is { result: PromiseRejectedResult; model: (typeof models)[number] } =>
        entry.result.status === 'rejected',
    );

  if (failures.length > 0) {
    for (const { result, model } of failures) {
      const reason = result.reason as { message?: string; code?: number } | undefined;
      logger.error(
        {
          model: model.modelName,
          code: reason?.code,
          message: reason?.message,
          err: result.reason,
        },
        'Failed to build the model indexes',
      );
    }

    throw new Error(
      `Refusing to start: ${failures.length} model(s) failed index creation ` +
        `(${failures
          .map(
            (f) =>
              `${f.model.modelName}: ${(f.result.reason as Error | undefined)?.message ?? 'unknown'}`,
          )
          .join('; ')}). ` +
        'A missing unique index removes a correctness guarantee, not just performance. ' +
        'Check the database user has index-creation rights, then deploy again.',
    );
  }

  logger.info({ models: models.length }, 'Schema indexes are in place');
}

/** Ping the database. Used by the readiness probe. */
export async function pingDatabase(): Promise<number> {
  const startedAt = Date.now();
  if (mongoose.connection.readyState !== ConnectionStates.connected) {
    throw new ServiceUnavailableError('MongoDB is not connected.');
  }
  await mongoose.connection.db?.admin().ping();
  return Date.now() - startedAt;
}

/** True when the driver currently holds an open connection. */
export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === ConnectionStates.connected;
}
