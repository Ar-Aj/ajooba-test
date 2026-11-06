/**
 * Domain types for the storefront's local stores.
 *
 * The cart, wishlist, addresses and orders use these shapes. They mirror
 * what the API will eventually return so the UI can swap to a real backend
 * without touching presentation components — the type contracts are the
 * boundary.
 *
 * Why local? `docs/API_CONTRACT.md` §3.4 enumerates the entire commerce
 * surface as "Not started". Building a real admin+orders pipeline is a
 * separate, explicitly scheduled phase. Until it lands, these stores are
 * the only honest answer for customer interactions: the storefront allows
 * carting, addressing and a "place a local-test order" flow that the user
 * can see and undo, never producing a paid order or inventory change.
 */

import type { ProductVariant } from '@ajooba/contracts';

export interface CartLine {
  /** Stable id used by React keys and localStorage. */
  id: string;
  /** The variant the line refers to — the API is the source of truth for the
   *  numbers (MRP, selling price). */
  variantSku: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  /** Colour derived from the variant's `colour` field at the time of adding. */
  colour: string;
  size: number;
  /** Denormalised at add-to-cart time so the cart line is meaningful even if
   *  the catalogue later reflects a price change. The cart always shows what
   *  the customer added. */
  unitMrp: number;
  unitPrice: number;
  quantity: number;
  /** First gallery image — used as the line thumbnail. */
  imageUrl?: string;
  imageAlt?: string;
  /** When the customer added the line. ISO 8601. */
  addedAt: string;
}

export interface Address {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: 'India';
  isDefault?: boolean;
}

export type OrderStatus =
  'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'returned';

export interface LocalOrderLine {
  productId: string;
  productSlug: string;
  productTitle: string;
  variantSku: string;
  size: number;
  colour: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

export interface LocalOrder {
  id: string;
  number: string;
  lines: LocalOrderLine[];
  /** Subtotal in INR, computed at the time of placement. */
  subtotal: number;
  shipping: number;
  /** Always 0 locally — payments are not enabled. */
  total: number;
  status: OrderStatus;
  placedAt: string;
  shippingAddress: Address;
  /** Always "unpaid" for now. */
  paymentState: 'unpaid' | 'paid' | 'refunded';
  /** Free-form note: the source-of-truth flag. */
  notes: string[];
}

export interface ReturnRequest {
  id: string;
  orderNumber: string;
  reason: 'size-issue' | 'damaged' | 'quality-issue' | 'wrong-item' | 'other';
  description: string;
  /** SKUs the customer wants to return. */
  lineSkus: string[];
  status: 'submitted' | 'in-review' | 'pickup-scheduled' | 'refunded' | 'rejected';
  submittedAt: string;
}

/** Narrow ProductVariant to what the cart needs. */
export type MinimalVariant = Pick<
  ProductVariant,
  'sku' | 'size' | 'colour' | 'mrp' | 'sellingPrice' | 'inStock' | 'stock'
>;
