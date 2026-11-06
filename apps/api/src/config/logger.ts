import { pino } from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * Application logger.
 *
 * Structured JSON in production (so log aggregators can parse it), readable
 * output in development. No secret values are ever logged.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'ajooba-api' },
  redact: {
    /*
     * The paths below are matched **literally** by pino, so each one has to
     * be listed. A wildcard like `*.password` matches one level only —
     * `req.body.currentPassword` is a different path and is not covered.
     *
     * Request bodies are not serialised today (see the `pinoHttp` config in
     * `app.ts`), so none of these body paths can currently leak. They are
     * listed anyway, because the day someone adds a body serialiser — a
     * change that looks harmless — the password fields must already be
     * covered.
     */
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-razorpay-signature"]',
      'res.headers["set-cookie"]',
      'res.headers["Set-Cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.passwordHash',
      '*.token',
      '*.tokenHash',
      '*.accessToken',
      '*.refreshToken',
      '*.sessionSecret',
      '*.razorpayKeySecret',
      '*.shiprocketApiPassword',
      '*.resendApiKey',
      'req.body',
    ],
    censor: '[redacted]',
  },
  transport:
    isProduction || isTest
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
});

export type Logger = typeof logger;
