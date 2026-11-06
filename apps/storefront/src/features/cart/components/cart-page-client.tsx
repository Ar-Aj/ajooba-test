'use client';

import Link from 'next/link';
import { useCommerce } from '@/lib/commerce-context';
import { CartItemList, OrderSummary } from '@/features/cart/components/cart-item-list';
import {
  freeShippingGap,
  freeShippingProgress,
  orderTotal,
  shippingFor,
  FREE_SHIPPING_THRESHOLD,
} from '@/features/cart/lib/pricing';
import { rupees } from '@/lib/format';
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
 * The free-shipping meter sits above the lines rather than inside the summary.
 * It is a nudge, not arithmetic, and putting it beside the total would imply it
 * changes what is owed — it does not, it changes what is charged for delivery.
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

  const shipping = shippingFor(cartSubtotal);
  const total = orderTotal(cartSubtotal, shipping);
  const gap = freeShippingGap(cartSubtotal);
  const progress = freeShippingProgress(cartSubtotal);

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
          {/* ---- free shipping meter ------------------------------------- */}
          <div className="mb-7">
            {gap > 0 ? (
              <>
                <p className="step-sm text-ink-700">
                  Add <strong className="font-medium text-ink-950">{rupees(gap)}</strong> more for
                  free shipping across India.
                </p>
                <div
                  className="mt-2.5 h-0.5 w-full bg-border"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progress towards free shipping"
                >
                  <div
                    className="h-full bg-gold-500 transition-[width] duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="step-sm text-ink-800">
                Free shipping unlocked. This order ships at no extra cost.
              </p>
            )}
          </div>

          <CartItemList lines={cart} />
        </div>

        <aside className="lg:sticky lg:top-32 lg:self-start">
          <OrderSummary subtotal={cartSubtotal} shipping={shipping} total={total}>
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
                Free shipping on orders above {rupees(FREE_SHIPPING_THRESHOLD)}.
              </p>
            </div>
          </OrderSummary>

          {/*
            Payment is not connected in this build. Saying so here — on the cart,
            before the checkout — is the honest place for it: a shopper who only
            learns this at the payment step has already invested effort.
          */}
          <div className="mt-7">
            <p className="label-cap text-ink-400">About payment</p>
            <p className="step-xs mt-2 text-ink-600">
              Payment capture is not connected yet. Placing an order on this build records it
              locally on this device and never takes your money — no card, UPI or COD details are
              requested.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
