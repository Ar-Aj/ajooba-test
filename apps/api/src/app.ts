import compression from 'compression';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { adminOrigins, corsOrigins, isProduction } from './config/env.js';
import { errorHandler, notFoundHandler, requestIdMiddleware } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { v1Router } from './routes/v1.routes.js';

/**
 * Express application assembly.
 *
 * The app is created separately from the server bootstrap so that tests can
 * mount it with supertest without opening a socket.
 */
export function createApp(): Application {
  const app = express();

  // Behind a proxy/load balancer (Vercel, Render, Cloudflare) we need the real
  // client IP for rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; a restrictive CSP here would be misleading
      // but harmless. It is set explicitly to avoid the default breaking
      // future non-JSON responses.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin / server-to-server / curl requests have no Origin header.
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowed = isProduction
          ? [...corsOrigins, ...adminOrigins]
          : [...corsOrigins, ...adminOrigins, 'http://localhost:3000', 'http://localhost:3001'];
        callback(null, allowed.includes(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(requestIdMiddleware);

  app.use(
    pinoHttp({
      logger,
      autoLogging: {
        ignore: (req: Request) => req.url === '/health/live',
      },
      customLogLevel: (_req: Request, res: Response, err: Error | undefined) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req: Request, res: Response) =>
        `${req.method} ${req.url} ${res.statusCode}`,
    }),
  );

  // A coarse global limit. Route-specific limits are added where needed.
  app.use(
    '/v1',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again shortly.',
        },
      },
    }),
  );

  app.use('/health', healthRouter);
  app.use('/v1', v1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
