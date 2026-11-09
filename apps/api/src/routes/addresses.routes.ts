import { Router } from 'express';
import { Types } from 'mongoose';
import {
  addressInputSchema,
  addressUpdateSchema,
  type AddressInput,
  type AddressUpdateInput,
  type CustomerAddress,
} from '@ajooba/contracts';
import { NotFoundError, UnauthorizedError, ValidationError } from '../core/errors.js';
import { routeParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireCustomer } from '../middleware/auth.js';
import { validateBody, validatedBody } from '../middleware/validate.js';
import { UserModel } from '../models/user.model.js';

/**
 * Customer address book routes (`/v1/addresses`).
 *
 * Persists delivery addresses on the authenticated customer's record so saved
 * addresses follow the customer across devices and can be referenced directly
 * at checkout via `shippingAddressId`.
 */

export const addressesRouter: Router = Router();

interface StoredAddressSubdoc {
  _id: Types.ObjectId;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  isDefault?: boolean | null;
}

function mapAddress(addr: StoredAddressSubdoc): CustomerAddress {
  return {
    id: addr._id.toString(),
    label: addr.label,
    fullName: addr.fullName,
    phone: addr.phone,
    line1: addr.line1,
    line2: addr.line2 ?? '',
    city: addr.city,
    state: addr.state,
    postalCode: addr.postalCode,
    country: addr.country ?? 'India',
    isDefault: Boolean(addr.isDefault),
  };
}

function sortDefaultFirst(items: CustomerAddress[]): CustomerAddress[] {
  return [...items].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/**
 * List the signed-in customer's saved addresses.
 */
addressesRouter.get('/', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const customer = await UserModel.findById(principal.id)
      .select('addresses')
      .lean<{ addresses: StoredAddressSubdoc[] } | null>();

    if (!customer) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }

    const items = sortDefaultFirst((customer.addresses ?? []).map(mapAddress));
    sendSuccess(res, { items, count: items.length }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * Add a new delivery address to the customer's address book.
 */
addressesRouter.post(
  '/',
  requireCustomer,
  validateBody(addressInputSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const body = validatedBody<AddressInput>(req);
      const customer = await UserModel.findById(principal.id);
      if (!customer) {
        throw new UnauthorizedError('Your session is invalid or has expired.');
      }

      const shouldBeDefault = body.isDefault || customer.addresses.length === 0;
      if (shouldBeDefault) {
        for (const existing of customer.addresses) {
          existing.isDefault = false;
        }
      }

      const newId = new Types.ObjectId();
      customer.addresses.push({
        _id: newId,
        label: body.label,
        fullName: body.fullName,
        phone: body.phone,
        line1: body.line1,
        line2: body.line2 ?? '',
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country ?? 'India',
        isDefault: shouldBeDefault,
      });

      await customer.save();

      const created = customer.addresses.find((addr) => addr._id.toString() === newId.toString());

      sendSuccess(
        res,
        mapAddress(
          created ?? {
            _id: newId,
            label: body.label,
            fullName: body.fullName,
            phone: body.phone,
            line1: body.line1,
            line2: body.line2 ?? '',
            city: body.city,
            state: body.state,
            postalCode: body.postalCode,
            country: body.country ?? 'India',
            isDefault: shouldBeDefault,
          },
        ),
        getRequestId(req),
        201,
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Update an existing saved address (including setting it as default).
 */
addressesRouter.patch(
  '/:addressId',
  requireCustomer,
  validateBody(addressUpdateSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      if (!principal) {
        throw new UnauthorizedError('Authentication required.');
      }

      const addressId = routeParam(req, 'addressId');
      if (!Types.ObjectId.isValid(addressId)) {
        throw new ValidationError('Must be a valid address id.');
      }

      const body = validatedBody<AddressUpdateInput>(req);
      const customer = await UserModel.findById(principal.id);
      if (!customer) {
        throw new UnauthorizedError('Your session is invalid or has expired.');
      }

      const target = customer.addresses.find((addr) => addr._id.toString() === addressId);
      if (!target) {
        throw new NotFoundError('Address');
      }

      if (body.label !== undefined) target.label = body.label;
      if (body.fullName !== undefined) target.fullName = body.fullName;
      if (body.phone !== undefined) target.phone = body.phone;
      if (body.line1 !== undefined) target.line1 = body.line1;
      if (body.line2 !== undefined) target.line2 = body.line2;
      if (body.city !== undefined) target.city = body.city;
      if (body.state !== undefined) target.state = body.state;
      if (body.postalCode !== undefined) target.postalCode = body.postalCode;
      if (body.country !== undefined) target.country = body.country;

      if (body.isDefault === true) {
        for (const addr of customer.addresses) {
          addr.isDefault = addr._id.toString() === addressId;
        }
      } else if (body.isDefault === false) {
        target.isDefault = false;
        if (customer.addresses.length > 0 && !customer.addresses.some((addr) => addr.isDefault)) {
          customer.addresses[0]!.isDefault = true;
        }
      }

      await customer.save();

      sendSuccess(res, mapAddress(target), getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Remove a saved address from the customer's address book.
 */
addressesRouter.delete('/:addressId', requireCustomer, async (req, res, next) => {
  try {
    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedError('Authentication required.');
    }

    const addressId = routeParam(req, 'addressId');
    if (!Types.ObjectId.isValid(addressId)) {
      throw new ValidationError('Must be a valid address id.');
    }

    const customer = await UserModel.findById(principal.id);
    if (!customer) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }

    const index = customer.addresses.findIndex((addr) => addr._id.toString() === addressId);
    if (index === -1) {
      throw new NotFoundError('Address');
    }

    customer.addresses.splice(index, 1);

    if (customer.addresses.length > 0 && !customer.addresses.some((addr) => addr.isDefault)) {
      customer.addresses[0]!.isDefault = true;
    }

    await customer.save();

    const items = sortDefaultFirst(customer.addresses.map(mapAddress));
    sendSuccess(res, { deleted: true, items, count: items.length }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});
