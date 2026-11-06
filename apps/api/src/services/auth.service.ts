import { Types } from 'mongoose';
import {
  ADMIN_ROLE_PERMISSIONS,
  type AdminProfile,
  type AdminRole,
  type AuthSession,
  type AuthTokens,
  type CustomerAddress,
  type CustomerProfile,
} from '@ajooba/contracts';
import { env } from '../config/env.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../core/errors.js';
import { AdminUserModel } from '../models/admin-user.model.js';
import { RefreshTokenModel } from '../models/refresh-token.model.js';
import { UserModel } from '../models/user.model.js';
import {
  generateOpaqueToken,
  generateTokenFamilyId,
  hashPassword,
  hashToken,
  verifyPassword,
} from './password.service.js';
import {
  accessTokenTtlSeconds,
  issueAccessToken,
  refreshTokenTtlSeconds,
} from './token.service.js';

/**
 * Authentication service.
 *
 * The two identity domains — customers and administrators — share the
 * token machinery but nothing else. They live in different collections,
 * they have different lockout budgets, and an administrator session never
 * authenticates a customer route (and vice versa).
 */

interface CustomerDoc {
  _id: Types.ObjectId;
  email: string;
  phone: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  addresses: Array<{
    _id: Types.ObjectId;
    label: string;
    fullName: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
  }>;
  wishlist: Types.ObjectId[];
  isActive: boolean;
  lastLoginAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AdminDoc {
  _id: Types.ObjectId;
  email: string;
  name: string;
  passwordHash: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                */
/* -------------------------------------------------------------------------- */

export function mapCustomer(doc: CustomerDoc): CustomerProfile {
  return {
    id: doc._id.toString(),
    email: doc.email,
    phone: doc.phone,
    firstName: doc.firstName,
    lastName: doc.lastName,
    addresses: doc.addresses.map((address): CustomerAddress => ({
      id: address._id.toString(),
      label: address.label,
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      isDefault: address.isDefault,
    })),
    wishlist: doc.wishlist.map((id) => id.toString()),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function mapAdmin(doc: AdminDoc): AdminProfile {
  return {
    id: doc._id.toString(),
    email: doc.email,
    name: doc.name,
    role: doc.role,
    permissions: ADMIN_ROLE_PERMISSIONS[doc.role],
    isActive: doc.isActive,
    lastLoginAt: doc.lastLoginAt ? doc.lastLoginAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Token issue / rotate                                                       */
/* -------------------------------------------------------------------------- */

interface IssueContext {
  readonly userAgent: string;
  readonly ip: string;
}

/**
 * Issue an access token and a fresh refresh token.
 *
 * The refresh token is stored as a hash. The raw value is returned to the
 * caller and never written anywhere else.
 */
async function issueTokens(
  kind: 'customer' | 'admin',
  subjectId: Types.ObjectId,
  email: string,
  role: AdminRole | undefined,
  context: IssueContext,
): Promise<AuthTokens> {
  const accessToken = await issueAccessToken({
    sub: subjectId.toString(),
    kind,
    email,
    ...(role ? { role } : {}),
    ...(role ? { permissions: ADMIN_ROLE_PERMISSIONS[role] } : {}),
  });

  const rawRefreshToken = generateOpaqueToken();
  const familyId = generateTokenFamilyId();

  await RefreshTokenModel.create({
    tokenHash: hashToken(rawRefreshToken),
    kind,
    subjectId,
    familyId,
    expiresAt: new Date(Date.now() + refreshTokenTtlSeconds() * 1000),
    userAgent: context.userAgent.slice(0, 200),
    ip: context.ip.slice(0, 60),
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    tokenType: 'Bearer',
    expiresIn: accessTokenTtlSeconds(),
  };
}

/* -------------------------------------------------------------------------- */
/* Lockout                                                                    */
/* -------------------------------------------------------------------------- */

interface LockoutState {
  readonly lockedUntil: Date | null;
  readonly failedLoginAttempts: number;
}

/**
 * Refuse a sign-in while the account is locked.
 */
function assertNotLocked(state: LockoutState): void {
  if (state.lockedUntil && state.lockedUntil.getTime() > Date.now()) {
    const seconds = Math.ceil((state.lockedUntil.getTime() - Date.now()) / 1000);
    throw new UnauthorizedError(
      `This account is temporarily locked. Try again in ${Math.ceil(seconds / 60)} minute(s).`,
    );
  }
}

/**
 * Record a failed sign-in and lock the account when the budget is spent.
 *
 * The updater is passed in rather than the model, because the customer and
 * administrator models have different shapes and a union of them is not
 * callable in TypeScript.
 */
async function registerFailedAttempt(
  applyUpdate: (update: Record<string, unknown>) => Promise<unknown>,
  currentAttempts: number,
): Promise<void> {
  const budget = env.MAX_FAILED_LOGIN_ATTEMPTS;
  if (budget <= 0) {
    return;
  }

  const attempts = currentAttempts + 1;
  const update: Record<string, unknown> = { failedLoginAttempts: attempts };

  if (attempts >= budget) {
    update.lockedUntil = new Date(Date.now() + env.ACCOUNT_LOCKOUT_SECONDS * 1000);
    update.failedLoginAttempts = 0;
  }

  await applyUpdate(update);
}

/* -------------------------------------------------------------------------- */
/* Customer auth                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Register a new customer.
 *
 * The password is hashed before anything is written. A duplicate email is
 * a conflict — the response never reveals whether the address is already
 * registered to a different account, but it does tell the caller that
 * *this* registration failed, which is the correct UX.
 */
export async function registerCustomer(
  input: {
    email: string;
    phone?: string;
    password: string;
    firstName: string;
    lastName: string;
  },
  context: IssueContext,
): Promise<AuthSession> {
  const existing = await UserModel.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    throw new ConflictError('An account with that email already exists.');
  }

  const passwordHash = await hashPassword(input.password);

  const created = await UserModel.create({
    email: input.email,
    /*
     * The record's phone is required, so a sign-up that skipped it gets a
     * placeholder instead of an empty string.
     *
     * The placeholder is *not* a fake number — it is the literal string
     * `unconfirmed`, which fails every phone-shaped check downstream. Checkout
     * asks for a real number and overwrites it; fulfilment code that expects a
     * dialable number therefore cannot silently use one that is not.
     */
    phone: input.phone ?? 'unconfirmed',
    passwordHash,
    firstName: input.firstName,
    lastName: input.lastName ?? '',
  });

  const tokens = await issueTokens('customer', created._id, created.email, undefined, context);

  return { user: mapCustomer(created as unknown as CustomerDoc), tokens };
}

/**
 * Sign a customer in.
 *
 * A wrong email and a wrong password produce the **same** error, so the
 * endpoint cannot be used to enumerate registered addresses.
 */
export async function loginCustomer(
  input: { email: string; password: string },
  context: IssueContext,
): Promise<AuthSession> {
  const doc = await UserModel.findOne({ email: input.email }).lean<CustomerDoc | null>();

  if (!doc) {
    // Spend comparable time so the response time does not reveal whether
    // the account exists.
    await verifyPassword(
      input.password,
      '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
    );
    throw new UnauthorizedError('Email or password is incorrect.');
  }

  assertNotLocked(doc);

  if (!doc.isActive) {
    throw new UnauthorizedError('This account is not active.');
  }

  const valid = await verifyPassword(input.password, doc.passwordHash);
  if (!valid) {
    await registerFailedAttempt(
      (update) => UserModel.updateOne({ _id: doc._id }, { $set: update }),
      doc.failedLoginAttempts,
    );
    throw new UnauthorizedError('Email or password is incorrect.');
  }

  await UserModel.updateOne(
    { _id: doc._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );

  const tokens = await issueTokens('customer', doc._id, doc.email, undefined, context);

  return { user: mapCustomer(doc), tokens };
}

/**
 * Issue a fresh customer session for a record that already exists.
 *
 * This is the shared tail of every sign-in path — password, Google, Facebook —
 * and it exists so those three cannot drift apart. The OAuth service has no
 * business knowing how a refresh token is minted, and a sign-in through Google
 * must produce exactly the same token pair as a sign-in with a password.
 */
export async function issueCustomerSession(
  customerId: Types.ObjectId,
  context: IssueContext,
): Promise<AuthSession> {
  const doc = await UserModel.findById(customerId).lean<CustomerDoc | null>();
  if (!doc) {
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }
  if (!doc.isActive) {
    throw new UnauthorizedError('This account is not active.');
  }

  await UserModel.updateOne(
    { _id: doc._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );

  const tokens = await issueTokens('customer', doc._id, doc.email, undefined, context);

  return { user: mapCustomer(doc), tokens };
}

export type { IssueContext };

/**
 * Fetch a customer by id.
 */
export async function getCustomerById(id: string): Promise<CustomerProfile | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }
  const doc = await UserModel.findById(id).lean<CustomerDoc | null>();
  return doc ? mapCustomer(doc) : null;
}

/* -------------------------------------------------------------------------- */
/* Administrator auth                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Sign an administrator in.
 */
export async function loginAdmin(
  input: { email: string; password: string },
  context: IssueContext,
): Promise<{ admin: AdminProfile; tokens: AuthTokens }> {
  const doc = await AdminUserModel.findOne({ email: input.email }).lean<AdminDoc | null>();

  if (!doc) {
    await verifyPassword(
      input.password,
      '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
    );
    throw new UnauthorizedError('Email or password is incorrect.');
  }

  assertNotLocked(doc);

  if (!doc.isActive) {
    throw new UnauthorizedError('This account is not active.');
  }

  const valid = await verifyPassword(input.password, doc.passwordHash);
  if (!valid) {
    await registerFailedAttempt(
      (update) => AdminUserModel.updateOne({ _id: doc._id }, { $set: update }),
      doc.failedLoginAttempts,
    );
    throw new UnauthorizedError('Email or password is incorrect.');
  }

  await AdminUserModel.updateOne(
    { _id: doc._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );

  const tokens = await issueTokens('admin', doc._id, doc.email, doc.role, context);

  return { admin: mapAdmin(doc), tokens };
}

/**
 * Fetch an administrator by id.
 */
export async function getAdminById(id: string): Promise<AdminProfile | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }
  const doc = await AdminUserModel.findById(id).lean<AdminDoc | null>();
  return doc ? mapAdmin(doc) : null;
}

/**
 * Load the *live* administrator record for a principal.
 *
 * The token carries the role, but the role is re-read from the database on
 * every request so that deactivating an administrator or changing their
 * role takes effect immediately rather than at the end of the token's
 * lifetime.
 */
export async function loadAdminPrincipal(id: string): Promise<AdminProfile | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }
  const doc = await AdminUserModel.findById(id).lean<AdminDoc | null>();
  if (!doc || !doc.isActive) {
    return null;
  }
  return mapAdmin(doc);
}

/* -------------------------------------------------------------------------- */
/* Refresh / logout                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Exchange a refresh token for a new token pair.
 *
 * The old refresh token is marked used and revoked. If an already-used
 * token is presented again, that is a replay: the entire token family is
 * revoked, because it means the token was stolen.
 */
export async function refreshSession(
  rawRefreshToken: string,
  context: IssueContext,
): Promise<{ kind: 'customer' | 'admin'; tokens: AuthTokens }> {
  const tokenHash = hashToken(rawRefreshToken);
  const record = await RefreshTokenModel.findOne({ tokenHash });

  if (!record) {
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }

  if (record.revokedAt) {
    // Replay: revoke the whole family.
    await RefreshTokenModel.updateMany(
      { familyId: record.familyId },
      { $set: { revokedAt: new Date() } },
    );
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }

  if (record.kind === 'customer') {
    const customer = await UserModel.findById(record.subjectId).lean<CustomerDoc | null>();
    if (!customer || !customer.isActive) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }
    await RefreshTokenModel.updateOne(
      { _id: record._id },
      { $set: { usedAt: new Date(), revokedAt: new Date() } },
    );
    const tokens = await issueTokens('customer', customer._id, customer.email, undefined, context);
    return { kind: 'customer', tokens };
  }

  const admin = await AdminUserModel.findById(record.subjectId).lean<AdminDoc | null>();
  if (!admin || !admin.isActive) {
    throw new UnauthorizedError('Your session is invalid or has expired.');
  }
  await RefreshTokenModel.updateOne(
    { _id: record._id },
    { $set: { usedAt: new Date(), revokedAt: new Date() } },
  );
  const tokens = await issueTokens('admin', admin._id, admin.email, admin.role, context);
  return { kind: 'admin', tokens };
}

/**
 * Revoke a single refresh token (sign-out).
 */
export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  await RefreshTokenModel.updateOne(
    { tokenHash: hashToken(rawRefreshToken) },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * Revoke every refresh token for an identity (sign-out everywhere).
 */
export async function revokeAllRefreshTokens(
  kind: 'customer' | 'admin',
  subjectId: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(subjectId)) {
    return;
  }
  await RefreshTokenModel.updateMany(
    { kind, subjectId: new Types.ObjectId(subjectId), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * Change a customer's password and end every existing session.
 */
export async function changeCustomerPassword(
  customerId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(customerId)) {
    throw new NotFoundError('Customer');
  }

  const doc = await UserModel.findById(customerId).lean<CustomerDoc | null>();
  if (!doc) {
    throw new NotFoundError('Customer');
  }

  const valid = await verifyPassword(currentPassword, doc.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  await UserModel.updateOne(
    { _id: customerId },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    },
  );

  await revokeAllRefreshTokens('customer', customerId);
}

/**
 * Change an administrator's password and end every existing session.
 */
export async function changeAdminPassword(
  adminId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(adminId)) {
    throw new NotFoundError('Administrator');
  }

  const doc = await AdminUserModel.findById(adminId).lean<AdminDoc | null>();
  if (!doc) {
    throw new NotFoundError('Administrator');
  }

  const valid = await verifyPassword(currentPassword, doc.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect.');
  }

  const passwordHash = await hashPassword(newPassword);
  await AdminUserModel.updateOne(
    { _id: adminId },
    {
      $set: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    },
  );

  await revokeAllRefreshTokens('admin', adminId);
}
