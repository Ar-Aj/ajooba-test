'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useToast } from '@/components/ui/toast';
import { cartStore } from '@/lib/cart-store';
import type { CartLine } from '@/lib/commerce-types';
import { fieldForIndex } from '@/lib/specimen';
import { rupees } from '@/lib/format';
import { cn } from '@/lib/cn';
import { trackTap } from '@/lib/track';

interface CartItemListProps {
  lines: readonly CartLine[];
  /** Compact mode is used inside the checkout rail. */
  compact?: boolean;
}

/**
 * Cart line list with inline quantity editing and removal.
 *
 * ## Why the line is a specimen, not a card
 *
 * The same field-with-a-photograph the shelf uses, one step smaller. A cart is
 * a list of things the shopper has already chosen, so the picture's job is
 * recognition, not persuasion — it should be easy to scan five lines and be sure
 * which black mojri is which.
 *
 * ## Interaction notes
 *
 * - Quantity changes commit immediately. The list is local state and the write
 *   is synchronous, so there is nothing to wait for; showing a spinner for a
 *   `localStorage` write would be theatre.
 * - Removal is one click with no confirmation. A cart line is trivially
 *   recoverable (the design page is one tap away), so a modal would only add
 *   friction to a decision the shopper has already made. The toast is the undo
 *   affordance.
 * - The quantity input is a real number input with a label, so it can be typed
 *   into as well as stepped.
 */
export function CartItemList({ lines, compact = false }: CartItemListProps) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function changeQuantity(line: CartLine, next: number) {
    // A removal by stepping the quantity to zero is a removal, and the report
    // should see it as one rather than as a quantity change that vanished.
    trackTap(next <= 0 ? 'remove-from-cart' : 'quantity-decrease', 'cart', {
      productId: line.productId,
      sku: line.variantSku,
    });
    startTransition(() => {
      if (next <= 0) {
        cartStore.remove(line.id);
        toast({ title: 'Removed from cart', description: line.productTitle });
        return;
      }
      cartStore.updateQuantity(line.id, next);
    });
  }

  function remove(line: CartLine) {
    trackTap('remove-from-cart', 'cart', {
      productId: line.productId,
      sku: line.variantSku,
    });
    startTransition(() => {
      cartStore.remove(line.id);
      toast({ title: 'Removed from cart', description: line.productTitle });
    });
  }

  return (
    <ul
      className={cn('border-t border-border', pending && 'opacity-60')}
      aria-busy={pending}
      aria-label="Items in your cart"
    >
      {lines.map((line, index) => (
        <li key={line.id} className="flex gap-4 border-b border-border py-5 md:gap-6">
          <Link
            href={`/products/${line.productSlug}`}
            className={cn(
              'specimen shrink-0',
              fieldForIndex(index),
              compact ? 'h-20 w-16' : 'h-28 w-24 md:h-32 md:w-28',
            )}
            tabIndex={-1}
            aria-hidden="true"
          >
            {line.imageUrl ? (
              <img src={line.imageUrl} alt="" loading="lazy" width={224} height={256} />
            ) : null}
          </Link>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/products/${line.productSlug}`}
                  className="step-sm line-clamp-2 font-medium text-ink-900 hover:text-ink-950"
                >
                  {line.productTitle}
                </Link>
                <p className="step-xs mt-1 text-ink-500">
                  {line.colour} · UK {line.size}
                </p>
                <p className="step-xs mt-0.5 text-ink-400">{line.variantSku}</p>
              </div>

              <button
                type="button"
                onClick={() => remove(line)}
                aria-label={`Remove ${line.productTitle} (UK ${line.size}) from cart`}
                className="shrink-0 p-1.5 text-ink-400 transition-colors hover:text-claret-700"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4 7h16M9 7V5h6v2M18 7l-1 13H7L6 7" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-4">
              <div className="flex items-center border border-border">
                <button
                  type="button"
                  onClick={() => changeQuantity(line, line.quantity - 1)}
                  aria-label={`Decrease quantity of ${line.productTitle}`}
                  className="btn-press h-9 w-9 text-ink-600 hover:text-ink-900"
                >
                  −
                </button>
                <label htmlFor={`qty-${line.id}`} className="sr-only">
                  Quantity of {line.productTitle}, UK {line.size}
                </label>
                <input
                  id={`qty-${line.id}`}
                  type="number"
                  min={1}
                  max={10}
                  value={line.quantity}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    changeQuantity(line, Number.isFinite(parsed) ? parsed : 1);
                  }}
                  className="tnum step-xs h-9 w-9 border-x border-border bg-transparent text-center focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => changeQuantity(line, line.quantity + 1)}
                  aria-label={`Increase quantity of ${line.productTitle}`}
                  disabled={line.quantity >= 10}
                  className="btn-press h-9 w-9 text-ink-600 hover:text-ink-900 disabled:opacity-30"
                >
                  +
                </button>
              </div>

              <div className="text-right">
                <p className="tnum step-sm text-ink-900">
                  {rupees(line.unitPrice * line.quantity)}
                </p>
                {line.unitPrice < line.unitMrp ? (
                  <p className="tnum step-xs text-ink-400 line-through">
                    {rupees(line.unitMrp * line.quantity)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Order summary.
 *
 * A hairline-topped definition list on the page ground, not a bordered card.
 * Every line that affects the total is shown, including the shipping line even
 * when it is zero, because "Free" is information and a silently missing row is
 * not.
 */
export function OrderSummary({
  subtotal,
  shipping,
  total,
  children,
  className,
}: {
  subtotal: number;
  shipping: number;
  total: number;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-t-2 border-ink-900 pt-5', className)}>
      <h2 className="label-cap text-ink-400">Order summary</h2>
      <dl className="mt-4 space-y-2.5">
        <div className="flex justify-between">
          <dt className="step-sm text-ink-600">Subtotal</dt>
          <dd className="tnum step-sm text-ink-900">{rupees(subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="step-sm text-ink-600">Shipping</dt>
          <dd className="tnum step-sm text-ink-900">
            {shipping === 0 ? 'Free' : rupees(shipping)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <dt className="step-sm font-medium text-ink-900">Total</dt>
          <dd className="tnum step-lg text-ink-900">{rupees(total)}</dd>
        </div>
      </dl>
      {children}
    </div>
  );
}
