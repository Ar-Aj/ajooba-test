import { Types } from 'mongoose';
import type { Order, OrderAddress, OrderItem, OrderStatus, PaymentStatus } from '@ajooba/contracts';
import { ConflictError, NotFoundError } from '../core/errors.js';
import { OrderModel } from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { StockMovementModel } from '../models/stock-movement.model.js';
import { VariantModel } from '../models/variant.model.js';
import { buildOrderNumber } from './password.service.js';
import { priceBasket, toDiscountRule } from './pricing.service.js';
import { resolveCoupon } from './cart.service.js';
import { getStoreSettings } from './store-settings.service.js';
import { recordActivityEvent } from './analytics.service.js';
import { writeAuditLog } from './audit.service.js';
import { logger } from '../config/logger.js';

/**
 * Order and checkout service.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **No overselling.** Stock is decremented with a single conditional
 *     MongoDB update — `stock >= quantity` is part of the filter, not a
 *     check that happens before the write. Two customers racing for the
 *     last pair cannot both win, because only one update can match.
 *  2. **Immutable snapshots.** The order items, the totals and the address
 *     are written once and never updated. A later catalogue change cannot
 *     rewrite what a customer was charged.
 *
 * If any step of the checkout fails part way through, everything that was
 * already done is undone, so a failed checkout never leaves stock
 * decremented without an order.
 */

/* -------------------------------------------------------------------------- */
/* Order state machine                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The legal transitions of an order.
 *
 * `cancelled` and `completed` are terminal. A transition that is not in
 * this table is rejected server-side — the admin API never accepts an
 * arbitrary status.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    placed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  });

/**
 * Can an order move from one status to another?
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The shape `returnStockForOrder` needs.
 *
 * Exported so `refund.service.ts` can type its own lookup against it rather
 * than re-deriving the shape with an inline `import()` type, which the
 * `consistent-type-imports` rule (rightly) forbids.
 */
export interface OrderDoc {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: OrderItem[];
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  couponCode: string;
  shippingAddress: OrderAddress;
  billingAddress: OrderAddress;
  paymentRef?: string;
  paymentMethod: string;
  placedAt: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  /** Why the order was cancelled, when it was. */
  cancellationReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Project an order document into the public order shape.
 */
export function mapOrder(doc: OrderDoc): Order {
  return {
    id: doc._id.toString(),
    orderNumber: doc.orderNumber,
    customerId: doc.customerId.toString(),
    customerName: doc.customerName,
    customerEmail: doc.customerEmail,
    customerPhone: doc.customerPhone,
    items: doc.items,
    subtotal: doc.subtotal,
    shippingFee: doc.shippingFee,
    taxAmount: doc.taxAmount,
    discountAmount: doc.discountAmount,
    totalAmount: doc.totalAmount,
    currency: 'INR',
    status: doc.status,
    paymentStatus: doc.paymentStatus,
    couponCode: doc.couponCode || null,
    shippingAddress: doc.shippingAddress,
    billingAddress: doc.billingAddress,
    paymentRef: doc.paymentRef ?? null,
    paymentMethod: doc.paymentMethod as Order['paymentMethod'],
    placedAt: doc.placedAt.toISOString(),
    deliveredAt: doc.deliveredAt ? doc.deliveredAt.toISOString() : null,
    cancelledAt: doc.cancelledAt ? doc.cancelledAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Stock                                                                      */
/* -------------------------------------------------------------------------- */

interface VariantDoc {
  _id: Types.ObjectId;
  sku: string;
  productId: Types.ObjectId;
  productCode: string;
  size: number;
  colour: string;
  sellingPrice: number;
  mrp: number;
  stock: number;
  reservedStock: number;
  imageUrl?: string;
}

/**
 * Reserve stock for a line.
 *
 * The `stock: { $gte: quantity }` clause is part of the **filter**, so the
 * decrement and the availability check are a single atomic operation. If
 * another checkout took the last unit first, this update matches nothing
 * and the caller is told the item is out of stock.
 *
 * The units are moved from `stock` into `reservedStock` rather than simply
 * removed, so a failed checkout can put them back exactly.
 */
export async function reserveStock(
  variantId: Types.ObjectId,
  quantity: number,
): Promise<{ variant: VariantDoc; stockBefore: number } | null> {
  /*
   * The photography clause is part of the filter, so the check and the
   * decrement stay one atomic operation: a colourway held for review matches
   * nothing here and no stock moves, exactly like an out-of-stock size. This is
   * the server-side guarantee that a colour we cannot photograph truthfully can
   * never be ordered — the storefront merely reflects it.
   *
   * Documents written before this field existed have no `photographyStatus`, so
   * they must still match; `$ne: 'pending-review'` covers both.
   */
  const updated = await VariantModel.findOneAndUpdate(
    {
      _id: variantId,
      stock: { $gte: quantity },
      photographyStatus: { $ne: 'pending-review' },
    },
    { $inc: { stock: -quantity, reservedStock: quantity } },
    { returnDocument: 'after' },
  ).lean<VariantDoc | null>();

  if (!updated) {
    return null;
  }

  return { variant: updated, stockBefore: updated.stock + quantity };
}

/**
 * Release a reservation — the stock goes back, the reservation is removed.
 *
 * The filter asserts that the reservation being released is actually
 * there. `updateOne` does **not** run schema validators, so the `min: 0`
 * on `reservedStock` is not enforced on an `$inc` path — an unfiltered
 * decrement could drive the counter negative and leave the variant
 * permanently un-sellable, because availability is computed against it.
 */
export async function releaseStock(variantId: Types.ObjectId, quantity: number): Promise<void> {
  await VariantModel.updateOne(
    { _id: variantId, reservedStock: { $gte: quantity } },
    { $inc: { stock: quantity, reservedStock: -quantity } },
  );
}

/**
 * Commit a reservation — the stock is consumed and the reservation cleared.
 *
 * The same guard as `releaseStock`: the decrement only happens if the
 * reservation is actually there, so a double commit cannot drive
 * `reservedStock` negative.
 */
export async function commitStock(variantId: Types.ObjectId, quantity: number): Promise<void> {
  await VariantModel.updateOne(
    { _id: variantId, reservedStock: { $gte: quantity } },
    { $inc: { reservedStock: -quantity } },
  );
}

/**
 * The units of a variant that are free to sell.
 *
 * Re-exported from `stock.service` so the order service has the helper
 * without taking a dependency on the cart service.
 */
import { availableUnits } from './stock.service.js';

/**
 * Roll the product-level `inStock` rollup back into agreement with its
 * variants.
 *
 * Exported because a refund restores stock too, and the product flag has
 * to follow.
 */
export async function refreshProductInStock(productIds: Types.ObjectId[]): Promise<void> {
  if (productIds.length === 0) {
    return;
  }
  const counts = await VariantModel.aggregate<{ _id: Types.ObjectId; inStock: number }>([
    { $match: { productId: { $in: productIds } } },
    { $group: { _id: '$productId', inStock: { $sum: { $cond: ['$inStock', 1, 0] } } } },
  ]);

  const inStockIds = counts.filter((row) => row.inStock > 0).map((row) => row._id);
  const outOfStockIds = productIds.filter((id) => !inStockIds.some((x) => x.equals(id)));

  await Promise.all([
    ProductModel.updateMany({ _id: { $in: inStockIds } }, { $set: { inStock: true } }),
    ProductModel.updateMany({ _id: { $in: outOfStockIds } }, { $set: { inStock: false } }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                   */
/* -------------------------------------------------------------------------- */

export interface CheckoutLine {
  readonly variantId: string;
  readonly quantity: number;
}

export interface CheckoutInput {
  readonly customerId: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone: string;
  readonly shippingAddress: OrderAddress;
  readonly billingAddress: OrderAddress;
  readonly couponCode?: string;
  readonly paymentMethod: 'razorpay' | 'cod';
  readonly idempotencyKey: string;
  /**
   * The lines being purchased. Only the variant and the quantity are
   * accepted — the client never supplies a price, a discount or a total.
   */
  readonly lines: readonly CheckoutLine[];
}

/**
 * Place an order.
 *
 * The sequence is:
 *
 *  1. **Check** — an order with this idempotency key already exists? Then
 *     return it. This is what makes a double-tap safe.
 *  2. **Reserve** — decrement the stock for every line, atomically. If any
 *     line cannot be satisfied, everything already reserved is released
 *     and the checkout fails.
 *  3. **Price** — compute the totals from the *live* variant prices, and
 *     assert that the arithmetic holds.
 *  4. **Write** — persist the order with its frozen snapshot.
 *  5. **Settle** — commit the reservations, record the stock movements and
 *     the activity event.
 *
 * If step 4 fails, step 2 is undone, so a failed checkout never leaves
 * stock decremented without an order.
 */
export async function placeOrder(input: CheckoutInput): Promise<Order> {
  /*
   * Step 1 — idempotency. The unique index on
   * (customerId, idempotencyKey) is the real guarantee; this read makes
   * the common case cheap and gives a clean error for the racing case.
   */
  const existing = await OrderModel.findOne({
    customerId: new Types.ObjectId(input.customerId),
    idempotencyKey: input.idempotencyKey,
  }).lean<OrderDoc | null>();

  if (existing) {
    return mapOrder(existing);
  }

  const settings = await getStoreSettings();

  if (input.paymentMethod === 'cod' && !settings.isCodEnabled) {
    throw new ConflictError('Cash on delivery is not available right now. Choose online payment.');
  }

  // Load the live variants for the lines. The caller supplies variant ids
  // and quantities — never prices.
  const variantIds = input.lines.map((line) => line.variantId);
  const lines = await VariantModel.find({
    _id: { $in: variantIds },
  }).lean<VariantDoc[]>();

  if (lines.length === 0) {
    throw new ConflictError('Your cart is empty.');
  }

  const linesById = new Map(lines.map((line) => [line._id.toString(), line]));

  // --- Step 2: reserve stock, atomically ---------------------------------
  const reserved: Array<{ variant: VariantDoc; quantity: number; stockBefore: number }> = [];

  /*
   * The coupon code whose single use this attempt claimed.
   *
   * Declared out here because the `catch` below has to be able to give it
   * back — a failed order write must not consume a limited coupon's usage.
   */
  let claimedCoupon: string | null = null;

  try {
    for (const line of input.lines) {
      const variant = linesById.get(line.variantId);
      if (!variant) {
        throw new ConflictError('An item in your cart is no longer available.');
      }
      if (line.quantity > 20) {
        throw new ConflictError('You can order at most 20 units of the same item.');
      }

      const result = await reserveStock(variant._id, line.quantity);
      if (!result) {
        const available = availableUnits(variant);
        throw new ConflictError(
          available === 0
            ? `"${variant.sku}" (size ${variant.size}) just went out of stock.`
            : `Only ${available} unit(s) of "${variant.sku}" (size ${variant.size}) remain.`,
        );
      }

      reserved.push({
        variant: result.variant,
        quantity: line.quantity,
        stockBefore: result.stockBefore,
      });
    }

    // --- Step 3: price from the live data --------------------------------
    const priceLines = reserved.map((entry) => ({
      unitPrice: entry.variant.sellingPrice,
      quantity: entry.quantity,
    }));

    const subtotal = priceLines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);

    let couponRule = null;
    let couponCode = '';
    if (input.couponCode) {
      /*
       * The basket's product codes are needed to evaluate a
       * product-restricted coupon. The variants carry `productCode`
       * directly, so no extra read is required.
       */
      const basketProductCodes = [
        ...new Set(reserved.map((entry) => entry.variant.productCode).filter(Boolean)),
      ];

      const resolved = await resolveCoupon(input.couponCode, subtotal, basketProductCodes);
      if ('error' in resolved) {
        throw new ConflictError(resolved.error);
      }
      couponRule = toDiscountRule(resolved.coupon);
      couponCode = resolved.coupon.code;
    }

    const breakdown = priceBasket(priceLines, settings, couponRule);

    if (input.paymentMethod === 'cod' && breakdown.totalAmount > 10_000) {
      throw new ConflictError('Cash on delivery is available for orders up to ₹10,000.');
    }

    // The frozen line items. Prices come from the live variant at the
    // moment of purchase and never change afterwards.
    const productIds = reserved.map((entry) => entry.variant.productId);
    const productDocs = await ProductModel.find({ _id: { $in: productIds } })
      .select('title')
      .lean<Array<{ _id: Types.ObjectId; title: string }>>();
    const titlesById = new Map(productDocs.map((doc) => [doc._id.toString(), doc.title]));

    const items: OrderItem[] = reserved.map((entry) => ({
      productId: entry.variant.productId.toString(),
      variantId: entry.variant._id.toString(),
      sku: entry.variant.sku,
      title: titlesById.get(entry.variant.productId.toString()) ?? entry.variant.sku,
      imageUrl: entry.variant.imageUrl ?? null,
      colour: entry.variant.colour,
      size: entry.variant.size,
      unitPrice: entry.variant.sellingPrice,
      mrp: entry.variant.mrp,
      quantity: entry.quantity,
      lineTotal: entry.variant.sellingPrice * entry.quantity,
    }));

    /*
     * Assert the arithmetic before the write. If the pricing engine and
     * the frozen line items ever disagree, the checkout fails loudly
     * rather than storing an order whose total does not match its lines.
     */
    const lineSum = items.reduce((total, item) => total + item.lineTotal, 0);
    if (lineSum !== breakdown.subtotal) {
      throw new ConflictError('The order total could not be verified. Please try again.');
    }
    const expectedTotal =
      breakdown.subtotal - breakdown.discountAmount + breakdown.shippingFee + breakdown.taxAmount;
    if (expectedTotal !== breakdown.totalAmount) {
      throw new ConflictError('The order total could not be verified. Please try again.');
    }

    /*
     * Claim one use of the coupon, atomically, **before** the order is
     * written.
     *
     * The eligibility check above is a read. Between that read and this
     * claim, another checkout could take the last remaining use of a
     * limited coupon — so the claim itself is what enforces the limit,
     * and it is released again if the order write fails.
     */
    if (couponCode) {
      const claimed = await claimCouponUse(couponCode);
      if (!claimed) {
        throw new ConflictError(
          'That coupon was claimed by another order while you were checking out. ' +
            'Please remove it and try again.',
        );
      }
      claimedCoupon = couponCode;
    }

    // --- Step 4: write the order -----------------------------------------
    let created: OrderDoc;
    try {
      const doc = await OrderModel.create({
        orderNumber: buildOrderNumber(),
        customerId: new Types.ObjectId(input.customerId),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        items,
        subtotal: breakdown.subtotal,
        shippingFee: breakdown.shippingFee,
        taxAmount: breakdown.taxAmount,
        discountAmount: breakdown.discountAmount,
        totalAmount: breakdown.totalAmount,
        currency: 'INR',
        status: 'placed',
        paymentStatus: input.paymentMethod === 'cod' ? 'pending' : 'pending',
        couponCode,
        shippingAddress: input.shippingAddress,
        billingAddress: input.billingAddress,
        paymentMethod: input.paymentMethod,
        idempotencyKey: input.idempotencyKey,
        placedAt: new Date(),
      });
      created = doc as unknown as OrderDoc;
    } catch (error) {
      /*
       * A duplicate-key error here means a concurrent request with the
       * same idempotency key won the race. Return that order rather than
       * failing — the customer gets exactly one order either way.
       */
      const raced = await OrderModel.findOne({
        customerId: new Types.ObjectId(input.customerId),
        idempotencyKey: input.idempotencyKey,
      }).lean<OrderDoc | null>();

      if (raced) {
        await releaseAll(reserved);
        return mapOrder(raced);
      }
      throw error;
    }

    // --- Step 5: settle ---------------------------------------------------
    await Promise.all(reserved.map((entry) => commitStock(entry.variant._id, entry.quantity)));

    await StockMovementModel.insertMany(
      reserved.map((entry) => ({
        variantId: entry.variant._id,
        sku: entry.variant.sku,
        productCode: entry.variant.productCode,
        delta: -entry.quantity,
        stockBefore: entry.stockBefore,
        stockAfter: entry.stockBefore - entry.quantity,
        reason: 'sale' as const,
        note: `Order ${created.orderNumber}`,
        actorId: null,
        actorLabel: 'system',
        orderId: created._id,
      })),
    );

    await refreshProductInStock(productIds);

    await recordActivityEvent({
      event: 'order_completed',
      sessionId: `order:${created.orderNumber}`,
      customerId: input.customerId,
      orderId: created._id.toString(),
      value: created.totalAmount,
    });

    return mapOrder(created);
  } catch (error) {
    // Undo every reservation that was made before the failure.
    await releaseAll(reserved);
    // ...and give back the coupon use that was claimed for this attempt.
    if (claimedCoupon) {
      await releaseCouponClaim(claimedCoupon);
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Coupon claims                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Claim one use of a coupon, atomically.
 *
 * The claim is a single conditional update, so two concurrent checkouts
 * cannot both take the last remaining use of a limited coupon:
 *
 * ```
 * { code, isActive: true,
 *   $or: [ { usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } } ] }
 * ```
 *
 * `usageLimit: null` means unlimited, and the `$expr` comparison enforces
 * the limit **inside the filter** rather than in a read-then-write that
 * another request could interleave with.
 *
 * A `null` result means the coupon is exhausted or was withdrawn between
 * the eligibility check and this claim. That is a `409`, not a silent
 * no-discount order — the customer was promised a discount, and quietly
 * charging full price is worse than asking them to retry.
 *
 * The claim is taken **before** the order is written and released if the
 * write fails, so a failed checkout does not burn a coupon use.
 */
export async function claimCouponUse(code: string): Promise<boolean> {
  const { CouponModel } = await import('../models/coupon.model.js');

  const claimed = await CouponModel.findOneAndUpdate(
    {
      code,
      isActive: true,
      $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
    },
    { $inc: { usedCount: 1 } },
    { returnDocument: 'after' },
  ).lean<{ code: string } | null>();

  return claimed !== null;
}

/**
 * Release a coupon claim.
 *
 * Called when the order write fails after the claim was taken, so a failed
 * checkout does not consume a limited coupon's usage.
 */
export async function releaseCouponClaim(code: string): Promise<void> {
  const { CouponModel } = await import('../models/coupon.model.js');
  await CouponModel.updateOne({ code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

/**
 * Release a set of reservations.
 */
async function releaseAll(
  reserved: Array<{ variant: VariantDoc; quantity: number }>,
): Promise<void> {
  await Promise.all(reserved.map((entry) => releaseStock(entry.variant._id, entry.quantity)));
}

/* -------------------------------------------------------------------------- */
/* Order queries                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Fetch an order by its order number.
 */
export async function getOrderByNumber(orderNumber: string): Promise<Order | null> {
  const doc = await OrderModel.findOne({ orderNumber }).lean<OrderDoc | null>();
  return doc ? mapOrder(doc) : null;
}

/**
 * Fetch an order by its id.
 */
export async function getOrderById(id: string): Promise<Order | null> {
  if (!Types.ObjectId.isValid(id)) {
    return null;
  }
  const doc = await OrderModel.findById(id).lean<OrderDoc | null>();
  return doc ? mapOrder(doc) : null;
}

/**
 * Fetch an order that belongs to a specific customer.
 *
 * This is the **ownership check**: a customer asking for an order that is
 * not theirs gets a 404, not a 403, so the endpoint cannot be used to
 * discover which order ids exist.
 */
export async function getOrderForCustomer(
  orderId: string,
  customerId: string,
): Promise<Order | null> {
  if (!Types.ObjectId.isValid(orderId)) {
    return null;
  }
  const doc = await OrderModel.findOne({
    _id: new Types.ObjectId(orderId),
    customerId: new Types.ObjectId(customerId),
  }).lean<OrderDoc | null>();

  return doc ? mapOrder(doc) : null;
}

/**
 * List a customer's own orders, newest first.
 */
export async function listCustomerOrders(
  customerId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: Order[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const filter = { customerId: new Types.ObjectId(customerId) };

  const [docs, totalItems] = await Promise.all([
    OrderModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<OrderDoc[]>(),
    OrderModel.countDocuments(filter),
  ]);

  return {
    items: docs.map(mapOrder),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

/**
 * List orders for the admin panel.
 */
export async function listAdminOrders(
  filter: {
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    customerId?: string;
    orderNumber?: string;
    from?: Date;
    to?: Date;
  },
  page: number,
  pageSize: number,
): Promise<{
  items: Order[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};

  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.paymentStatus) {
    query.paymentStatus = filter.paymentStatus;
  }
  if (filter.customerId && Types.ObjectId.isValid(filter.customerId)) {
    query.customerId = new Types.ObjectId(filter.customerId);
  }
  if (filter.orderNumber) {
    query.orderNumber = filter.orderNumber;
  }
  if (filter.from || filter.to) {
    const range: { $gte?: Date; $lte?: Date } = {};
    if (filter.from) range.$gte = filter.from;
    if (filter.to) range.$lte = filter.to;
    query.placedAt = range;
  }

  const [docs, totalItems] = await Promise.all([
    OrderModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<OrderDoc[]>(),
    OrderModel.countDocuments(query),
  ]);

  return {
    items: docs.map(mapOrder),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

/* -------------------------------------------------------------------------- */
/* Status transitions                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Move an order to a new status.
 *
 * The transition is validated against the state machine. A cancelled
 * order's stock is returned to the catalogue.
 */
export async function updateOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
  note?: string,
): Promise<Order> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw new NotFoundError('Order');
  }

  const order = await OrderModel.findById(orderId).lean<OrderDoc | null>();
  if (!order) {
    throw new NotFoundError('Order');
  }

  if (order.status === nextStatus) {
    // Idempotent: moving to the status it is already in is a no-op, not
    // an error. A retried request must not fail.
    return mapOrder(order);
  }

  if (!canTransition(order.status, nextStatus)) {
    throw new ConflictError(`An order in "${order.status}" cannot move to "${nextStatus}".`);
  }

  const update: Record<string, unknown> = { status: nextStatus };
  if (note) {
    update.notes = note;
  }
  if (nextStatus === 'completed') {
    update.deliveredAt = new Date();
  }
  if (nextStatus === 'cancelled') {
    update.cancelledAt = new Date();
    /*
     * The reason is written to **both** `notes` and `cancellationReason`.
     *
     * `notes` is the administrator's free-form record; `cancellationReason`
     * is the customer-facing field, and it is the one the email template and
     * the outbox re-renderer read. Writing only `notes` meant a retried
     * cancellation email was rebuilt **without** the reason — the customer
     * got a bare "your order has been cancelled" that said nothing about
     * why.
     */
    if (note) {
      update.cancellationReason = note;
    }
  }

  const updated = await OrderModel.findByIdAndUpdate(
    orderId,
    { $set: update },
    {
      returnDocument: 'after',
    },
  ).lean<OrderDoc | null>();

  if (!updated) {
    throw new NotFoundError('Order');
  }

  // A cancelled order puts its stock back.
  if (nextStatus === 'cancelled') {
    await returnStockForOrder(updated);
  }

  /*
   * Customer notification for the three statuses a customer cares about.
   *
   * Recorded, not sent inline — the same reasoning as the payment path: a
   * provider failure here must not make an order status change appear to
   * have failed, which would prompt an administrator to retry the transition
   * that has already applied.
   *
   * Only fires on a real transition, because the idempotent early return above
   * short-circuits before reaching it — so re-saving the same status does not
   * produce a second "your order has shipped" email.
   */
  await notifyOrderStatusChange(updated, nextStatus, note);

  return mapOrder(updated);
}

/**
 * Record the customer-facing notification for an order status change.
 *
 * `shipped` is deliberately **not** driven from here alone. A label is not a
 * dispatch: the shipping webhook promotes the order when the courier actually
 * collects the parcel. See `shipping.service.ts`.
 */
async function notifyOrderStatusChange(
  order: OrderDoc,
  status: OrderStatus,
  note?: string,
): Promise<void> {
  const template =
    status === 'completed' ? 'order-delivered' : status === 'cancelled' ? 'order-cancelled' : null;

  if (!template) {
    return;
  }

  try {
    const { renderOrderDelivered, renderOrderCancelled } = await import('./email-templates.js');
    const { notifyOrderEvent } = await import('./notification.service.js');

    const projected = mapOrder(order);
    await notifyOrderEvent({
      template,
      orderId: order._id,
      orderNumber: projected.orderNumber,
      to: projected.customerEmail,
      rendered:
        template === 'order-delivered'
          ? renderOrderDelivered(projected)
          : renderOrderCancelled(projected, note),
    });
  } catch (error) {
    logger.warn(
      {
        orderId: order._id.toString(),
        status,
        err: error instanceof Error ? error.message : String(error),
      },
      'Order status changed but the customer notification could not be recorded',
    );
  }
}

/**
 * Resolve the product code for a cancellation movement.
 *
 * `stock_movements.productCode` is `required` in both the schema and the
 * Zod contract, so this path must never invent a value. The order item
 * carries `productId` and `variantId` but not the code, so the code is
 * read from the two authoritative documents:
 *
 *   1. the variant's own `productCode` (populated by the backfill), else
 *   2. the canonical parent `products.code`, which is the field the
 *      denormalised copy is defined against.
 *
 * If neither can be established the movement is **not written** and the
 * inconsistency is reported through `writeAuditLog`, because a return that
 * silently loses its ledger attribution is worse than one that is visibly
 * wrong and can be reconciled.
 */
async function resolveProductCodeForReturn(
  variantId: Types.ObjectId,
  productId: Types.ObjectId,
): Promise<{ code: string; source: 'variant' | 'product' } | null> {
  const variant = await VariantModel.findById(variantId)
    .select('productCode')
    .lean<{ productCode?: string } | null>();

  if (variant?.productCode) {
    return { code: variant.productCode, source: 'variant' };
  }

  const product = await ProductModel.findById(productId)
    .select('code')
    .lean<{ code: string } | null>();

  if (product?.code) {
    return { code: product.code, source: 'product' };
  }

  return null;
}

/**
 * Return the stock of a cancelled order to the catalogue.
 *
 * Exported because the same restoration is needed when a payment fails
 * (the units were consumed at checkout but the customer never paid) and
 * when a return is refunded (the goods come back). Both are the same
 * arithmetic: put the units back and write a ledger row.
 */
export async function returnStockForOrder(order: OrderDoc): Promise<void> {
  await Promise.all(
    order.items.map(async (item) => {
      const variantId = new Types.ObjectId(item.variantId);
      const productId = new Types.ObjectId(item.productId);

      const resolved = await resolveProductCodeForReturn(variantId, productId);
      if (!resolved) {
        /*
         * Fail safely: put the stock back (that part is correct and must not
         * be lost) but do NOT write a ledger row with a fabricated code.
         * The omission is recorded so it can be reconciled by hand.
         */
        await VariantModel.updateOne({ _id: variantId }, { $inc: { stock: item.quantity } });

        await writeAuditLog({
          actorId: null,
          actorEmail: 'system',
          actorRole: 'system',
          action: 'stock-adjust',
          entity: 'stock_movement',
          entityId: variantId.toString(),
          summary:
            `Cancelled order ${order.orderNumber}: stock returned for SKU ${item.sku} ` +
            'but no stock_movement was written — productCode could not be resolved.',
          changes: { sku: item.sku, quantity: item.quantity, orderId: order._id.toString() },
          ip: null,
        });
        return;
      }

      await VariantModel.updateOne({ _id: variantId }, { $inc: { stock: item.quantity } });

      /*
       * Read the level back so the ledger records the real before/after
       * rather than the placeholder zeros this path used to write.
       */
      const after = await VariantModel.findById(variantId)
        .select('stock')
        .lean<{ stock: number } | null>();
      const stockAfter = after?.stock ?? 0;

      await StockMovementModel.create({
        variantId,
        sku: item.sku,
        productCode: resolved.code,
        delta: item.quantity,
        stockBefore: stockAfter - item.quantity,
        stockAfter,
        reason: 'return' as const,
        note: `Order ${order.orderNumber} cancelled`,
        actorId: null,
        actorLabel: 'system',
        orderId: order._id,
      });
    }),
  );

  const productIds = order.items.map((item) => new Types.ObjectId(item.productId));
  await refreshProductInStock(productIds);
}
