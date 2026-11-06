import { describe, expect, it } from 'vitest';
import {
  EMPTY_ADDRESS,
  validateAddress,
  type AddressDraft,
} from '@/features/checkout/components/address-fields';

/**
 * The checkout's address validation is the last gate before an order is
 * recorded. A rule that accepts an invalid address produces a delivery that
 * cannot be completed, so these rules are pinned down here.
 */

function draft(overrides: Partial<AddressDraft> = {}): AddressDraft {
  return {
    ...EMPTY_ADDRESS,
    fullName: 'Aarav Sharma',
    phone: '9876543210',
    line1: '12 Gandhi Marg',
    line2: '',
    city: 'Varanasi',
    state: 'Uttar Pradesh',
    postalCode: '221001',
    ...overrides,
  };
}

describe('validateAddress', () => {
  it('accepts a complete, valid address', () => {
    expect(validateAddress(draft())).toEqual({});
  });

  it('requires a recipient name', () => {
    expect(validateAddress(draft({ fullName: 'A' })).fullName).toBeDefined();
    expect(validateAddress(draft({ fullName: '  ' })).fullName).toBeDefined();
  });

  it('requires a 10-digit Indian mobile number starting 6-9', () => {
    expect(validateAddress(draft({ phone: '1234567890' })).phone).toBeDefined();
    expect(validateAddress(draft({ phone: '5876543210' })).phone).toBeDefined();
    expect(validateAddress(draft({ phone: '98765432' })).phone).toBeDefined();
    expect(validateAddress(draft({ phone: '98765432101' })).phone).toBeDefined();
    expect(validateAddress(draft({ phone: '9876543210' })).phone).toBeUndefined();
  });

  it('requires a street address', () => {
    expect(validateAddress(draft({ line1: '12' })).line1).toBeDefined();
  });

  it('requires a city and a state', () => {
    expect(validateAddress(draft({ city: '' })).city).toBeDefined();
    expect(validateAddress(draft({ state: '' })).state).toBeDefined();
  });

  it('requires a valid 6-digit PIN code', () => {
    expect(validateAddress(draft({ postalCode: '22100' })).postalCode).toBeDefined();
    expect(validateAddress(draft({ postalCode: '2210012' })).postalCode).toBeDefined();
    expect(validateAddress(draft({ postalCode: '021001' })).postalCode).toBeDefined();
    expect(validateAddress(draft({ postalCode: '22100A' })).postalCode).toBeDefined();
    expect(validateAddress(draft({ postalCode: '221001' })).postalCode).toBeUndefined();
  });

  it('does not require address line 2', () => {
    expect(validateAddress(draft({ line2: '' })).line2).toBeUndefined();
  });

  it('reports every problem at once rather than one at a time', () => {
    const errors = validateAddress(
      draft({ fullName: '', phone: '123', city: '', state: '', postalCode: 'x' }),
    );
    expect(Object.keys(errors).length).toBeGreaterThanOrEqual(5);
  });
});
