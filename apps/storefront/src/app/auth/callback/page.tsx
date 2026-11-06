'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { acceptOAuthSession } from '@/lib/customer-session';

/**
 * The landing page for a social sign-in.
 *
 * Google and Facebook send the shopper to the API, which sends them here with
 * the session in the URL fragment. This page does the one thing that must
 * happen before anything else can: turn that fragment into a stored session and
 * leave.
 *
 * ## Why this is its own route
 *
 * The fragment is a credential. It must be read once, stored, and then removed
 * from the address bar — not left to survive a render, a screenshot, or a shared
 * link. A dedicated route can do that on mount and immediately navigate away,
 * and the `/login` page never has to know that a token was ever in the URL.
 *
 * ## Why the messaging is minimal
 *
 * This page is visible for about as long as one API call takes. Anything more
 * than a sentence would flash.
 */
export default function OAuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    /*
     * `location.hash` is read here rather than during render, because on the
     * server there is no hash and rendering one would be a hydration mismatch.
     */
    const run = async () => {
      const result = await acceptOAuthSession(window.location.hash);

      if (cancelled) return;

      if (!result) {
        setFailed(true);
        window.setTimeout(() => {
          router.replace('/login?error=oauth_failed');
        }, 1200);
        return;
      }

      /*
       * `replace`, not `push`: the callback belongs to the sign-in, and pressing
       * Back should not land on a URL whose fragment has already been spent.
       * Replacing it also clears the token from the address bar.
       */
      router.replace(result.next);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="container-page flex min-h-[50dvh] items-center justify-center py-16">
      <div role="status" aria-live="polite" className="text-center">
        <p className="step-lg text-ink-900">
          {failed ? 'That sign-in did not complete.' : 'Signing you in…'}
        </p>
        <p className="step-sm mt-2 text-ink-500">
          {failed ? 'Taking you back to the sign-in page.' : 'This takes a moment.'}
        </p>
      </div>
    </div>
  );
}
