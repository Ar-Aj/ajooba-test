import Link from 'next/link';
import { Fragment } from 'react';
import { cn } from '@/lib/cn';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-xs text-ink-500', className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li>
                {isLast || !item.href ? (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={cn(isLast && 'text-ink-800')}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} className="hover:text-ink-900 hover:underline">
                    {item.label}
                  </Link>
                )}
              </li>
              {!isLast ? (
                <li aria-hidden="true" className="px-1 text-ink-300">
                  /
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
