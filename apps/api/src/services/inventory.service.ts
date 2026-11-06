import { Types } from 'mongoose';
import type { StockMovement, StockMovementReason } from '@ajooba/contracts';
import { ConflictError, NotFoundError } from '../core/errors.js';
import { ProductModel } from '../models/product.model.js';
import { StockMovementModel } from '../models/stock-movement.model.js';
import { VariantModel } from '../models/variant.model.js';

/**
 * Inventory.
 *
 * Stock is never edited in place. Every change appends a movement to the
 * ledger, so a discrepancy is always explainable and the current level
 * can be reconstructed from history.
 *
 * The stock level itself is still stored on the variant, because the
 * storefront needs to filter and sort on it. The ledger is the record of
 * *how* it got there.
 */

interface VariantDoc {
  _id: Types.ObjectId;
  sku: string;
  productId: Types.ObjectId;
  productCode: string;
  stock: number;
  inStock: boolean;
}

export interface StockAdjustmentInput {
  readonly variantId: string;
  readonly delta: number;
  readonly reason: StockMovementReason;
  readonly note: string;
  readonly actorId: string | null;
  readonly actorLabel: string;
}

export interface StockAdjustmentResult {
  readonly movement: StockMovement;
  readonly variant: {
    readonly id: string;
    readonly sku: string;
    readonly productCode: string;
    readonly stock: number;
    readonly inStock: boolean;
  };
}

/**
 * Apply a stock adjustment.
 *
 * The update uses a conditional filter so the read and the write are a
 * single atomic operation: the new level can never go below zero, even
 * if two administrators adjust the same variant at the same moment.
 */
export async function adjustStock(input: StockAdjustmentInput): Promise<StockAdjustmentResult> {
  if (!Types.ObjectId.isValid(input.variantId)) {
    throw new NotFoundError('Variant');
  }

  const variantId = new Types.ObjectId(input.variantId);

  /*
   * A negative delta must not take the stock below zero, so the filter
   * requires enough stock for the decrement. A positive delta is always
   * allowed.
   */
  const filter: Record<string, unknown> = { _id: variantId };
  if (input.delta < 0) {
    filter.stock = { $gte: Math.abs(input.delta) };
  }

  const updated = await VariantModel.findOneAndUpdate(
    filter,
    { $inc: { stock: input.delta }, $set: { inStock: true } },
    { returnDocument: 'after' },
  ).lean<VariantDoc | null>();

  if (!updated) {
    /*
     * The update did not match. Either the variant does not exist, or
     * there was not enough stock. Tell the caller which.
     */
    const existing = await VariantModel.findById(variantId)
      .select('stock')
      .lean<{ stock: number } | null>();

    if (!existing) {
      throw new NotFoundError('Variant');
    }
    throw new ConflictError(
      `Cannot remove ${Math.abs(input.delta)} unit(s): only ${existing.stock} in stock.`,
    );
  }

  // Recompute `inStock` from the new level rather than trusting the
  // `$set` above, which cannot know the resulting value.
  const inStock = updated.stock > 0;
  await VariantModel.updateOne({ _id: variantId }, { $set: { inStock } });

  const movement = await StockMovementModel.create({
    variantId,
    sku: updated.sku,
    productCode: updated.productCode,
    delta: input.delta,
    stockBefore: updated.stock - input.delta,
    stockAfter: updated.stock,
    reason: input.reason,
    note: input.note,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
  });

  await refreshProductInStock([updated.productId]);

  return {
    movement: {
      id: movement._id.toString(),
      variantId: variantId.toString(),
      sku: updated.sku,
      productCode: updated.productCode,
      delta: input.delta,
      stockBefore: updated.stock - input.delta,
      stockAfter: updated.stock,
      reason: input.reason,
      note: input.note,
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      createdAt: movement.createdAt.toISOString(),
    },
    variant: {
      id: variantId.toString(),
      sku: updated.sku,
      productCode: updated.productCode,
      stock: updated.stock,
      inStock,
    },
  };
}

/**
 * Apply a batch of adjustments.
 *
 * Each adjustment is applied independently. One failure does not roll
 * back the others — the result reports exactly what succeeded and what
 * failed, so a partial batch is safe to retry.
 */
export async function adjustStockBatch(
  adjustments: readonly StockAdjustmentInput[],
  actorId: string | null,
  actorLabel: string,
): Promise<{
  applied: StockAdjustmentResult[];
  failed: Array<{ variantId: string; reason: string }>;
}> {
  const applied: StockAdjustmentResult[] = [];
  const failed: Array<{ variantId: string; reason: string }> = [];

  for (const adjustment of adjustments) {
    try {
      applied.push(
        await adjustStock({
          ...adjustment,
          actorId: adjustment.actorId ?? actorId,
          actorLabel: adjustment.actorLabel || actorLabel,
        }),
      );
    } catch (error) {
      failed.push({
        variantId: adjustment.variantId,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { applied, failed };
}

/**
 * Roll the product-level `inStock` rollup back into agreement with its
 * variants.
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

/**
 * A stock-movement row, as it comes back from the database.
 */
interface StockMovementDoc {
  _id: Types.ObjectId;
  variantId: Types.ObjectId;
  sku: string;
  productCode: string;
  delta: number;
  stockBefore: number;
  stockAfter: number;
  reason: StockMovementReason;
  note: string;
  actorId: Types.ObjectId | null;
  actorLabel: string;
  createdAt: Date;
}

/**
 * A variant row, as it comes back from the database.
 */
interface VariantSummaryDoc {
  _id: Types.ObjectId;
  sku: string;
  productCode: string;
  size: number;
  colour: string;
  stock: number;
  inStock: boolean;
}

/**
 * The stock ledger for a variant, newest first.
 */
export async function listStockMovements(
  filter: { variantId?: string; productCode?: string },
  page: number,
  pageSize: number,
): Promise<{
  items: StockMovement[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};
  if (filter.variantId && Types.ObjectId.isValid(filter.variantId)) {
    query.variantId = new Types.ObjectId(filter.variantId);
  }
  if (filter.productCode) {
    query.productCode = filter.productCode;
  }

  const [docs, totalItems] = await Promise.all([
    StockMovementModel.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<StockMovementDoc[]>(),
    StockMovementModel.countDocuments(query),
  ]);

  return {
    items: docs.map((doc) => ({
      id: doc._id.toString(),
      variantId: doc.variantId.toString(),
      sku: doc.sku,
      productCode: doc.productCode,
      delta: doc.delta,
      stockBefore: doc.stockBefore,
      stockAfter: doc.stockAfter,
      reason: doc.reason,
      note: doc.note,
      actorId: doc.actorId ? doc.actorId.toString() : null,
      actorLabel: doc.actorLabel,
      createdAt: doc.createdAt.toISOString(),
    })),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}

/**
 * The current inventory level, per variant.
 */
export async function listInventory(
  filter: { productCode?: string; inStock?: boolean; search?: string },
  page: number,
  pageSize: number,
): Promise<{
  items: Array<{
    variantId: string;
    sku: string;
    productCode: string;
    size: number;
    colour: string;
    stock: number;
    inStock: boolean;
  }>;
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const query: Record<string, unknown> = {};
  if (filter.productCode) {
    query.productCode = filter.productCode;
  }
  if (filter.inStock !== undefined) {
    query.inStock = filter.inStock;
  }
  if (filter.search) {
    const escaped = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.sku = { $regex: escaped, $options: 'i' };
  }

  const [docs, totalItems] = await Promise.all([
    VariantModel.find(query)
      .select('sku productCode size colour stock inStock')
      .sort({ productCode: 1, colour: 1, size: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean<VariantSummaryDoc[]>(),
    VariantModel.countDocuments(query),
  ]);

  return {
    items: docs.map((doc) => ({
      variantId: doc._id.toString(),
      sku: doc.sku,
      productCode: doc.productCode,
      size: doc.size,
      colour: doc.colour,
      stock: doc.stock,
      inStock: doc.inStock,
    })),
    totalItems,
    page,
    pageSize,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  };
}
