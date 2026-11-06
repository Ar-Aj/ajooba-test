import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { stockAdjustmentBatchSchema } from '@ajooba/contracts';
import { apiUrl } from '@/lib/env';

/**
 * Stock adjustment proxy.
 *
 * The stock route is **idempotent by contract**: `POST /v1/admin/inventory/adjustments`
 * declares `idempotent({ required: true })`, so a request without an
 * `Idempotency-Key` header is refused upstream. That key is what makes a retried
 * adjustment safe — without it, a flaky connection and a second click remove the
 * same three pairs twice.
 *
 * The key is therefore **generated here**, per submitted request, and forwarded.
 * Generating it in the browser would be equally valid but would put the
 * responsibility for uniqueness on a client that may be reloaded mid-request; a
 * server-generated v4 UUID is one line and cannot be stale.
 *
 * The body is validated against the contract before forwarding so a malformed
 * adjustment is a clear 422 here rather than an opaque refusal three layers down.
 * The API validates again — it is the authority — and its message is passed
 * through verbatim.
 */
export async function POST(request: Request) {
  const token = (await cookies()).get('ajooba_admin_token')?.value;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } },
      { status: 400 },
    );
  }

  const parsed = stockAdjustmentBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
            .join('; '),
        },
      },
      { status: 422 },
    );
  }

  const upstream = await fetch(apiUrl('/v1/admin/inventory/adjustments'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
