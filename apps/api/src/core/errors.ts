import { ApiErrorCode, type ApiError, type FieldError } from '@ajooba/contracts';

/**
 * Application-level errors.
 *
 * Errors carry a machine-readable code and a safe, user-facing message.
 * Internal details (stack traces, driver messages) are logged, never sent to
 * the client.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: readonly FieldError[];
  readonly expose: boolean;

  constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    options?: {
      details?: readonly FieldError[];
      cause?: unknown;
      /**
       * Override the default "4xx is safe to show, 5xx is not" rule.
       *
       * The default exists so an unexpected exception never leaks a stack trace
       * or a database name to a browser. A **deliberate** 5xx is a different
       * case: `SERVICE_UNAVAILABLE` with a written message means the shop knows
       * exactly what is closed — "Google sign-in is not available yet, use your
       * email" — and replacing that with "An unexpected error occurred." is both
       * less true and less useful. A computed status can be passed here when the
       * message is one we authored, never for a caught exception.
       */
      expose?: boolean;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options?.details;
    this.expose = options?.expose ?? statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.expose ? this.message : 'An unexpected error occurred.',
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', details?: readonly FieldError[]) {
    super(ApiErrorCode.VALIDATION_FAILED, message, 422, details ? { details } : undefined);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(ApiErrorCode.NOT_FOUND, `${resource} not found.`, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state.') {
    super(ApiErrorCode.CONFLICT, message, 409);
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(ApiErrorCode.UNAUTHORIZED, message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource.') {
    super(ApiErrorCode.FORBIDDEN, message, 403);
    this.name = 'ForbiddenError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A dependency is unavailable.', cause?: unknown) {
    super(ApiErrorCode.SERVICE_UNAVAILABLE, message, 503, { cause });
    this.name = 'ServiceUnavailableError';
  }
}
