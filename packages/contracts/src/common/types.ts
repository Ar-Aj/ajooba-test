/**
 * Common primitives shared by every Ajooba service and application.
 *
 * These are transport-level concerns only. Anything domain-specific belongs
 * in `catalog/`.
 */

/** Canonical API envelope for a successful response. */
export interface ApiSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta?: ResponseMeta;
}

/** Canonical API envelope for a failed response. */
export interface ApiFailure {
  readonly ok: false;
  readonly error: ApiError;
  readonly meta?: ResponseMeta;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** Request/response correlation and pagination metadata. */
export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
  readonly pagination?: PaginationMeta;
}

export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasNextPage: boolean;
  readonly hasPreviousPage: boolean;
}

/** Machine-readable error codes. Never send a raw exception message to clients. */
export const ApiErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  /** Field-level details, present for VALIDATION_FAILED. */
  readonly details?: readonly FieldError[];
  readonly requestId?: string;
}

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/** Standard pagination query parameters accepted by list endpoints. */
export interface PaginationQuery {
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
