'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Accessibility preferences.
 *
 * Two controls that genuinely help and that we can actually honour:
 *
 *   1. "Larger text" — toggles a class on `<html>` that scales the root
 *      font-size. Every size in the design system is rem-based, so the whole
 *      layout scales with it, including spacing, because Tailwind's spacing
 *      scale is rem-based too.
 *
 *   2. "Reduce motion" — toggles a class that disables CSS transitions and
 *      animations, and is respected by the hero carousel (it checks the
 *      `prefers-reduced-motion` media query) and by all Tailwind
 *      `motion-reduce:` variants.
 *
 * The preference is stored locally and restored before first paint by the
 * inline script in `app/layout.tsx` — otherwise the page would flash at the
 * default size and then jump.
 */

const STORAGE_KEY = 'ajooba-a11y';

interface Prefs {
  largeText: boolean;
  reduceMotion: boolean;
}

const DEFAULTS: Prefs = { largeText: false, reduceMotion: false };

export function AccessibilityControls({
  variant = 'default',
}: {
  variant?: 'default' | 'inverse';
}) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.classList.toggle('text-lg', prefs.largeText);
    root.classList.toggle('motion-reduce', prefs.reduceMotion);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore quota errors */
    }
  }, [prefs, mounted]);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setPrefs((p) => ({ ...p, largeText: !p.largeText }))}
        aria-pressed={prefs.largeText}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          prefs.largeText
            ? 'bg-gold-100 text-gold-900'
            : variant === 'inverse'
              ? 'text-cream-50/70 hover:bg-cream-50/10 hover:text-cream-50'
              : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
        )}
        title="Increase the text size across the site"
      >
        <span aria-hidden="true" className="text-sm font-semibold">
          Aa
        </span>
        <span className="sr-only">Larger text</span>
      </button>
      <button
        type="button"
        onClick={() => setPrefs((p) => ({ ...p, reduceMotion: !p.reduceMotion }))}
        aria-pressed={prefs.reduceMotion}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          prefs.reduceMotion
            ? 'bg-gold-100 text-gold-900'
            : variant === 'inverse'
              ? 'text-cream-50/70 hover:bg-cream-50/10 hover:text-cream-50'
              : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
        )}
        title="Turn off animations and transitions"
      >
        <span aria-hidden="true">◼</span>
        <span className="sr-only">Reduce motion</span>
      </button>
    </div>
  );
}

export function A11yBootstrap() {
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as Partial<Prefs>;
      const root = document.documentElement;
      if (prefs.largeText) root.classList.add('text-lg');
      if (prefs.reduceMotion) root.classList.add('motion-reduce');
    } catch {
      /* ignore malformed storage */
    }
  }, []);
  return null;
}

/**
 * The inline script that applies the stored preference before the page
 * paints. Exported for backwards compatibility.
 */
export const a11yBootstrapScript = `(function(){try{var r=window.localStorage.getItem('${STORAGE_KEY}');if(!r)return;var p=JSON.parse(r);var e=document.documentElement;if(p.largeText)e.classList.add('text-lg');if(p.reduceMotion)e.classList.add('motion-reduce');}catch(_){}})();`;
