import type { Types } from 'mongoose';
import type { DailyMetric, DashboardMetrics, TopProductMetric } from '@ajooba/contracts';
import { OrderModel } from '../models/order.model.js';
import { ProductModel } from '../models/product.model.js';
import { ReturnRequestModel } from '../models/return-request.model.js';
import { UserModel } from '../models/user.model.js';
/**
 * Dashboard metrics.
 *
 * Every figure below is **derived from live records** at request time:
 * orders, order items, returns and customers. There is no metrics
 * collection, no seeded fixture and no default that stands in for a
 * missing measurement.
 *
 * The practical consequence: on an empty database the dashboard reports
 * zeros, which is the truth. A dashboard that showed plausible revenue
 * before a single order existed would be lying, and the architecture
 * explicitly forbids that (see docs/ARCHITECTURE.md §12).
 */

/**
 * The order statuses that count as real revenue.
 *
 * A cancelled order is not revenue, and a placed-but-unpaid order is not
 * revenue either — it is a pending payment. Only a paid order counts.
 */
const REVENUE_STATUSES: ReadonlyArray<'paid' | 'partially_refunded'> = [
  'paid',
  'partially_refunded',
];

/**
 * The window start, as a Date.
 */
function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * The `YYYY-MM-DD` key for a date, in UTC.
 */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Compute the dashboard metrics for a window.
 */
export async function getDashboardMetrics(days: number): Promise<DashboardMetrics> {
  const since = windowStart(days);

  const [statusCounts, revenueRow, unitsRow, customerCount, openReturns, refundedRow] =
    await Promise.all([
      OrderModel.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      OrderModel.aggregate<{ total: number; orders: number }>([
        {
          $match: {
            createdAt: { $gte: since },
            paymentStatus: { $in: REVENUE_STATUSES },
          },
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, orders: { $sum: 1 } } },
      ]),
      OrderModel.aggregate<{ units: number }>([
        {
          $match: {
            createdAt: { $gte: since },
            paymentStatus: { $in: REVENUE_STATUSES },
          },
        },
        { $unwind: '$items' },
        { $group: { _id: null, units: { $sum: '$items.quantity' } } },
      ]),
      UserModel.countDocuments({ createdAt: { $gte: since } }),
      ReturnRequestModel.countDocuments({ status: { $in: ['requested', 'approved'] } }),
      ReturnRequestModel.aggregate<{ total: number }>([
        { $match: { status: 'refunded' } },
        { $group: { _id: null, total: { $sum: '$refundAmount' } } },
      ]),
    ]);

  const byStatus = new Map(statusCounts.map((row) => [row._id, row.count]));

  const totalRevenue = revenueRow[0]?.total ?? 0;
  const paidOrderCount = revenueRow[0]?.orders ?? 0;
  const totalUnitsSold = unitsRow[0]?.units ?? 0;
  const averageOrderValue = paidOrderCount === 0 ? 0 : Math.round(totalRevenue / paidOrderCount);

  // --- the daily series -------------------------------------------------
  const dailyRows = await OrderModel.aggregate<{ _id: string; orders: number; revenue: number }>([
    {
      $match: {
        createdAt: { $gte: since },
        paymentStatus: { $in: REVENUE_STATUSES },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        revenue: { $sum: '$totalAmount' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const dailyByKey = new Map(dailyRows.map((row) => [row._id, row]));

  /*
   * The series is dense — every day in the window gets a row, even the
   * days with no orders. A sparse series makes a chart lie about the
   * shape of the data.
   */
  const daily: DailyMetric[] = [];
  const dayCount = Math.max(1, days);
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    const key = dayKey(date);
    const row = dailyByKey.get(key);
    daily.push({
      date: key,
      orders: row?.orders ?? 0,
      revenue: row?.revenue ?? 0,
    });
  }

  // --- the top products -------------------------------------------------
  const topRows = await OrderModel.aggregate<{
    _id: Types.ObjectId;
    units: number;
    revenue: number;
  }>([
    {
      $match: {
        createdAt: { $gte: since },
        paymentStatus: { $in: REVENUE_STATUSES },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        units: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { units: -1 } },
    { $limit: 10 },
  ]);

  const productIds = topRows.map((row) => row._id);
  const products = await ProductModel.find({ _id: { $in: productIds } })
    .select('code title')
    .lean<Array<{ _id: Types.ObjectId; code: string; title: string }>>();
  const productsById = new Map(products.map((doc) => [doc._id.toString(), doc]));

  const topProducts: TopProductMetric[] = topRows.map((row) => {
    const product = productsById.get(row._id.toString());
    return {
      productId: row._id.toString(),
      code: product?.code ?? '',
      title: product?.title ?? 'Unknown product',
      unitsSold: row.units,
      revenue: row.revenue,
    };
  });

  return {
    totalCustomers: customerCount,
    totalOrders: statusCounts.reduce((total, row) => total + row.count, 0),
    totalRevenue,
    averageOrderValue,
    totalUnitsSold,
    pendingOrders: byStatus.get('placed') ?? 0,
    processingOrders: byStatus.get('processing') ?? 0,
    shippedOrders: byStatus.get('shipped') ?? 0,
    completedOrders: byStatus.get('completed') ?? 0,
    cancelledOrders: byStatus.get('cancelled') ?? 0,
    openReturns,
    refundedAmount: refundedRow[0]?.total ?? 0,
    daily,
    topProducts,
    generatedAt: new Date().toISOString(),
  };
}
