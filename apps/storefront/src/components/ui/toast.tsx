'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Tiny toast system.
 *
 * Three tones, mapped onto the house palette rather than a generic red/amber/
 * green: a success mark is the house ink on cream, a warning that needs a person
 * is gold, and a fault is the shop's own claret. Nothing on the storefront uses
 * a colour the brand does not own.
 *
 * ## Why a toast can carry a link
 *
 * The commonest toast on this store is a refusal that has an obvious next step:
 * "sign in to save this", "that size is out of stock, here is another". A toast
 * that only states the problem makes the shopper go and find the fix. `action`
 * puts the fix in the message, which is the difference between an explanation
 * and an apology.
 */

type ToastTone = 'info' | 'success' | 'warning';

interface ToastAction {
  readonly label: string;
  /** Where the action goes. An internal path, so it is a real `next/link`. */
  readonly href: string;
}

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  timeoutMs: number;
  action?: ToastAction;
}

interface ToastContextValue {
  toast: (
    input: Omit<ToastItem, 'id' | 'tone' | 'timeoutMs'> & {
      tone?: ToastTone;
      timeoutMs?: number;
    },
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue['toast']>(
    ({ title, description, tone = 'info', timeoutMs, action }) => {
      const id = `t-${Math.random().toString(36).slice(2, 9)}`;
      /*
       * A toast with an action stays up longer. Four seconds is enough to read
       * a sentence; it is not enough to read a sentence, decide, and move a
       * thumb to the button.
       */
      const wait = timeoutMs ?? (action ? 7000 : 4000);
      setItems((current) => [
        ...current,
        { id, title, description, tone, timeoutMs: wait, action },
      ]);
      const handle = window.setTimeout(() => dismiss(id), wait);
      timers.current.set(id, handle);
    },
    [dismiss],
  );

  useEffect(() => {
    // Copy the map reference into a local so the cleanup closes over the
    // same instance it was created with.
    const timerMap = timers.current;
    return () => {
      for (const handle of timerMap.values()) {
        window.clearTimeout(handle);
      }
      timerMap.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-60 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm"
      >
        {items.map((item) => (
          <ToastView key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  /*
   * The tones use the house colours. `warning` is gold — it means "somebody do
   * something", which is exactly what gold means everywhere else in this shop.
   */
  const toneClass =
    toast.tone === 'success'
      ? 'border-ink-900 bg-ink-900 text-cream-50'
      : toast.tone === 'warning'
        ? 'border-gold-600 bg-gold-50 text-ink-900'
        : 'border-border bg-cream-50 text-ink-900';

  return (
    <div
      role="status"
      className={cn('pointer-events-auto w-full border px-4 py-3.5 shadow-elevated', toneClass)}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="step-sm font-medium">{toast.title}</p>
          {toast.description ? (
            <p
              className={cn(
                'mt-1 text-[0.8125rem] leading-relaxed',
                toast.tone === 'success' ? 'text-cream-50/70' : 'text-ink-600',
              )}
            >
              {toast.description}
            </p>
          ) : null}
          {toast.action ? (
            <Link
              href={toast.action.href}
              onClick={onDismiss}
              className="btn-press mt-3 inline-flex h-9 items-center bg-gold-500 px-4 text-[0.8125rem] font-semibold text-ink-900 hover:bg-gold-400"
            >
              {toast.action.label}
            </Link>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 rounded p-1 text-current opacity-45 hover:opacity-100"
        >
          <span aria-hidden="true" className="block text-lg leading-none">
            ×
          </span>
        </button>
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}
