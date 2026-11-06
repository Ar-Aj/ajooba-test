'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { InteractionAction, InteractionSurface } from '@ajooba/contracts';
import { trackTap, type TapDetail } from '@/lib/track';

/**
 * A link that records the tap that opened it.
 *
 * ## Why a component and not a `useEffect` per page
 *
 * The tap that matters is the one on a specific control. A page-level script
 * can see that a click happened somewhere; only the control knows it was the
 * "Black" swatch rather than the size row, and only the control knows which
 * design it was about.
 *
 * ## Why `onClick` and not a capture listener on the document
 *
 * A delegated listener would have to reverse-engineer the intent from the DOM —
 * the nearest `[data-*]` attribute, the nearest heading — and that reading is
 * wrong exactly where the page is unusual, which is where the interesting taps
 * are. Every control states its own action instead, and the taxonomy in
 * `@ajooba/contracts` makes an unknown action a compile error.
 *
 * ## It never changes behaviour
 *
 * `onClick` fires the tracker and then lets the link do what it was going to do.
 * No `preventDefault`, no `await`, no navigation on the tracker's schedule. A
 * measurement that can break a click is a defect, not a feature.
 */
export function TapLink({
  href,
  action,
  surface,
  detail,
  children,
  className,
  prefetch,
  ...rest
}: {
  href: string;
  action: InteractionAction;
  surface: InteractionSurface;
  detail?: TapDetail;
  children: ReactNode;
  className?: string;
  prefetch?: boolean;
  'aria-label'?: string;
  'aria-current'?: 'page' | undefined;
  title?: string;
  target?: string;
  rel?: string;
  'data-testid'?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      prefetch={prefetch}
      onClick={() => trackTap(action, surface, detail)}
      {...rest}
    >
      {children}
    </Link>
  );
}
