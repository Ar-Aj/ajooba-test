'use client';

import { useEffect, useState } from 'react';

/**
 * A countdown to a **persisted campaign end time** (Phase 2F).
 *
 * The target comes from the database (`campaignEndsAt`), not from a duration
 * the browser made up, so the number on screen is a fact about a real
 * campaign rather than manufactured urgency.
 *
 * It renders nothing once the campaign has ended, and the parent section
 * stops rendering the whole deal block server-side, so an expired campaign
 * cannot linger because a timer misfired.
 *
 * The first paint deliberately renders the zero-padded end time only (no
 * ticking) until the component has mounted. That avoids a hydration mismatch
 * between the server's clock and the client's, while still showing the real
 * deadline immediately.
 */
export function DealCountdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const target = new Date(endsAt).getTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  if (Number.isNaN(target)) return null;

  // Not mounted yet: show the honest end time rather than a guessed countdown.
  if (remaining === null) {
    return (
      <p className={className}>
        Ends {new Date(endsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
    );
  }

  if (remaining <= 0) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [
    { label: 'days', value: days },
    { label: 'hrs', value: hours },
    { label: 'min', value: minutes },
    { label: 'sec', value: seconds },
  ];

  return (
    <p className={className} aria-live="off">
      {parts.map((part, index) => (
        <span key={part.label} className="inline-flex items-baseline gap-1">
          {index > 0 ? <span className="opacity-50">·</span> : null}
          <span className="tabular-nums">{String(part.value).padStart(2, '0')}</span>
          <span className="text-[0.7em] uppercase tracking-wider opacity-70">{part.label}</span>
        </span>
      ))}
    </p>
  );
}
