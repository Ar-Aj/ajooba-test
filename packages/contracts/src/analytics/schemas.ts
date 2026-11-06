import { z } from 'zod';
import { ACTIVITY_EVENTS } from '../admin/types.js';
import {
  INTERACTION_ACTIONS,
  INTERACTION_DEVICES,
  INTERACTION_SURFACES,
} from './types.js';

/**
 * Analytics event schemas.
 *
 * These are the write side of the interaction ledger. They are strict about
 * what they accept because every field here becomes a row that a report will
 * later group by: a malformed surface or a free-text action does not produce
 * an error the shopper would notice, it produces a report row that never
 * matches anything else and quietly skews a share.
 *
 * The read side lives in `insights.ts`.
 */

export const activityEventNameSchema = z.enum(ACTIVITY_EVENTS);
export const interactionSurfaceSchema = z.enum(INTERACTION_SURFACES);
export const interactionActionSchema = z.enum(INTERACTION_ACTIONS);
export const interactionDeviceSchema = z.enum(INTERACTION_DEVICES);

/**
 * A storefront path, as recorded on an event.
 *
 * A path is not personal data — it is the shape of the shop. A query string
 * very much can be: the search box is a text field, and `?q=my+email` would
 * carry it straight into the analytics collection. So it is cut off here,
 * rather than trusting every caller to remember.
 */
const pathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((value) => value.split('?')[0] ?? '')
  .transform((value) => (value.startsWith('/') ? value : `/${value}`));

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase kebab-case slug');

/**
 * One recorded event.
 *
 * Every field beyond the event name is optional, because the same schema
 * serves a bare page view and a fully-described tap. What is *not* optional is
 * `sessionId`: an event with no session cannot be attributed to anything, and
 * an unattributable row costs storage and answers nothing.
 */
export const recordEventRequestSchema = z.object({
  event: activityEventNameSchema,
  sessionId: z.string().trim().min(8).max(120),
  productId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  variantId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  searchTerm: z.string().trim().max(120).optional(),
  sku: z.string().trim().max(40).optional(),
  quantity: z.coerce.number().int().min(1).max(100).optional(),
  value: z.coerce.number().int().nonnegative().optional(),

  /* --- interaction detail ------------------------------------------------- */
  surface: interactionSurfaceSchema.optional(),
  action: interactionActionSchema.optional(),
  categorySlug: slugSchema.optional(),
  categoryName: z.string().trim().max(80).optional(),
  path: pathSchema.optional(),
});

export type RecordEventRequest = z.infer<typeof recordEventRequestSchema>;

/**
 * A batch of events from one page.
 *
 * Batching exists because a shopper taps a dozen controls without leaving a
 * page, and one request per tap burns the caller's rate-limit budget, costs a
 * round trip each time, and loses most of its events when the visitor
 * navigates away mid-flight. One `sendBeacon` carrying the queued events
 * costs one request and survives the navigation.
 *
 * The cap is deliberately low. A browser with fifty interactions queued is
 * not a browser that needs more capacity; it is one whose queue was never
 * flushed, and a bounded payload keeps any single request cheap.
 */
export const recordEventBatchSchema = z.object({
  sessionId: z.string().trim().min(8).max(120),
  events: z.array(recordEventRequestSchema.omit({ sessionId: true })).min(1).max(25),
});

export type RecordEventBatch = z.infer<typeof recordEventBatchSchema>;

export const activityEventRecordSchema = z.object({
  id: z.string(),
  event: activityEventNameSchema,
  sessionId: z.string(),
  customerId: z.string().nullable(),
  productId: z.string().nullable(),
  variantId: z.string().nullable(),
  searchTerm: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().int().nullable(),
  orderId: z.string().nullable(),
  value: z.number().int().nullable(),
  device: interactionDeviceSchema,
  surface: z.string().nullable(),
  action: z.string().nullable(),
  categorySlug: z.string().nullable(),
  categoryName: z.string().nullable(),
  path: z.string().nullable(),
  occurredAt: z.string(),
});
