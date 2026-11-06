import { redirect } from 'next/navigation';
import { AdminShell, type ShellAdmin } from '@/components/layout/admin-shell';
import { OpsApiError, fetchAdmin } from '@/lib/ops';
import { requireSession } from '@/lib/session';
import { adminEnv } from '@/lib/env';
import { adminPath } from '@/lib/public-path';

/**
 * The panel's layout.
 *
 * This is where the sidebar, the session gate and the operator's identity are
 * established, once, for every screen inside the group.
 *
 * ## Two reads, and why both
 *
 * `requireSession` checks the cookie exists, which needs no network call and
 * decides whether to send the visitor to sign-in. `fetchAdmin` then asks the API
 * who they are, which is the only way to know their permissions and to notice a
 * token that is present but no longer valid.
 *
 * A revoked token is a real case: an administrator deactivated while signed in
 * keeps their cookie until it expires. `fetchAdmin` answers `null` for that, and
 * the correct response is sign-in — not a shell with an empty sidebar and a table
 * that permanently fails.
 *
 * ## An outage is not a sign-out
 *
 * These two failures look identical from a distance and need opposite responses.
 * If the API cannot be reached, the administrator is still signed in; clearing
 * their session would log them out because our server had a bad minute. So the
 * shell renders in a degraded state — full navigation, no identity — and each
 * screen states that the API is unreachable.
 *
 * ## Why the redirect is outside the `try`
 *
 * `redirect()` works by throwing. Calling it inside a `try` that inspects the
 * caught error is a trap: the redirect signal has to be re-thrown by an `else`
 * branch that exists only by luck. The outcome is therefore computed first and
 * the redirect issued after, where nothing can intercept it.
 *
 * `force-dynamic` because identity is per-request and must never be baked into a
 * prerendered page.
 */
export const dynamic = 'force-dynamic';

type Outcome =
  { kind: 'signed-in'; admin: ShellAdmin } | { kind: 'signed-out' } | { kind: 'unreachable' };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  await requireSession('/');

  let outcome: Outcome;

  try {
    const profile = await fetchAdmin();
    outcome = profile
      ? {
          kind: 'signed-in',
          admin: {
            email: profile.email,
            name: profile.name,
            role: profile.role,
            permissions: profile.permissions,
          },
        }
      : { kind: 'signed-out' };
  } catch (error) {
    if (error instanceof OpsApiError && error.isUnreachable) {
      outcome = { kind: 'unreachable' };
    } else if (error instanceof OpsApiError && error.isUnauthorised) {
      outcome = { kind: 'signed-out' };
    } else {
      throw error;
    }
  }

  if (outcome.kind === 'signed-out') {
    redirect(adminPath('/login'));
  }

  return (
    <AdminShell
      storefrontUrl={adminEnv.NEXT_PUBLIC_SITE_URL}
      admin={outcome.kind === 'signed-in' ? outcome.admin : null}
      apiReachable={outcome.kind !== 'unreachable'}
    >
      {children}
    </AdminShell>
  );
}
