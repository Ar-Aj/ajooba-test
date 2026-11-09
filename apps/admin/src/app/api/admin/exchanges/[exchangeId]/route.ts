import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveExchangeRequestSchema } from '@ajooba/contracts';
import { apiUrl } from '@/lib/env';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ exchangeId: string }> },
) {
  const token = (await cookies()).get('ajooba_admin_token')?.value;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const { exchangeId } = await context.params;
  if (!OBJECT_ID.test(exchangeId)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'That is not a valid exchange id.' } },
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

  const parsed = resolveExchangeRequestSchema.safeParse(payload);
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

  try {
    const upstream = await fetch(apiUrl(`/v1/admin/exchanges/${exchangeId}`), {
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
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'API_UNAVAILABLE', message: 'The API is unreachable. Try again.' },
      },
      { status: 503 },
    );
  }
}
