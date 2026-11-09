import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { NotFoundError, UnauthorizedError, ValidationError } from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireCustomer } from '../middleware/auth.js';
import { validateBody, validatedBody } from '../middleware/validate.js';
import { ProductModel } from '../models/product.model.js';
import { UserModel } from '../models/user.model.js';
import { recordActivityEvent } from '../services/analytics.service.js';

/**
 * Wishlist.
 *
 * The wishlist is a list of product ids on the customer record. A product
 * that has since been removed from the catalogue is filtered out of the
 * response rather than being returned as a broken reference.
 */

export const wishlistRouter: Router = Router();

const wishlistBodySchema = z.object({
  productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid product id'),
});

/**
 * Read the wishlist.
 */
wishlistRouter.get('/', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const customer = await UserModel.findById(principal.id)
      .select('wishlist')
      .lean<{ wishlist: Types.ObjectId[] } | null>();

    if (!customer) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }

    const products = await ProductModel.find({ _id: { $in: customer.wishlist } })
      .select('code slug title colours images mrp sellingPrice inStock')
      .lean<Array<Record<string, unknown> & { _id: Types.ObjectId }>>();

    const order = new Map(customer.wishlist.map((id, index) => [id.toString(), index]));
    const items = products
      .map((doc) => ({
        ...doc,
        id: doc._id.toString(),
      }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    sendSuccess(res, { items, count: items.length }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Add a product to the wishlist.
 */
wishlistRouter.post(
  '/',
  requireCustomer,
  validateBody(wishlistBodySchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const body = validatedBody<z.infer<typeof wishlistBodySchema>>(req);

      const product = await ProductModel.findById(body.productId).select('_id').lean();
      if (!product) {
        throw new NotFoundError('Product');
      }

      await UserModel.updateOne(
        { _id: principal.id, wishlist: { $ne: product._id } },
        { $addToSet: { wishlist: product._id } },
      );

      await recordActivityEvent({
        event: 'wishlist_added',
        sessionId: `customer:${principal.id}`,
        customerId: principal.id,
        productId: body.productId,
      });

      const customer = await UserModel.findById(principal.id)
        .select('wishlist')
        .lean<{ wishlist: Types.ObjectId[] } | null>();

      sendSuccess(
        res,
        {
          items: customer?.wishlist.map((id) => id.toString()) ?? [],
          count: customer?.wishlist.length ?? 0,
        },
        getRequestId(req),
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Remove a product from the wishlist.
 */
wishlistRouter.delete('/:productId', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const productId = routeParam(req, 'productId');

    if (!Types.ObjectId.isValid(productId)) {
      throw new ValidationError('Must be a valid product id.');
    }

    await UserModel.updateOne(
      { _id: principal.id },
      { $pull: { wishlist: new Types.ObjectId(productId) } },
    );

    const customer = await UserModel.findById(principal.id)
      .select('wishlist')
      .lean<{ wishlist: Types.ObjectId[] } | null>();

    sendSuccess(
      res,
      {
        items: customer?.wishlist.map((id) => id.toString()) ?? [],
        count: customer?.wishlist.length ?? 0,
      },
      getRequestId(req),
    );
  } catch (error) {
    next(error);
  }
});
