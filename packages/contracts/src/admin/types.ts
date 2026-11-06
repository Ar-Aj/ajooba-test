import { z } from 'zod';

/**
 * Administration and content-management contracts.
 *
 * These cover the editable storefront content (banners, homepage sections),
 * the inventory control surface, the audit trail, and the dashboard metrics.
 */

/* -------------------------------------------------------------------------- */
/* Banners                                                                    */
/* -------------------------------------------------------------------------- */

export const BANNER_PLACEMENTS = ['home-hero', 'home-mid', 'home-footer', 'category-top'] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export interface Banner {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly imageUrl: string;
  readonly mobileImageUrl: string | null;
  readonly linkUrl: string;
  readonly placement: BannerPlacement;
  readonly position: number;
  readonly isActive: boolean;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Editable content                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A named, editable block of storefront copy.
 *
 * `key` is a stable identifier the storefront looks up; `value` is the
 * editable text. This lets the business change a headline without a
 * deployment, without ever hardcoding copy in a component.
 */
export interface ContentBlock {
  readonly key: string;
  readonly value: string;
  readonly description: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The result of a stock adjustment.
 *
 * Stock movements are recorded as an append-only ledger so that a stock
 * discrepancy is always explainable.
 */
export interface StockMovement {
  readonly id: string;
  readonly variantId: string;
  readonly sku: string;
  readonly productCode: string;
  readonly delta: number;
  readonly stockBefore: number;
  readonly stockAfter: number;
  readonly reason: StockMovementReason;
  readonly note: string;
  readonly actorId: string | null;
  readonly actorLabel: string;
  readonly createdAt: string;
}

export const STOCK_MOVEMENT_REASONS = [
  'initial-set',
  'correction',
  'restock',
  'sale',
  'return',
  'damage',
  'audit',
] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/* -------------------------------------------------------------------------- */
/* Audit log                                                                  */
/* -------------------------------------------------------------------------- */

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'status-change',
  'stock-adjust',
  'login',
  'import',
  /**
   * A refund was issued at the payment provider.
   *
   * Distinct from `status-change` because moving money backwards is the
   * single most consequential action this platform takes, and it needs to
   * be greppable in the audit trail on its own.
   */
  'refund',
  /*
   * Fulfilment actions. Each one is distinct because they fail in
   * different ways: a dispatch that was never created, an AWB that was
   * never assigned, a parcel that was never collected and a shipment
   * that was called off are four different operational problems.
   * Collapsing them into `update` would make them indistinguishable
   * in the log, and the log is the only record of what the warehouse
   * actually did.
   */
  'shipment-create',
  'shipment-awb',
  'shipment-pickup',
  'shipment-cancel',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditLogEntry {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorEmail: string;
  readonly actorRole: string;
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId: string;
  readonly summary: string;
  /** The before/after diff, stored as JSON. Never contains secrets. */
  readonly changes: Record<string, unknown> | null;
  readonly ip: string | null;
  readonly createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dashboard metrics.
 *
 * Every number here is derived from live records — orders, order items and
 * activity events. There is no seeded or pre-computed metrics collection, so
 * an empty database produces an empty dashboard rather than a plausible
 * lie. See docs/DATA_MODEL.md §8.
 */
export interface DashboardMetrics {
  /** Distinct customers with at least one order in the window. */
  readonly totalCustomers: number;
  readonly totalOrders: number;
  readonly totalRevenue: number;
  readonly averageOrderValue: number;
  readonly totalUnitsSold: number;
  readonly pendingOrders: number;
  readonly processingOrders: number;
  readonly shippedOrders: number;
  readonly completedOrders: number;
  readonly cancelledOrders: number;
  readonly openReturns: number;
  readonly refundedAmount: number;
  /** Order count per day for the window, oldest first. */
  readonly daily: readonly DailyMetric[];
  readonly topProducts: readonly TopProductMetric[];
  readonly generatedAt: string;
}

export interface DailyMetric {
  readonly date: string;
  readonly orders: number;
  readonly revenue: number;
}

export interface TopProductMetric {
  readonly productId: string;
  readonly code: string;
  readonly title: string;
  readonly unitsSold: number;
  readonly revenue: number;
}

/* -------------------------------------------------------------------------- */
/* Analytics events                                                           */
/* -------------------------------------------------------------------------- */

/**
 * First-party activity events.
 *
 * These are recorded from real customer activity so that analytics can be
 * derived rather than invented. The event names are a closed set.
 */
export const ACTIVITY_EVENTS = [
  'product_view',
  'category_view',
  /**
   * A control was touched.
   *
   * One event name for every tap, with the *which* carried by `action` and
   * the *where* by `surface`. The alternative — an event name per control —
   * would put the storefront's control inventory into the event enum, where
   * every new button becomes a migration.
   */
  'interaction',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'checkout_started',
  'order_completed',
  'order_cancelled',
  'return_requested',
  'wishlist_added',
  'coupon_applied',
] as const;
export type ActivityEvent = (typeof ACTIVITY_EVENTS)[number];

/* -------------------------------------------------------------------------- */
/* Schemas                                                                    */
/* -------------------------------------------------------------------------- */

export const bannerPlacementSchema = z.enum(BANNER_PLACEMENTS);

export const bannerInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  subtitle: z.string().trim().max(300).default(''),
  imageUrl: z.string().trim().min(1).max(2048),
  mobileImageUrl: z.string().trim().max(2048).nullable().default(null),
  linkUrl: z.string().trim().max(2048).default(''),
  placement: bannerPlacementSchema,
  position: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
});

export type BannerInput = z.infer<typeof bannerInputSchema>;

export const updateBannerRequestSchema = bannerInputSchema.partial();

export type UpdateBannerRequest = z.infer<typeof updateBannerRequestSchema>;

export const contentBlockInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'Key must be a lowercase dotted identifier'),
  value: z.string().trim().max(2000),
  description: z.string().trim().max(300).default(''),
});

export type ContentBlockInput = z.infer<typeof contentBlockInputSchema>;

export const stockAdjustmentSchema = z.object({
  variantId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid variant id'),
  /** Signed change in units. Negative removes stock. */
  delta: z.coerce
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((v) => v !== 0, {
      message: 'delta must not be zero',
    }),
  reason: z.enum(STOCK_MOVEMENT_REASONS),
  note: z.string().trim().max(500).default(''),
});

export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;

export const stockAdjustmentBatchSchema = z.object({
  adjustments: z.array(stockAdjustmentSchema).min(1).max(500),
  note: z.string().trim().max(500).default(''),
});

export type StockAdjustmentBatch = z.infer<typeof stockAdjustmentBatchSchema>;

export const stockMovementReasonSchema = z.enum(STOCK_MOVEMENT_REASONS);
export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export const adminPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export type AdminPaginationQuery = z.infer<typeof adminPaginationQuerySchema>;

/**
 * The admin customer-list query.
 *
 * `search` is bounded here rather than read raw off `req.query`, so it can
 * never be an unbounded string used as a `$regex`.
 */
export const adminCustomerQuerySchema = adminPaginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
});

export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;

/**
 * The admin inventory-list query.
 *
 * `search` is bounded here rather than read raw off `req.query`, so it can
 * never be an unbounded string used as a `$regex` — even though the
 * service escapes it, an unbounded pattern is still a denial-of-service
 * waiting to happen.
 */
export const adminInventoryQuerySchema = adminPaginationQuerySchema.extend({
  productCode: z.string().trim().max(40).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  inStock: z.enum(['true', 'false']).optional(),
});

export type AdminInventoryQuery = z.infer<typeof adminInventoryQuerySchema>;

export const auditLogQuerySchema = adminPaginationQuerySchema.extend({
  action: auditActionSchema.optional(),
  entity: z.string().trim().max(40).optional(),
  actorId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const dashboardQuerySchema = z.object({
  /** Window in days. Defaults to 30. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Response shapes                                                            */
/* -------------------------------------------------------------------------- */

export const bannerSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  imageUrl: z.string(),
  mobileImageUrl: z.string().nullable(),
  linkUrl: z.string(),
  placement: bannerPlacementSchema,
  position: z.number().int(),
  isActive: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const contentBlockSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: z.string(),
  updatedAt: z.string(),
});

export const stockMovementSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  sku: z.string(),
  productCode: z.string(),
  delta: z.number().int(),
  stockBefore: z.number().int(),
  stockAfter: z.number().int(),
  reason: stockMovementReasonSchema,
  note: z.string(),
  actorId: z.string().nullable(),
  actorLabel: z.string(),
  createdAt: z.string(),
});

export const auditLogEntrySchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string(),
  actorRole: z.string(),
  action: auditActionSchema,
  entity: z.string(),
  entityId: z.string(),
  summary: z.string(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

export const dailyMetricSchema = z.object({
  date: z.string(),
  orders: z.number().int().nonnegative(),
  revenue: z.number().int().nonnegative(),
});

export const topProductMetricSchema = z.object({
  productId: z.string(),
  code: z.string(),
  title: z.string(),
  unitsSold: z.number().int().nonnegative(),
  revenue: z.number().int().nonnegative(),
});

export const dashboardMetricsSchema = z.object({
  totalCustomers: z.number().int().nonnegative(),
  totalOrders: z.number().int().nonnegative(),
  totalRevenue: z.number().int().nonnegative(),
  averageOrderValue: z.number().int().nonnegative(),
  totalUnitsSold: z.number().int().nonnegative(),
  pendingOrders: z.number().int().nonnegative(),
  processingOrders: z.number().int().nonnegative(),
  shippedOrders: z.number().int().nonnegative(),
  completedOrders: z.number().int().nonnegative(),
  cancelledOrders: z.number().int().nonnegative(),
  openReturns: z.number().int().nonnegative(),
  refundedAmount: z.number().int().nonnegative(),
  daily: z.array(dailyMetricSchema),
  topProducts: z.array(topProductMetricSchema),
  generatedAt: z.string(),
});
