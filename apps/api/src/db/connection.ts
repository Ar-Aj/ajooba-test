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
    .then((instance) => {
      connectionState.connected = true;
      connectionState.connecting = false;
      connectionState.lastError = null;
      logger.info({ db: instance.connection.name }, 'MongoDB connected');
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
