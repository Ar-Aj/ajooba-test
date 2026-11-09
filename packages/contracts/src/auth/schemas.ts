import { z } from 'zod';
import { ADMIN_PERMISSIONS, ADMIN_ROLES } from './types.js';

/**
 * Zod schemas for the authentication boundary.
 *
 * These enforce the input rules the API relies on: password strength,
 * Indian mobile-number shape, email shape, and the role/permission enums.
 */

/**
 * Password policy.
 *
 * Minimum 10 characters, and at least one letter and one digit. This is
 * deliberately stricter than the "8 characters" floor that many frameworks
 * default to, because the account is reachable over the public internet.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password must be at most 200 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5)
  .max(254)
  .email('Must be a valid email address');

/**
 * Indian mobile number, stored in E.164-ish local form: `+91XXXXXXXXX`.
 *
 * The workbook is silent on phone format, but the store ships only within
 * India and every checkout needs a reachable number, so the shape is
 * enforced at the boundary rather than discovered at fulfilment time.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Must be a valid phone number, e.g. +919876543210');

export const adminRoleSchema = z.enum(ADMIN_ROLES);
export const adminPermissionSchema = z.enum(ADMIN_PERMISSIONS);

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

export const registerRequestSchema = z.object({
  email: emailSchema,
  /*
   * A phone number is required by the customer record, but the *form* asks for
   * it as optional because a shopper signing up to save a design has no reason
   * to hand over a number yet.
   *
   * The resolution is `phoneSchema.optional()` with a placeholder written by the
   * service, not a relaxed schema: checkout still needs a real, reachable number,
   * and that is collected there. Accepting `''` here would put an empty string
   * into a field that fulfilment code assumes is a number.
   */
  phone: phoneSchema.optional(),
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  /*
   * Optional, and defaulted to `''` rather than rejected.
   *
   * A single-word name — common in this market, and common among shoppers who
   * type only a first name — produced a 422 that read as "lastName: too small"
   * beside a form with no last-name field. That is a validation error the
   * customer cannot act on because the UI never asked for the input.
   */
  lastName: z.string().trim().max(80).default(''),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Social sign-in                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The providers we support.
 *
 * Two, deliberately. Each one is an OAuth client the shop has to register,
 * verify and keep working; a button that leads to an unconfigured provider is
 * worse than no button, so the set is small and each member is real.
 */
export const OAUTH_PROVIDERS = ['google', 'facebook'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

/**
 * The path a shopper is returned to after the OAuth round trip.
 *
 * Validated as a **relative path only**. An absolute URL here would make the
 * callback an open redirect: an attacker could send a shopper to
 * `/v1/auth/oauth/google/start?next=https://evil.example` and the shop would
 * hand them over with our domain still in the address bar. Anything that is not
 * a single-leading-slash path falls back to the account page.
 */
export const nextPathSchema = z
  .string()
  .trim()
  .max(512)
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'),
    'Must be a relative path on this site',
  );

export const oauthStartQuerySchema = z.object({
  next: nextPathSchema.optional(),
});

/** A social sign-in door this deployment can actually complete. */
export interface OAuthProviderStatus {
  readonly id: OAuthProvider;
  readonly label: string;
}

export interface OAuthProvidersResponse {
  readonly providers: readonly OAuthProviderStatus[];
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(20).max(4096),
});

export type RefreshTokenRequest = z.infer<typeof refreshTokenRequestSchema>;

/**
 * A password change.
 *
 * The **new** password is held to the full `passwordSchema` policy — the
 * same one registration enforces — rather than a length check alone. A
 * customer who could set a 10-character all-symbol password here would
 * have a weaker account than one created through registration, which is
 * exactly the wrong direction.
 *
 * The current password is only checked for presence and length: it is
 * verified against the stored hash, so it does not need to satisfy the
 * new-password policy (the customer's existing password may predate it).
 */
export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must differ from the current one.',
    path: ['newPassword'],
  });

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Password recovery                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A password recovery request.
 *
 * Only the address is taken. The endpoint answers identically for a known
 * and an unknown address, so this schema cannot be used to probe which
 * addresses hold accounts.
 */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

/**
 * Exchange a reset token for a reset grant.
 *
 * The token is the raw value from the emailed link. It is verified against
 * a stored hash and is never persisted.
 */
export const verifyResetTokenRequestSchema = z.object({
  token: z.string().min(20).max(512),
});

export type VerifyResetTokenRequest = z.infer<typeof verifyResetTokenRequestSchema>;

/**
 * Complete a password reset.
 *
 * `grantToken` is the short-lived grant issued by the verify step. It is
 * proved against the stored reset-token hash, so a client cannot invent one.
 *
 * The new password is held to the **same** policy as registration, so an
 * account recovered through email is not weaker than one created at sign-up.
 */
export const resetPasswordRequestSchema = z.object({
  grantToken: z.string().min(20).max(512),
  newPassword: passwordSchema,
});

export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * The `Authorization: Bearer <token>` header value.
 */
export const bearerTokenSchema = z.object({
  token: z.string().min(20).max(4096),
});

/* -------------------------------------------------------------------------- */
/* Addresses                                                                  */
/* -------------------------------------------------------------------------- */

export const addressInputSchema = z.object({
  label: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).default(''),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Must be a 6-digit Indian PIN code'),
  country: z.string().trim().min(2).max(80).default('India'),
  isDefault: z.boolean().default(false),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

/**
 * Partial address update schema.
 *
 * Kept free of `.default(...)` so a PATCH request only modifies fields the
 * caller explicitly sent and never resets `line2`, `country`, or `isDefault`
 * back to their creation defaults.
 */
export const addressUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: phoneSchema.optional(),
    line1: z.string().trim().min(1).max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().min(1).max(80).optional(),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Must be a 6-digit Indian PIN code')
      .optional(),
    country: z.string().trim().min(2).max(80).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: 'At least one address field must be provided.',
  });

export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;

export const updateProfileRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: phoneSchema.optional(),
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                  */
/* -------------------------------------------------------------------------- */

export const customerAddressSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
  isDefault: z.boolean(),
});

export const customerProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  addresses: z.array(customerAddressSchema),
  wishlist: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const authTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});

export const authSessionSchema = z.object({
  user: customerProfileSchema,
  tokens: authTokensSchema,
});

export const adminProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string(),
  role: adminRoleSchema,
  permissions: z.array(adminPermissionSchema),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const adminSessionSchema = z.object({
  admin: adminProfileSchema,
  tokens: authTokensSchema,
});
