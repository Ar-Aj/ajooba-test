import type { ApiError, ApiResponse, ResponseMeta } from '@ajooba/contracts';
import type { Response } from 'express';

/**
 * Response helpers.
 *
 * Every response the API produces goes through one of these functions, so the
 * envelope shape is guaranteed to match the contract in `@ajooba/contracts`.
 */

export function buildMeta(
  requestId: string,
  pagination?: ResponseMeta['pagination'],
): ResponseMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    ...(pagination ? { pagination } : {}),
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  requestId: string,
  statusCode = 200,
  pagination?: ResponseMeta['pagination'],
): void {
  const body: ApiResponse<T> = {
    ok: true,
    data,
    meta: buildMeta(requestId, pagination),
  };
  res.status(statusCode).json(body);
}

export function sendFailure(
  res: Response,
  error: ApiError,
  requestId: string,
  statusCode: number,
): void {
  const body: ApiResponse<never> = {
    ok: false,
    error: { ...error, requestId },
    meta: buildMeta(requestId),
  };
  res.status(statusCode).json(body);
}
