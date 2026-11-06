import { describe, expect, it } from 'vitest';
import { optionalPhone } from '@/lib/format';

/**
 * The API writes `unconfirmed` into a customer's phone when a sign-up skipped
 * the field, because the database record requires a phone but the form does not
 * ask for one.
 *
 * That sentinel exists so downstream code cannot treat it as a dialable number.
 * It must not reach the screen either: "Mobile: unconfirmed" reads as a broken
 * record rather than as a detail the shopper has not given us yet.
 */

describe('optionalPhone', () => {
  it('returns undefined for the API sentinel', () => {
    expect(optionalPhone('unconfirmed')).toBeUndefined();
  });

  it('returns undefined for empty, whitespace and absent values', () => {
    expect(optionalPhone('')).toBeUndefined();
    expect(optionalPhone('   ')).toBeUndefined();
    expect(optionalPhone(undefined)).toBeUndefined();
    expect(optionalPhone(null)).toBeUndefined();
  });

  it('returns a real number unchanged', () => {
    expect(optionalPhone('+919876543210')).toBe('+919876543210');
    expect(optionalPhone('9876543210')).toBe('9876543210');
  });

  it('trims surrounding whitespace from a real number', () => {
    expect(optionalPhone('  +919876543210  ')).toBe('+919876543210');
  });

  it('does not treat a number that merely contains the sentinel as missing', () => {
    // A guard against a future `includes` rewrite: only the exact sentinel is
    // a placeholder.
    expect(optionalPhone('unconfirmed99')).toBe('unconfirmed99');
  });
});
