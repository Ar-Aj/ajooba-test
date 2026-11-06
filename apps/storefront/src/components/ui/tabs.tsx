'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Plain accessible tabs (Roving tabindex, arrow keys, Home/End).
 * Suits the limited surfaces that need tabs without a dependency.
 *
 * No external props are mutating — this is purely a controlled component
 * with internal state if `value` isn't passed.
 */
interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  items: Array<{ id: string; label: string; content: ReactNode }>;
  ariaLabel: string;
  className?: string;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  items,
  ariaLabel,
  className,
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const active = value ?? internal;
  const setActive = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };
  const baseId = useId();
  const tabRefs: Array<HTMLButtonElement | null> = [];

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = items.length;
    if (count === 0) return;
    const focusAt = (position: number) => {
      const item = items[position];
      if (!item) return;
      setActive(item.id);
      tabRefs[position]?.focus();
    };
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt((index + 1) % count);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt((index - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(count - 1);
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <div role="tablist" aria-label={ariaLabel} className="flex gap-1 border-b border-ink-200">
        {items.map((item, index) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabRefs[index] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => setActive(item.id)}
              className={cn(
                '-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none',
                isActive
                  ? 'border-ink-900 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-900',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            hidden={!isActive}
            className="py-6"
          >
            {isActive ? item.content : null}
          </div>
        );
      })}
    </div>
  );
}
