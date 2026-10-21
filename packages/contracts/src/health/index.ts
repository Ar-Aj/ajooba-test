import { z } from 'zod';

/**
 * Health-check contracts.
 *
 * `/health/live` proves the process is running.
 * `/health/ready` proves the process can serve traffic (database reachable).
 */

export const SERVICE_NAMES = ['api', 'storefront', 'admin'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const HEALTH_STATUSES = ['ok', 'degraded', 'error'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface HealthCheck {
  readonly name: string;
  readonly status: HealthStatus;
  readonly latencyMs?: number;
  readonly message?: string;
}

export interface LivenessResponse {
  readonly status: 'ok';
  readonly service: ServiceName;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
}

export interface ReadinessResponse {
  readonly status: HealthStatus;
  readonly service: ServiceName;
  readonly checks: readonly HealthCheck[];
  readonly timestamp: string;
}

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(SERVICE_NAMES),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(HEALTH_STATUSES),
  service: z.enum(SERVICE_NAMES),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(HEALTH_STATUSES),
      latencyMs: z.number().nonnegative().optional(),
      message: z.string().optional(),
    }),
  ),
  timestamp: z.string(),
});
