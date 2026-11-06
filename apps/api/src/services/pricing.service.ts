import type { Coupon, StoreSettings } from '@ajooba/contracts';

/**
 * Pricing.
 *
 * This module is the **single** place where money is calculated. The cart
 * service and the checkout service both use it, so a cart total and an
 * order total for the same basket can never disagree.
 *
 * Rules:
 *
 *  - Money is whole INR rupees. There are no paise anywhere in the
 *    platform, so no rounding happens at the API boundary.
 *  - A discount is applied to the **subtotal** (the sum of line totals),
 *    never to the shipping fee.
 *  - A percentage discount is capped by `maxDiscountAmount` when the
 *    coupon sets one, and can never exceed the subtotal.
 *  - Tax is applied to the discounted subtotal. When `taxInclusive` is
 *    set, the tax is already inside the displayed price and is added to
 *    the total rather than to the taxable base.
 *  - The shipping fee is free above `freeShippingThreshold` (when that
 *    threshold is greater than zero) and free when the basket is empty.
 */

/** The line inputs the pricing engine works from. */
export interface PriceLine {
  readonly unitPrice: number;
  readonly quantity: number;
}

/** The result of pricing a basket. */
export interface PriceBreakdown {
  /** The sum of `unitPrice * quantity`. */
  readonly subtotal: number;
  /** The discount actually applied, after the cap. */
  readonly discountAmount: number;
  /** The shipping fee charged. */
  readonly shippingFee: number;
  /** The tax charged. */
  readonly taxAmount: number;
  /** `subtotal - discountAmount + shippingFee + taxAmount`. */
  readonly totalAmount: number;
  /** The number of units across all lines. */
  readonly itemCount: number;
}

/**
 * A coupon, reduced to the fields the pricing engine needs.
 */
export interface DiscountRule {
  readonly code: string;
  readonly type: 'percentage' | 'fixed';
  readonly value: number;
  readonly minOrderAmount: number;
  readonly maxDiscountAmount: number | null;
}

/**
 * Compute the discount a coupon yields for a given subtotal.
 *
 * Returns 0 when the coupon does not apply. The caller decides what to do
 * about that — a cart that silently drops an ineligible coupon would be
 * confusing, so the cart service reports the reason separately.
 */
export function computeDiscount(rule: DiscountRule, subtotal: number): number {
  if (subtotal <= 0) {
    return 0;
  }
  if (subtotal < rule.minOrderAmount) {
    return 0;
  }

  let discount: number;
  if (rule.type === 'percentage') {
    discount = Math.floor((subtotal * rule.value) / 100);
    if (rule.maxDiscountAmount !== null) {
      discount = Math.min(discount, rule.maxDiscountAmount);
    }
  } else {
    discount = rule.value;
  }

  // A discount can never exceed the subtotal it is applied to.
  return Math.max(0, Math.min(discount, subtotal));
}

/**
 * Compute the shipping fee for a basket.
 */
export function computeShippingFee(
  settings: Pick<StoreSettings, 'shippingFee' | 'freeShippingThreshold'>,
  subtotalAfterDiscount: number,
  itemCount: number,
): number {
  if (itemCount === 0) {
    return 0;
  }
  if (
    settings.freeShippingThreshold > 0 &&
    subtotalAfterDiscount >= settings.freeShippingThreshold
  ) {
    return 0;
  }
  return Math.max(0, settings.shippingFee);
}

/**
 * Compute the tax on a basket.
 *
 * `taxRateBps` is basis points: 500 = 5%. The result is rounded to whole
 * rupees, because the platform has no paise.
 */
export function computeTax(
  settings: Pick<StoreSettings, 'taxRateBps' | 'taxInclusive'>,
  taxableBase: number,
): number {
  if (settings.taxRateBps <= 0) {
    return 0;
  }
  return Math.round((taxableBase * settings.taxRateBps) / 10_000);
}

/**
 * Price a basket.
 *
 * `coupon` may be null, in which case no discount is applied. The coupon
 * is assumed to have already been validated for eligibility by the caller;
 * `computeDiscount` still enforces the subtotal cap.
 */
export function priceBasket(
  lines: readonly PriceLine[],
  settings: Pick<
    StoreSettings,
    'shippingFee' | 'freeShippingThreshold' | 'taxRateBps' | 'taxInclusive'
  >,
  coupon: DiscountRule | null,
): PriceBreakdown {
  let subtotal = 0;
  let itemCount = 0;

  for (const line of lines) {
    subtotal += line.unitPrice * line.quantity;
    itemCount += line.quantity;
  }

  const discountAmount = coupon ? computeDiscount(coupon, subtotal) : 0;
  const discountedSubtotal = subtotal - discountAmount;

  const shippingFee = computeShippingFee(settings, discountedSubtotal, itemCount);

  /*
   * Tax-inclusive and tax-exclusive are genuinely different calculations:
   *
   *  - **Exclusive** — the tax is *not* in the line prices, so it is
   *    computed on the discounted subtotal and added on top of it.
   *  - **Inclusive** — the tax is *already* inside the line prices, so
   *    adding it again would double-charge the customer. The tax amount
   *    is still reported (it is the portion of the price that is tax, for
   *    the invoice) but it is already counted in the subtotal, so it is
   *    not added to the total again.
   */
  const taxAmount = computeTax(settings, discountedSubtotal);

  const totalAmount = settings.taxInclusive
    ? discountedSubtotal + shippingFee
    : discountedSubtotal + shippingFee + taxAmount;

  return {
    subtotal,
    discountAmount,
    shippingFee,
    taxAmount,
    totalAmount,
    itemCount,
  };
}

/**
 * Convert a stored coupon document into the rule shape the pricing engine
 * consumes.
 */
export function toDiscountRule(coupon: Coupon): DiscountRule {
  return {
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    minOrderAmount: coupon.minOrderAmount,
    maxDiscountAmount: coupon.maxDiscountAmount,
  };
}
