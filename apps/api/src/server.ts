import { createServer } from 'node:http';
import { createApp } from './app.js';
import { describeEnv, env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectToDatabase, disconnectFromDatabase } from './db/connection.js';

/**
 * API server bootstrap.
 *
 * The database connection is established before the server starts accepting
 * traffic, so a misconfigured database fails fast at boot rather than on the
 * first request.
 */
async function main(): Promise<void> {
  logger.info(describeEnv(), 'Starting @ajooba/api');

  try {
    await connectToDatabase();
  } catch (error) {
    logger.error(
      { err: error },
      'Failed to connect to MongoDB. Check MONGODB_URI and the network access list.',
    );
    process.exit(1);
  }

  const app = createApp();
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, apiPublicUrl: env.API_PUBLIC_URL }, 'API listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectFromDatabase().finally(() => {
        process.exit(0);
      });
    });
    // Force exit if connections hang.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error during startup');
  process.exit(1);
});
