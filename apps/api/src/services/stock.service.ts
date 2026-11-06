/**
 * Stock arithmetic.
 *
 * A tiny module, deliberately separate from both the cart and the order
 * service, because both need it and they already depend on each other
 * (`order.service` resolves coupons through `cart.service`). Putting the
 * helper in its own module keeps that dependency acyclic.
 */

/**
 * The units of a variant that are free to sell.
 *
 * **This is `stock`, not `stock - reservedStock`.**
 *
 * `reserveStock` *already* moves the units out of `stock` and into
 * `reservedStock` (`$inc: { stock: -quantity, reservedStock: +quantity }`),
 * so `stock` is the net count of units that are not earmarked by an
 * in-flight checkout. Subtracting `reservedStock` a second time
 * double-counts the reservation and understates availability — often by
 * roughly half, for the duration of every checkout.
 *
 * `reservedStock` is therefore the count of units currently *in flight*
 * (mid-checkout). It matters for one thing: an administrative stock
 * correction must not set the level below what open checkouts have
 * already promised.
 */
export function availableUnits(doc: { stock: number; reservedStock?: number }): number {
  return Math.max(0, doc.stock);
}
