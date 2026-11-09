'use client';

import Link from 'next/link';
import { useCommerce } from '@/lib/commerce-context';
import { CartItemList, OrderSummary } from '@/features/cart/components/cart-item-list';
import { TapLink } from '@/components/track/tap-link';

/**
 * The cart page.
 *
 * Client-rendered because the cart is local state (see `src/lib/cart-store.ts`)
 * — there is no cart API to hydrate from.
 *
 * ## Layout reasoning
 *
 * Two columns from `lg`: the shelf of chosen designs on the left, the summary
 * pinned on the right. The summary is sticky so the total remains visible while
 * the shopper edits quantities, which is the one moment on this page when they
 * are actively looking for the number to change.
 *
 * The API owns shipping, tax and final-total calculations. The local cart only
 * has a subtotal estimate; checkout reloads current catalogue and store values.
 */
export function CartPageClient() {
  const { cart, cartSubtotal } = useCommerce();

  if (cart.length === 0) {
    return (
      <div className="container-page py-16 md:py-28">
        <div className="max-w-lg">
          <h1 className="step-xl text-ink-900">Your cart is empty</h1>
          <p className="step-md mt-4 text-ink-600">
            Nothing has been added yet. Browse the catalogue and pick a pair — your cart stays on
            this device until you check out.
          </p>
          <Link
            href="/products"
            className="btn-press step-sm mt-8 inline-flex bg-ink-900 px-7 py-3.5 font-medium text-cream-50 hover:bg-ink-800"
          >
            Browse footwear
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-8 md:py-12">
      <header className="mb-10 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="step-xl text-ink-900">Your cart</h1>
          <p className="step-sm mt-2 text-ink-500">
            {cart.length} {cart.length === 1 ? 'design' : 'designs'} saved on this device.
          </p>
        </div>
        <Link href="/products" className="step-sm link-underline text-ink-700 hover:text-ink-950">
          Continue shopping →
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_20rem] lg:gap-16">
        <div>
          <CartItemList lines={cart} />
        </div>

        <aside className="lg:sticky lg:top-32 lg:self-start">
          <OrderSummary
            subtotal={cartSubtotal}
            title="Cart estimate"
            subtotalLabel="Current item subtotal"
          >
            <div className="mt-6">
              <TapLink
                href="/checkout"
                action="checkout-start"
                surface="cart"
                className="btn-press step-sm block w-full bg-ink-900 py-3.5 text-center font-medium text-cream-50 hover:bg-ink-800"
              >
                Proceed to checkout
              </TapLink>
              <p className="step-xs mt-3 text-center text-ink-500">
                Delivery, tax and the final total are confirmed from current store settings at
                checkout.
              </p>
            </div>
          </OrderSummary>
        </aside>
      </div>
    </div>
  );
}
