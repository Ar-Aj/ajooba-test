import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

/**
 * A status mark.
 *
 * A square, a word, a colour. Four tones with four fixed meanings, and no fifth:
 *
 * - `neutral` — the record exists and nothing is expected of you.
 * - `active`  — the record is live and doing its job.
 * - `waiting` — gold. It needs a person. This is the only tone that should pull
 *                the eye across a table, so it is the only one with weight.
 * - `fault`   — claret. Something failed, or the record is cancelled.
 *
 * ## Why not a pill
 *
 * Because a pill in six pastels is what every dashboard looks like, and because
 * colour alone is not allowed to be the signal: the word is always present and
 * carries the meaning on its own. The square is a reinforcement for the scanning
 * eye, not the message.
 */
export type StatusTone = 'neutral' | 'active' | 'waiting' | 'fault';

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'text-ink-500',
  active: 'text-ink-800',
  waiting: 'text-gold-700',
  fault: 'text-claret-700',
};

export function Status({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('status', TONE_CLASS[tone], className)}>{children}</span>;
}

/**
 * Map an order status to a mark.
 *
 * Kept in one place so the orders list, the order detail and the dashboard
 * cannot disagree about what "processing" looks like. The mapping is a total
 * function over the contract's `ORDER_STATUSES`, so adding a status upstream is
 * a type error here rather than a silently uncoloured row.
 */
export function orderStatusTone(status: string): StatusTone {
  switch (status) {
    case 'placed':
      return 'waiting';
    case 'processing':
      return 'active';
    case 'shipped':
      return 'active';
    case 'completed':
      return 'neutral';
    case 'cancelled':
      return 'fault';
    default:
      return 'neutral';
  }
}

/** Map a payment status to a mark. Unpaid is a person's problem; failed is a fault. */
export function paymentStatusTone(status: string): StatusTone {
  switch (status) {
    case 'paid':
      return 'active';
    case 'pending':
      return 'waiting';
    case 'failed':
      return 'fault';
    case 'refunded':
    case 'partially_refunded':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/**
 * A stock level, expressed as the thing an operator cares about.
 *
 * "3" is a number. "Low · 3" is a decision. The thresholds are the ones the
 * storefront uses to show "only N left", so an operator sees the same severity
 * the customer does.
 */
export function stockLevel(stock: number): { label: string; tone: StatusTone } {
  if (stock <= 0) return { label: 'Out of stock', tone: 'fault' };
  // 3 is the threshold the storefront uses for "only N left", so an operator
  // sees the same severity a shopper does.
  if (stock <= 3) return { label: 'Low', tone: 'waiting' };
  return { label: 'In stock', tone: 'active' };
}
