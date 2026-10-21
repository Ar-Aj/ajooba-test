import { NextResponse } from 'next/server';

/**
 * Admin panel health check.
 *
 *   GET /api/health -> liveness for the admin app
 */

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      data: {
        status: 'ok' as const,
        service: 'admin' as const,
        timestamp: new Date().toISOString(),
      },
    },
    { status: 200, headers: { 'cache-control': 'no-store, max-age=0' } },
  );
}
