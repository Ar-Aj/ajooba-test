/**
 * Currency helpers. The whole platform is INR-only for now — see
 * `docs/API_CONTRACT.md` § Q-3. Anything that renders a price uses `rupees`.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Format an integer-rupee amount as a currency string (`₹1,399`). */
export function rupees(amount: number | undefined | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '—';
  }
  return INR.format(amount);
}

/** True when the design has a meaningful discount to display. */
export function hasDiscount(mrp: number, selling: number): boolean {
  return mrp > selling && selling > 0;
}

/** Discount rounded to the nearest whole percent. */
export function discountPercent(mrp: number, selling: number): number {
  if (mrp <= 0) return 0;
  return Math.round(((mrp - selling) / mrp) * 100);
}

/**
 * The API's sentinel for "no phone number was given at sign-up".
 *
 * A customer record requires a phone, but the form does not, so the API writes
 * the literal string `unconfirmed`. That is deliberately not a number that could
 * ring, and it must never reach the screen as though it were one — "Mobile:
 * unconfirmed" reads as a broken record rather than a missing detail.
 */
const UNCONFIRMED_PHONE = 'unconfirmed';

/**
 * Present a customer's phone, or `undefined` when they have not given one.
 *
 * Use this anywhere a stored phone is turned into copy. Checkout has its own,
 * stricter validation because a delivery needs a real number; this helper is for
 * display and for prefilling forms.
 */
export function optionalPhone(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === UNCONFIRMED_PHONE) return undefined;
  return trimmed;
}
