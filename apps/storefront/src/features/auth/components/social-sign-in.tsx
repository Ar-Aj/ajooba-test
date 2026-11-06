'use client';

import { useEffect, useState } from 'react';
import { oauthStartUrl } from '@/lib/customer-session';

/**
 * "Continue with Google / Facebook".
 *
 * ## Only the doors that open
 *
 * The list comes from the API, which knows which OAuth clients are configured.
 * A deployment with no credentials renders nothing here rather than two buttons
 * that land on a 503 — a door drawn on a wall is worse than no door.
 *
 * ## Why these are plain links
 *
 * The start endpoint answers with a redirect to the provider, so the only thing
 * that can follow it is a full navigation. A `<button onClick={fetch}>` would
 * receive a 302 body it cannot use. An anchor also means middle-click, open in
 * new tab and keyboard activation all work for free.
 *
 * ## Why the marks are drawn, not fetched
 *
 * A brand's logo is theirs. These are the two marks every sign-in surface uses,
 * drawn inline at a size that matches the text beside them: no image request on
 * a page whose whole job is to load fast, and no third-party request from a page
 * that handles credentials.
 */

interface Provider {
  readonly id: string;
  readonly label: string;
}

export function SocialSignIn({ next }: { next?: string }) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let cancelled = false;

    void (async () => {
      const { fetchOAuthProviders } = await import('@/lib/customer-session');
      const list = await fetchOAuthProviders();
      if (!cancelled) setProviders(list);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Render the divider only once we know whether there is anything to divide
   * from. A rule with nothing under it reads as a missing component.
   */
  if (!mounted || providers.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-border" />
        <span className="step-xs text-ink-400">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <ul className="mt-5 space-y-2.5">
        {providers.map((provider) => (
          <li key={provider.id}>
            <a
              href={oauthStartUrl(provider.id as 'google' | 'facebook', next)}
              className="btn-press flex h-12 w-full items-center justify-center gap-3 border border-border bg-cream-50 text-[0.9375rem] font-medium text-ink-900 hover:border-ink-900 hover:bg-white"
            >
              <ProviderMark provider={provider.id} />
              Continue with {provider.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two marks, at 18px so they sit level with 15px text. */
function ProviderMark({ provider }: { provider: string }) {
  if (provider === 'google') {
    return (
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M45.1 24.5c0-1.6-.14-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.9 6.6-9.6 6.6-16.1Z"
        />
        <path
          fill="#34A853"
          d="M24 46c6 0 11-2 14.6-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.5-9.1H4.2v5.7C7.8 40.9 15.3 46 24 46Z"
        />
        <path
          fill="#FBBC05"
          d="M11.5 28.1c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.2A22 22 0 0 0 2 24c0 3.6.9 7 2.2 9.9l7.3-5.8Z"
        />
        <path
          fill="#EA4335"
          d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.3 2 7.8 7.1 4.2 14.2l7.3 5.7c1.8-5.2 6.7-9.2 12.5-9.2Z"
        />
      </svg>
    );
  }

  if (provider === 'facebook') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#1877F2"
          d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7v-3.5h3.1V9.4c0-3.1 1.8-4.8 4.6-4.8 1.3 0 2.7.23 2.7.23v3h-1.6c-1.5 0-2 .95-2 1.9v2.3h3.5l-.55 3.5h-2.9v8.4A12 12 0 0 0 24 12Z"
        />
      </svg>
    );
  }

  return null;
}
