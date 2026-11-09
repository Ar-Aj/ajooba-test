import { describe, expect, it } from 'vitest';
import { nextPathSchema, registerRequestSchema } from '@ajooba/contracts';

/**
 * The registration contract.
 *
 * These assertions exist because of a specific, reported failure: a shopper
 * filled in the storefront's sign-up form — name, email, password, no phone —
 * and received a 422 they could do nothing about. The form had no phone field
 * marked required and asked for one name, but the schema demanded a phone and a
 * non-empty `lastName`, so a perfectly ordinary sign-up was rejected by a rule
 * the UI never showed.
 *
 * The test is on the schema rather than on the form, because the schema is what
 * every client shares and what the API enforces.
 */

describe('registerRequestSchema', () => {
  const base = {
    email: 'shopper@example.test',
    password: 'correct-horse-battery-9',
    firstName: 'Noor',
    lastName: 'Sheikh',
  };

  it('accepts a sign-up with no phone number', () => {
    const parsed = registerRequestSchema.safeParse({
      email: base.email,
      password: base.password,
      firstName: base.firstName,
      lastName: base.lastName,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.phone).toBeUndefined();
  });

  it('still validates a phone number when one is given', () => {
    const good = registerRequestSchema.safeParse({ ...base, phone: '+919876543210' });
    expect(good.success).toBe(true);

    /*
     * An empty string is not "no phone" — it is a malformed phone. A client that
     * means "not provided" must omit the key, which is why the optionality is
     * `.optional()` and not `.or(z.literal(''))`.
     */
    const empty = registerRequestSchema.safeParse({ ...base, phone: '' });
    expect(empty.success).toBe(false);

    const garbage = registerRequestSchema.safeParse({ ...base, phone: 'call me' });
    expect(garbage.success).toBe(false);
  });

  it('accepts a single-word name', () => {
    const parsed = registerRequestSchema.safeParse({
      email: base.email,
      password: base.password,
      firstName: 'Noor',
      lastName: '',
    });

    expect(parsed.success).toBe(true);
  });

  it('defaults a missing lastName to an empty string rather than rejecting', () => {
    const parsed = registerRequestSchema.safeParse({
      email: base.email,
      password: base.password,
      firstName: 'Noor',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.lastName).toBe('');
  });

  it('still refuses an empty first name, a bad email and a short password', () => {
    expect(registerRequestSchema.safeParse({ ...base, firstName: '  ' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
  });
});

describe('nextPathSchema', () => {
  it('accepts relative paths', () => {
    expect(nextPathSchema.safeParse('/products/a11').success).toBe(true);
    expect(nextPathSchema.safeParse('/account/orders').success).toBe(true);
  });

  it('refuses protocol-relative and absolute URLs, which would be an open redirect', () => {
    expect(nextPathSchema.safeParse('//evil.example').success).toBe(false);
    expect(nextPathSchema.safeParse('https://evil.example').success).toBe(false);
    expect(nextPathSchema.safeParse('/\\evil.example').success).toBe(false);
  });
});
