import { Router } from 'express';
import { adminAuthRouter, authRouter } from './auth.routes.js';
import { adminAnalyticsRouter, analyticsRouter } from './analytics.routes.js';
import { adminRouter } from './admin.routes.js';
import { cartRouter, couponValidationRouter } from './cart.routes.js';
import { catalogRouter } from './catalog.routes.js';
import { adminContentRouter, contentRouter } from './content.routes.js';
import { adminCatalogRouter } from './catalog-admin.routes.js';
import {
  adminOrdersRouter,
  adminPaymentsRouter,
  checkoutRouter,
  ordersRouter,
  paymentsRouter,
} from './checkout.routes.js';
import { adminReturnsRouter, returnsRouter } from './returns.routes.js';
import { wishlistRouter } from './wishlist.routes.js';
import { adminShipmentsRouter, orderShippingRouter } from './shipping.routes.js';

/**
 * API version 1 router.
 *
 * Every route under /v1 is mounted from its own sub-router so that new
 * resource groups can be added without changing this file's contract.
 *
 * The mount order matters in one place only: the admin sub-routers are
 * mounted under `/admin`, and the admin *auth* router is mounted at
 * `/admin/auth` so its paths read as `/v1/admin/auth/login`.
 */
export const v1Router: Router = Router();

/* Public, customer-facing ------------------------------------------------- */
v1Router.use('/catalog', catalogRouter);
v1Router.use('/content', contentRouter);
v1Router.use('/coupons', couponValidationRouter);
v1Router.use('/analytics', analyticsRouter);

/* Customer-authenticated -------------------------------------------------- */
v1Router.use('/auth', authRouter);
v1Router.use('/cart', cartRouter);
v1Router.use('/wishlist', wishlistRouter);
v1Router.use('/checkout', checkoutRouter);
v1Router.use('/orders', ordersRouter);
v1Router.use('/shipments', orderShippingRouter);
v1Router.use('/payments', paymentsRouter);
v1Router.use('/returns', returnsRouter);

/* Administrator-only ------------------------------------------------------ */
v1Router.use('/admin/auth', adminAuthRouter);
v1Router.use('/admin/analytics', adminAnalyticsRouter);
v1Router.use('/admin/content', adminContentRouter);
v1Router.use('/admin/catalog', adminCatalogRouter);
v1Router.use('/admin/orders', adminOrdersRouter);
v1Router.use('/admin/payments', adminPaymentsRouter);
v1Router.use('/admin/returns', adminReturnsRouter);
v1Router.use('/admin/shipments', adminShipmentsRouter);
v1Router.use('/admin', adminRouter);
