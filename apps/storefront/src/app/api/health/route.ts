import { NextResponse } from 'next/server';
import { revalidateSeconds } from '@/lib/env';

/**
 * Storefront health check.
 *
 *   GET /api/health -> liveness for the storefront
 *
 * This proves the Next.js process is serving. It intentionally does NOT
 * depend on the catalogue API, so it stays fast and does not fail during a
 * planned API maintenance window.
 */

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      data: {
        status: 'ok' as const,
        service: 'storefront' as const,
        timestamp: new Date().toISOString(),
      },
    },
    {
      status: 200,
      headers: { 'cache-control': 'no-store, max-age=0' },
    },
  );
}

/**
 * HEAD probe. Reaching this handler means the module-level environment
 * validation already succeeded, so configuration is valid.
 */
export function HEAD(): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: { 'cache-control': `no-store, max-age=0, s-maxage=${revalidateSeconds}` },
  });
}
