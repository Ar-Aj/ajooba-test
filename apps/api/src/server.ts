import { createServer } from 'node:http';
import { createApp } from './app.js';
import { describeEnv, env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectToDatabase, disconnectFromDatabase } from './db/connection.js';
import { reconcileCategoryTaxonomyAtBoot } from './services/category-bootstrap.service.js';

/**
 * API server bootstrap.
 *
 * The database connection is established before the server starts accepting
 * traffic, so a misconfigured database fails fast at boot rather than on the
 * first request.
 */
async function main(): Promise<void> {
  logger.info(describeEnv(), 'Starting @ajooba/api');

  const app = createApp();
  const server = createServer(app);

  // Bind socket immediately so managed Node.js platforms (e.g. Hostinger's 3s
  // listen() watchdog) register the server port right away while MongoDB
  // finishes connecting.
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, apiPublicUrl: env.API_PUBLIC_URL }, 'API listening');
  });

  try {
    await connectToDatabase();
  } catch (error) {
    logger.error(
      { err: error },
      'Failed to connect to MongoDB. Check MONGODB_URI and the network access list.',
    );
    process.exit(1);
  }

  /*
   * Reconcile the category taxonomy against the catalogue.
   */
  await reconcileCategoryTaxonomyAtBoot();

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

const defaultApp = createApp();

if (process.env.VERCEL) {
  logger.info('Booting @ajooba/api in Vercel serverless environment');
  void connectToDatabase()
    .then(() => reconcileCategoryTaxonomyAtBoot())
    .catch((error) => {
      logger.warn({ err: error }, 'Deferred MongoDB connection on Vercel boot');
    });
} else {
  main().catch((error: unknown) => {
    logger.fatal({ err: error }, 'Fatal error during startup');
    process.exit(1);
  });
}

export default defaultApp;
