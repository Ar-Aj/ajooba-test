'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { forgetVisitor } from '@/lib/track';

/**
 * Cookie / consent banner.
 *
 * We do not run advertising or cross-site tracking, and the site works
 * entirely without cookies. So the banner does NOT gate the site behind an
 * "accept" wall — it states plainly what is stored, and the choice offered
 * is between accepting and limiting it to the functional essentials.
 *
 * The "necessary" storage (cart, wishlist, preferences) is functional, not
 * tracking, and is explicitly described as such rather than hidden behind
 * the word "cookie".
 */
const STORAGE_KEY = 'ajooba-consent';

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        // Wait a beat so the banner never fights the first paint.
        const t = window.setTimeout(() => setVisible(true), 900);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function decide(value: 'all' | 'essential') {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    /*
     * Choosing "necessary only" has to undo, not merely pause. `forgetVisitor`
     * discards any queued interaction events and drops the pseudonymous ids, so
     * a visitor who declines is not counted from this point on *and* is not
     * carrying a previous decision's identifiers. Stopping collection while
     * keeping the identifiers would be a promise kept in wording only.
     */
    if (value === 'essential') forgetVisitor();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Privacy choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ink-200 bg-white px-4 py-4 shadow-elevated"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-ink-900">A note on what we store</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            We keep your cart, wishlist and display preferences in this browser so the shop works
            between visits. We do not run advertising trackers or sell anything about you.{' '}
            <Link href="/privacy" className="font-medium text-ink-900 underline underline-offset-2">
              Read the privacy policy
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button intent="outline" size="sm" onClick={() => decide('essential')}>
            Necessary only
          </Button>
          <Button intent="primary" size="sm" onClick={() => decide('all')}>
            Fine, continue
          </Button>
        </div>
      </div>
    </div>
  );
}
