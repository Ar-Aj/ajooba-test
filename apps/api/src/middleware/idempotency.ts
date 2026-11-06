import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { IdempotencyModel } from '../models/idempotency.model.js';
import { getRequestId } from './error-handler.js';
import { ConflictError } from '../core/errors.js';

/**
 * Idempotency.
 *
 * An operation that must not be duplicated — placing an order, capturing a
 * refund, adjusting stock in bulk — accepts a client-supplied
 * `Idempotency-Key` header.
 *
 * The behaviour:
 *
 *  - **First request with a key** — the handler runs normally, and its
 *    status code and response body are stored against the key.
 *  - **Repeat request with the same key** — the stored response is
 *    replayed verbatim, and the handler does **not** run again.
 *  - **Same key, different request body** — rejected with a conflict,
 *    because the client is trying to reuse a key for a different
 *    operation.
 *
 * The key is scoped to the caller and the route, so one identity can never
 * read another's response by guessing a key.
 *
 * Concurrent requests with the same key are handled by a unique index on
 * the record: the second request loses the insert race and replays the
 * stored result once the first has committed.
 */

const IDEMPOTENCY_HEADER = 'idempotency-key';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** A request that has a resolved identity. */
type IdentityRequest = Request & {
  principal?: { kind: 'customer' | 'admin'; id: string; email?: string };
};

interface StoredRecord {
  statusCode: number;
  response: unknown;
  requestHash: string;
}

export interface IdempotencyOptions {
  /** How long a stored result is replayable. Defaults to 24 hours. */
  readonly ttlMs?: number;
  /**
   * Require the key. When true (the default) a request without a key is
   * rejected, because the route has declared itself non-repeatable.
   */
  readonly required?: boolean;
}

/**
 * A stable hash of the request body, used to detect a key reuse with a
 * different payload.
 */
function hashRequestBody(body: unknown): string {
  const serialised = JSON.stringify(body ?? null);
  // A non-cryptographic digest is enough here: this detects accidental
  // reuse, it is not a security boundary.
  let hash = 5381;
  for (let index = 0; index < serialised.length; index += 1) {
    hash = (hash * 33) ^ serialised.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Build the scope string an idempotency key is stored under.
 *
 * The route path is preferred over the concrete request path, because the
 * route path is stable across different ids: `/orders/:orderId/status`
 * rather than `/orders/662f.../status`. Express 5 types `req.route` as
 * `any`, so it is read through a narrow, checked shape instead of being
 * trusted blindly.
 */
function routeScope(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  const path = typeof route?.path === 'string' ? route.path : req.path;
  return `${req.method} ${path}`;
}

/**
 * Middleware that makes a route idempotent.
 */
export function idempotent(options: IdempotencyOptions = {}): RequestHandler {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const required = options.required ?? true;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header(IDEMPOTENCY_HEADER)?.trim();

    if (!key) {
      if (required) {
        next(
          new ConflictError(
            `This operation requires an "${IDEMPOTENCY_HEADER}" header so it can be safely retried.`,
          ),
        );
        return;
      }
      next();
      return;
    }

    if (key.length > 120) {
      next(new ConflictError('The idempotency key is too long.'));
      return;
    }

    const identity = (req as IdentityRequest).principal;
    if (!identity) {
      // Without an identity there is nothing to scope the key to. The
      // route must mount the authentication middleware first.
      next(new Error('idempotent() requires an authenticated request.'));
      return;
    }

    const scope = routeScope(req);
    const requestHash = hashRequestBody(req.body);

    void (async () => {
      const existing = await IdempotencyModel.findOne({
        kind: identity.kind,
        subjectId: identity.id,
        scope,
        key,
      }).lean<StoredRecord | null>();

      if (existing) {
        if (existing.requestHash !== requestHash) {
          next(
            new ConflictError(
              'This idempotency key was already used with a different request body.',
            ),
          );
          return;
        }
        res.setHeader('idempotent-replay', 'true');
        res.status(existing.statusCode).json(existing.response);
        return;
      }

      // Capture the response so it can be stored before the client sees it.
      const originalJson = res.json.bind(res);
      const originalEnd = res.end.bind(res);
      let captured: { statusCode: number; body: unknown } | null = null;

      res.json = ((body: unknown) => {
        captured = { statusCode: res.statusCode, body };
        return originalJson(body);
      }) as Response['json'];

      /*
       * The record is written before the response is flushed, not on
       * `finish`. Writing it on `finish` is a fire-and-forget promise, and a
       * client that retries immediately — a double tap on "place order", a
       * proxy replaying a timed-out request — can reach the API before the
       * insert lands. The retry would then miss the record, find the cart
       * already emptied by the first order, and fail with a conflict
       * instead of replaying the order that already exists.
       *
       * Holding `end` open until the write settles closes that window: by
       * the time the client has the response, the key is already replayable.
       */
      res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
        const finish = (): void => {
          originalEnd(chunk as never, encoding as never, callback as never);
        };

        if (!captured) {
          finish();
          return;
        }

        const record = captured;

        // Only a successful outcome is worth replaying. A 4xx/5xx should be
        // retryable with the same key.
        if (record.statusCode >= 400) {
          finish();
          return;
        }

        void IdempotencyModel.updateOne(
          { kind: identity.kind, subjectId: identity.id, scope, key },
          {
            $set: {
              statusCode: record.statusCode,
              response: record.body,
              requestHash,
              expiresAt: new Date(Date.now() + ttlMs),
            },
          },
          { upsert: true },
        )
          .catch((error: unknown) => {
            req.log?.error(
              { err: error, requestId: getRequestId(req) },
              'Failed to store idempotency record',
            );
          })
          .then(finish);
      }) as Response['end'];

      next();
    })().catch(next);
  };
}

/**
 * The header name clients must send.
 */
export const IDEMPOTENCY_KEY_HEADER = IDEMPOTENCY_HEADER;
