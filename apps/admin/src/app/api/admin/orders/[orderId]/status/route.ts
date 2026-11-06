import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiUrl } from '@/lib/env';
import { orderStatusUpdateRequestSchema } from '@ajooba/contracts';

/**
 * Order status transition.
 *
 * A thin, authenticated pass-through to `PATCH /v1/admin/orders/:orderId/status`.
 *
 * Three things happen here and nowhere else:
 *
 *  1. **The token is attached server-side.** The browser never holds it.
 *  2. **The request body is validated against the contract before it is
 *     forwarded.** The API validates again — it is the authority — but a
 *     malformed status should be a 422 from the panel rather than an unexplained
 *     refusal from three layers down.
 *  3. **The id is validated as an ObjectId.** It comes from the URL, and
 *     forwarding an arbitrary segment into an upstream path is how a proxy
 *     becomes something else.
 */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export async function PATCH(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const token = (await cookies()).get('ajooba_admin_token')?.value;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const { orderId } = await context.params;
  if (!OBJECT_ID.test(orderId)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'That is not a valid order id.' } },
      { status: 400 },
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

  const parsed = orderStatusUpdateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues.map((issue) => issue.message).join(' '),
        },
      },
      { status: 422 },
    );
  }

  const upstream = await fetch(apiUrl(`/v1/admin/orders/${orderId}/status`), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
