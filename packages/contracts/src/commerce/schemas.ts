import { z } from 'zod';
import {
  COUPON_TYPES,
  EXCHANGE_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  RETURN_REASONS,
  RETURN_STATUSES,
} from './types.js';
import { addressInputSchema, emailSchema, phoneSchema } from '../auth/schemas.js';
import { paginationQuerySchema } from '../common/schemas.js';

/**
 * Zod schemas for the commerce boundary.
 *
 * Every request that can create or mutate money is validated here, and
 * every *response* shape is validated too — the API asserts its own output
 * against these schemas in tests, so a contract drift is a test failure
 * rather than a surprise in the browser.
 */

/* -------------------------------------------------------------------------- */
/* Cart                                                                       */
/* -------------------------------------------------------------------------- */

export const addCartItemRequestSchema = z.object({
  variantId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid variant id'),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
});

export type AddCartItemRequest = z.infer<typeof addCartItemRequestSchema>;

export const updateCartItemRequestSchema = z.object({
  quantity: z.coerce.number().int().min(0).max(20),
});

export type UpdateCartItemRequest = z.infer<typeof updateCartItemRequestSchema>;

export const applyCouponRequestSchema = z.object({
  code: z.string().trim().min(1).max(40),
});

export type ApplyCouponRequest = z.infer<typeof applyCouponRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Checkout / orders                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Checkout payload.
 *
 * The client may reference a saved address by id, or supply a fresh one.
 * It may NOT supply prices, totals or discount amounts — those are computed
 * server-side from the live variant and coupon records. A client that sends
 * a price is ignoring it, and the server will not use it.
 */
export const checkoutRequestSchema = z
  .object({
    shippingAddressId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    shippingAddress: addressInputSchema.optional(),
    billingAddressId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/)
      .optional(),
    billingAddress: addressInputSchema.optional(),
    couponCode: z.string().trim().min(1).max(40).optional(),
    paymentMethod: z.enum(['razorpay', 'cod']),
    /**
     * A client-generated key, echoed for convenience.
     *
     * The **enforced** key is the `Idempotency-Key` *header*, which the
     * idempotency middleware requires. This body field is optional and
     * advisory: it is stored alongside the header value so a client can
     * correlate its own record, but the order's idempotency key is always
     * derived from the header — otherwise two clients sending the same
     * header with different body keys would produce two orders, which is
     * exactly what the header exists to prevent.
     */
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .refine((value) => value.shippingAddressId || value.shippingAddress, {
    message: 'A shipping address is required',
    path: ['shippingAddress'],
  });

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

export const orderStatusUpdateRequestSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
});

export type OrderStatusUpdateRequest = z.infer<typeof orderStatusUpdateRequestSchema>;

/**
 * Admin-side order filters.
 */
export const adminOrderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  customerId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  orderNumber: z.string().trim().max(40).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The Checkout response the browser returns from Razorpay.
 *
 * Every field is required and format-constrained. An absent or malformed
 * signature is rejected before any database write happens, so a partially
 * populated body cannot advance an order.
 */
export const verifyPaymentRequestSchema = z.object({
  razorpay_payment_id: z
    .string()
    .trim()
    .regex(/^pay_[A-Za-z0-9_]+$/, 'Must be a Razorpay payment id'),
  razorpay_order_id: z
    .string()
    .trim()
    .regex(/^order_[A-Za-z0-9_]+$/, 'Must be a Razorpay order id'),
  razorpay_signature: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, 'Must be a hex SHA-256 signature'),
});

export type VerifyPaymentRequest = z.infer<typeof verifyPaymentRequestSchema>;

/**
 * Refund initiation payload.
 *
 * `amount` is optional on purpose. When omitted the server refunds the full
 * remaining refundable balance, which is the only amount that can never be
 * wrong. A caller that supplies an amount larger than the balance is
 * rejected rather than clamped, because a silently reduced refund is a
 * support incident.
 */
export const initiateRefundRequestSchema = z.object({
  amount: z.coerce.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
});

export type InitiateRefundRequest = z.infer<typeof initiateRefundRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Shipping                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shipment creation payload.
 *
 * A courier id may be pinned, otherwise the account's configured courier is
 * used (or Shiprocket chooses from the serviceable list).
 */
export const createShipmentRequestSchema = z.object({
  /** Optional courier id override. Defaults to the account's configured courier. */
  courierId: z.coerce.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
});

export type CreateShipmentRequest = z.infer<typeof createShipmentRequestSchema>;

export const cancelShipmentRequestSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export type CancelShipmentRequest = z.infer<typeof cancelShipmentRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Returns                                                                    */
/* -------------------------------------------------------------------------- */

export const createReturnRequestSchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid order id'),
  items: z
    .array(
      z.object({
        variantId: z.string().regex(/^[0-9a-fA-F]{24}$/),
        quantity: z.coerce.number().int().min(1).max(20),
      }),
    )
    .min(1, 'At least one item must be returned'),
  reason: z.enum(RETURN_REASONS),
  reasonNote: z.string().trim().max(1000).default(''),
});

export type CreateReturnRequest = z.infer<typeof createReturnRequestSchema>;

export const createExchangeRequestSchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid order id'),
  originalVariantId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid variant id'),
  replacementVariantId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid variant id'),
  quantity: z.coerce.number().int().min(1).max(20),
  reasonNote: z.string().trim().max(1000).default(''),
});

export type CreateExchangeRequest = z.infer<typeof createExchangeRequestSchema>;

export const exchangeOptionsQuerySchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  originalVariantId: z.string().regex(/^[0-9a-fA-F]{24}$/),
});

export type ExchangeOptionsQuery = z.infer<typeof exchangeOptionsQuerySchema>;

export const adminExchangeQuerySchema = paginationQuerySchema.extend({
  status: z.enum(EXCHANGE_STATUSES).optional(),
  orderId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
});

export type AdminExchangeQuery = z.infer<typeof adminExchangeQuerySchema>;

export const resolveExchangeRequestSchema = z.object({
  status: z.enum(['approved', 'rejected', 'received', 'replacement-shipped', 'completed']),
  note: z.string().trim().max(500).default(''),
});

export type ResolveExchangeRequest = z.infer<typeof resolveExchangeRequestSchema>;

/**
 * The staff transition on a return: approve, reject, or confirm receipt and inspection.
 *
 * `refunded` is deliberately **absent** from this enum. It is only set after
 * the payment provider confirms that money was returned.
 *
 * A return reaching `refunded` means the customer has their money back. That
 * is a statement about the world, not an administrative decision — it can
 * only be true once the payment provider has confirmed the refund. Accepting
 * it here would let any administrator mark an order `refunded` with a single
 * PATCH, with no money ever moving and the customer simply not being paid.
 *
 * The only route that may produce this state is
 * `POST /v1/admin/returns/:returnId/refund`, which issues the refund at the
 * provider and then waits for the provider to confirm it.
 */
export const resolveReturnRequestSchema = z.object({
  status: z.enum(['approved', 'rejected', 'received']),
  refundAmount: z.coerce.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).optional(),
});

/** What staff may record on a return. Receipt is operational; `refunded` is excluded. */
export type ResolveReturnStatus = 'approved' | 'rejected' | 'received';

export type ResolveReturnRequest = z.infer<typeof resolveReturnRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Coupons                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The coupon fields, declared without defaults.
 *
 * The defaults live in `couponInputShape` (the create schema) and are
 * deliberately absent here. `updateCouponRequestSchema` is a PATCH
 * contract: if the defaulted fields carried their defaults here, a request
 * that only changed `value` would also reset `isActive` to `true`,
 * `description` to `''` and `minOrderAmount` to `0` — because the route
 * applies the parsed body with `$set`. A PATCH must only ever write the
 * fields the client actually sent.
 */
const couponFields = {
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may contain letters, digits, hyphen and underscore only')
    .transform((value) => value.toUpperCase()),
  type: z.enum(COUPON_TYPES),
  value: z.coerce.number().int().positive(),
  minOrderAmount: z.coerce.number().int().nonnegative(),
  maxDiscountAmount: z.coerce.number().int().positive().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  usageLimit: z.coerce.number().int().positive().nullable(),
  isActive: z.boolean(),
  description: z.string().trim().max(300),
  /**
   * Restrict the coupon to specific product codes.
   *
   * Empty means it applies to the whole basket. The field is exposed here
   * because it was previously stored but never settable and never
   * enforced — a coupon that looked product-scoped but discounted the
   * entire basket.
   *
   * It carries **no default** here, because `couponFields` is also the
   * base of the PATCH contract: a defaulted field would be reset to `[]`
   * by a request that only changed `value`. The default lives in
   * `couponInputShape` instead.
   */
  productCodes: z.array(z.string().trim().min(1).max(40)).max(100),
};

/**
 * The create contract: every field is present, and the optional ones carry
 * their defaults.
 */
const couponInputShape = {
  ...couponFields,
  minOrderAmount: couponFields.minOrderAmount.default(0),
  maxDiscountAmount: couponFields.maxDiscountAmount.default(null),
  endsAt: couponFields.endsAt.default(null),
  usageLimit: couponFields.usageLimit.default(null),
  isActive: couponFields.isActive.default(true),
  description: couponFields.description.default(''),
  productCodes: couponFields.productCodes.default([]),
};

/**
 * The cross-field rules for a coupon.
 *
 * They are expressed as a standalone function so that the same rules can be
 * attached to both the create schema and the update schema. Zod 4 refuses to
 * call `.partial()` on a schema that already carries a refinement, so the
 * refinement cannot live on the object the update schema is derived from.
 */
function refineCoupon(
  value: {
    type?: (typeof COUPON_TYPES)[number] | undefined;
    value?: number | undefined;
    startsAt?: string | undefined;
    endsAt?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === 'percentage' && value.value !== undefined && value.value > 100) {
    ctx.addIssue({
      code: 'custom',
      message: 'A percentage coupon cannot exceed 100',
      path: ['value'],
    });
  }
  if (value.endsAt && value.startsAt && new Date(value.endsAt) <= new Date(value.startsAt)) {
    ctx.addIssue({
      code: 'custom',
      message: 'endsAt must be after startsAt',
      path: ['endsAt'],
    });
  }
}

export const couponInputSchema = z.object(couponInputShape).superRefine(refineCoupon);

export type CouponInput = z.infer<typeof couponInputSchema>;

/**
 * The update contract.
 *
 * Every field is optional, `code` is immutable, and the cross-field rules
 * are only applied to the fields the request actually carries — the server
 * holds the stored value of the rest.
 */
export const updateCouponRequestSchema = z
  .object(couponFields)
  .partial()
  .omit({ code: true })
  .superRefine(refineCoupon);

export type UpdateCouponRequest = z.infer<typeof updateCouponRequestSchema>;

export const validateCouponRequestSchema = z.object({
  code: z.string().trim().min(1).max(40),
  /**
   * The subtotal the client believes it has.
   *
   * **Ignored for a signed-in caller** — the server computes the preview
   * against the customer's own cart instead, so a client cannot use this
   * endpoint to price a coupon against an arbitrary basket. Used only for
   * an unauthenticated caller, and even then no discount amount is
   * disclosed.
   */
  subtotal: z.coerce.number().int().nonnegative(),
});

export type ValidateCouponRequest = z.infer<typeof validateCouponRequestSchema>;

/**
 * The admin return-list query.
 *
 * Validated so that an unknown `status` is a 422 rather than a silently
 * empty list — which would read as "there are no returns" when it actually
 * means "you typed the filter wrong".
 */
export const adminReturnQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RETURN_STATUSES).optional(),
  orderId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'orderId must be a MongoDB ObjectId')
    .optional(),
});

export type AdminReturnQuery = z.infer<typeof adminReturnQuerySchema>;

/**
 * The admin coupon-preview body.
 *
 * Validated, so a non-numeric `subtotal` is a 422 rather than `NaN` being
 * propagated into `discountAmount` and `totalAfterDiscount` — which would
 * serialise as `null` in JSON and read as a real answer.
 */
export const couponPreviewRequestSchema = z.object({
  subtotal: z.coerce.number().int().nonnegative().max(100_000_000),
});

export type CouponPreviewRequest = z.infer<typeof couponPreviewRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Store settings                                                             */
/* -------------------------------------------------------------------------- */

export const storeSettingsInputSchema = z.object({
  storeName: z.string().trim().min(1).max(120),
  supportEmail: emailSchema,
  supportPhone: phoneSchema,
  shippingFee: z.coerce.number().int().nonnegative(),
  freeShippingThreshold: z.coerce.number().int().nonnegative(),
  taxRateBps: z.coerce.number().int().min(0).max(10_000),
  taxInclusive: z.boolean(),
  isCodEnabled: z.boolean(),
  announcement: z.string().trim().max(500),
});

export type StoreSettingsInput = z.infer<typeof storeSettingsInputSchema>;

/* -------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* -------------------------------------------------------------------------- */

export const cartItemSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  productId: z.string(),
  slug: z.string(),
  title: z.string(),
  colour: z.string(),
  size: z.number().int(),
  imageUrl: z.string().nullable(),
  unitPrice: z.number().int().nonnegative(),
  mrp: z.number().int().nonnegative(),
  quantity: z.number().int().nonnegative(),
  lineTotal: z.number().int().nonnegative(),
  isAvailable: z.boolean(),
  availableStock: z.number().int().nonnegative(),
});

export const appliedCouponSchema = z.object({
  code: z.string(),
  type: z.enum(COUPON_TYPES),
  value: z.number().int().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
});

export const cartSchema = z.object({
  id: z.string(),
  items: z.array(cartItemSchema),
  coupon: appliedCouponSchema.nullable(),
  itemCount: z.number().int().nonnegative(),
  subtotal: z.number().int().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
  shippingFee: z.number().int().nonnegative(),
  taxAmount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
  currency: z.literal('INR'),
  updatedAt: z.string(),
});

export const orderItemSchema = z.object({
  productId: z.string(),
  variantId: z.string(),
  sku: z.string(),
  title: z.string(),
  imageUrl: z.string().nullable(),
  colour: z.string(),
  size: z.number().int(),
  unitPrice: z.number().int().nonnegative(),
  mrp: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  lineTotal: z.number().int().nonnegative(),
});

export const orderAddressSchema = z.object({
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  postalCode: z.string(),
  country: z.string(),
});

export const orderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  items: z.array(orderItemSchema),
  subtotal: z.number().int().nonnegative(),
  shippingFee: z.number().int().nonnegative(),
  taxAmount: z.number().int().nonnegative(),
  discountAmount: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
  currency: z.literal('INR'),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  couponCode: z.string().nullable(),
  shippingAddress: orderAddressSchema,
  billingAddress: orderAddressSchema,
  paymentRef: z.string().nullable(),
  placedAt: z.string(),
  deliveredAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const returnRequestSchema = z.object({
  id: z.string(),
  returnNumber: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  customerId: z.string(),
  items: z.array(orderItemSchema),
  reason: z.enum(RETURN_REASONS),
  reasonNote: z.string(),
  status: z.enum(RETURN_STATUSES),
  refundAmount: z.number().int().nonnegative(),
  refundRef: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  requestedAt: z.string(),
  resolvedAt: z.string().nullable(),
});

export const couponSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: z.enum(COUPON_TYPES),
  value: z.number().int().nonnegative(),
  minOrderAmount: z.number().int().nonnegative(),
  maxDiscountAmount: z.number().int().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  usageLimit: z.number().int().nullable(),
  usedCount: z.number().int().nonnegative(),
  isActive: z.boolean(),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const storeSettingsSchema = z.object({
  storeName: z.string(),
  supportEmail: z.string(),
  supportPhone: z.string(),
  currency: z.literal('INR'),
  shippingFee: z.number().int().nonnegative(),
  freeShippingThreshold: z.number().int().nonnegative(),
  taxRateBps: z.number().int().nonnegative(),
  taxInclusive: z.boolean(),
  isCodEnabled: z.boolean(),
  announcement: z.string(),
  updatedAt: z.string(),
});
