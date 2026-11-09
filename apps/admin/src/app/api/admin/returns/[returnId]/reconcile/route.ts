import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiUrl } from '@/lib/env';

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export async function POST(_request: Request, context: { params: Promise<{ returnId: string }> }) {
  const token = (await cookies()).get('ajooba_admin_token')?.value;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const { returnId } = await context.params;
  if (!OBJECT_ID.test(returnId)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'That is not a valid return id.' } },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(apiUrl(`/v1/admin/returns/${returnId}/reconcile`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
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
