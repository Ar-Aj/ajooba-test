import { Router } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import {
  bannerInputSchema,
  contentBlockInputSchema,
  homepageConfigSchema,
  productPickerQuerySchema,
  storeSettingsInputSchema,
  type Banner,
  type BannerInput,
  type ContentBlock,
  type ContentBlockInput,
  type HomepageConfigInput,
  type ProductPickerQuery,
  type StoreSettingsInput,
  type UpdateBannerRequest,
} from '@ajooba/contracts';
import { ConflictError, NotFoundError, UnauthorizedError } from '../core/errors.js';
import { routeParam, queryParam } from '../core/params.js';
import { sendSuccess } from '../core/http.js';
import { getRequestId } from '../middleware/error-handler.js';
import { requireAdmin, requirePermission } from '../middleware/auth.js';
import { adminWriteLimiter } from '../middleware/rate-limit.js';
import { validateBody, validateQuery, validated, validatedBody } from '../middleware/validate.js';
import { BannerModel } from '../models/banner.model.js';
import { ContentBlockModel } from '../models/content-block.model.js';
import { writeAuditLog } from '../services/audit.service.js';
import { getStoreSettings, updateStoreSettings } from '../services/store-settings.service.js';
import {
  getResolvedHomepage,
  listSectionsForAdmin,
  currentHomepageVersion,
  saveSections,
} from '../services/homepage.service.js';
import { searchProductsForPicker } from '../services/homepage.service.js';

/**
 * Editable storefront content: banners, content blocks and store settings.
 *
 * The **read** routes are public — the storefront needs them to render.
 * The **write** routes are administrator-only and are permission-checked
 * server-side.
 */

/**
 * A banner row, as it comes back from the database.
 *
 * The lean result is typed explicitly rather than left as a
 * `Record<string, unknown>`, so every field read from it is checked and
 * every value is converted with the right converter.
 */
interface BannerDoc {
  _id: Types.ObjectId;
  title: string;
  subtitle: string;
  imageUrl: string;
  mobileImageUrl: string | null;
  linkUrl: string;
  placement: Banner['placement'];
  position: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A content-block row, as it comes back from the database.
 */
interface ContentBlockDoc {
  _id: Types.ObjectId;
  key: string;
  value: string;
  description: string;
  updatedAt: Date;
}

/**
 * Map a banner row to the contract shape the API returns.
 */
function mapBanner(doc: BannerDoc): Banner {
  return {
    id: doc._id.toString(),
    title: doc.title,
    subtitle: doc.subtitle,
    imageUrl: doc.imageUrl,
    mobileImageUrl: doc.mobileImageUrl,
    linkUrl: doc.linkUrl,
    placement: doc.placement,
    position: doc.position,
    isActive: doc.isActive,
    startsAt: doc.startsAt ? doc.startsAt.toISOString() : null,
    endsAt: doc.endsAt ? doc.endsAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Map a content-block row to the contract shape the API returns.
 */
function mapContentBlock(doc: ContentBlockDoc): ContentBlock {
  return {
    key: doc.key,
    value: doc.value,
    description: doc.description,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export const contentRouter: Router = Router();
export const adminContentRouter: Router = Router();

/**
 * The active banners for a placement.
 */
contentRouter.get('/banners', async (req, res, next) => {
  try {
    const placement = queryParam(req, 'placement');
    const now = new Date();

    const filter: Record<string, unknown> = {
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    };
    if (placement) {
      filter.placement = placement;
    }

    const docs = await BannerModel.find(filter).sort({ position: 1 }).lean<BannerDoc[]>();

    const banners: Banner[] = docs.map(mapBanner);

    sendSuccess(res, { items: banners, count: banners.length }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * The editable content blocks.
 */
contentRouter.get('/blocks', async (req, res, next) => {
  try {
    const docs = await ContentBlockModel.find({}).sort({ key: 1 }).lean<ContentBlockDoc[]>();

    const blocks: ContentBlock[] = docs.map(mapContentBlock);

    sendSuccess(res, { items: blocks, count: blocks.length }, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * The store settings, as the storefront sees them.
 */
contentRouter.get('/settings', async (req, res, next) => {
  try {
    const settings = await getStoreSettings();
    sendSuccess(res, settings, getRequestId(req));
  } catch (error) {
    next(error);
  }
});

/**
 * The published homepage, fully resolved.
 *
 * Public, because the storefront needs it to render. Only sections that can
 * honestly be shown are returned — the backend decides what is renderable,
 * so the storefront never has to guess whether a deal has expired or a
 * product reference is stale.
 */
contentRouter.get('/homepage', async (_req, res, next) => {
  try {
    const sections = await getResolvedHomepage();
    sendSuccess(res, { sections, count: sections.length }, getRequestId(_req));
  } catch (error) {
    next(error);
  }
});

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * List every banner, including the inactive ones.
 */
adminContentRouter.get(
  '/banners',
  requireAdmin,
  requirePermission('content:read'),
  async (req, res, next) => {
    try {
      const docs = await BannerModel.find({})
        .sort({ placement: 1, position: 1 })
        .lean<BannerDoc[]>();

      const banners: Banner[] = docs.map(mapBanner);

      sendSuccess(res, { items: banners, count: banners.length }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Create a banner.
 */
adminContentRouter.post(
  '/banners',
  requireAdmin,
  requirePermission('content:write'),
  adminWriteLimiter,
  validateBody(bannerInputSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<BannerInput>(req);
      const created = await BannerModel.create(body);

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'create',
        entity: 'banner',
        entityId: created._id.toString(),
        summary: `Banner "${created.title}" created.`,
        changes: body,
        ip: req.ip ?? null,
      });

      sendSuccess(res, created, getRequestId(req), 201);
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Homepage merchandising — requires `content:write`                           */
/* -------------------------------------------------------------------------- */

/**
 * Search the real catalogue for the product picker.
 *
 * Read-only, but administrator-scoped: it is the admin's view of the
 * catalogue, and it reports imagery/sellability problems per row.
 */
adminContentRouter.get(
  '/homepage/products',
  requireAdmin,
  requirePermission('content:read'),
  validateQuery(productPickerQuerySchema),
  async (req, res, next) => {
    try {
      /*
       * The **validated** query is used, not `req.query` — `validateQuery`
       * stores its parsed result separately, so reading `req.query` here
       * would bypass the schema's bounds on `search`.
       */
      const query = validated<'query', ProductPickerQuery>(req, 'query');
      const result = await searchProductsForPicker(query);
      sendSuccess(res, result, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Every homepage section, including the hidden ones.
 *
 * The editor needs to see a section that is currently hidden — otherwise an
 * administrator could never re-enable a section that was switched off or has
 * expired.
 */
adminContentRouter.get(
  '/homepage/sections',
  requireAdmin,
  requirePermission('content:read'),
  async (req, res, next) => {
    try {
      const sections = await listSectionsForAdmin();
      // The version MUST be returned: it is the optimistic-concurrency token the
      // client has to echo back on save. Omitting it made every save fail with
      // "saved by someone else" because the client had no valid value to send.
      const version = await currentHomepageVersion();
      sendSuccess(res, { items: sections, count: sections.length, version }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Replace the homepage sections.
 *
 * The schema is validated by Zod before the service runs, and every product
 * and category reference is re-checked server-side, so an invalid or
 * unpublished product can never be promoted to the storefront.
 */
adminContentRouter.put(
  '/homepage/sections',
  requireAdmin,
  requirePermission('content:write'),
  adminWriteLimiter,
  validateBody(homepageConfigSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<HomepageConfigInput>(req);

      const sections = await saveSections(
        body.sections.map((s) => ({
          position: s.position,
          isVisible: s.isVisible,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          config: s.config,
        })),
        body.version,
        principal?.id ?? null,
      );

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'update',
        entity: 'homepage',
        entityId: 'homepage',
        summary: `Homepage saved with ${body.sections.length} section(s).`,
        changes: { publish: body.publish, sections: body.sections.length },
        ip: req.ip ?? null,
      });

      /*
       * Return the new version so the client can keep editing. Without it the
       * editor has no valid token for its *next* save and would be locked out
       * after one successful write.
       */
      const version = await currentHomepageVersion();
      sendSuccess(res, { sections, count: sections.length, version }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Update a banner.
 */
adminContentRouter.patch(
  '/banners/:bannerId',
  requireAdmin,
  requirePermission('content:write'),
  adminWriteLimiter,
  validateBody(bannerInputSchema.partial()),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<UpdateBannerRequest>(req);
      const bannerId = routeParam(req, 'bannerId');

      const existing = await BannerModel.findById(bannerId).lean<BannerDoc | null>();
      if (!existing) {
        throw new NotFoundError('Banner');
      }

      const updated = await BannerModel.findByIdAndUpdate(
        bannerId,
        { $set: body },
        { returnDocument: 'after' },
      ).lean<BannerDoc | null>();

      if (!updated) {
        throw new NotFoundError('Banner');
      }

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'update',
        entity: 'banner',
        entityId: bannerId,
        summary: `Banner "${updated.title}" updated.`,
        changes: body,
        ip: req.ip ?? null,
      });

      sendSuccess(res, updated, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Delete a banner.
 */
adminContentRouter.delete(
  '/banners/:bannerId',
  requireAdmin,
  requirePermission('content:write'),
  adminWriteLimiter,
  async (req, res, next) => {
    try {
      const principal = req.principal;

      const deleted = await BannerModel.findByIdAndDelete(
        routeParam(req, 'bannerId'),
      ).lean<BannerDoc | null>();
      if (!deleted) {
        throw new NotFoundError('Banner');
      }

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'delete',
        entity: 'banner',
        entityId: routeParam(req, 'bannerId'),
        summary: `Banner "${deleted.title}" deleted.`,
        ip: req.ip ?? null,
      });

      sendSuccess(res, { deleted: true }, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Upsert a content block.
 */
adminContentRouter.put(
  '/blocks',
  requireAdmin,
  requirePermission('content:write'),
  adminWriteLimiter,
  validateBody(contentBlockInputSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<ContentBlockInput>(req);

      const updated = await ContentBlockModel.findOneAndUpdate(
        { key: body.key },
        { $set: body },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ).lean<ContentBlockDoc | null>();

      if (!updated) {
        throw new NotFoundError('Content block');
      }

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'update',
        entity: 'content_block',
        entityId: updated._id.toString(),
        summary: `Content block "${updated.key}" updated.`,
        changes: { key: updated.key, value: updated.value },
        ip: req.ip ?? null,
      });

      sendSuccess(res, updated, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Update the store settings.
 */
adminContentRouter.put(
  '/settings',
  requireAdmin,
  requirePermission('settings:write'),
  adminWriteLimiter,
  validateBody(storeSettingsInputSchema),
  async (req, res, next) => {
    try {
      const principal = req.principal;
      const body = validatedBody<StoreSettingsInput>(req);

      const settings = await updateStoreSettings(body);

      await writeAuditLog({
        actorId: principal?.id ?? null,
        actorEmail: principal?.email ?? 'system',
        actorRole: principal?.role ?? 'system',
        action: 'update',
        entity: 'store_settings',
        entityId: 'default',
        summary: 'Store settings updated.',
        changes: body,
        ip: req.ip ?? null,
      });

      sendSuccess(res, settings, getRequestId(req));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The list of known content block keys, so the admin panel can offer a
 * fixed set of editable fields rather than a free-text editor.
 */
export const contentBlockKeySchema = z.object({
  key: z.string().trim().min(2).max(60),
});

/**
 * Guard used by the content-key route so a missing key is a validation
 * error rather than an unhandled exception.
 */
export function assertContentKey(value: string): void {
  const result = contentBlockKeySchema.safeParse({ key: value });
  if (!result.success) {
    throw new ConflictError('Invalid content block key.');
  }
}

/**
 * Guard used when the current administrator identity is required.
 */
export function assertAuthenticated(principal: { id: string } | undefined): void {
  if (!principal) {
    throw new UnauthorizedError('Authentication required.');
  }
}
