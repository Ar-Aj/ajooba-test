'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { adminPath } from '@/lib/public-path';

/**
 * The sign-in form.
 *
 * Split from the page so the page can wrap it in a `Suspense` boundary: this
 * component reads `useSearchParams`, and Next requires that read to be inside a
 * boundary for the page to be prerendered. Without it the build fails with a hard
 * error rather than a warning, which is the correct behaviour — a sign-in screen
 * should not depend on client JavaScript to render its heading.
 *
 * ## What it does not do
 *
 * It does not "remember" anything, does not offer a password hint, and does not
 * tell you whether an email exists. A sign-in that distinguishes "no such user"
 * from "wrong password" is a user-enumeration oracle, and the API deliberately
 * answers the same 401 for both.
 *
 * ## Where it goes next
 *
 * `?next=` is validated before use. An unvalidated redirect target on a sign-in
 * screen is the classic open-redirect: `?next=https://evil.example` would bounce a
 * freshly authenticated administrator to an attacker's page that asks them to sign
 * in again.
 *
 * ## The reveal toggle
 *
 * A long password typed on a phone, in a stockroom, will be mistyped. A reveal
 * control costs one button and saves a support call. It is a `type` swap on a
 * controlled input, not a second field, and it never stores anything.
 */

/** Only a same-origin, absolute path is ever used as a redirect target. */
export function safeNext(raw: string | null): string {
  if (!raw) return '/';
  // A protocol-relative value (`//evil.example`) also escapes the origin, so a
  // single leading slash is not enough on its own.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(adminPath('/api/admin/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as { ok: boolean; error?: { message: string } };

      if (!response.ok || !body.ok) {
        setError(body.error?.message ?? 'Sign-in failed.');
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError('Could not reach the sign-in service.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="step-lg text-ink-900">Sign in</h2>
      <p className="mt-2 text-base text-ink-500">
        Use an administrator account to reach the panel.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-semibold text-ink-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="field"
            placeholder="you@ajooba.in"
          />
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="text-sm font-semibold text-ink-700">
              Password
            </label>
            <button
              type="button"
              onClick={() => setReveal((shown) => !shown)}
              className="btn-press inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-rose-700"
              aria-pressed={reveal}
            >
              {reveal ? (
                <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="password"
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-medium text-red-800"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary group w-full justify-between pl-5 pr-4"
        >
          <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </button>
      </form>
    </>
  );
}
