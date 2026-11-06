'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
  defaultOpen?: string;
  className?: string;
}

/** Single-open accordion: classic disclosure pattern. */
export function Accordion({ items, defaultOpen, className }: AccordionProps) {
  const baseId = useId();
  const [openId, setOpenId] = useState<string | undefined>(defaultOpen);

  return (
    <ul
      className={cn(
        'divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white',
        className,
      )}
    >
      {items.map((item) => {
        const open = openId === item.id;
        const triggerId = `${baseId}-trigger-${item.id}`;
        const panelId = `${baseId}-panel-${item.id}`;
        return (
          <li key={item.id}>
            <h3>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                id={triggerId}
                onClick={() => setOpenId(open ? undefined : item.id)}
                className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium hover:bg-ink-50"
              >
                {item.title}
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block transition-transform',
                    open ? 'rotate-45' : 'rotate-0',
                  )}
                >
                  +
                </span>
              </button>
            </h3>
            <div
              role="region"
              id={panelId}
              aria-labelledby={triggerId}
              hidden={!open}
              className="px-5 pb-4 text-sm leading-relaxed text-ink-600"
            >
              {open ? item.content : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
