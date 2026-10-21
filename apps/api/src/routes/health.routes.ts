import { Router } from 'express';
import { SERVICE_NAMES, type HealthCheck, type ReadinessResponse } from '@ajooba/contracts';
import { sendSuccess } from '../core/http.js';
import { isDatabaseConnected, pingDatabase } from '../db/connection.js';
import { getRequestId } from '../middleware/error-handler.js';

/**
 * Health-check routes.
 *
 *   GET /health/live  — liveness. Proves the process is up. Never touches Mongo.
 *   GET /health/ready — readiness. Proves the process can serve traffic.
 *
 * Both are intentionally dependency-light so they stay fast and reliable.
 */

export const healthRouter: Router = Router();

const startedAt = Date.now();

healthRouter.get('/live', (req, res) => {
  sendSuccess(
    res,
    {
      status: 'ok' as const,
      service: 'api' as const,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    },
    getRequestId(req),
  );
});

healthRouter.get('/ready', async (req, res) => {
  const checks: HealthCheck[] = [];

  let databaseStatus: HealthCheck;
  if (!isDatabaseConnected()) {
    databaseStatus = { name: 'mongodb', status: 'error', message: 'Not connected.' };
  } else {
    try {
      const latencyMs = await pingDatabase();
      databaseStatus = { name: 'mongodb', status: 'ok', latencyMs };
    } catch (error) {
      databaseStatus = {
        name: 'mongodb',
        status: 'error',
        message: error instanceof Error ? error.message : 'Ping failed.',
      };
    }
  }
  checks.push(databaseStatus);

  const failed = checks.some((c) => c.status === 'error');
  const degraded = checks.some((c) => c.status === 'degraded');

  const body: ReadinessResponse = {
    status: failed ? 'error' : degraded ? 'degraded' : 'ok',
    service: 'api',
    checks,
    timestamp: new Date().toISOString(),
  };

  sendSuccess(res, body, getRequestId(req), failed ? 503 : 200);
});

/**
 * A machine-readable index of the service's routes. Useful for a fresh
 * developer and for smoke testing. Contains no secrets.
 */
healthRouter.get('/', (req, res) => {
  sendSuccess(
    res,
    {
      service: 'api',
      version: '0.1.0',
      services: SERVICE_NAMES,
      endpoints: {
        health: ['GET /health/live', 'GET /health/ready'],
        catalog: ['GET /v1/catalog/products', 'GET /v1/catalog/products/:slug'],
      },
    },
    getRequestId(req),
  );
});
