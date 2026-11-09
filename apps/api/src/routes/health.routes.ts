import { Router } from 'express';
import { SERVICE_NAMES, type HealthCheck, type ReadinessResponse } from '@ajooba/contracts';
import { sendSuccess } from '../core/http.js';
import { isDatabaseConnected, pingDatabase } from '../db/connection.js';
import { getRequestId } from '../middleware/error-handler.js';

/**
 * Health-check routes.
 *
 *   GET /health/live  — liveness. Proves the process is up. Never touches Mongo.
 *   GET /health/ready — readiness. Proves the process can serve traffic.
 *
 * Both are intentionally dependency-light so they stay fast and reliable.
 */

export const healthRouter: Router = Router();

/*
 * Version string for this service. Kept next to the route index so the two
 * can never drift.
 */
export const API_VERSION = '0.1.0';

const startedAt = Date.now();

healthRouter.get('/live', (req, res) => {
  sendSuccess(
    res,
    {
      status: 'ok' as const,
      service: 'api' as const,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    },
    getRequestId(req),
  );
});

healthRouter.get('/ready', async (req, res) => {
  const checks: HealthCheck[] = [];

  let databaseStatus: HealthCheck;
  if (!isDatabaseConnected()) {
    databaseStatus = { name: 'mongodb', status: 'error', message: 'Not connected.' };
  } else {
    try {
      const latencyMs = await pingDatabase();
      databaseStatus = { name: 'mongodb', status: 'ok', latencyMs };
    } catch (error) {
      databaseStatus = {
        name: 'mongodb',
        status: 'error',
        message: error instanceof Error ? error.message : 'Ping failed.',
      };
    }
  }
  checks.push(databaseStatus);

  const failed = checks.some((c) => c.status === 'error');
  const degraded = checks.some((c) => c.status === 'degraded');

  const body: ReadinessResponse = {
    status: failed ? 'error' : degraded ? 'degraded' : 'ok',
    service: 'api',
    checks,
    timestamp: new Date().toISOString(),
  };

  sendSuccess(res, body, getRequestId(req), failed ? 503 : 200);
});

/*
 * A machine-readable index of the service's routes. Useful for a fresh
 * developer and for smoke testing. Contains no secrets.
 *
 * This list is kept complete. An index that lists only a handful of routes is
 * worse than no index at all, because a caller treats it as an exhaustive
 * capability list and concludes that an endpoint which 404s was never meant
 * to exist.
 */
healthRouter.get('/', (req, res) => {
  sendSuccess(
    res,
    {
      service: 'api',
      version: API_VERSION,
      services: SERVICE_NAMES,
      endpoints: {
        health: ['GET /health/live', 'GET /health/ready'],
        catalog: [
          'GET /v1/catalog/facets',
          'GET /v1/catalog/products',
          'GET /v1/catalog/products/:slug',
        ],
        content: [
          'GET /v1/content/banners',
          'GET /v1/content/blocks',
          'GET /v1/content/settings',
          'GET /v1/content/homepage',
        ],
        coupons: ['POST /v1/coupons/validate'],
        analytics: ['POST /v1/analytics/events', 'POST /v1/analytics/events/batch'],
        auth: [
          'POST /v1/auth/register',
          'POST /v1/auth/login',
          'POST /v1/auth/refresh',
          'POST /v1/auth/logout',
          'GET /v1/auth/me',
          'PATCH /v1/auth/me',
          'POST /v1/auth/change-password',
          'POST /v1/auth/logout-all',
          'POST /v1/auth/password-reset/request',
          'POST /v1/auth/password-reset/verify',
          'POST /v1/auth/password-reset/complete',
        ],
        cart: [
          'GET /v1/cart',
          'POST /v1/cart/items',
          'PATCH /v1/cart/items/:variantId',
          'DELETE /v1/cart/items/:variantId',
          'DELETE /v1/cart',
          'POST /v1/cart/coupon',
          'DELETE /v1/cart/coupon',
        ],
        wishlist: ['GET /v1/wishlist', 'POST /v1/wishlist', 'DELETE /v1/wishlist/:productId'],
        addresses: [
          'GET /v1/addresses',
          'POST /v1/addresses',
          'PATCH /v1/addresses/:addressId',
          'DELETE /v1/addresses/:addressId',
        ],
        checkout: ['POST /v1/checkout/orders'],
        orders: ['GET /v1/orders', 'GET /v1/orders/:orderNumber'],
        returns: ['POST /v1/returns', 'GET /v1/returns', 'GET /v1/returns/:returnId'],
        exchanges: [
          'POST /v1/exchanges',
          'GET /v1/exchanges',
          'GET /v1/exchanges/options',
          'GET /v1/exchanges/:exchangeId',
        ],
        payments: [
          'GET /v1/payments/configuration',
          'POST /v1/payments/:orderId/intent',
          'POST /v1/payments/:orderId/verify',
          'GET /v1/payments/:orderId',
        ],
        shipments: ['GET /v1/shipments/orders/:orderId/shipment'],
        adminAuth: [
          'POST /v1/admin/auth/login',
          'POST /v1/admin/auth/refresh',
          'POST /v1/admin/auth/logout',
          'GET /v1/admin/auth/me',
          'POST /v1/admin/auth/change-password',
        ],
        adminContent: [
          'GET /v1/admin/content/banners',
          'POST /v1/admin/content/banners',
          'PATCH /v1/admin/content/banners/:bannerId',
          'DELETE /v1/admin/content/banners/:bannerId',
          'PUT /v1/admin/content/blocks',
          'PUT /v1/admin/content/settings',
          'GET /v1/admin/content/homepage/sections',
          'PUT /v1/admin/content/homepage/sections',
          'GET /v1/admin/content/homepage/products',
        ],
        adminCatalog: [
          'GET /v1/admin/catalog/products',
          'POST /v1/admin/catalog/products',
          'GET /v1/admin/catalog/products/:code',
          'PATCH /v1/admin/catalog/products/:code',
          'DELETE /v1/admin/catalog/products/:code',
          'GET /v1/admin/catalog/products/:code/colours',
          'GET /v1/admin/catalog/products/:code/variants',
          'POST /v1/admin/catalog/products/:code/variants',
          'DELETE /v1/admin/catalog/variants/:sku',
          'PATCH /v1/admin/catalog/variants/:sku/photography',
          'POST /v1/admin/catalog/skus/lookup',
          'GET /v1/admin/catalog/skus/:sku',
          'PATCH /v1/admin/catalog/skus/:sku',
          'GET /v1/admin/catalog/skus/:sku/stock',
          'PUT /v1/admin/catalog/skus/:sku/stock',
          'POST /v1/admin/catalog/inventory/stock-set',
          'GET /v1/admin/catalog/categories',
          'POST /v1/admin/catalog/categories',
          'POST /v1/admin/catalog/categories/seed',
          'POST /v1/admin/catalog/categories/reorder',
          'PATCH /v1/admin/catalog/categories/:slug',
          'DELETE /v1/admin/catalog/categories/:slug',
          'GET /v1/admin/catalog/categories/:slug/products',
          'GET /v1/admin/catalog/images/review-queue',
          'GET /v1/admin/catalog/images/:code/coverage',
          'POST /v1/admin/catalog/images/:imageId/assign',
          'POST /v1/admin/catalog/images/:imageId/reject',
          'POST /v1/admin/catalog/images/:imageId/revert',
          'POST /v1/admin/catalog/imports',
          'GET /v1/admin/catalog/imports',
          'GET /v1/admin/catalog/imports/:planId',
          'POST /v1/admin/catalog/imports/:planId/apply',
        ],
        adminOrders: [
          'GET /v1/admin/orders',
          'GET /v1/admin/orders/:orderId',
          'PATCH /v1/admin/orders/:orderId/status',
        ],
        adminPayments: ['GET /v1/admin/payments/:orderId'],
        adminReturns: [
          'GET /v1/admin/returns',
          'PATCH /v1/admin/returns/:returnId',
          'POST /v1/admin/returns/:returnId/refund',
        ],
        adminExchanges: ['GET /v1/admin/exchanges', 'PATCH /v1/admin/exchanges/:exchangeId'],
        adminShipments: [
          'GET /v1/admin/shipments/configuration',
          'GET /v1/admin/shipments',
          'GET /v1/admin/shipments/order/:orderId',
          'GET /v1/admin/shipments/:shipmentId',
          'POST /v1/admin/shipments/orders/:orderId',
          'POST /v1/admin/shipments/:shipmentId/awb',
          'POST /v1/admin/shipments/:shipmentId/pickup',
          'POST /v1/admin/shipments/:shipmentId/cancel',
          'POST /v1/admin/shipments/:shipmentId/refresh',
        ],
        webhooks: [
          'POST /webhooks/razorpay',
          'POST /webhooks/carrier/track',
          'POST /webhooks/shiprocket (legacy alias)',
        ],
        adminAnalytics: [
          'GET /v1/admin/analytics/search-terms',
          'GET /v1/admin/analytics/top-viewed',
          'GET /v1/admin/analytics/events',
          'GET /v1/admin/analytics/insights',
          'GET /v1/admin/analytics/visitors',
          'GET /v1/admin/analytics/visitors/:customerId',
          'GET /v1/admin/analytics/products',
          'GET /v1/admin/analytics/products/:productId',
          'GET /v1/admin/analytics/customer-spectrum',
        ],
        admin: [
          'GET /v1/admin/dashboard',
          'GET /v1/admin/inventory',
          'POST /v1/admin/inventory/adjustments',
          'GET /v1/admin/inventory/movements',
          'GET /v1/admin/coupons',
          'POST /v1/admin/coupons',
          'PATCH /v1/admin/coupons/:couponId',
          'DELETE /v1/admin/coupons/:couponId',
          'POST /v1/admin/coupons/:couponId/preview',
          'GET /v1/admin/customers',
          'GET /v1/admin/audit-logs',
        ],
      },
    },
    getRequestId(req),
  );
});
