/**
 * Cart / checkout arithmetic.
 *
 * Kept in one pure module so the cart page, the drawer and the checkout page
 * can never disagree about what the customer owes. Every function is total —
 * no throwing, no `NaN` leaking into the UI.
 *
 * Shipping policy (also stated in the header, footer and product page so the
 * customer is never surprised at the last step):
 *   - free above ₹1,499
 *   - flat ₹99 below that
 *   - an empty cart always costs ₹0
 */

export const FREE_SHIPPING_THRESHOLD = 1499;
export const FLAT_SHIPPING_FEE = 99;

/** Return the shipping fee for a subtotal. */
export function shippingFor(subtotal: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING_FEE;
}

/** How much more the customer must add to reach free shipping. `0` when met. */
export function freeShippingGap(subtotal: number): number {
  return Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
}

export function orderTotal(subtotal: number, shipping: number): number {
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  const safeShipping = Number.isFinite(shipping) && shipping > 0 ? shipping : 0;
  return safeSubtotal + safeShipping;
}

/**
 * Percentage progress towards free shipping, clamped to 0–100 for the
 * progress bar. Never exceeds 100 so the bar cannot overflow.
 */
export function freeShippingProgress(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD) * 100));
}
