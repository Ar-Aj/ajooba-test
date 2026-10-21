import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Customer accounts.
 *
 * Authentication design: passwords are hashed with bcrypt. The schema stores
 * only the hash — never a plaintext or reversible value.
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
    country: { type: String, required: true, default: 'India' },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, index: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    /** Role for admin access. Customers never receive `admin`. */
    role: { type: String, enum: ['customer', 'admin'], default: 'customer', index: true },
    addresses: { type: [addressSchema], default: [] },
    wishlist: { type: [Schema.Types.ObjectId], default: [], ref: 'Product' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export const UserModel = mongoose.model('User', userSchema);
