import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Phone OTP verification challenges.
 *
 * Used during customer registration to verify Indian mobile numbers (`+91XXXXXXXXXX`)
 * before creating an account. Only the SHA-256 hash of the 6-digit OTP is stored.
 * Documents automatically expire via MongoDB's TTL index on `expiresAt`.
 */
const phoneOtpSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    verifiedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    ip: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'phone_otps',
  },
);

phoneOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
phoneOtpSchema.index({ phone: 1, createdAt: -1 });

export type PhoneOtpDocument = InferSchemaType<typeof phoneOtpSchema>;
export const PhoneOtpModel = mongoose.model('PhoneOtp', phoneOtpSchema);
