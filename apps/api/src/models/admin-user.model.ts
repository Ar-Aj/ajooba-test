import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Administrator accounts.
 *
 * Administrators are stored in their **own** collection, separate from
 * customers. This is deliberate:
 *
 *  - a customer-facing endpoint can never touch an administrator record;
 *  - an administrator's role and permissions are a single, explicit field
 *    rather than a `role` string on a shared table;
 *  - the two identities can carry different session policies, lockout
 *    budgets and audit expectations.
 *
 * There is no default administrator and no default password. The first
 * administrator is created by an explicit bootstrap command that requires
 * credentials to be supplied through the environment.
 */

const adminUserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true },
    /** bcrypt hash. Never a plaintext password. */
    passwordHash: { type: String, required: true },
    /**
     * The role. The set of permissions it grants is defined in
     * `@ajooba/contracts` (`ADMIN_ROLE_PERMISSIONS`) and enforced
     * server-side on every protected route.
     */
    role: {
      type: String,
      required: true,
      enum: ['owner', 'admin', 'manager', 'support', 'content-editor'],
      default: 'admin',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'admin_users',
  },
);

adminUserSchema.index({ createdAt: -1 });

export type AdminUserDocument = InferSchemaType<typeof adminUserSchema>;
export const AdminUserModel = mongoose.model('AdminUser', adminUserSchema);
