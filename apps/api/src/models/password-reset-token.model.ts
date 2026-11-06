import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Password reset tokens.
 *
 * The raw token exists in exactly two places: the customer's email link and
 * the request's own memory. Only its SHA-256 hash is stored, so a database
 * dump cannot be replayed against the reset endpoint.
 *
 * Three properties matter, and each exists because of a specific failure:
 *
 *  1. **Single use.** `usedAt` is stamped when the token is redeemed, and
 *     the redemption query requires `usedAt: null`. A link that leaks into a
 *     shared inbox is therefore worthless after it has been used once.
 *  2. **Short lived.** `expiresAt` carries a TTL index, so an abandoned
 *     request removes itself rather than lingering as an attack surface.
 *  3. **Superseded.** Issuing a new token for the same customer marks the
 *     previous ones used. Otherwise a customer who forgot their password
 *     twice would have two live links, and the older one would still work.
 *
 * The token is **not** stored against the customer document, because a
 * customer document is read on every authenticated request — a reset token
 * there would be in the hot path of ordinary traffic.
 */
const passwordResetTokenSchema = new Schema(
  {
    /** SHA-256 hex digest of the raw token. Never the token itself. */
    tokenHash: { type: String, required: true, unique: true, index: true },

    /** The customer who may redeem it. */
    customerId: { type: Schema.Types.ObjectId, required: true, index: true },

    /** The customer's email, captured at request time for the audit trail. */
    email: { type: String, required: true },

    /** When the token stops working. */
    expiresAt: { type: Date, required: true },

    /** Stamped when the token is redeemed. */
    usedAt: { type: Date, default: null },

    /**
     * SHA-256 of the reset **grant** — the short-lived credential handed to
     * the browser after the emailed token is verified.
     *
     * The grant is a separate secret from the emailed token so that the two
     * can have independent lifetimes and so that the grant, which travels to
     * the browser, is never the thing that was emailed. Only its hash is
     * stored.
     */
    grantHash: { type: String, default: null, index: true },

    /** When the grant stops working. */
    grantExpiresAt: { type: Date, default: null },

    /** Stamped when the grant is spent on a password change. */
    grantUsedAt: { type: Date, default: null },

    /** The request that created it, for abuse investigations. */
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'password_reset_tokens',
  },
);

// Expired tokens remove themselves.
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// "Are there live tokens for this customer?" — used when superseding.
passwordResetTokenSchema.index({ customerId: 1, usedAt: 1 });

export type PasswordResetTokenDocument = InferSchemaType<typeof passwordResetTokenSchema>;
export const PasswordResetTokenModel = mongoose.model(
  'PasswordResetToken',
  passwordResetTokenSchema,
);
