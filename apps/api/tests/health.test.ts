import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type {
  ApiResponse,
  ApiSuccess,
  LivenessResponse,
  ReadinessResponse,
} from '@ajooba/contracts';
import { createApp } from '../src/app.js';

/**
 * Health-check contract tests.
 *
 * These exercise the app in isolation: no database connection is required for
 * the liveness probe, and the readiness probe is expected to report `error`
 * (not crash) when MongoDB is unreachable.
 *
 * The response body is parsed through the shared contracts rather than being
 * read as `any`, so these tests also assert that the live API honours the
 * types it publishes in `@ajooba/contracts`.
 */

let app: Application;

beforeAll(() => {
  app = createApp();
});

afterAll(() => {
  app = undefined as unknown as Application;
});

/** Narrow a supertest body to a successful envelope with a known data type. */
function success<T>(body: unknown): ApiSuccess<T> {
  const envelope = body as ApiResponse<T>;
  if (!envelope.ok || envelope.data === undefined) {
    throw new Error(`Expected a success envelope, received: ${JSON.stringify(body)}`);
  }
  return envelope;
}

/** Narrow a supertest body to a failure envelope. */
function failure(body: unknown): Extract<ApiResponse<never>, { ok: false }> {
  const envelope = body as ApiResponse<never>;
  if (envelope.ok) {
    throw new Error(`Expected a failure envelope, received: ${JSON.stringify(body)}`);
  }
  return envelope;
}

describe('GET /health/live', () => {
  it('reports the service as alive', async () => {
    const response = await request(app).get('/health/live');

    expect(response.status).toBe(200);

    const body = success<LivenessResponse>(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.service).toBe('api');
    expect(typeof body.data.uptimeSeconds).toBe('number');
  });

  it('returns a request id in the envelope and the header', async () => {
    const response = await request(app).get('/health/live');

    const body = success<LivenessResponse>(response.body);
    expect(body.meta?.requestId).toBeTypeOf('string');
    expect(response.headers['x-request-id']).toBe(body.meta?.requestId);
  });

  it('honours an inbound x-request-id', async () => {
    const response = await request(app).get('/health/live').set('x-request-id', 'trace-abc-123');

    const body = success<LivenessResponse>(response.body);
    expect(body.meta?.requestId).toBe('trace-abc-123');
  });
});

describe('GET /health/ready', () => {
  it('reports a check result even when MongoDB is unreachable', async () => {
    const response = await request(app).get('/health/ready');

    // 200 when MongoDB answers, 503 when it does not. Both are contract-valid.
    expect([200, 503]).toContain(response.status);

    const body = success<ReadinessResponse>(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.service).toBe('api');
    expect(Array.isArray(body.data.checks)).toBe(true);

    const mongodb = body.data.checks.find((check) => check.name === 'mongodb');
    expect(mongodb).toBeDefined();

    // The HTTP status must agree with the reported readiness status.
    if (body.data.status === 'error') {
      expect(response.status).toBe(503);
    } else {
      expect(response.status).toBe(200);
    }
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const response = await request(app).get('/v1/does-not-exist');

    expect(response.status).toBe(404);

    const body = failure(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTypeOf('string');
  });
});
