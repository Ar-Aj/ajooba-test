import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiErrorCode } from '@ajooba/contracts';
import { logger } from '../config/logger.js';
import { AppError, NotFoundError, ValidationError } from '../core/errors.js';
import { sendFailure } from '../core/http.js';

/**
 * Augment Express's Request type so handlers can read `req.requestId`.
 *
 * The module is augmented via `globalThis` because Express 5 has a non-trivial
 * module hierarchy and a direct `declare module 'express-serve-static-core'`
 * can fail to resolve under Node's NodeNext resolution strategy.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Read the request id from a request, falling back to a fresh UUID.
 *
 * Centralised so handler code can simply call `getRequestId(req)` without
 * trusting the type augmentation in every file.
 */
export function getRequestId(req: Request): string {
  return (req as Request & { requestId?: string }).requestId ?? randomUUID();
}

/**
 * Attach a correlation id to every request. Reuses an inbound
 * `x-request-id` when present so a trace survives across services.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  const id = inbound && inbound.length <= 128 ? inbound : randomUUID();
  (req as Request & { requestId: string }).requestId = id;
  res.setHeader('x-request-id', id);
  next();
};

/** Convert a Zod error into a list of field-level errors. */
export function toFieldErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** 404 handler for unmatched routes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};

/**
 * Central error handler.
 *
 * Known `AppError`s are returned with their safe message. Anything else is
 * logged with full detail and returned as a generic 500 so that internal
 * information never leaks to a client.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = getRequestId(req);

  if (err instanceof ZodError) {
    const validationError = new ValidationError('Request validation failed.', toFieldErrors(err));
    logger.warn(
      { requestId, path: req.path, issues: toFieldErrors(err) },
      'Request validation failed',
    );
    sendFailure(res, validationError.toApiError(), requestId, validationError.statusCode);
    return;
  }

  if (err instanceof AppError) {
    const logPayload = { requestId, path: req.path, code: err.code };
    if (err.statusCode >= 500) {
      logger.error({ ...logPayload, err }, 'Request failed');
    } else {
      logger.warn(logPayload, 'Request rejected');
    }
    sendFailure(res, err.toApiError(), requestId, err.statusCode);
    return;
  }

  logger.error({ requestId, path: req.path, err }, 'Unhandled error');
  sendFailure(
    res,
    { code: ApiErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred.' },
    requestId,
    500,
  );
};
