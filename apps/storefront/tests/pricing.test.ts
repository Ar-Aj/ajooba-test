import { describe, expect, it } from 'vitest';
import {
  FREE_SHIPPING_THRESHOLD,
  FLAT_SHIPPING_FEE,
  freeShippingGap,
  freeShippingProgress,
  orderTotal,
  shippingFor,
} from '@/features/cart/lib/pricing';

/**
 * Cart arithmetic is the one place in the storefront where a rounding error
 * becomes a wrong amount of money. These tests pin the policy down.
 */

describe('shippingFor', () => {
  it('is free at and above the threshold', () => {
    expect(shippingFor(FREE_SHIPPING_THRESHOLD)).toBe(0);
    expect(shippingFor(FREE_SHIPPING_THRESHOLD + 1)).toBe(0);
    expect(shippingFor(5000)).toBe(0);
  });

  it('charges a flat fee below the threshold', () => {
    expect(shippingFor(FREE_SHIPPING_THRESHOLD - 1)).toBe(FLAT_SHIPPING_FEE);
    expect(shippingFor(999)).toBe(FLAT_SHIPPING_FEE);
    expect(shippingFor(1)).toBe(FLAT_SHIPPING_FEE);
  });

  it('is always zero for an empty or invalid cart', () => {
    expect(shippingFor(0)).toBe(0);
    expect(shippingFor(-50)).toBe(0);
    expect(shippingFor(Number.NaN)).toBe(0);
  });
});

describe('freeShippingGap', () => {
  it('reports how much more is needed', () => {
    expect(freeShippingGap(0)).toBe(FREE_SHIPPING_THRESHOLD);
    expect(freeShippingGap(1000)).toBe(FREE_SHIPPING_THRESHOLD - 1000);
  });

  it('is zero once the threshold is met', () => {
    expect(freeShippingGap(FREE_SHIPPING_THRESHOLD)).toBe(0);
    expect(freeShippingGap(FREE_SHIPPING_THRESHOLD + 500)).toBe(0);
  });
});

describe('orderTotal', () => {
  it('adds shipping to the subtotal', () => {
    expect(orderTotal(1000, 99)).toBe(1099);
    expect(orderTotal(2000, 0)).toBe(2000);
  });

  it('never returns a negative or NaN total', () => {
    expect(orderTotal(-10, -10)).toBe(0);
    expect(orderTotal(Number.NaN, Number.NaN)).toBe(0);
  });
});

describe('freeShippingProgress', () => {
  it('is clamped between 0 and 100', () => {
    expect(freeShippingProgress(0)).toBe(0);
    expect(freeShippingProgress(-100)).toBe(0);
    expect(freeShippingProgress(FREE_SHIPPING_THRESHOLD)).toBe(100);
    expect(freeShippingProgress(FREE_SHIPPING_THRESHOLD * 10)).toBe(100);
  });

  it('reports proportional progress below the threshold', () => {
    expect(freeShippingProgress(FREE_SHIPPING_THRESHOLD / 2)).toBe(50);
  });
});
