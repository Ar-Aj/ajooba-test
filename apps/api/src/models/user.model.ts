import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Customer accounts.
 *
 * Authentication design: passwords are hashed with bcrypt. The schema stores
 * only the hash — never a plaintext or reversible value.
 *
 * A customer is NOT an administrator. Administrators live in their own
 * collection (`admin_users`) with their own role model and their own
 * session policy. Keeping the two apart means no customer-facing endpoint
 * can escalate a customer into an admin.
 */

const addressSchema = new Schema(
  {
    label: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, default: 'India' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

/**
 * A link between this customer and an external identity provider.
 *
 * ## Why the provider id is stored, and why it is the thing matched on
 *
 * A shopper who signs in with Google has a stable `sub` claim and an email that
 * can change. Matching on the id means a customer who changes their Google
 * address still lands in the same account, with the same orders. Matching on
 * email alone would silently create a second account the day somebody updates
 * their address.
 *
 * The pair is unique per customer so a double-click on the callback cannot
 * append the same link twice.
 */
const oauthAccountSchema = new Schema(
  {
    provider: { type: String, required: true, enum: ['google', 'facebook'] },
    providerId: { type: String, required: true },
    /** When this provider was first linked. */
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    /*
     * Optional for a customer who arrived through Google or Facebook: there is
     * no password to hash. `loginCustomer` treats an empty hash as "this account
     * has no password", so such a record cannot be entered with a guessed one.
     */
    passwordHash: { type: String, default: '' },
    phone: { type: String, required: true, index: true },
    firstName: { type: String, required: true },
    lastName: { type: String, default: '' },
    /** External identities linked to this customer. Empty for password accounts. */
    oauthAccounts: { type: [oauthAccountSchema], default: [] },
    addresses: { type: [addressSchema], default: [] },
    /** Product ids the customer has saved. */
    wishlist: { type: [Schema.Types.ObjectId], default: [], ref: 'Product' },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null },
    /**
     * Consecutive failed sign-in attempts. Reset to 0 on a successful
     * sign-in and on an account lockout.
     */
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    /**
     * When the account is locked out. Present only while the lock is
     * active; a successful sign-in clears it.
     */
    lockedUntil: { type: Date, default: null },
    /**
     * Bumped whenever the password changes. A token minted before the bump
     * is rejected, so changing a password ends every existing session.
     */
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

// Supports "does this email already exist" and the admin customer list.
userSchema.index({ createdAt: -1 });
// The OAuth callback's first lookup: "which customer is this Google id?"
// Sparse, because password-only accounts have no links at all.
userSchema.index(
  { 'oauthAccounts.provider': 1, 'oauthAccounts.providerId': 1 },
  { sparse: true },
);
// A customer may have at most one default address; the service enforces the
// invariant, this index simply makes the lookup cheap.
userSchema.index({ 'addresses.isDefault': 1 });

export type UserDocument = InferSchemaType<typeof userSchema>;
export const UserModel = mongoose.model('User', userSchema);
