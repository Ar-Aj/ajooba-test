import { cn } from '@/lib/cn';

/**
 * A restrained announcement marquee (Phase 3).
 *
 * It is a CSS-only animation: the track is duplicated once and translated by
 * exactly 50%, which is what makes the loop seamless without measuring
 * anything in JavaScript.
 *
 * Accessibility and honesty rules:
 *  - The content is real (a live campaign title or an approved brand line)
 *    supplied by the caller; nothing is invented here.
 *  - With `prefers-reduced-motion: reduce` the animation is removed and the
 *    text simply sits still and stays readable.
 *  - The moving copy is hidden from assistive tech and the same string is
 *    exposed once as static text, so a screen reader does not read the strip
 *    twice.
 */
export function Marquee({ items, className }: { items: readonly string[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <div className={cn('relative flex overflow-hidden bg-field-b py-3.5 text-ink-800', className)}>
      {/*
        Static, accessible copy. Visually hidden because the marquee below
        already shows it; present so assistive tech reads it exactly once.
      */}
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div
        aria-hidden="true"
        className="pointer-events-none flex min-w-full shrink-0 animate-marquee items-center justify-around gap-10 whitespace-nowrap px-6 text-sm font-medium text-ink-800 motion-reduce:animate-none"
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center gap-10">
            {items.map((item) => (
              <span key={`${copy}-${item}`} className="inline-flex items-center gap-10">
                {item}
                <span className="text-gold-600">·</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
