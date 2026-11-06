'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Lightweight install-prompt banner that respects `beforeinstallprompt`.
 *
 * - Only shows when the browser actually fires the event.
 * - Honors `dismiss` so it never nags twice in a session.
 * - Is never shown for browsers that don't surface install (most iOS,
 *   most desktop Safari), which is the expected behaviour; we do not
 *   pretend to support install where we cannot.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (dismissed) return;
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [dismissed]);

  if (installed) return null;
  if (!visible || !deferred) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Install Ajooba app"
      className={cn(
        'fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md rounded-2xl border border-ink-200 bg-white p-4 shadow-elevated',
      )}
    >
      <p className="font-display text-lg">Add Ajooba to your home screen</p>
      <p className="mt-1 text-sm text-ink-600">
        Get faster launches, a full-screen shop, and a quick way to track orders. The site uses no
        extra storage on your device.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            setDismissed(true);
          }}
          className="rounded-md border border-ink-200 px-4 py-2 text-sm hover:bg-ink-50"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await deferred.prompt();
              await deferred.userChoice;
            } catch {
              /* the user agent may reject; we just hide the banner. */
            }
            setVisible(false);
            setDeferred(null);
          }}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-cream-50 hover:bg-ink-800"
        >
          Install
        </button>
      </div>
    </div>
  );
}
