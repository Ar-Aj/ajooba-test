import { describe, expect, it } from 'vitest';
import {
  computeDiscount,
  computeShippingFee,
  computeTax,
  priceBasket,
  type DiscountRule,
} from '../src/services/pricing.service.js';

/**
 * Pricing engine.
 *
 * Money is computed in exactly one place, and the cart and the checkout
 * both call it. These tests pin the arithmetic down, because a rounding
 * or an off-by-one here becomes a real charge to a real customer.
 */

const SETTINGS = {
  shippingFee: 99,
  freeShippingThreshold: 1499,
  taxRateBps: 0,
  taxInclusive: false,
} as const;

function rule(overrides: Partial<DiscountRule> = {}): DiscountRule {
  return {
    code: 'TEST',
    type: 'percentage',
    value: 10,
    minOrderAmount: 0,
    maxDiscountAmount: null,
    ...overrides,
  };
}

describe('computeDiscount', () => {
  it('applies a percentage discount to the subtotal', () => {
    expect(computeDiscount(rule({ value: 10 }), 1000)).toBe(100);
    expect(computeDiscount(rule({ value: 25 }), 800)).toBe(200);
  });

  it('rounds a percentage discount down to whole rupees', () => {
    // 10% of 1399 is 139.9 — the platform has no paise, so it rounds down.
    expect(computeDiscount(rule({ value: 10 }), 1399)).toBe(139);
  });

  it('applies a fixed discount verbatim', () => {
    expect(computeDiscount(rule({ type: 'fixed', value: 250 }), 1000)).toBe(250);
  });

  it('never discounts below the minimum order amount', () => {
    expect(computeDiscount(rule({ minOrderAmount: 2000 }), 1500)).toBe(0);
    expect(computeDiscount(rule({ minOrderAmount: 1500 }), 1500)).toBe(150);
  });

  it('caps a percentage discount at the maximum discount amount', () => {
    expect(computeDiscount(rule({ value: 50, maxDiscountAmount: 300 }), 2000)).toBe(300);
  });

  it('never discounts more than the subtotal', () => {
    expect(computeDiscount(rule({ type: 'fixed', value: 5000 }), 1000)).toBe(1000);
    expect(computeDiscount(rule({ type: 'fixed', value: 5000 }), 0)).toBe(0);
  });

  it('returns zero for an empty or negative subtotal', () => {
    expect(computeDiscount(rule(), 0)).toBe(0);
    expect(computeDiscount(rule(), -100)).toBe(0);
  });

  it('never returns a negative discount', () => {
    expect(computeDiscount(rule({ type: 'fixed', value: -50 }), 1000)).toBe(0);
  });
});

describe('computeShippingFee', () => {
  it('charges the flat fee below the free-shipping threshold', () => {
    expect(computeShippingFee(SETTINGS, 1000, 1)).toBe(99);
  });

  it('is free at or above the free-shipping threshold', () => {
    expect(computeShippingFee(SETTINGS, 1499, 1)).toBe(0);
    expect(computeShippingFee(SETTINGS, 2000, 1)).toBe(0);
  });

  it('is free for an empty basket', () => {
    expect(computeShippingFee(SETTINGS, 0, 0)).toBe(0);
  });

  it('charges the fee for every basket when the threshold is zero', () => {
    const settings = { ...SETTINGS, freeShippingThreshold: 0 };
    expect(computeShippingFee(settings, 100_000, 1)).toBe(99);
  });
});

describe('computeTax', () => {
  it('is zero when no tax rate is configured', () => {
    expect(computeTax({ taxRateBps: 0, taxInclusive: false }, 1000)).toBe(0);
  });

  it('applies basis points to the taxable base', () => {
    // 500 bps = 5%
    expect(computeTax({ taxRateBps: 500, taxInclusive: false }, 1000)).toBe(50);
    expect(computeTax({ taxRateBps: 1800, taxInclusive: false }, 1000)).toBe(180);
  });

  it('rounds to whole rupees', () => {
    // 5% of 1399 = 69.95
    expect(computeTax({ taxRateBps: 500, taxInclusive: false }, 1399)).toBe(70);
  });
});

describe('priceBasket', () => {
  it('sums the line totals into a subtotal', () => {
    const breakdown = priceBasket(
      [
        { unitPrice: 1500, quantity: 2 },
        { unitPrice: 900, quantity: 1 },
      ],
      SETTINGS,
      null,
    );

    expect(breakdown.subtotal).toBe(3900);
    expect(breakdown.itemCount).toBe(3);
    expect(breakdown.discountAmount).toBe(0);
  });

  it('adds shipping and tax to the discounted subtotal', () => {
    const breakdown = priceBasket(
      [{ unitPrice: 1000, quantity: 1 }],
      { ...SETTINGS, taxRateBps: 500 },
      rule({ value: 10 }),
    );

    expect(breakdown.subtotal).toBe(1000);
    expect(breakdown.discountAmount).toBe(100);
    expect(breakdown.shippingFee).toBe(99);
    expect(breakdown.taxAmount).toBe(45);
    expect(breakdown.totalAmount).toBe(1000 - 100 + 99 + 45);
  });

  it('does not add an inclusive tax to the total a second time', () => {
    const breakdown = priceBasket(
      [{ unitPrice: 1000, quantity: 1 }],
      { ...SETTINGS, taxRateBps: 500, taxInclusive: true },
      null,
    );

    // The tax is reported for the invoice, but it is already inside the
    // line price, so the total must not grow by it again.
    expect(breakdown.taxAmount).toBe(50);
    expect(breakdown.totalAmount).toBe(1000 + 99);
  });

  it('prices an empty basket as zero', () => {
    const breakdown = priceBasket([], SETTINGS, rule());

    expect(breakdown.subtotal).toBe(0);
    expect(breakdown.discountAmount).toBe(0);
    expect(breakdown.shippingFee).toBe(0);
    expect(breakdown.totalAmount).toBe(0);
    expect(breakdown.itemCount).toBe(0);
  });

  it('keeps the total internally consistent for every combination', () => {
    const lines = [
      { unitPrice: 1399, quantity: 1 },
      { unitPrice: 2500, quantity: 2 },
    ];

    for (const taxRateBps of [0, 500, 1800]) {
      for (const taxInclusive of [false, true]) {
        for (const coupon of [null, rule({ value: 10 }), rule({ type: 'fixed', value: 300 })]) {
          const breakdown = priceBasket(lines, { ...SETTINGS, taxRateBps, taxInclusive }, coupon);

          const expectedTotal = taxInclusive
            ? breakdown.subtotal - breakdown.discountAmount + breakdown.shippingFee
            : breakdown.subtotal -
              breakdown.discountAmount +
              breakdown.shippingFee +
              breakdown.taxAmount;

          expect(breakdown.totalAmount).toBe(expectedTotal);
          expect(breakdown.totalAmount).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('frees the shipping once the discounted subtotal reaches the threshold', () => {
    const breakdown = priceBasket(
      [{ unitPrice: 1600, quantity: 1 }],
      SETTINGS,
      rule({ value: 10 }),
    );

    // 1600 - 160 = 1440, which is below 1499, so the fee still applies.
    expect(breakdown.shippingFee).toBe(99);

    const freed = priceBasket([{ unitPrice: 1600, quantity: 1 }], SETTINGS, rule({ value: 5 }));

    // 1600 - 80 = 1520, which is at or above 1499.
    expect(freed.shippingFee).toBe(0);
  });
});
