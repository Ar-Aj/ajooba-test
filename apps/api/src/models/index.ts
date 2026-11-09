/**
 * Model barrel.
 *
 * Importing the models from one place guarantees that a model is only ever
 * registered once with Mongoose, and makes the collection inventory easy to
 * read at a glance.
 */

export { ProductModel } from './product.model.js';
export { VariantModel } from './variant.model.js';
export { UserModel } from './user.model.js';
export { AdminUserModel } from './admin-user.model.js';
export { RefreshTokenModel } from './refresh-token.model.js';
export { CartModel } from './cart.model.js';
export { OrderModel } from './order.model.js';
export { ReturnRequestModel } from './return-request.model.js';
export { ExchangeRequestModel } from './exchange-request.model.js';
export { PaymentModel } from './payment.model.js';
export { CouponModel } from './coupon.model.js';
export { BannerModel } from './banner.model.js';
export { ContentBlockModel } from './content-block.model.js';
export { StoreSettingsModel } from './store-settings.model.js';
export { StockMovementModel } from './stock-movement.model.js';
export { AuditLogModel } from './audit-log.model.js';
export { ActivityEventModel } from './activity-event.model.js';
export { IdempotencyModel } from './idempotency.model.js';
export { HomepageSectionModel } from './homepage-section.model.js';
export { WebhookEventModel } from './webhook-event.model.js';
export { EmailLogModel } from './email-log.model.js';
export { ShipmentModel } from './shipment.model.js';

export type { ProductDocument } from './product.model.js';
export type { VariantDocument } from './variant.model.js';
export type { UserDocument } from './user.model.js';
export type { AdminUserDocument } from './admin-user.model.js';
export type { CartDocument } from './cart.model.js';
export type { OrderDocument } from './order.model.js';
export type { ReturnRequestDocument } from './return-request.model.js';
export type { ExchangeRequestDocument } from './exchange-request.model.js';
export type { PaymentDocument } from './payment.model.js';
export type { CouponDocument } from './coupon.model.js';
export type { BannerDocument } from './banner.model.js';
export type { StockMovementDocument } from './stock-movement.model.js';
export type { AuditLogDocument } from './audit-log.model.js';
export type { ActivityEventDocument } from './activity-event.model.js';
export type { HomepageSectionDocument } from './homepage-section.model.js';
