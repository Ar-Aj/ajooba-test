'use client';

import { useEffect, useId, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

/**
 * Lightweight accessible modal layer.
 *
 * - `role="dialog"` + `aria-modal="true"` + labelled by `Title`.
 * - Traps focus within the dialog while open, restores focus on close.
 * - Locks background scroll.
 * - Closes on Escape and on backdrop click.
 *
 * Radix-free by design — keeps the dependency surface minimal and the
 * behaviour predictable. All visuals are Tailwind tokens, so themable.
 */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first focusable element after the dialog mounts.
    const t = window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" aria-hidden={!open}>
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative z-10 w-full overflow-hidden rounded-2xl bg-cream-50 text-ink-900 shadow-elevated',
          sizeClass[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-6 py-4">
          <div>
            <h2 id={titleId} className="font-display text-xl font-medium leading-tight">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm text-ink-500">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-500 hover:bg-ink-50 hover:text-ink-900 focus-visible:outline-none"
            aria-label="Close dialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="max-h-[70dvh] overflow-y-auto px-6 py-5 scrollbar-soft">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-3 border-t border-ink-100 px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Wraps an element so pressing Escape on it bubbles to the closest Dialog. */
export function stopEscapePropagation(handler: (event: KeyboardEvent<HTMLElement>) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') event.stopPropagation();
    handler(event);
  };
}
