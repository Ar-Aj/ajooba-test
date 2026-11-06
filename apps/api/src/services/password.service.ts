import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

/**
 * Password hashing.
 *
 * bcrypt with a configurable cost factor. The plaintext password is never
 * stored, logged, or included in an error message.
 *
 * The cost factor comes from `BCRYPT_COST` so the test suite can lower it
 * without changing the algorithm or the verification path.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, env.BCRYPT_COST);
}

/**
 * Verify a password against a stored hash.
 *
 * A malformed hash is treated as a failed verification rather than an
 * error, so a corrupted record cannot turn into a 500 that tells an
 * attacker the record exists.
 *
 * ## The empty hash
 *
 * A customer created through Google or Facebook has no password at all, and the
 * record stores `''` rather than a hash of random bytes — see
 * `oauth.service.ts`. An empty string is not a valid bcrypt hash, and it must
 * never compare equal to anything, including an empty submitted password.
 * `bcrypt.compare` happens to fail on it, but relying on that is a behaviour of
 * a dependency rather than a rule of ours, so it is refused explicitly.
 */
export async function verifyPassword(plaintext: string, passwordHash: string): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(plaintext, passwordHash);
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically random opaque token.
 *
 * Used for refresh tokens and idempotency keys. The raw value goes to the
 * client; only its hash is stored.
 */
export function generateOpaqueToken(byteLength = 48): string {
  return randomBytes(byteLength).toString('base64url');
}

/**
 * Hash an opaque token for storage.
 *
 * SHA-256 is correct here — unlike a password, the token already has full
 * entropy, so there is nothing for a slow KDF to protect against, and the
 * lookup must be a single indexed read.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a unique identifier for a token family.
 */
export function generateTokenFamilyId(): string {
  return randomUUID();
}

/**
 * Build the `x-request-id`-style public order number.
 *
 * `AJ-YYYYMMDD-XXXXXX` — human-readable over the phone, unique in
 * practice, and sortable by date.
 */
export function buildOrderNumber(date: Date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `AJ-${stamp}-${suffix}`;
}

/**
 * Build a return number, sharing the order-number shape.
 */
export function buildReturnNumber(date: Date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `RT-${stamp}-${suffix}`;
}
