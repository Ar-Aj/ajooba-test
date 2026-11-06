import { Router } from 'express';
import {
  adminProductQuerySchema,
  adminVariantQuerySchema,
  applyImportPlanRequestSchema,
  assignImageRequestSchema,
  bulkStockSetRequestSchema,
  categoryQuerySchema,
  categoryProductsQuerySchema,
  createCategoryRequestSchema,
  createImportPlanRequestSchema,
  createProductRequestSchema,
  createVariantRequestSchema,
  imageReviewQuerySchema,
  importPlanListQuerySchema,
  photographyRequestSchema,
  reorderCategoriesRequestSchema,
  reviewImageRequestSchema,
  setStockRequestSchema,
  skuLookupRequestSchema,
  updateCategoryRequestSchema,
  updateProductRequestSchema,
  updateVariantRequestSchema,
  type AdminProductQuery,
  type AdminVariantQuery,
  type ApplyImportPlanRequest,
  type BulkStockSetRequest,
  type CategoryQuery,
  type CategoryProductsQuery,
  type CreateCategoryRequest,
  type CreateImportPlanRequest,
  type CreateProductRequest,
  type CreateVariantRequest,
  type ImageReviewQuery,
  type ImportPlanListQuery,
  type SetStockRequest,
  type UpdateCategoryRequest,
  type UpdateProductRequest,
  type UpdateVariantRequest,
} from '@ajooba/contracts';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { UnauthorizedError } from '../core/errors.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requirePermission } from '../middleware/auth.js';
import { adminWriteLimiter } from '../middleware/rate-limit.js';
import { validateBody, validateQuery, validatedBody, validated } from '../middleware/validate.js';
import {
  assignImage,
  bulkSetStock,
  createCategory,
  createProduct,
  createVariant,
  getImageCoverage,
  getProductByCode,
  getVariant,
  listCategories,
  listColoursForProduct,
  listImageReviewQueue,
  listProductsForAdmin,
  listVariantsForProduct,
  lookupSkus,
  rejectImage,
  reorderCategories,
  retireCategory,
  retireProduct,
  retireVariant,
  revertImage,
  seedCategoriesFromProducts,
  setPhotographyStatus,
  setStock,
  stockHistoryForSku,
  updateCategory,
  updateProduct,
  updateVariant,
  type ActorContext,
} from '../services/catalog-admin.service.js';
import {
  applyImportPlan,
  createImportPlan,
  getImportPlan,
  listImportPlans,
} from '../services/import.service.js';

/**
 * Catalogue administration routes.
 *
 * ## Addressing
 *
 * Products are addressed by their **`A<NN>` code**, never by title or slug.
 * The slug is derived from the title on every save and the title is
 * editable, so an API keyed on the slug would 404 the first time somebody
 * corrected a product name. Variants are addressed by their **`sku`**, which
 * is the merchant's own identifier from the workbook.
 *
 * ## Permissions
 *
 * Every route declares the permission it needs and the check happens
 * server-side. The admin panel's own visibility rules are a convenience.
 * `catalog:read` for reads, `catalog:write` for writes, `inventory:write`
 * for stock, `import:run` for the import trigger.
 *
 * ## Writes
 *
 * Every mutating route appends an audit entry naming the administrator, the
 * entity and the reason. There is no route that hard-deletes a product,
 * variant or category: all three are referenced by historical orders, the
 * stock ledger or the audit log, and are retired instead.
 */

export const adminCatalogRouter: Router = Router();

/**
 * Build the actor context every write is audited with.
 *
 * Read from the authenticated principal, never from the request body — the
 * administrator who performed an action is not a claim the client gets to
 * make.
 */
function actorFrom(req: {
  principal?: { id: string; email: string; role?: string };
  ip?: string;
}): ActorContext {
  const principal = req.principal;
  if (!principal) {
    throw new UnauthorizedError('Authentication required.');
  }
  return {
    actorId: principal.id,
    actorEmail: principal.email,
    actorRole: principal.role ?? 'system',
    ip: req.ip ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* G-1 — Products                                                             */
/* -------------------------------------------------------------------------- */

/** Every design, including drafts and archived ones. */
adminCatalogRouter.get(
  '/products',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(adminProductQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', AdminProductQuery>(req, 'query');
      const result = await listProductsForAdmin(query);

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Seed the category collection from the slugs already in use. */
adminCatalogRouter.post(
  '/categories/seed',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      const result = await seedCategoriesFromProducts(actorFrom(req));
      sendSuccess(res, result, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Read one design by its `A<NN>` code. */
adminCatalogRouter.get(
  '/products/:code',
  requireAdmin,
  requirePermission('catalog:read'),
  async (req, res, next) => {
    try {
      sendSuccess(res, await getProductByCode(routeParam(req, 'code')), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Create a design. A duplicate code is a 409, never an upsert. */
adminCatalogRouter.post(
  '/products',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(createProductRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<CreateProductRequest>(req);
      sendSuccess(res, await createProduct(body, actorFrom(req)), getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/** Update a design in place. Never creates a second parent record. */
adminCatalogRouter.patch(
  '/products/:code',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(updateProductRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<UpdateProductRequest>(req);
      const product = await updateProduct(routeParam(req, 'code'), body, actorFrom(req));
      sendSuccess(res, product, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Archive a design. Soft only — history is retained. */
adminCatalogRouter.delete(
  '/products/:code',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      const product = await retireProduct(routeParam(req, 'code'), actorFrom(req));
      sendSuccess(res, product, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* G-2 — Colour variants                                                      */
/* -------------------------------------------------------------------------- */

/** The colourway rollup for a design: one row per colour, not per SKU. */
adminCatalogRouter.get(
  '/products/:code/colours',
  requireAdmin,
  requirePermission('catalog:read'),
  async (req, res, next) => {
    try {
      const items = await listColoursForProduct(routeParam(req, 'code'));
      sendSuccess(res, { items, count: items.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Every SKU on a design, optionally narrowed to one colour. */
adminCatalogRouter.get(
  '/products/:code/variants',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(adminVariantQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', AdminVariantQuery>(req, 'query');
      const result = await listVariantsForProduct(routeParam(req, 'code'), query);

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Add a colourway to an existing design.
 *
 * `stock` is not accepted: a new SKU is always created at zero and can only
 * be raised through the audited stock ledger.
 */
adminCatalogRouter.post(
  '/products/:code/variants',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(createVariantRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<CreateVariantRequest>(req);
      const result = await createVariant(routeParam(req, 'code'), body, actorFrom(req));
      sendSuccess(res, result, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/** Retire one SKU. Soft only — order lines still reference it. */
adminCatalogRouter.delete(
  '/variants/:sku',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      sendSuccess(
        res,
        await retireVariant(routeParam(req, 'sku'), actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* G-3 — SKU reads                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Batch SKU resolution.
 *
 * A POST body rather than a GET query array: a 674-row stock-take would blow
 * past practical URL lengths, and `missing` has to be distinguishable from
 * "found but out of stock".
 */
adminCatalogRouter.post(
  '/skus/lookup',
  requireAdmin,
  requirePermission('catalog:read'),
  validateBody(skuLookupRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ skus: string[] }>(req);
      sendSuccess(res, await lookupSkus(body.skus), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Read one SKU in full, with the images verified for its colour. */
adminCatalogRouter.get(
  '/skus/:sku',
  requireAdmin,
  requirePermission('catalog:read'),
  async (req, res, next) => {
    try {
      sendSuccess(res, await getVariant(routeParam(req, 'sku')), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** The stock ledger for one SKU. */
adminCatalogRouter.get(
  '/skus/:sku/stock',
  requireAdmin,
  requirePermission('catalog:read'),
  async (req, res, next) => {
    try {
      sendSuccess(res, await stockHistoryForSku(routeParam(req, 'sku')), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Update the editable fields of one SKU. */
adminCatalogRouter.patch(
  '/skus/:sku',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(updateVariantRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<UpdateVariantRequest>(req);
      sendSuccess(
        res,
        await updateVariant(routeParam(req, 'sku'), body, actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Set an absolute stock level for one SKU.
 *
 * Requires a reason and the level the administrator currently believes is on
 * hand, so a stale tab cannot silently overwrite a newer count.
 */
adminCatalogRouter.put(
  '/skus/:sku/stock',
  requireAdmin,
  requirePermission('inventory:write'),
  adminWriteLimiter,
  validateBody(setStockRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<SetStockRequest>(req);
      sendSuccess(
        res,
        await setStock(routeParam(req, 'sku'), body, actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/** Set stock for a batch of SKUs. Defaults to a dry run that writes nothing. */
adminCatalogRouter.post(
  '/inventory/stock-set',
  requireAdmin,
  requirePermission('inventory:write'),
  adminWriteLimiter,
  validateBody(bulkStockSetRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<BulkStockSetRequest>(req);
      const result = await bulkSetStock(
        body.rows,
        body.reason,
        body.note,
        body.dryRun,
        actorFrom(req),
      );
      sendSuccess(res, result, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* G-4 — Categories                                                           */
/* -------------------------------------------------------------------------- */

/** The category tree, with real product counts. */
adminCatalogRouter.get(
  '/categories',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(categoryQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', CategoryQuery>(req, 'query');
      const items = await listCategories(query);
      sendSuccess(res, { items, count: items.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Create a category. */
adminCatalogRouter.post(
  '/categories',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(createCategoryRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<CreateCategoryRequest>(req);
      sendSuccess(res, await createCategory(body, actorFrom(req)), getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/** Bulk reordering. Positions are renumbered so they stay contiguous. */
adminCatalogRouter.post(
  '/categories/reorder',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(reorderCategoriesRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ orderedSlugs: string[] }>(req);
      const items = await reorderCategories(body.orderedSlugs, actorFrom(req));
      sendSuccess(res, { items, count: items.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Update a category. Circular hierarchy is rejected. */
adminCatalogRouter.patch(
  '/categories/:slug',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(updateCategoryRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<UpdateCategoryRequest>(req);
      sendSuccess(
        res,
        await updateCategory(routeParam(req, 'slug'), body, actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Retire a category.
 *
 * Refuses while products still reference it — reassign them first, so
 * nothing is silently un-categorised.
 */
adminCatalogRouter.delete(
  '/categories/:slug',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      sendSuccess(
        res,
        await retireCategory(routeParam(req, 'slug'), actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/** The products assigned to a category. */
adminCatalogRouter.get(
  '/categories/:slug/products',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(categoryProductsQuerySchema),
  async (req, res, next) => {
    try {
      const slug = routeParam(req, 'slug');
      const query = validated<'query', CategoryProductsQuery>(req, 'query');
      const result = await listProductsForAdmin({
        subcategory: slug,
        page: query.page,
        pageSize: query.pageSize,
      });
      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* G-5 — Image review                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The image review queue.
 *
 * Every item carries the evidence a reviewer needs to decide without opening
 * a filesystem: source filename, proposed colour, why the automated rule
 * gave up, the colours this design really sells, and whether this is the
 * last missing photograph for its colour.
 */
adminCatalogRouter.get(
  '/images/review-queue',
  requireAdmin,
  requirePermission('catalog:read'),
  validateQuery(imageReviewQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', ImageReviewQuery>(req, 'query');
      const result = await listImageReviewQueue(query);

      sendSuccess(res, result, getRequestId(req), 200, {
        page: result.page,
        pageSize: result.pageSize,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPreviousPage: result.page > 1,
      });
    } catch (error) {
      next(error);
    }
  },
);

/** Per-design colour coverage: every colour × verified photo count, plus gaps. */
adminCatalogRouter.get(
  '/images/:code/coverage',
  requireAdmin,
  requirePermission('catalog:read'),
  async (req, res, next) => {
    try {
      sendSuccess(res, await getImageCoverage(routeParam(req, 'code')), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Assign a quarantined image to a colour.
 *
 * A reason is mandatory. The colour must be one the design actually sells,
 * and byte-identical imagery may not be assigned to two different colours.
 */
adminCatalogRouter.post(
  '/images/:imageId/assign',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(assignImageRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ colour: string; reason: string }>(req);
      sendSuccess(
        res,
        await assignImage(routeParam(req, 'imageId'), body.colour, body.reason, actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/** Confirm quarantine is correct. The image stays undisplayed. */
adminCatalogRouter.post(
  '/images/:imageId/reject',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(reviewImageRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ reason: string }>(req);
      sendSuccess(
        res,
        await rejectImage(routeParam(req, 'imageId'), body.reason, actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/** Undo an assignment, returning the image to quarantine. */
adminCatalogRouter.post(
  '/images/:imageId/revert',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(reviewImageRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ reason: string }>(req);
      sendSuccess(
        res,
        await revertImage(routeParam(req, 'imageId'), body.reason, actorFrom(req)),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Flip a colourway's photography gate.
 *
 * Refuses to mark a colour verified when the design has no verified
 * photograph for it — the backend guarantee that a colour cannot become
 * sellable because a form was filled in.
 */
adminCatalogRouter.patch(
  '/variants/:sku/photography',
  requireAdmin,
  requirePermission('catalog:write'),
  adminWriteLimiter,
  validateBody(photographyRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<{ status: 'verified' | 'pending-review'; reason: string }>(req);
      sendSuccess(
        res,
        await setPhotographyStatus(
          routeParam(req, 'sku'),
          body.status,
          body.reason,
          actorFrom(req),
        ),
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* G-6 — Controlled catalogue import                                          */
/* -------------------------------------------------------------------------- */

/**
 * Start an import dry run.
 *
 * Requires `import:run`, which is granted to owner/admin/manager. The payload
 * is **uploaded in the request body** — a client may not submit a filesystem
 * path, and this route runs no command. Nothing is written to `products` or
 * `variants`; the only write is the plan record the apply is authorised
 * against.
 */
adminCatalogRouter.post(
  '/imports',
  requireAdmin,
  requirePermission('import:run'),
  adminWriteLimiter,
  validateBody(createImportPlanRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<CreateImportPlanRequest>(req);
      const plan = await createImportPlan(body.payload, body.sourceFilename, actorFrom(req));
      sendSuccess(res, plan, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/** The most recent import plans. */
adminCatalogRouter.get(
  '/imports',
  requireAdmin,
  requirePermission('import:run'),
  validateQuery(importPlanListQuerySchema),
  async (req, res, next) => {
    try {
      const query = validated<'query', ImportPlanListQuery>(req, 'query');
      const items = await listImportPlans(query.limit);
      sendSuccess(res, { items, count: items.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Apply an import plan.
 *
 * Separate from the dry run and requiring `confirm: true` plus the plan's
 * checksum, so an apply is always a deliberate, attributable act against a
 * report the operator has seen.
 */
adminCatalogRouter.post(
  '/imports/:planId/apply',
  requireAdmin,
  requirePermission('import:run'),
  adminWriteLimiter,
  validateBody(applyImportPlanRequestSchema),
  async (req, res, next) => {
    try {
      const body = validatedBody<ApplyImportPlanRequest>(req);
      const result = await applyImportPlan(
        routeParam(req, 'planId'),
        body.payloadChecksum,
        true,
        actorFrom(req),
      );
      sendSuccess(res, result, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/** Read one plan back, including its findings and outcome. */
adminCatalogRouter.get(
  '/imports/:planId',
  requireAdmin,
  requirePermission('import:run'),
  async (req, res, next) => {
    try {
      sendSuccess(res, await getImportPlan(routeParam(req, 'planId')), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);
