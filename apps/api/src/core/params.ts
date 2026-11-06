import type { Request } from 'express';
import { ValidationError } from './errors.js';

/**
 * Route parameter helpers.
 *
 * Express 5 types a route parameter as `string | string[] | undefined`,
 * because a parameter can repeat in a pattern. In practice every parameter
 * this API declares is a single segment, so these helpers read the value
 * and fail loudly when it is missing — rather than letting an `undefined`
 * reach a MongoDB query, where it would silently match nothing.
 */

/**
 * Read a required route parameter.
 */
export function routeParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }

  throw new ValidationError(`The "${name}" parameter is required.`);
}

/**
 * Read an optional route parameter.
 */
export function optionalRouteParam(req: Request, name: string): string | undefined {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }

  return undefined;
}

/**
 * Read a query parameter as a string.
 *
 * A repeated query parameter arrives as an array; the first value is used.
 */
export function queryParam(req: Request, name: string): string | undefined {
  const value = (req.query as Record<string, string | string[] | undefined>)[name];

  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].length > 0 ? value[0] : undefined;
  }

  return undefined;
}

/**
 * Read a query parameter as a number.
 */
export function numberQueryParam(req: Request, name: string): number | undefined {
  const raw = queryParam(req, name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
