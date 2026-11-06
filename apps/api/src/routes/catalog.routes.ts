import { Router } from 'express';
import {
  catalogQuerySchema,
  productSlugParamSchema,
  type CatalogQueryInput,
  type Product,
} from '@ajooba/contracts';
import { NotFoundError } from '../core/errors.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { validateParams, validateQuery, validated } from '../middleware/validate.js';
import {
  getCatalogFacets,
  getProductBySlug,
  getPublicCategories,
  listProducts,
} from '../services/catalog.service.js';

/**
 * Catalogue read routes.
 *
 * GET /v1/catalog/products       — paginated, filterable product list
 * GET /v1/catalog/products/:slug — a single product with its variants
 * GET /v1/catalog/categories     — the live taxonomy the shop navigates by
 * GET /v1/catalog/facets         — facet counts for the filter UI
 *
 * The catalogue is read-only in this phase. Writes happen through the admin
 * API once the import pipeline is in place. No product data is ever seeded
 * from a fixture — every response is served from the real MongoDB catalogue.
 */

export const catalogRouter: Router = Router();

/*
 * The static segment routes are registered BEFORE `/products/:slug` would match
 * them. Express matches in declaration order, and neither `facets` nor
 * `categories` is a valid slug (slugs are lowercase alphanumeric with hyphens),
 * so a product lookup for those literal strings would 404 anyway — but
 * declaring them first makes the intent explicit and removes the question
 * entirely.
 */
catalogRouter.get('/categories', async (req, res, next) => {
  try {
    const categories = await getPublicCategories();
    sendSuccess(res, { items: categories, count: categories.length }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/facets', async (req, res, next) => {
  try {
    const facets = await getCatalogFacets();
    sendSuccess(res, facets, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/products', validateQuery(catalogQuerySchema), async (req, res, next) => {
  try {
    const query = validated<'query', CatalogQueryInput>(req, 'query');
    const result = await listProducts(query);
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
});

catalogRouter.get(
  '/products/:slug',
  validateParams(productSlugParamSchema),
  async (req, res, next) => {
    try {
      const { slug } = validated<'params', { slug: string }>(req, 'params');
      const product: Product | null = await getProductBySlug(slug);
      if (!product) {
        throw new NotFoundError('Product');
      }
      sendSuccess(res, product, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

// Re-exported for convenience (so the type augmentation is loaded once).
export type { Product as CatalogProduct };
