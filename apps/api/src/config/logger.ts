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
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.sessionSecret',
      '*.razorpayKeySecret',
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
