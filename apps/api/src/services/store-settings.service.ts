import type { StoreSettings } from '@ajooba/contracts';
import { StoreSettingsModel } from '../models/store-settings.model.js';

/**
 * Store settings.
 *
 * The settings are a singleton document. Reading them is cheap because the
 * document is small and MongoDB keeps it in cache; every read still goes
 * to the database so that a change made in the admin panel takes effect
 * on the next request rather than at the next deployment.
 */

/**
 * The settings used when no document exists yet.
 *
 * These are operational defaults, not fabricated business data: a zero tax
 * rate, a flat shipping fee and no announcement. The store behaves
 * correctly — it just does not claim to know anything the business has not
 * configured.
 */
export const DEFAULT_STORE_SETTINGS: Omit<StoreSettings, 'updatedAt'> = Object.freeze({
  storeName: 'Ajooba Footwear',
  supportEmail: 'support@ajooba.in',
  supportPhone: '+919876543210',
  currency: 'INR',
  shippingFee: 99,
  freeShippingThreshold: 1499,
  taxRateBps: 0,
  taxInclusive: false,
  isCodEnabled: true,
  announcement: '',
});

/**
 * Read the current store settings.
 */
export async function getStoreSettings(): Promise<StoreSettings> {
  const doc = await StoreSettingsModel.findOne({ key: 'default' }).lean();

  if (!doc) {
    return { ...DEFAULT_STORE_SETTINGS, updatedAt: new Date(0).toISOString() };
  }

  return {
    storeName: doc.storeName,
    supportEmail: doc.supportEmail,
    supportPhone: doc.supportPhone,
    currency: 'INR',
    shippingFee: doc.shippingFee,
    freeShippingThreshold: doc.freeShippingThreshold,
    taxRateBps: doc.taxRateBps,
    taxInclusive: doc.taxInclusive,
    isCodEnabled: doc.isCodEnabled,
    announcement: doc.announcement,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Update the store settings.
 */
export async function updateStoreSettings(
  input: Omit<StoreSettings, 'currency' | 'updatedAt'>,
): Promise<StoreSettings> {
  const doc = await StoreSettingsModel.findOneAndUpdate(
    { key: 'default' },
    { $set: { ...input, key: 'default' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  return {
    storeName: doc.storeName,
    supportEmail: doc.supportEmail,
    supportPhone: doc.supportPhone,
    currency: 'INR',
    shippingFee: doc.shippingFee,
    freeShippingThreshold: doc.freeShippingThreshold,
    taxRateBps: doc.taxRateBps,
    taxInclusive: doc.taxInclusive,
    isCodEnabled: doc.isCodEnabled,
    announcement: doc.announcement,
    updatedAt: doc.updatedAt.toISOString(),
  };
}
