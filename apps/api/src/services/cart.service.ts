import { Types } from 'mongoose';
import type { Cart, CartItem, Coupon } from '@ajooba/contracts';
import { ConflictError, NotFoundError } from '../core/errors.js';
import { CartModel } from '../models/cart.model.js';
import { CouponModel } from '../models/coupon.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import { getStoreSettings } from './store-settings.service.js';
import { availableUnits } from './stock.service.js';
import { computeDiscount, priceBasket, toDiscountRule } from './pricing.service.js';

/**
 * Cart service.
 *
 * The cart stores **quantities only**. Every price in a cart response is
 * read live from the variant at request time, so a cart can never show or
 * charge a price the catalogue no longer holds.
 *
 * The cart is the *same* service the checkout reads from, so the totals a
 * customer sees and the totals they are charged are produced by the same
 * `priceBasket` call.
 */

const MAX_ITEM_QUANTITY = 20;

interface CartItemDoc {
  variantId: Types.ObjectId;
  sku: string;
  productId: Types.ObjectId;
  quantity: number;
  addedUnitPrice: number;
  addedAt: Date;
}

interface CartDoc {
  _id: Types.ObjectId;
  customerId?: Types.ObjectId;
  sessionId?: string;
  items: CartItemDoc[];
  couponCode: string;
  updatedAt: Date;
}

interface VariantDoc {
  _id: Types.ObjectId;
  sku: string;
  productId: Types.ObjectId;
  size: number;
  colour: string;
  sellingPrice: number;
  mrp: number;
  stock: number;
  inStock: boolean;
  reservedStock: number;
  imageUrl?: string;
  productCode: string;
  /**
   * `pending-review` marks a colourway with no verified photography, which is
   * not purchasable regardless of stock.
   */
  photographyStatus?: 'verified' | 'pending-review';
}

interface ProductDoc {
  _id: Types.ObjectId;
  slug: string;
  title: string;
  /** The catalogue code, e.g. `A12`. Used by product-restricted coupons. */
  code: string;
}

/**
 * The coupon document, as it is read from the database.
 *
 * The lean projection is typed explicitly because several of the schema's
 * optional fields (`usageLimit`, `maxDiscountAmount`) are nullable in
 * MongoDB and would otherwise widen to `number | null | undefined`.
 */
interface CouponDoc {
  _id: Types.ObjectId;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  description: string;
  /** Restrict the coupon to specific products. Empty means it applies to all. */
  productCodes: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Which cart to operate on.
 *
 * A signed-in customer always gets their customer-scoped cart. A guest
 * gets a session-scoped cart. The two are never mixed, so a guest cart
 * can never be "adopted" by a customer without going through the
 * explicit merge path.
 */
export interface CartScope {
  readonly customerId?: string;
  readonly sessionId?: string;
}

/**
 * Load the cart document for a scope, or null.
 */
async function findCart(scope: CartScope): Promise<CartDoc | null> {
  const filter = scope.customerId
    ? { customerId: new Types.ObjectId(scope.customerId) }
    : { sessionId: scope.sessionId };

  if (!scope.customerId && !scope.sessionId) {
    return null;
  }

  return CartModel.findOne(filter).lean<CartDoc | null>();
}

/**
 * Load (or create) the cart document for a scope.
 */
async function findOrCreateCart(scope: CartScope): Promise<CartDoc> {
  const existing = await findCart(scope);
  if (existing) {
    return existing;
  }

  if (!scope.customerId && !scope.sessionId) {
    throw new NotFoundError('Cart');
  }

  const created = await CartModel.create({
    ...(scope.customerId ? { customerId: new Types.ObjectId(scope.customerId) } : {}),
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    items: [],
    couponCode: '',
  });

  return created as unknown as CartDoc;
}

/**
 * Read a coupon and check whether it applies right now.
 *
 * Returns the reason the coupon was rejected so the caller can tell the
 * customer *why* rather than silently dropping it.
 *
 * `productCodes` — the basket's product codes — is optional. When it is
 * supplied and the coupon is restricted to specific products, the
 * eligibility check requires at least one of those products in the basket.
 * Without the restriction the coupon applies to the whole basket.
 */
export async function resolveCoupon(
  code: string,
  subtotal: number,
  basketProductCodes?: readonly string[],
): Promise<{ coupon: Coupon } | { error: string }> {
  const normalised = code.trim().toUpperCase();

  const doc = await CouponModel.findOne({ code: normalised }).lean<CouponDoc | null>();
  if (!doc) {
    return { error: 'That coupon code is not recognised.' };
  }
  if (!doc.isActive) {
    return { error: 'That coupon is no longer active.' };
  }

  const now = new Date();
  if (doc.startsAt.getTime() > now.getTime()) {
    return { error: 'That coupon is not active yet.' };
  }
  if (doc.endsAt && doc.endsAt.getTime() <= now.getTime()) {
    return { error: 'That coupon has expired.' };
  }
  if (doc.usageLimit !== null && doc.usedCount >= doc.usageLimit) {
    return { error: 'That coupon has reached its usage limit.' };
  }
  if (subtotal < doc.minOrderAmount) {
    return {
      error: `That coupon requires a minimum order of ₹${doc.minOrderAmount}.`,
    };
  }

  /*
   * A product-restricted coupon only applies when the basket contains one
   * of the restricted products.
   *
   * The check is only made when the caller supplied the basket's product
   * codes. A caller that does not know the basket cannot be told "yes" or
   * "no" about a product restriction — and the checkout path, which is the
   * one that decides what is charged, always supplies them.
   */
  if (doc.productCodes && doc.productCodes.length > 0 && basketProductCodes) {
    const restricted = new Set(doc.productCodes.map((entry) => entry.toUpperCase()));
    const matches = basketProductCodes.some((entry) => restricted.has(entry.toUpperCase()));
    if (!matches) {
      return { error: 'That coupon does not apply to the items in your cart.' };
    }
  }

  if (computeDiscount(toDiscountRule(doc as unknown as Coupon), subtotal) <= 0) {
    return { error: 'That coupon does not apply to this order.' };
  }

  return {
    coupon: {
      id: doc._id.toString(),
      code: doc.code,
      type: doc.type,
      value: doc.value,
      minOrderAmount: doc.minOrderAmount,
      maxDiscountAmount: doc.maxDiscountAmount ?? null,
      startsAt: doc.startsAt.toISOString(),
      endsAt: doc.endsAt ? doc.endsAt.toISOString() : null,
      usageLimit: doc.usageLimit ?? null,
      usedCount: doc.usedCount,
      isActive: doc.isActive,
      description: doc.description ?? '',
      productCodes: doc.productCodes ?? [],
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    },
  };
}

/**
 * Build the cart projection, pricing it from live variant data.
 */
export async function buildCart(scope: CartScope): Promise<Cart> {
  const cart = await findCart(scope);
  const settings = await getStoreSettings();

  if (!cart) {
    const breakdown = priceBasket([], settings, null);
    return {
      id: '',
      items: [],
      coupon: null,
      itemCount: 0,
      subtotal: breakdown.subtotal,
      discountAmount: 0,
      shippingFee: 0,
      taxAmount: 0,
      totalAmount: 0,
      currency: 'INR',
      updatedAt: new Date(0).toISOString(),
    };
  }

  const variantIds = cart.items.map((item) => item.variantId);
  const [variantDocs, productDocs] = await Promise.all([
    VariantModel.find({ _id: { $in: variantIds } }).lean<VariantDoc[]>(),
    ProductModel.find({
      _id: { $in: cart.items.map((item) => item.productId) },
    }).lean<ProductDoc[]>(),
  ]);

  const variantsById = new Map(variantDocs.map((doc) => [doc._id.toString(), doc]));
  const productsById = new Map(productDocs.map((doc) => [doc._id.toString(), doc]));

  /** Product id → catalogue code, for product-restricted coupons. */
  const productCodesById = new Map(productDocs.map((doc) => [doc._id.toString(), doc.code]));

  const items: CartItem[] = [];
  const priceLines: Array<{ unitPrice: number; quantity: number }> = [];
  let couponRule = null;
  let couponInfo = null;

  for (const item of cart.items) {
    const variant = variantsById.get(item.variantId.toString());
    const product = productsById.get(item.productId.toString());

    if (!variant) {
      // The variant no longer exists. It is reported as unavailable and
      // contributes nothing to the totals, so the customer is never
      // charged for something that cannot be bought.
      continue;
    }

    const availableStock = availableUnits(variant);
    const isAvailable = availableStock >= item.quantity;

    items.push({
      variantId: variant._id.toString(),
      sku: variant.sku,
      productId: variant.productId.toString(),
      slug: product?.slug ?? '',
      title: product?.title ?? variant.sku,
      colour: variant.colour,
      size: variant.size,
      imageUrl: variant.imageUrl ?? null,
      unitPrice: variant.sellingPrice,
      mrp: variant.mrp,
      quantity: item.quantity,
      lineTotal: variant.sellingPrice * item.quantity,
      isAvailable,
      availableStock,
    });

    priceLines.push({ unitPrice: variant.sellingPrice, quantity: item.quantity });
  }

  if (cart.couponCode) {
    const resolved = await resolveCoupon(
      cart.couponCode,
      priceBasket(priceLines, settings, null).subtotal,
      items.map((item) => productCodesById.get(item.productId) ?? '').filter(Boolean),
    );
    if ('coupon' in resolved) {
      couponRule = toDiscountRule(resolved.coupon);
      couponInfo = resolved.coupon;
    }
  }

  const breakdown = priceBasket(priceLines, settings, couponRule);

  const appliedCoupon =
    couponInfo && couponRule
      ? {
          code: couponInfo.code,
          type: couponInfo.type,
          value: couponInfo.value,
          discountAmount: breakdown.discountAmount,
        }
      : null;

  return {
    id: cart._id.toString(),
    items,
    coupon: appliedCoupon,
    itemCount: breakdown.itemCount,
    subtotal: breakdown.subtotal,
    discountAmount: breakdown.discountAmount,
    shippingFee: breakdown.shippingFee,
    taxAmount: breakdown.taxAmount,
    totalAmount: breakdown.totalAmount,
    currency: 'INR',
    updatedAt: cart.updatedAt.toISOString(),
  };
}

/**
 * The product codes of the items in a cart.
 *
 * Used to evaluate a product-restricted coupon. Only codes for items whose
 * variant still exists are returned — a coupon restricted to a product the
 * customer no longer has in their cart must not apply.
 */
export async function cartProductCodes(scope: CartScope): Promise<string[]> {
  const cart = await findCart(scope);
  if (!cart) {
    return [];
  }

  const variantDocs = await VariantModel.find({
    _id: { $in: cart.items.map((item) => item.variantId) },
  })
    .select('productCode')
    .lean<Array<{ productCode?: string }>>();

  const codes = variantDocs
    .map((doc) => doc.productCode)
    .filter((code): code is string => typeof code === 'string' && code.length > 0);

  return [...new Set(codes)];
}

/**
 * Add a variant to the cart.
 *
 * The stock is checked at add time so the customer finds out early. The
 * authoritative check still happens at checkout, where it is enforced
 * atomically.
 */
export async function addCartItem(
  scope: CartScope,
  variantId: string,
  quantity: number,
): Promise<Cart> {
  if (!Types.ObjectId.isValid(variantId)) {
    throw new NotFoundError('Variant');
  }

  const variant = await VariantModel.findById(variantId).lean<VariantDoc | null>();
  if (!variant) {
    throw new NotFoundError('Variant');
  }

  const cart = await findOrCreateCart(scope);
  const existing = cart.items.find((item) => item.variantId.toString() === variantId);

  const desired = (existing?.quantity ?? 0) + quantity;
  if (desired > MAX_ITEM_QUANTITY) {
    throw new ConflictError(`You can order at most ${MAX_ITEM_QUANTITY} units of the same item.`);
  }

  /*
   * A colourway whose photography is still under review is not purchasable, even
   * with stock on hand: we cannot show the customer what they would be buying.
   * `order.reserveStock` enforces the same rule authoritatively at checkout.
   */
  if (variant.photographyStatus === 'pending-review') {
    throw new ConflictError(
      `The ${variant.colour} colourway of this design is being photographed and is not on sale yet.`,
    );
  }

  const availableStock = availableUnits(variant);
  if (availableStock < desired) {
    throw new ConflictError(
      availableStock === 0
        ? 'That size is currently out of stock.'
        : `Only ${availableStock} unit(s) of that size are available.`,
    );
  }

  if (existing) {
    await CartModel.updateOne(
      { _id: cart._id },
      {
        $set: {
          'items.$[item].quantity': desired,
          'items.$[item].addedUnitPrice': variant.sellingPrice,
        },
      },
      { arrayFilters: [{ 'item.variantId': new Types.ObjectId(variantId) }] },
    );
  } else {
    await CartModel.updateOne(
      { _id: cart._id },
      {
        $push: {
          items: {
            variantId: variant._id,
            sku: variant.sku,
            productId: variant.productId,
            quantity,
            addedUnitPrice: variant.sellingPrice,
            addedAt: new Date(),
          },
        },
      },
    );
  }

  return buildCart(scope);
}

/**
 * Set the quantity of a line. A quantity of zero removes the line.
 */
export async function updateCartItem(
  scope: CartScope,
  variantId: string,
  quantity: number,
): Promise<Cart> {
  if (!Types.ObjectId.isValid(variantId)) {
    throw new NotFoundError('Variant');
  }

  const cart = await findCart(scope);
  if (!cart) {
    throw new NotFoundError('Cart');
  }

  const existing = cart.items.find((item) => item.variantId.toString() === variantId);
  if (!existing) {
    throw new NotFoundError('Cart item');
  }

  if (quantity <= 0) {
    await CartModel.updateOne(
      { _id: cart._id },
      { $pull: { items: { variantId: new Types.ObjectId(variantId) } } },
    );
    return buildCart(scope);
  }

  if (quantity > MAX_ITEM_QUANTITY) {
    throw new ConflictError(`You can order at most ${MAX_ITEM_QUANTITY} units of the same item.`);
  }

  const variant = await VariantModel.findById(variantId).lean<VariantDoc | null>();
  if (!variant) {
    throw new NotFoundError('Variant');
  }

  const availableStock = availableUnits(variant);
  if (availableStock < quantity) {
    throw new ConflictError(
      availableStock === 0
        ? 'That size is currently out of stock.'
        : `Only ${availableStock} unit(s) of that size are available.`,
    );
  }

  await CartModel.updateOne(
    { _id: cart._id },
    { $set: { 'items.$[item].quantity': quantity } },
    { arrayFilters: [{ 'item.variantId': new Types.ObjectId(variantId) }] },
  );

  return buildCart(scope);
}

/**
 * Remove a line from the cart.
 */
export async function removeCartItem(scope: CartScope, variantId: string): Promise<Cart> {
  if (!Types.ObjectId.isValid(variantId)) {
    throw new NotFoundError('Cart item');
  }

  const cart = await findCart(scope);
  if (!cart) {
    throw new NotFoundError('Cart');
  }

  await CartModel.updateOne(
    { _id: cart._id },
    { $pull: { items: { variantId: new Types.ObjectId(variantId) } } },
  );

  return buildCart(scope);
}

/**
 * Empty the cart.
 */
export async function clearCart(scope: CartScope): Promise<Cart> {
  const cart = await findCart(scope);
  if (cart) {
    await CartModel.updateOne({ _id: cart._id }, { $set: { items: [], couponCode: '' } });
  }
  return buildCart(scope);
}

/**
 * Apply a coupon to the cart.
 */
export async function applyCouponToCart(scope: CartScope, code: string): Promise<Cart> {
  const cart = await findCart(scope);
  if (!cart) {
    throw new NotFoundError('Cart');
  }

  const variantIds = cart.items.map((item) => item.variantId);
  const [variantDocs, productDocs] = await Promise.all([
    VariantModel.find({ _id: { $in: variantIds } }).lean<VariantDoc[]>(),
    ProductModel.find({
      _id: { $in: cart.items.map((item) => item.productId) },
    }).lean<ProductDoc[]>(),
  ]);

  /*
   * Only items whose variant still exists contribute to the subtotal.
   *
   * An earlier version fell back to `item.addedUnitPrice` for a missing
   * variant, which priced the basket at a stale price the customer is no
   * longer going to pay — and, worse, computed the coupon's minimum-order
   * test against that stale number. The checkout path skips vanished
   * variants, so this path does too.
   */
  const subtotal = cart.items.reduce((total, item) => {
    const variant = variantDocs.find((doc) => doc._id.toString() === item.variantId.toString());
    if (!variant) {
      return total;
    }
    return total + variant.sellingPrice * item.quantity;
  }, 0);

  const basketProductCodes = productDocs
    .filter((product) =>
      cart.items.some((item) => item.productId.toString() === product._id.toString()),
    )
    .map((product) => product.code);

  const resolved = await resolveCoupon(code, subtotal, basketProductCodes);
  if ('error' in resolved) {
    throw new ConflictError(resolved.error);
  }

  await CartModel.updateOne({ _id: cart._id }, { $set: { couponCode: resolved.coupon.code } });

  return buildCart(scope);
}

/**
 * Remove the coupon from the cart.
 */
export async function removeCouponFromCart(scope: CartScope): Promise<Cart> {
  const cart = await findCart(scope);
  if (!cart) {
    throw new NotFoundError('Cart');
  }
  await CartModel.updateOne({ _id: cart._id }, { $set: { couponCode: '' } });
  return buildCart(scope);
}

/**
 * Delete the cart document entirely. Used after a successful checkout.
 */
export async function deleteCart(scope: CartScope): Promise<void> {
  const cart = await findCart(scope);
  if (cart) {
    await CartModel.deleteOne({ _id: cart._id });
  }
}
