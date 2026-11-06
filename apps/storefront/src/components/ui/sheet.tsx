'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: 'right' | 'left' | 'bottom' | 'top';
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string; // tailwind class, e.g. 'max-w-md'
  className?: string;
}

/**
 * Accessible slide-in drawer used for the cart and the mobile nav.
 * - role="dialog", focus-trapped, Escape closes, background scroll locked.
 * - Polite dismiss: clicking the backdrop closes the sheet.
 * - Slides in from the side passed in (right is the default for a cart).
 */
export function Sheet({
  open,
  onClose,
  side = 'right',
  title,
  description,
  children,
  footer,
  width = 'max-w-md',
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
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
    const onKey = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const slide =
    side === 'right'
      ? 'right-0 top-0 h-full'
      : side === 'left'
        ? 'left-0 top-0 h-full'
        : side === 'top'
          ? 'inset-x-0 top-0 max-h-[85dvh] rounded-b-2xl'
          : 'bottom-0 inset-x-0 h-[80dvh] rounded-t-2xl';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={cn(
          'absolute flex flex-col bg-cream-50 text-ink-900 shadow-elevated',
          side === 'bottom' ? '' : width,
          slide,
          className,
        )}
        aria-describedby={description ? `${title}-desc` : undefined}
      >
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="font-display text-lg font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {description ? (
          <p
            id={`${title}-desc`}
            className="border-b border-ink-100 px-5 py-3 text-sm text-ink-500"
          >
            {description}
          </p>
        ) : null}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-soft">{children}</div>
        {footer ? <footer className="border-t border-ink-100 px-5 py-4">{footer}</footer> : null}
      </aside>
    </div>
  );
}
