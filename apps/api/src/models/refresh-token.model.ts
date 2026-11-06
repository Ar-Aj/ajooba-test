import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Refresh tokens.
 *
 * Only a SHA-256 hash of the token is stored. A database dump therefore
 * does not hand an attacker a usable session — the raw token exists only
 * in the client that requested it.
 *
 * Each token records the identity it belongs to and whether it has already
 * been used, so a refresh token can be rotated (and replay detected)
 * without a second collection.
 */
const refreshTokenSchema = new Schema(
  {
    /** SHA-256 hex digest of the raw token. Never the token itself. */
    tokenHash: { type: String, required: true, unique: true, index: true },
    /** Which identity domain the token belongs to. */
    kind: { type: String, required: true, enum: ['customer', 'admin'], index: true },
    /** The customer or administrator id. */
    subjectId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** The token id (`jti`) so a family can be revoked. */
    familyId: { type: String, required: true, index: true },
    /** When the token expires. */
    expiresAt: { type: Date, required: true },
    /** Set when the token is used or explicitly revoked. */
    revokedAt: { type: Date, default: null },
    /**
     * True once the token has been exchanged. A second use of the same
     * token is a replay and revokes the whole family.
     */
    usedAt: { type: Date, default: null },
    /** The client that asked for the token, for the audit trail. */
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'refresh_tokens',
  },
);

// MongoDB's TTL index removes expired tokens automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Revoking every session for a subject at once.
refreshTokenSchema.index({ kind: 1, subjectId: 1, revokedAt: 1 });

export type RefreshTokenDocument = InferSchemaType<typeof refreshTokenSchema>;
export const RefreshTokenModel = mongoose.model('RefreshToken', refreshTokenSchema);
