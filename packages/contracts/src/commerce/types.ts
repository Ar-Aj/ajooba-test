/**
 * Commerce domain contracts — cart, orders, returns, coupons, payments.
 *
 * Money is always whole INR rupees, matching the source workbooks and the
 * `ProductVariant` money fields. There are no paise anywhere in the
 * platform, so no rounding happens at the API boundary.
 */

/* -------------------------------------------------------------------------- */
/* Cart                                                                       */
/* -------------------------------------------------------------------------- */

/** A line in a cart. The price shown here is a *snapshot at read time* from the live variant. */
export interface CartItem {
  readonly variantId: string;
  readonly sku: string;
  readonly productId: string;
  readonly slug: string;
  readonly title: string;
  readonly colour: string;
  readonly size: number;
  readonly imageUrl: string | null;
  readonly unitPrice: number;
  readonly mrp: number;
  readonly quantity: number;
  readonly lineTotal: number;
  /** False when the requested quantity exceeds live stock. */
  readonly isAvailable: boolean;
  readonly availableStock: number;
}

/** A coupon that has been successfully applied to a cart. */
export interface AppliedCoupon {
  readonly code: string;
  readonly type: 'percentage' | 'fixed';
  readonly value: number;
  readonly discountAmount: number;
}

/** The full cart projection, including the server-computed money totals. */
export interface Cart {
  readonly id: string;
  readonly items: readonly CartItem[];
  readonly coupon: AppliedCoupon | null;
  readonly itemCount: number;
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly shippingFee: number;
  readonly taxAmount: number;
  readonly totalAmount: number;
  readonly currency: 'INR';
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Order lifecycle.
 *
 * ```
 * placed ──▶ processing ──▶ shipped ──▶ completed
 *    │            │            │
 *    └── cancelled └── cancelled └── cancelled
 * ```
 *
 * `cancelled` and `completed` are terminal. The transition table lives in
 * `apps/api/src/services/order.service.ts` and is enforced server-side.
 */
export const ORDER_STATUSES = [
  'placed',
  'processing',
  'shipped',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * An immutable snapshot of a purchased line.
 *
 * The order item is written once, at checkout, and never updated. A later
 * catalogue price change or a product rename cannot rewrite history.
 */
export interface OrderItem {
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly colour: string;
  readonly size: number;
  /** The unit price charged, in whole rupees. */
  readonly unitPrice: number;
  readonly mrp: number;
  readonly quantity: number;
  /** `unitPrice * quantity`, frozen at checkout. */
  readonly lineTotal: number;
}

/** A frozen copy of the delivery address used for an order. */
export interface OrderAddress {
  readonly fullName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface Order {
  readonly id: string;
  readonly orderNumber: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerEmail: string;
  /**
   * The customer's phone at the time of purchase.
   *
   * Denormalised onto the order precisely so fulfilment does not depend on
   * the customer record still holding an accurate number, and so the
   * payment provider can be given a contact without a second lookup.
   */
  readonly customerPhone: string;
  readonly items: readonly OrderItem[];
  readonly subtotal: number;
  readonly shippingFee: number;
  readonly taxAmount: number;
  readonly discountAmount: number;
  readonly totalAmount: number;
  readonly currency: 'INR';
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly couponCode: string | null;
  readonly shippingAddress: OrderAddress;
  readonly billingAddress: OrderAddress;
  readonly paymentRef: string | null;
  /**
   * How the customer intends to pay.
   *
   * Surfaced so the storefront can offer a "resume payment" action for an
   * order that was created but never paid.
   */
  readonly paymentMethod: 'razorpay' | 'cod';
  readonly placedAt: string;
  readonly deliveredAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Returns                                                                    */
/* -------------------------------------------------------------------------- */

export const RETURN_REASONS = [
  'size-too-small',
  'size-too-large',
  'not-as-described',
  'damaged',
  'wrong-item',
  'changed-mind',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'refunded'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface ReturnRequest {
  readonly id: string;
  readonly returnNumber: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly customerId: string;
  readonly items: readonly OrderItem[];
  readonly reason: ReturnReason;
  readonly reasonNote: string;
  readonly status: ReturnStatus;
  readonly refundAmount: number;
  readonly refundRef: string | null;
  readonly requestedAt: string;
  readonly resolvedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export const COUPON_TYPES = ['percentage', 'fixed'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export interface Coupon {
  readonly id: string;
  readonly code: string;
  readonly type: CouponType;
  readonly value: number;
  readonly minOrderAmount: number;
  readonly maxDiscountAmount: number | null;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly usageLimit: number | null;
  readonly usedCount: number;
  readonly isActive: boolean;
  readonly description: string;
  /**
   * Restrict the coupon to specific products.
   *
   * Empty means it applies to the whole basket. When it is not empty, the
   * basket must contain at least one of these product codes for the
   * coupon to apply.
   */
  readonly productCodes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

export interface PaymentRecord {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly customerId: string;
  readonly amount: number;
  readonly currency: 'INR';
  readonly status: PaymentStatus;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly method: string | null;
  readonly failureReason: string | null;
  readonly capturedAt: string | null;
  readonly refundedAmount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Payment intent (Razorpay)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether the payment integration can actually be exercised.
 *
 * `false` is a first-class, expected state: the code is complete and
 * tested, but the credentials are absent. Callers must branch on it rather
 * than assume a payment is possible.
 */
export interface PaymentConfiguration {
  readonly configured: boolean;
  readonly mode: 'test' | 'live';
  /**
   * The publishable key id, safe to hand to the browser.
   *
   * `null` when unconfigured. The key **secret** is never in this shape.
   */
  readonly keyId: string | null;
  /** Whether webhook signatures can be verified. */
  readonly webhooksEnabled: boolean;
}

/**
 * Everything the browser needs to open Razorpay Checkout, and nothing else.
 *
 * `amount` is in **paise** (the smallest currency unit) because that is
 * what the Checkout form requires. It is derived from the server-calculated
 * order total, never from anything the client sent.
 */
export interface PaymentIntent {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly razorpayOrderId: string;
  /** Amount in paise. */
  readonly amount: number;
  readonly currency: 'INR';
  readonly totalAmountRupees: number;
  readonly keyId: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone: string;
  readonly paymentId: string | null;
}

/** The outcome of verifying a Checkout response. */
export interface PaymentVerificationResult {
  readonly verified: boolean;
  readonly status: PaymentStatus;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly paymentId: string | null;
  readonly amountRupees: number;
  /** Why verification did not succeed, when it did not. */
  readonly reason: string | null;
}

/* -------------------------------------------------------------------------- */
/* Shipping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shipment lifecycle, as **our** platform understands it.
 *
 * This is intentionally distinct from both the internal order status and
 * Shiprocket's own status vocabulary. The mapping is one-way and explicit:
 * a generated label is not a shipment, and a manifest is not a delivery.
 */
export const SHIPMENT_STATUSES = [
  'pending',
  'created',
  'awb_assigned',
  'manifested',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'failed',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * Whether the shipping integration can actually be exercised.
 *
 * `false` is expected until Shiprocket credentials exist. The API then
 * reports the setup that is missing instead of pretending to ship.
 */
export interface ShippingConfiguration {
  readonly configured: boolean;
  readonly pickupLocation: string | null;
  /** Whether tracking webhooks can be authenticated. */
  readonly webhooksEnabled: boolean;
  /** Setup steps still outstanding, surfaced in the admin UI. */
  readonly missing: readonly string[];
}

/**
 * The shipment as this platform understands it.
 *
 * Deliberately **separate** from the order status: an order can be
 * `processing` while a shipment is `awb_assigned`, and conflating the two
 * is how a store ends up telling a customer an order "shipped" when only a
 * label was generated.
 */
export interface Shipment {
  readonly id: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: ShipmentStatus;
  readonly provider: string;
  readonly providerOrderId: string | null;
  readonly providerShipmentId: string | null;
  readonly awbCode: string | null;
  readonly courierName: string | null;
  /** The provider's own status string, kept verbatim for diagnosis. */
  readonly trackingStatus: string | null;
  readonly trackingStatusId: number | null;
  readonly estimatedDelivery: string | null;
  readonly labelUrl: string | null;
  readonly pickupRequestedAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Store settings                                                             */
/* -------------------------------------------------------------------------- */

export interface StoreSettings {
  readonly storeName: string;
  readonly supportEmail: string;
  readonly supportPhone: string;
  readonly currency: 'INR';
  /** Flat shipping fee in whole rupees. */
  readonly shippingFee: number;
  /** Free-shipping threshold in whole rupees. 0 disables the threshold. */
  readonly freeShippingThreshold: number;
  /** GST rate in basis points (e.g. 500 = 5%). */
  readonly taxRateBps: number;
  readonly taxInclusive: boolean;
  readonly isCodEnabled: boolean;
  readonly announcement: string;
  readonly updatedAt: string;
}
