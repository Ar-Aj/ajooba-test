import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class lists, letting later classes win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format paise-free rupee amounts the way the shop does.
 *
 * Both apps must print money identically: an operator reading ₹1,39,900 in the
 * panel and ₹1,39,900 on the storefront is comparing two views of one number.
 * `en-IN` grouping is not the same as `en-US` grouping above a lakh, and getting
 * that wrong makes every large total look like a data error.
 */
export function rupees(amount: number): string {
  if (!Number.isFinite(amount)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** A compact count: 1,284 stays exact; 12,900 becomes 12.9k. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 10_000) return new Intl.NumberFormat('en-IN').format(value);
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** `2026-11-03T09:12:00Z` → `3 Nov 2026, 09:12`. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** `2026-11-03T09:12:00Z` → `3 Nov 2026`. */
export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** "3 days ago" — for a list where exact times are noise. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return dateOnly(iso);
}
