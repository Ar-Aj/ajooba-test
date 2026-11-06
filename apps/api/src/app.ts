import compression from 'compression';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pinoHttp } from 'pino-http';
import { logger } from './config/logger.js';
import { adminOrigins, corsOrigins, env, isProduction } from './config/env.js';
import { errorHandler, notFoundHandler, requestIdMiddleware } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { v1Router } from './routes/v1.routes.js';
import { webhookRouter, WEBHOOK_RAW_BODY_PATHS } from './routes/webhook.routes.js';

/**
 * A request that carries the exact bytes of its body.
 *
 * Populated by the `verify` hook above, for webhook routes only.
 */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Express application assembly.
 *
 * The app is created separately from the server bootstrap so that tests can
 * mount it with supertest without opening a socket.
 */
export function createApp(): Application {
  const app = express();

  /*
   * The Vercel public rewrite sends the original /api/... path to this
   * service. Strip that mount prefix before the existing /v1, /health and
   * /webhooks routers run. Internal service-binding calls use unprefixed
   * routes directly.
   */
  app.use((req, _res, next) => {
    if (req.url === '/api') {
      req.url = '/';
    } else if (req.url?.startsWith('/api/')) {
      req.url = req.url.slice('/api'.length);
    }
    next();
  });

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

  /*
   * CORS.
   *
   * The origin allowlist is a **delegate**, not a static list, because the
   * two origin lists are kept separate rather than unioned:
   *
   *  - the storefront may call the customer API;
   *  - the admin panel may additionally call the administrator API;
   *  - provider webhooks are server-to-server and carry no Origin.
   *
   * Unioning the lists would let the storefront origin call administrator
   * endpoints with credentials, which is exactly the separation the two
   * lists exist to create.
   */
  app.use(
    cors((req, callback) => {
      const isAdminSurface = req.path.startsWith('/v1/admin') || req.path.startsWith('/webhooks');

      const allowed = isAdminSurface ? [...adminOrigins] : [...corsOrigins];

      const withLocalhost = isProduction
        ? allowed
        : [...allowed, 'http://localhost:3000', 'http://localhost:3001'];

      callback(null, {
        origin(
          origin: string | undefined,
          originCallback: (err: Error | null, ok?: boolean) => void,
        ) {
          // Same-origin / server-to-server / curl requests have no Origin header.
          if (!origin) {
            originCallback(null, true);
            return;
          }
          originCallback(null, withLocalhost.includes(origin));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
        exposedHeaders: ['x-request-id'],
        maxAge: 600,
      });
    }),
  );

  app.use(compression());

  /*
   * Raw body capture, scoped to the webhook routes only.
   *
   * Razorpay's documented signature procedure is
   * `hmac('sha256', raw_webhook_body, webhook_secret)` and its docs state
   * explicitly: *"Do not parse or cast the webhook request body."*
   *
   * `express.json({ verify })` therefore captures the exact bytes on the way
   * past for just this path, so the HMAC is computed over precisely what
   * arrived. Every other route keeps ordinary JSON parsing and never pays
   * for a second copy of its body.
   */
  app.use(
    WEBHOOK_RAW_BODY_PATHS,
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      },
    }),
  );

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

  /*
   * Provider webhooks.
   *
   * Mounted **outside** `/v1` so that a third-party provider can post to an
   * unversioned, stable URL, and mounted **before** the catch-all 404.
   *
   * The webhook surface gets its own, tighter limit. It sits outside the
   * `/v1` limiter, and it is reachable by anyone on the internet, so
   * without a limit of its own it would be a free denial-of-service and
   * log-flooding target. The limit is generous enough that a provider's
   * legitimate redelivery burst is never throttled.
   */
  app.use(
    '/webhooks',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
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

  app.use('/webhooks', webhookRouter);

  /*
   * Catalogue media.
   *
   * The catalogue stores image paths as root-relative URLs
   * (`/products/AJ-A1/A1 - 1.jpg`). The photography lives in the
   * repository-root `public/` tree, which is outside both the API and the
   * storefront app roots, so it is mounted read-only here.
   *
   * This mount is deliberately placed AFTER the JSON routers so a request
   * for `/v1/...` can never fall through to the file system, and it is
   * skipped entirely when `MEDIA_STATIC_DIR` is not configured — in that
   * case the CDN/object store serves the images and the API stays a pure
   * JSON service.
   */
  const mediaRoot = env.MEDIA_STATIC_DIR;
  if (mediaRoot && existsSync(mediaRoot)) {
    const productsDir = join(mediaRoot, 'products');
    app.use(
      '/products',
      express.static(productsDir, {
        // The source files are immutable: their names are content-addressed
        // by design code + colour + index.
        immutable: true,
        maxAge: '30d',
        fallthrough: true,
        index: false,
        dotfiles: 'ignore',
      }),
    );
    logger.info({ mediaRoot }, 'Serving catalogue media from disk');
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
