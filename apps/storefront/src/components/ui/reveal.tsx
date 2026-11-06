'use client';

import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A section entrance.
 *
 * The wrapper starts hidden only if JavaScript is running, which is why the
 * hiding class is added by this component rather than rendered by the server.
 * A shopper with JS disabled, or a crawler, sees fully visible content with no
 * animation at all — they never get a blank page because an observer failed to
 * fire.
 *
 * The observer unobserves after the first intersection: an entrance is a
 * greeting, not a state. Re-animating something every time it scrolls back into
 * view is the single most common way decorative motion becomes annoying.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  /** Stagger in milliseconds. Kept under 400ms so a grid never feels lagged. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') return;

    // Already visible on first paint (above the fold): show it immediately
    // rather than waiting for a scroll that may never happen.
    const box = node.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.92) return;

    node.classList.add('rise-ready');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      className={className}
    >
      {children}
    </Tag>
  );
}

/**
 * A horizontal rail that scrolls natively.
 *
 * Scroll-snap plus a real overflow container, so a trackpad swipe, a touch drag
 * and a keyboard arrow all behave the way the platform already does. The arrows
 * are an affordance for mouse users who do not think to scroll sideways; they
 * disable themselves at the ends rather than pretending to work.
 */
export function Rail({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <RailScroller label={label}>{children}</RailScroller>
    </div>
  );
}

function RailScroller({ children, label }: { children: ReactNode; label: string }) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const forwardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;

    const sync = () => {
      const max = node.scrollWidth - node.clientWidth;
      if (backRef.current) backRef.current.disabled = node.scrollLeft <= 2;
      if (forwardRef.current) {
        forwardRef.current.disabled = max <= 2 || node.scrollLeft >= max - 2;
      }
    };

    sync();
    node.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      node.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  const nudge = (direction: 1 | -1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.82, behavior: 'smooth' });
  };

  return (
    <>
      <div className="mb-1 flex justify-end gap-1">
        <button
          ref={backRef}
          type="button"
          onClick={() => nudge(-1)}
          aria-label={`Scroll ${label} backwards`}
          className="hidden h-9 w-9 items-center justify-center border border-border text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900 disabled:cursor-default disabled:border-transparent disabled:opacity-30 sm:inline-flex"
        >
          <span aria-hidden="true">←</span>
        </button>
        <button
          ref={forwardRef}
          type="button"
          onClick={() => nudge(1)}
          aria-label={`Scroll ${label} forwards`}
          className="hidden h-9 w-9 items-center justify-center border border-border text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900 disabled:cursor-default disabled:border-transparent disabled:opacity-30 sm:inline-flex"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <ul
        ref={scrollerRef}
        aria-label={label}
        className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 touch-pan-y"
      >
        {children}
        {/* A trailing spacer so the last card can snap clear of the right edge. */}
        <li aria-hidden="true" className="w-1 shrink-0 sm:w-4" />
      </ul>
    </>
  );
}

export type { ReactNode };
