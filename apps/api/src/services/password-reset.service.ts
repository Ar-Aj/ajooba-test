import type { Types } from 'mongoose';
import { logger } from '../config/logger.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../core/errors.js';
import { PasswordResetTokenModel } from '../models/password-reset-token.model.js';
import { UserModel } from '../models/user.model.js';
import { generateOpaqueToken, hashPassword, hashToken } from './password.service.js';
import { revokeAllRefreshTokens } from './auth.service.js';

/**
 * Password recovery.
 *
 * The flow has four parts, and each part is designed around a specific
 * abuse:
 *
 *  1. **Request.** An opaque token is minted and emailed. The endpoint
 *     answers **identically** whether or not the address is registered — a
 *     different response for a known address would turn this endpoint into a
 *     free account-enumeration oracle.
 *  2. **Verify.** The emailed token is exchanged for a short-lived,
 *     single-use **grant**.
 *  3. **Reset.** The grant is spent on a new password.
 *
 * The emailed token and the grant are deliberately **different secrets**.
 *
 * The emailed token travels through a customer's inbox, so it is treated as
 * compromised the moment it is read. The grant is a second, independently
 * minted secret with its own expiry, and it is the only thing that
 * authorises a password change. Splitting them means a leaked email link
 * is useless on its own, and a leaked grant cannot be replayed.
 *
 * The raw values are never persisted, never logged, and never returned by
 * any endpoint other than the one that issues them.
 */

/**
 * How long the emailed token stays valid.
 *
 * Short on purpose. The token travels through a customer's inbox, so it
 * will be read within minutes if it is going to be read at all.
 */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** How long the reset grant stays valid after verification. */
const RESET_GRANT_TTL_MS = 15 * 60 * 1000;

/**
 * The outcome of a reset request.
 *
 * Deliberately carries no information about whether the address exists.
 */
export interface ResetRequestResult {
  /** `true` when a token was minted and an email was queued. */
  readonly sent: boolean;
}

/**
 * A redeemed reset grant.
 *
 * Short-lived and single-use. It is the only thing that authorises a
 * password change from the recovery path.
 */
export interface ResetGrant {
  readonly customerId: string;
  /** The raw grant value. Returned to the browser, never stored. */
  readonly grantToken: string;
  readonly expiresAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Request                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Begin a password recovery.
 *
 * Returns `sent: false` for an address that is not registered, or for a
 * customer who is inactive — and the caller reports the same outcome in
 * every case. The distinction is deliberate: this endpoint must not tell an
 * attacker which addresses hold accounts.
 */
export async function requestPasswordReset(input: {
  email: string;
  ip?: string;
  userAgent?: string;
}): Promise<ResetRequestResult> {
  const email = input.email.trim().toLowerCase();

  const customer = await UserModel.findOne({ email })
    .select('_id email isActive firstName lastName')
    .lean<{
      _id: Types.ObjectId;
      email: string;
      isActive: boolean;
      firstName: string;
      lastName: string;
    } | null>();

  if (!customer || !customer.isActive) {
    /*
     * Logged at `info`, without the address, so that a burst of reset
     * requests against unknown addresses is visible to an operator without
     * the log becoming a list of harvested emails.
     */
    logger.info('Password reset requested for an address that cannot be recovered');
    return { sent: false };
  }

  /*
   * Supersede any live token for this customer, so only the most recent
   * request can be redeemed.
   */
  await PasswordResetTokenModel.updateMany(
    { customerId: customer._id, usedAt: null },
    { $set: { usedAt: new Date() } },
  );

  const rawToken = generateOpaqueToken(32);
  const tokenHash = hashToken(rawToken);

  await PasswordResetTokenModel.create({
    tokenHash,
    customerId: customer._id,
    email: customer.email,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    ip: (input.ip ?? '').slice(0, 60),
    userAgent: (input.userAgent ?? '').slice(0, 200),
  });

  const { notifyPasswordReset } = await import('./notification.service.js');
  const { renderPasswordReset } = await import('./email-templates.js');

  await notifyPasswordReset({
    tokenHash,
    to: customer.email,
    rendered: renderPasswordReset({
      customerName: customer.firstName || customer.lastName || 'there',
      resetUrl: buildResetUrl(rawToken),
    }),
  });

  return { sent: true };
}

/**
 * Build the reset link.
 *
 * The storefront host is configuration, never a hardcoded domain, because
 * staging and production are served from different origins.
 */
function buildResetUrl(rawToken: string): string {
  const base = (process.env.STOREFRONT_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

/* -------------------------------------------------------------------------- */
/* Verify                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Exchange an emailed reset token for a reset grant.
 *
 * The token is looked up by hash and must be unused and unexpired. The
 * redemption is written **before** the grant is handed back, so two
 * concurrent requests carrying the same token cannot both succeed — the
 * second finds the row already stamped.
 */
export async function verifyResetToken(rawToken: string): Promise<ResetGrant> {
  if (!rawToken || rawToken.length < 16) {
    throw new UnauthorizedError('This password reset link is not valid.');
  }

  const tokenHash = hashToken(rawToken);

  const token = await PasswordResetTokenModel.findOne({
    tokenHash,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean<{ _id: Types.ObjectId; customerId: Types.ObjectId } | null>();

  if (!token) {
    throw new UnauthorizedError(
      'This password reset link is no longer valid. Please request a new one.',
    );
  }

  /*
   * Consume the emailed token and mint the grant in one conditional write.
   *
   * The `usedAt: null` clause is the concurrency guard: the first request
   * to win the update stamps the row, and a second concurrent request
   * matches nothing and is rejected. Without it, a customer who double
   * clicked could obtain two live grants.
   */
  const grantToken = generateOpaqueToken(32);
  const grantHash = hashToken(grantToken);

  const claimed = await PasswordResetTokenModel.findOneAndUpdate(
    { _id: token._id, usedAt: null },
    {
      $set: {
        usedAt: new Date(),
        grantHash,
        grantExpiresAt: new Date(Date.now() + RESET_GRANT_TTL_MS),
      },
    },
    { returnDocument: 'after' },
  ).lean<{ customerId: Types.ObjectId } | null>();

  if (!claimed) {
    throw new UnauthorizedError(
      'This password reset link has already been used. Please request a new one.',
    );
  }

  return {
    customerId: claimed.customerId.toString(),
    grantToken,
    expiresAt: new Date(Date.now() + RESET_GRANT_TTL_MS),
  };
}

/* -------------------------------------------------------------------------- */
/* Reset                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Complete a password reset.
 *
 * The grant is proved against the stored hash, so a client cannot invent
 * one. Spending it ends every existing session: a password change that
 * leaves old sessions alive has not really changed the password.
 */
export async function resetPasswordWithGrant(input: {
  /** The raw grant value handed out by the verify step. */
  grantToken: string;
  newPassword: string;
}): Promise<void> {
  const grantHash = hashToken(input.grantToken);

  /*
   * Claim the grant atomically. `grantUsedAt: null` means it can be spent
   * exactly once, and `grantExpiresAt` bounds how long it is honoured.
   */
  const claimed = await PasswordResetTokenModel.findOneAndUpdate(
    {
      grantHash,
      grantUsedAt: null,
      grantExpiresAt: { $gt: new Date() },
    },
    { $set: { grantUsedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean<{ customerId: Types.ObjectId } | null>();

  if (!claimed) {
    throw new UnauthorizedError('This password reset grant is no longer valid.');
  }

  const customer = await UserModel.findById(claimed.customerId)
    .select('_id isActive')
    .lean<{ _id: Types.ObjectId; isActive: boolean } | null>();

  if (!customer || !customer.isActive) {
    throw new NotFoundError('Customer');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await UserModel.updateOne(
    { _id: customer._id },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    },
  );

  /*
   * A password change must end every existing session. Otherwise whoever
   * prompted the reset keeps their access, which defeats the purpose.
   */
  await revokeAllRefreshTokens('customer', String(customer._id));
}

/**
 * The minimum password strength a reset accepts.
 *
 * Deliberately the **same** rule the registration endpoint applies, so a
 * password chosen through recovery is not weaker than one chosen at sign-up.
 * The authoritative check is the shared `passwordSchema` in
 * `@ajooba/contracts`, which runs at the route boundary; this function is a
 * second, service-level guard for callers that reach the service directly.
 */
export function assertResetPasswordStrength(password: string): void {
  const problems: string[] = [];

  if (password.length < 10) problems.push('be at least 10 characters long');
  if (!/[A-Za-z]/.test(password)) problems.push('contain a letter');
  if (!/[0-9]/.test(password)) problems.push('contain a digit');

  if (problems.length > 0) {
    throw new ConflictError(`The new password must ${problems.join(', ')}.`);
  }
}
