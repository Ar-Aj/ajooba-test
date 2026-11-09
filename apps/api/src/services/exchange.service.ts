import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type { ExchangeOption, ExchangeRequest, ExchangeStatus, OrderItem } from '@ajooba/contracts';
import { ConflictError, NotFoundError } from '../core/errors.js';
import { ExchangeRequestModel } from '../models/exchange-request.model.js';
import { OrderModel } from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { VariantModel } from '../models/variant.model.js';
import { availableUnits } from './stock.service.js';

const EXCHANGE_WINDOW_DAYS = 10;

interface ExchangeDoc {
  _id: Types.ObjectId;
  exchangeNumber: string;
  orderId: Types.ObjectId;
  orderNumber: string;
  customerId: Types.ObjectId;
  originalItem: OrderItem & { productId: Types.ObjectId; variantId: Types.ObjectId };
  replacementItem: {
    productId: Types.ObjectId;
    variantId: Types.ObjectId;
    sku: string;
    title: string;
    imageUrl?: string | null;
    colour: string;
    size: number;
    unitPrice: number;
    mrp: number;
    quantity: number;
  };
  priceDifference: number;
  reasonNote: string;
  status: ExchangeStatus;
  resolutionNote?: string;
  requestedAt: Date;
  resolvedAt?: Date;
}

function mapExchange(doc: ExchangeDoc): ExchangeRequest {
  return {
    id: doc._id.toString(),
    exchangeNumber: doc.exchangeNumber,
    orderId: doc.orderId.toString(),
    orderNumber: doc.orderNumber,
    customerId: doc.customerId.toString(),
    originalItem: {
      ...doc.originalItem,
      productId: doc.originalItem.productId.toString(),
      variantId: doc.originalItem.variantId.toString(),
      imageUrl: doc.originalItem.imageUrl ?? null,
    },
    replacementItem: {
      ...doc.replacementItem,
      productId: doc.replacementItem.productId.toString(),
      variantId: doc.replacementItem.variantId.toString(),
      imageUrl: doc.replacementItem.imageUrl ?? null,
    },
    priceDifference: doc.priceDifference,
    reasonNote: doc.reasonNote,
    status: doc.status,
    resolutionNote: doc.resolutionNote ?? null,
    requestedAt: doc.requestedAt.toISOString(),
    resolvedAt: doc.resolvedAt?.toISOString() ?? null,
  };
}

export interface CreateExchangeInput {
  customerId: string;
  orderId: string;
  originalVariantId: string;
  replacementVariantId: string;
  quantity: number;
  reasonNote: string;
}

export async function getExchangeOptions(input: {
  customerId: string;
  orderId: string;
  originalVariantId: string;
}): Promise<ExchangeOption[]> {
  if (!Types.ObjectId.isValid(input.orderId)) throw new NotFoundError('Order');
  const order = await OrderModel.findOne({
    _id: new Types.ObjectId(input.orderId),
    customerId: new Types.ObjectId(input.customerId),
  }).lean<{ status: string; deliveredAt?: Date; items: OrderItem[] } | null>();
  if (!order || order.status !== 'completed' || !order.deliveredAt) {
    throw new ConflictError('Size exchanges are available after an order is delivered.');
  }
  const deadline = order.deliveredAt.getTime() + EXCHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() > deadline) throw new ConflictError('The 10-day exchange window has ended.');

  const original = order.items.find((item) => String(item.variantId) === input.originalVariantId);
  if (!original) throw new ConflictError('The selected size was not part of this order.');
  const originalVariant = await VariantModel.findById(input.originalVariantId).lean<{
    productId: Types.ObjectId;
    colourToken: string;
  } | null>();
  if (!originalVariant) throw new ConflictError('The original size is no longer in the catalogue.');

  const variants = await VariantModel.find({
    productId: originalVariant.productId,
    colourToken: originalVariant.colourToken,
    _id: { $ne: new Types.ObjectId(input.originalVariantId) },
  })
    .sort({ size: 1 })
    .lean<
      Array<{
        _id: Types.ObjectId;
        size: number;
        sellingPrice: number;
        mrp: number;
        stock: number;
        reservedStock?: number;
        photographyStatus?: string;
      }>
    >();

  return variants.map((variant) => ({
    variantId: variant._id.toString(),
    size: variant.size,
    available:
      variant.photographyStatus !== 'pending-review' &&
      availableUnits(variant) > 0 &&
      variant.sellingPrice === original.unitPrice,
    sellingPrice: variant.sellingPrice,
    mrp: variant.mrp,
    unavailableReason:
      variant.sellingPrice !== original.unitPrice
        ? 'price-difference'
        : variant.photographyStatus === 'pending-review'
          ? 'catalogue-review'
          : availableUnits(variant) <= 0
            ? 'out-of-stock'
            : null,
  }));
}

type ExchangeReservationResult = 'reserved' | 'already-reserved' | 'unavailable';

/** Reserve stock on the variant document itself; the exchange id makes retries idempotent. */
async function reserveExchangeStock(
  variantId: Types.ObjectId,
  quantity: number,
  exchangeId: string,
): Promise<ExchangeReservationResult> {
  const updated = await VariantModel.findOneAndUpdate(
    {
      _id: variantId,
      stock: { $gte: quantity },
      photographyStatus: { $ne: 'pending-review' },
      exchangeReservations: { $ne: exchangeId },
    },
    {
      $inc: { stock: -quantity, reservedStock: quantity },
      $addToSet: { exchangeReservations: exchangeId },
    },
    { returnDocument: 'after' },
  ).lean<{ _id: Types.ObjectId } | null>();

  if (updated) return 'reserved';
  const current = await VariantModel.findById(variantId)
    .select('exchangeReservations')
    .lean<{ exchangeReservations?: string[] } | null>();
  if (current?.exchangeReservations?.includes(exchangeId)) return 'already-reserved';
  return 'unavailable';
}

/** Release a pending exchange reservation once. Retrying cannot inflate stock. */
async function releaseExchangeStock(
  variantId: Types.ObjectId,
  quantity: number,
  exchangeId: string,
): Promise<void> {
  const released = await VariantModel.findOneAndUpdate(
    {
      _id: variantId,
      exchangeReservations: exchangeId,
      reservedStock: { $gte: quantity },
    },
    {
      $inc: { stock: quantity, reservedStock: -quantity },
      $pull: { exchangeReservations: exchangeId },
    },
    { returnDocument: 'after' },
  ).lean<{ _id: Types.ObjectId } | null>();
  if (released) return;

  const current = await VariantModel.findById(variantId)
    .select('exchangeReservations reservedStock')
    .lean<{ exchangeReservations?: string[]; reservedStock: number } | null>();
  if (current?.exchangeReservations?.includes(exchangeId)) {
    throw new ConflictError(
      'The exchange stock hold could not be safely released. Contact support.',
    );
  }
}

/** Consume the held replacement stock once it has been marked as shipped. */
async function commitExchangeStock(
  variantId: Types.ObjectId,
  quantity: number,
  exchangeId: string,
): Promise<void> {
  const committed = await VariantModel.findOneAndUpdate(
    {
      _id: variantId,
      exchangeReservations: exchangeId,
      reservedStock: { $gte: quantity },
    },
    {
      $inc: { reservedStock: -quantity },
      $pull: { exchangeReservations: exchangeId },
    },
    { returnDocument: 'after' },
  ).lean<{ _id: Types.ObjectId } | null>();
  if (committed) return;

  const current = await VariantModel.findById(variantId)
    .select('exchangeReservations')
    .lean<{ exchangeReservations?: string[] } | null>();
  if (current?.exchangeReservations?.includes(exchangeId)) {
    throw new ConflictError(
      'The exchange stock hold could not be safely committed. Contact support.',
    );
  }
}

/** Create a same-design, same-colour, different-size request for a delivered order. */
export async function createExchangeRequest(input: CreateExchangeInput): Promise<ExchangeRequest> {
  if (!Types.ObjectId.isValid(input.orderId)) throw new NotFoundError('Order');

  const order = await OrderModel.findOne({
    _id: new Types.ObjectId(input.orderId),
    customerId: new Types.ObjectId(input.customerId),
  }).lean<{
    _id: Types.ObjectId;
    orderNumber: string;
    customerId: Types.ObjectId;
    items: OrderItem[];
    status: string;
    deliveredAt?: Date;
  } | null>();

  if (!order) throw new NotFoundError('Order');
  if (order.status !== 'completed' || !order.deliveredAt) {
    throw new ConflictError('A size exchange can be requested after the order is delivered.');
  }

  const deadline = order.deliveredAt.getTime() + EXCHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (Date.now() > deadline) {
    throw new ConflictError(`The ${EXCHANGE_WINDOW_DAYS}-day exchange window has ended.`);
  }

  const original = order.items.find((item) => String(item.variantId) === input.originalVariantId);
  if (!original) throw new ConflictError('The selected size was not part of this order.');

  const [targetVariant, product, existing] = await Promise.all([
    VariantModel.findById(input.replacementVariantId).lean<{
      _id: Types.ObjectId;
      productId: Types.ObjectId;
      sku: string;
      size: number;
      colour: string;
      colourToken: string;
      sellingPrice: number;
      mrp: number;
      stock: number;
      reservedStock?: number;
      photographyStatus?: string;
      imageUrl?: string;
    } | null>(),
    ProductModel.findById(original.productId).select('title').lean<{ title: string } | null>(),
    ExchangeRequestModel.find({
      orderId: order._id,
      'originalItem.variantId': new Types.ObjectId(input.originalVariantId),
      status: { $ne: 'rejected' },
    }).lean<Array<{ originalItem: { quantity: number } }>>(),
  ]);

  if (!targetVariant) throw new NotFoundError('Replacement size');
  if (targetVariant.productId.toString() !== original.productId.toString()) {
    throw new ConflictError('Choose another size from the same design.');
  }
  if (targetVariant.colour.trim().toUpperCase() !== original.colour.trim().toUpperCase()) {
    throw new ConflictError('Choose another size in the same colour.');
  }
  if (targetVariant.size === original.size) {
    throw new ConflictError('Choose a different size for the exchange.');
  }
  if (targetVariant.sellingPrice !== original.unitPrice) {
    throw new ConflictError(
      'This size has a different price. Contact support so the price difference can be reviewed before requesting an exchange.',
    );
  }
  if (input.quantity > original.quantity) {
    throw new ConflictError(`You ordered ${original.quantity} unit(s) of this size.`);
  }

  const alreadyRequested = existing.reduce(
    (total, request) => total + request.originalItem.quantity,
    0,
  );
  if (input.quantity + alreadyRequested > original.quantity) {
    throw new ConflictError('An exchange is already in progress for the remaining quantity.');
  }

  if (
    targetVariant.photographyStatus === 'pending-review' ||
    availableUnits(targetVariant) < input.quantity
  ) {
    throw new ConflictError('That replacement size is not currently available.');
  }

  const originalSnapshot: OrderItem = {
    ...original,
    productId: String(original.productId),
    variantId: String(original.variantId),
    imageUrl: original.imageUrl ?? null,
    quantity: input.quantity,
    lineTotal: original.unitPrice * input.quantity,
  };
  const replacementUnitPrice = targetVariant.sellingPrice;
  const created = await ExchangeRequestModel.create({
    exchangeNumber: `EX-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`,
    orderId: order._id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    originalItem: originalSnapshot,
    replacementItem: {
      productId: targetVariant.productId,
      variantId: targetVariant._id,
      sku: targetVariant.sku,
      title: product?.title ?? original.title,
      imageUrl: targetVariant.imageUrl ?? original.imageUrl ?? null,
      colour: targetVariant.colour,
      size: targetVariant.size,
      unitPrice: replacementUnitPrice,
      mrp: targetVariant.mrp,
      quantity: input.quantity,
    },
    priceDifference: (replacementUnitPrice - original.unitPrice) * input.quantity,
    reasonNote: input.reasonNote,
    status: 'requested',
    requestedAt: new Date(),
  });

  return mapExchange(created as unknown as ExchangeDoc);
}

export async function getExchangeForCustomer(
  exchangeId: string,
  customerId: string,
): Promise<ExchangeRequest | null> {
  if (!Types.ObjectId.isValid(exchangeId)) return null;
  const doc = await ExchangeRequestModel.findOne({
    _id: new Types.ObjectId(exchangeId),
    customerId: new Types.ObjectId(customerId),
  }).lean<ExchangeDoc | null>();
  return doc ? mapExchange(doc) : null;
}

export async function listCustomerExchanges(
  customerId: string,
  page: number,
  pageSize: number,
): Promise<{
  items: ExchangeRequest[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const filter = { customerId: new Types.ObjectId(customerId) };
  const [docs, totalItems] = await Promise.all([
    ExchangeRequestModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ExchangeDoc[]>(),
    ExchangeRequestModel.countDocuments(filter),
  ]);
  return {
    items: docs.map(mapExchange),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

export async function listAdminExchanges(
  filter: { status?: ExchangeStatus; orderId?: string },
  page: number,
  pageSize: number,
): Promise<{
  items: ExchangeRequest[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.orderId) query.orderId = new Types.ObjectId(filter.orderId);
  const [docs, totalItems] = await Promise.all([
    ExchangeRequestModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<ExchangeDoc[]>(),
    ExchangeRequestModel.countDocuments(query),
  ]);
  return {
    items: docs.map(mapExchange),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

const EXCHANGE_TRANSITIONS: Readonly<Record<ExchangeStatus, readonly ExchangeStatus[]>> = {
  requested: ['approved', 'rejected'],
  approved: ['received', 'rejected'],
  rejected: [],
  received: ['replacement-shipped'],
  'replacement-shipped': ['completed'],
  completed: [],
};

/** Admin review is separate from payment/refund and does not change catalogue prices. */
export async function transitionExchange(
  exchangeId: string,
  status: ExchangeStatus,
  note: string,
): Promise<ExchangeRequest> {
  if (!Types.ObjectId.isValid(exchangeId)) throw new NotFoundError('Exchange request');
  const doc = await ExchangeRequestModel.findById(exchangeId).lean<ExchangeDoc | null>();
  if (!doc) throw new NotFoundError('Exchange request');
  if (doc.status === status) {
    if (status === 'approved') {
      const hold = await reserveExchangeStock(
        doc.replacementItem.variantId,
        doc.replacementItem.quantity,
        doc._id.toString(),
      );
      if (hold === 'unavailable') {
        throw new ConflictError(
          'The replacement size is no longer available. Check stock before approval.',
        );
      }
    } else if (status === 'rejected') {
      await releaseExchangeStock(
        doc.replacementItem.variantId,
        doc.replacementItem.quantity,
        doc._id.toString(),
      );
    } else if (status === 'replacement-shipped') {
      await commitExchangeStock(
        doc.replacementItem.variantId,
        doc.replacementItem.quantity,
        doc._id.toString(),
      );
    }
    return mapExchange(doc);
  }
  if (!EXCHANGE_TRANSITIONS[doc.status].includes(status)) {
    throw new ConflictError(`An exchange in "${doc.status}" cannot move to "${status}".`);
  }

  if (status === 'approved') {
    if (doc.priceDifference !== 0) {
      throw new ConflictError(
        'A price difference must be resolved before this exchange can be approved.',
      );
    }
    const reservation = await reserveExchangeStock(
      doc.replacementItem.variantId,
      doc.replacementItem.quantity,
      doc._id.toString(),
    );
    if (reservation === 'unavailable') {
      throw new ConflictError(
        'The replacement size is no longer available. Check stock before approval.',
      );
    }
  }

  const updated = await ExchangeRequestModel.findOneAndUpdate(
    { _id: new Types.ObjectId(exchangeId), status: doc.status },
    {
      $set: {
        status,
        ...(note.trim() ? { resolutionNote: note.trim() } : {}),
        resolvedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  ).lean<ExchangeDoc | null>();
  if (!updated) {
    const latest = await ExchangeRequestModel.findById(exchangeId).lean<ExchangeDoc | null>();
    if (latest?.status === 'approved') return mapExchange(latest);
    if (status === 'approved') {
      await releaseExchangeStock(
        doc.replacementItem.variantId,
        doc.replacementItem.quantity,
        doc._id.toString(),
      );
    }
    throw new ConflictError(
      'This exchange changed while it was being reviewed. Refresh and try again.',
    );
  }

  if (status === 'rejected' && doc.status === 'approved') {
    await releaseExchangeStock(
      doc.replacementItem.variantId,
      doc.replacementItem.quantity,
      doc._id.toString(),
    );
  }
  if (status === 'replacement-shipped') {
    await commitExchangeStock(
      doc.replacementItem.variantId,
      doc.replacementItem.quantity,
      doc._id.toString(),
    );
  }
  return mapExchange(updated);
}
