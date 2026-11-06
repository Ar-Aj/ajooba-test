import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Orders.
 *
 * An order is a **immutable snapshot** of a purchase. The item rows are
 * written once, at checkout, and are never updated: a later catalogue
 * price change, a product rename or a stock correction cannot rewrite
 * what a customer was charged.
 *
 * The totals on the document are also frozen. The API recomputes them from
 * the frozen line items at write time and asserts that the sum matches
 * before the order is persisted.
 */

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    /** The SKU as it was at the moment of purchase. */
    sku: { type: String, required: true },
    /** The title as it was at the moment of purchase. */
    title: { type: String, required: true },
    imageUrl: { type: String },
    colour: { type: String, required: true },
    size: { type: Number, required: true },
    /** The unit price charged, in whole rupees. */
    unitPrice: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 20 },
    /** `unitPrice * quantity`, frozen at checkout. */
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const orderAddressSchema = new Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, default: 'India' },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    /** Human-readable, unique. Used by customers in support conversations. */
    orderNumber: { type: String, required: true, unique: true, index: true },
    customerId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** Denormalised for the admin order list and for order confirmation. */
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },

    items: { type: [orderItemSchema], required: true },

    /** Sum of `lineTotal`. */
    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
    /** `subtotal - discountAmount + shippingFee + taxAmount`. */
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'INR' },

    status: {
      type: String,
      required: true,
      enum: ['placed', 'processing', 'shipped', 'completed', 'cancelled'],
      default: 'placed',
      index: true,
    },
    paymentStatus: {
      type: String,
      required: true,
      enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
      index: true,
    },

    couponCode: { type: String, default: '' },
    shippingAddress: { type: orderAddressSchema, required: true },
    billingAddress: { type: orderAddressSchema, required: true },

    /** The gateway reference, once payment is captured. */
    paymentRef: { type: String },
    /** How the customer intends to pay. */
    paymentMethod: { type: String, required: true, enum: ['razorpay', 'cod'] },

    /**
     * The client-supplied idempotency key. It makes a retried checkout
     * return the original order instead of creating a second one.
     */
    idempotencyKey: { type: String, index: true },

    placedAt: { type: Date, required: true, default: Date.now },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    /** Why the order was cancelled, when it was. */
    cancellationReason: { type: String },
    /** Free-form notes added by the fulfilment team. */
    notes: { type: String },
  },
  {
    timestamps: true,
    collection: 'orders',
  },
);

// The customer's own order list, newest first.
orderSchema.index({ customerId: 1, createdAt: -1 });
// The admin order list, filtered by status and window.
orderSchema.index({ status: 1, createdAt: -1 });
// The admin revenue report over a date window.
orderSchema.index({ createdAt: -1, paymentStatus: 1 });
// A customer's idempotency key must be unique, so a double-tap cannot
// create two orders.
orderSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type OrderDocument = InferSchemaType<typeof orderSchema>;
export const OrderModel = mongoose.model('Order', orderSchema);
