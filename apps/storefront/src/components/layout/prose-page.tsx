import type { ReactNode } from 'react';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface ProsePageProps {
  title: string;
  lede?: string;
  updated?: string;
  children: ReactNode;
  breadcrumbLabel?: string;
}

/**
 * Shared layout for the informational and policy pages.
 *
 * The narrow measure and the large editorial heading are deliberate: these
 * are reading pages, and they should not look like a dashboard.
 */
export function ProsePage({ title, lede, updated, children, breadcrumbLabel }: ProsePageProps) {
  return (
    <article className="container-narrow py-8 md:py-14">
      <Breadcrumbs
        className="mb-6"
        items={[{ label: 'Home', href: '/' }, { label: breadcrumbLabel ?? title }]}
      />
      <header className="mb-10 border-b border-ink-100 pb-8">
        <h1 className="font-display text-4xl leading-tight md:text-5xl">{title}</h1>
        {lede ? (
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-600 md:text-lg">{lede}</p>
        ) : null}
        {updated ? (
          <p className="mt-4 text-xs uppercase tracking-[0.2em] text-ink-400">
            Last updated {updated}
          </p>
        ) : null}
      </header>
      <div className="space-y-8 text-sm leading-relaxed text-ink-700 md:text-base">{children}</div>
    </article>
  );
}

export function ProseSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-2xl text-ink-900 md:text-3xl">{heading}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function ProseList({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-gold-600">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
