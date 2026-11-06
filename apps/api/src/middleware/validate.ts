import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { toFieldErrors } from './error-handler.js';
import { ValidationError } from '../core/errors.js';

/**
 * Request validation helpers.
 *
 * `validate` parses and *replaces* the value with the parsed result, so
 * downstream handlers always receive coerced, defaulted, typed data.
 */

type Source = 'body' | 'query' | 'params';

/**
 * Validate one part of the request against a Zod schema.
 * Throws a `ValidationError` (422) when the input does not conform.
 */
export function validate<T extends ZodType>(source: Source, schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      next(new ValidationError('Request validation failed.', toFieldErrors(result.error)));
      return;
    }

    // `req.query` and `req.params` are getter-only in Express 5, so the
    // validated value is stashed on the request instead of reassigned.
    if (source === 'body') {
      req.body = result.data;
    } else {
      Object.defineProperty(req, `validated${source}`, {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }

    next();
  };
}

/**
 * Read the value produced by `validate` for a non-body source.
 */
export function validated<TSource extends 'query' | 'params', TData>(
  req: Request,
  source: TSource,
): TData {
  const value = (req as unknown as Record<string, unknown>)[`validated${source}`];
  if (value === undefined) {
    throw new ValidationError(`Missing validated ${source}.`);
  }
  return value as TData;
}

/**
 * Read the parsed request body.
 *
 * `validateBody` replaces `req.body` with the parsed, coerced value, but
 * Express types `req.body` as `any`, so the parsed type has to be restored
 * at the point of use. This helper does that in one place, and keeps the
 * `any` from leaking into the route handlers.
 *
 * @example
 * const body = validatedBody<CheckoutRequest>(req);
 */
export function validatedBody<TData>(req: Request): TData {
  return req.body as TData;
}

/**
 * Assign a request id when one was not provided by an upstream service.
 */
export function ensureRequestId(req: Request): string {
  return req.requestId ?? randomUUID();
}

/** Convenience wrapper for schemas that parse `req.query`. */
export function validateQuery<T extends ZodType>(schema: T): RequestHandler {
  return validate('query', schema);
}

/** Convenience wrapper for schemas that parse `req.params`. */
export function validateParams<T extends ZodType>(schema: T): RequestHandler {
  return validate('params', schema);
}

/** Convenience wrapper for schemas that parse `req.body`. */
export function validateBody<T extends ZodType>(schema: T): RequestHandler {
  return validate('body', schema);
}
