import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Store settings.
 *
 * A single document holding the operational settings the storefront and
 * the checkout depend on: shipping fee, free-shipping threshold, tax rate
 * and whether cash on delivery is enabled.
 *
 * The money settings are **read from here at request time** rather than
 * baked into the code, so changing the shipping fee is an admin action and
 * not a deployment.
 */
const storeSettingsSchema = new Schema(
  {
    /** The settings are a singleton. This field makes that explicit. */
    key: { type: String, required: true, unique: true, default: 'default', index: true },

    storeName: { type: String, required: true, default: 'Ajooba Footwear' },
    supportEmail: { type: String, required: true, default: 'support@ajooba.in' },
    supportPhone: { type: String, required: true, default: '+919876543210' },

    currency: { type: String, required: true, default: 'INR' },

    /** Flat shipping fee in whole rupees. */
    shippingFee: { type: Number, required: true, min: 0, default: 99 },
    /** Free-shipping threshold in whole rupees. 0 disables the threshold. */
    freeShippingThreshold: { type: Number, required: true, min: 0, default: 1499 },
    /** Tax rate in basis points. 500 = 5%. */
    taxRateBps: { type: Number, required: true, min: 0, max: 10_000, default: 0 },
    /** True when the displayed price already includes the tax. */
    taxInclusive: { type: Boolean, required: true, default: false },
    /** Whether cash on delivery is offered at checkout. */
    isCodEnabled: { type: Boolean, required: true, default: true },
    /** A store-wide announcement banner. */
    announcement: { type: String, required: true, default: '' },
  },
  {
    timestamps: true,
    collection: 'store_settings',
  },
);

export type StoreSettingsDocument = InferSchemaType<typeof storeSettingsSchema>;
export const StoreSettingsModel = mongoose.model('StoreSettings', storeSettingsSchema);
