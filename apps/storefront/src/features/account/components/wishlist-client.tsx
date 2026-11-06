'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-states';
import { useToast } from '@/components/ui/toast';
import { useCommerce } from '@/lib/commerce-context';
import { wishlistStore } from '@/lib/wishlist-store';
import { cartStore } from '@/lib/cart-store';
import { rupees } from '@/lib/format';
import { PriceSavings } from '@/components/ui/price-savings';

export function WishlistClient() {
  const { wishlist, account } = useCommerce();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  if (wishlist.length === 0) {
    return (
      <EmptyState
        title="Your wishlist is empty"
        description={
          account
            ? 'Tap Save on any design to keep it here. Your wishlist stays with your account on this device.'
            : 'Saving a design needs an account, so it is waiting for you on your next visit instead of vanishing. Sign in, then tap Save on anything you like.'
        }
        action={
          account ? (
            <Button intent="gold" asChild>
              <Link href="/products">Find something you like</Link>
            </Button>
          ) : (
            <Button intent="gold" asChild>
              <Link href="/login?next=%2Faccount%2Fwishlist">Sign in to start saving</Link>
            </Button>
          )
        }
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-busy={pending}>
      {wishlist.map((item) => (
        <li
          key={item.productId}
          className="flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white"
        >
          <Link
            href={`/products/${item.productSlug}`}
            className="block aspect-[4/3] bg-ink-50"
            tabIndex={-1}
            aria-hidden="true"
          >
            {item.imageUrl ? (
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}
          </Link>
          <div className="flex flex-1 flex-col p-4">
            <p className="text-xs uppercase tracking-wider text-ink-500">{item.productCode}</p>
            <Link
              href={`/products/${item.productSlug}`}
              className="mt-1 line-clamp-2 font-medium text-ink-900 hover:underline"
            >
              {item.productTitle}
            </Link>
            <p className="mt-2 text-sm text-ink-700">
              {rupees(item.unitPrice)}
              {item.unitMrp > item.unitPrice ? (
                <span className="ml-2 text-ink-400 line-through">{rupees(item.unitMrp)}</span>
              ) : null}
            </p>
            <PriceSavings mrp={item.unitMrp} sellingPrice={item.unitPrice} className="mt-1" />
            <div className="mt-auto flex items-center gap-2 pt-4">
              <Button intent="primary" size="sm" className="flex-1" asChild>
                <Link href={`/products/${item.productSlug}`}>View design</Link>
              </Button>
              <Button
                intent="ghost"
                size="sm"
                onClick={() => {
                  startTransition(() => {
                    wishlistStore.remove(item.productId);
                    toast({ title: 'Removed from wishlist' });
                  });
                }}
                aria-label={`Remove ${item.productTitle} from wishlist`}
              >
                Remove
              </Button>
            </div>
            <p className="mt-3">
              <Badge intent="neutral">Pick a size to add to cart</Badge>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "Move all to cart" is deliberately not offered: sizes must be chosen per
 *  design, and guessing a size would create exactly the kind of invalid
 *  checkout state the brief forbids. */
export function WishlistBulkNote() {
  const { wishlist } = useCommerce();
  if (wishlist.length < 1) return null;
  return (
    <p className="mt-4 text-xs text-ink-500">
      Sizes have to be chosen on each design, so items move to the cart one at a time. Your wishlist
      is saved to your account.
    </p>
  );
}

export { cartStore };
