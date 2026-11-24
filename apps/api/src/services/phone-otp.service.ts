import { randomInt } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env, isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';
import { UnauthorizedError, ValidationError } from '../core/errors.js';
import { PhoneOtpModel } from '../models/phone-otp.model.js';
import { hashToken } from './password.service.js';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_GRANT_TTL_SECONDS = 15 * 60; // 15 minutes
const MAX_OTP_ATTEMPTS = 5;
const ALG = 'HS256';

function otpSigningKey(): Uint8Array {
  const encoder = new TextEncoder();
  const base = encoder.encode(env.JWT_SECRET);
  const material = new Uint8Array(base.length + 1);
  material.set(base, 0);
  material[base.length] = 0x6f; // 'o'
  return material;
}

export interface SendPhoneOtpResult {
  readonly sent: boolean;
  readonly phone: string;
  readonly expiresInSeconds: number;
  /**
   * Exposed outside production (or when no SMS gateway is configured yet) so
   * testers can complete the 6-digit OTP verification flow during sign-up.
   */
  readonly devOtp?: string;
}

export interface VerifyPhoneOtpResult {
  readonly verified: boolean;
  readonly phone: string;
  readonly verificationToken: string;
  readonly expiresInSeconds: number;
}

/**
 * Generate and store a 6-digit OTP challenge for an Indian mobile number.
 */
export async function sendPhoneOtp(input: {
  phone: string;
  ip?: string;
}): Promise<SendPhoneOtpResult> {
  const code = String(randomInt(100_000, 1_000_000));
  const codeHash = hashToken(`${input.phone}:${code}`);

  // Remove any unverified prior challenges for this number so only the newest OTP is valid.
  await PhoneOtpModel.deleteMany({ phone: input.phone, verifiedAt: null });

  await PhoneOtpModel.create({
    phone: input.phone,
    codeHash,
    attempts: 0,
    verifiedAt: null,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    ip: (input.ip ?? '').slice(0, 60),
  });

  logger.info(
    {
      phone: input.phone,
      ...(!isProduction ? { otp: code } : {}),
    },
    'Phone verification OTP generated',
  );

  // When an SMS gateway is not yet configured, return `devOtp` so customer sign-up
  // can be verified end-to-end immediately during testing.
  const smsConfigured = Boolean(process.env.SMS_API_KEY?.trim());

  return {
    sent: true,
    phone: input.phone,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    ...(!isProduction || !smsConfigured ? { devOtp: code } : {}),
  };
}

/**
 * Verify a 6-digit OTP and mint a signed verification token for that phone number.
 */
export async function verifyPhoneOtp(input: {
  phone: string;
  code: string;
}): Promise<VerifyPhoneOtpResult> {
  const record = await PhoneOtpModel.findOne({
    phone: input.phone,
    verifiedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!record) {
    throw new ValidationError(
      'This OTP has expired or was not requested. Please tap Send OTP again.',
    );
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await PhoneOtpModel.deleteOne({ _id: record._id });
    throw new ValidationError('Too many incorrect attempts. Please request a fresh OTP.');
  }

  const expectedHash = hashToken(`${input.phone}:${input.code.trim()}`);
  if (record.codeHash !== expectedHash) {
    await PhoneOtpModel.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    throw new ValidationError('Incorrect 6-digit OTP code. Please check and try again.');
  }

  await PhoneOtpModel.updateOne({ _id: record._id }, { $set: { verifiedAt: new Date() } });

  const verificationToken = await new SignJWT({
    phone: input.phone,
    type: 'phone_otp_verified',
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer(env.JWT_ISSUER)
    .setAudience('ajooba-phone-otp')
    .setIssuedAt()
    .setExpirationTime(`${OTP_GRANT_TTL_SECONDS}s`)
    .sign(otpSigningKey());

  return {
    verified: true,
    phone: input.phone,
    verificationToken,
    expiresInSeconds: OTP_GRANT_TTL_SECONDS,
  };
}

/**
 * Verify a signed phone verification token when present during registration.
 */
export async function assertPhoneVerificationToken(
  token: string,
  expectedPhone: string,
): Promise<void> {
  try {
    const { payload } = await jwtVerify(token, otpSigningKey(), {
      algorithms: [ALG],
      issuer: env.JWT_ISSUER,
      audience: 'ajooba-phone-otp',
    });

    if (payload.type !== 'phone_otp_verified' || payload.phone !== expectedPhone) {
      throw new UnauthorizedError('The mobile number verification does not match.');
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new ValidationError(
      'Your mobile number verification expired. Please verify the OTP again.',
    );
  }
}
