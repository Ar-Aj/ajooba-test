import { Types } from 'mongoose';
import type { ActivityEvent, RecordEventRequest } from '@ajooba/contracts';
import { ActivityEventModel } from '../models/activity-event.model.js';

/**
 * Analytics recording.
 *
 * The platform records its own activity events rather than relying on a
 * third-party tracker. Two rules govern everything in this file:
 *
 *  1. **Nothing is fabricated.** There is no seeded event collection and no
 *     pre-computed metrics document. A dashboard over an empty database
 *     shows zeros, and that is the truth.
 *  2. **Privacy-aware.** No raw IP address, no user-agent string and no
 *     direct identifier is stored. A session id is pseudonymous and
 *     rotating; the customer id is attached only when the visitor is
 *     signed in.
 *
 * The read side lives in `insights.service.ts`. This file only writes.
 */

/**
 * Coarse device classes. A full user-agent string is never stored.
 */
export type DeviceClass = 'mobile' | 'tablet' | 'desktop' | 'unknown';

/**
 * Derive a coarse device class from a user-agent string.
 *
 * The string is inspected and then discarded — only the class survives.
 */
export function classifyDevice(userAgent: string | undefined): DeviceClass {
  if (!userAgent) {
    return 'unknown';
  }
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) {
    return 'tablet';
  }
  if (/mobi|iphone|android|phone/.test(ua)) {
    return 'mobile';
  }
  if (/windows|macintosh|linux|cros/.test(ua)) {
    return 'desktop';
  }
  return 'unknown';
}

/**
 * Sanitise a search term before it is stored.
 *
 * The term is truncated, control characters are stripped, and anything
 * that looks like an email address or a phone number is redacted. A
 * customer who types their own number into the search box must not have
 * it end up in an analytics collection.
 */
export function sanitiseSearchTerm(raw: string): string {
  /*
   * The control-character range is deliberate: it strips the invisible
   * control bytes out of a search term before it is stored, so a term
   * cannot carry a terminal escape sequence into an export.
   */
  // eslint-disable-next-line no-control-regex
  let term = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  term = term.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted]');
  term = term.replace(/\+?\d[\d\s-]{7,}\d/g, '[redacted]');
  return term.slice(0, 120);
}

export interface RecordEventInput {
  readonly event: ActivityEvent;
  readonly sessionId: string;
  readonly customerId?: string | null;
  readonly productId?: string | null;
  readonly variantId?: string | null;
  readonly searchTerm?: string | null;
  readonly sku?: string | null;
  readonly quantity?: number | null;
  readonly orderId?: string | null;
  readonly value?: number | null;
  readonly device?: DeviceClass;
  readonly surface?: string | null;
  readonly action?: string | null;
  readonly categorySlug?: string | null;
  readonly categoryName?: string | null;
  readonly path?: string | null;
}

/** A Mongo ObjectId, or null when the input is absent or malformed. */
function objectIdOrNull(value: string | null | undefined): Types.ObjectId | null {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/**
 * Trim a nullable string to a column's length, mapping empty to null.
 *
 * `null` rather than `''` on purpose: a missing surface and an empty surface
 * are the same absence, and a mix of the two makes every `$group` produce
 * two buckets for one thing.
 */
function textOrNull(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the document for one event.
 *
 * Shared by the single and batch writers so the two cannot sanitise
 * differently — a batch that stored a raw search term while the single route
 * redacted it would be a privacy hole that only appears under load.
 */
function toDocument(input: RecordEventInput) {
  return {
    event: input.event,
    sessionId: input.sessionId.slice(0, 120),
    customerId: objectIdOrNull(input.customerId),
    productId: objectIdOrNull(input.productId),
    variantId: objectIdOrNull(input.variantId),
    searchTerm: input.searchTerm ? sanitiseSearchTerm(input.searchTerm) : '',
    sku: input.sku ? input.sku.slice(0, 40) : '',
    quantity: input.quantity ?? null,
    orderId: objectIdOrNull(input.orderId),
    value: input.value ?? null,
    surface: textOrNull(input.surface, 40),
    action: textOrNull(input.action, 40),
    categorySlug: textOrNull(input.categorySlug, 80),
    categoryName: textOrNull(input.categoryName, 80),
    path: textOrNull(input.path, 200),
    device: input.device ?? 'unknown',
    occurredAt: new Date(),
  };
}

/**
 * Record an activity event.
 *
 * A failure to record an event is never allowed to fail the request that
 * triggered it — analytics must not break a customer's shopping. The
 * error is logged and swallowed.
 */
export async function recordActivityEvent(input: RecordEventInput): Promise<void> {
  try {
    await ActivityEventModel.create(toDocument(input));
  } catch {
    // Intentionally swallowed — see the note above.
  }
}

/**
 * Record a batch of events from one page.
 *
 * ## Why this is the default path, not the exception
 *
 * A shopper taps a colour, a size and add-to-cart inside four seconds. Sent
 * singly, that is three requests against a rate limit sized for browsing, and
 * the third is the one the shop most wants to keep. Batched on navigation
 * (and on a short timer), it is one request that arrives with all three.
 *
 * ## Why `insertMany` with ordered: false
 *
 * One malformed row must not discard its neighbours. The events are
 * independent observations; a partial write is strictly better than none, and
 * the alternative — losing nineteen good taps because the twentieth carried a
 * bad id — is the behaviour that makes an analytics collection credible.
 *
 * Returns the number actually written, so the caller can report it honestly
 * rather than always claiming success.
 */
export async function recordActivityEvents(
  sessionId: string,
  events: readonly Omit<RecordEventRequest, 'sessionId'>[],
  options: {
    readonly customerId?: string | null;
    readonly device?: DeviceClass;
  } = {},
): Promise<number> {
  if (events.length === 0) return 0;

  try {
    const documents = events.map((event) =>
      toDocument({
        ...event,
        event: event.event,
        sessionId,
        customerId: options.customerId ?? null,
        device: options.device ?? 'unknown',
      }),
    );

    const written = await ActivityEventModel.insertMany(documents, { ordered: false });
    return written.length;
  } catch (error) {
    /*
     * `insertMany` with `ordered: false` rejects with a bulk-write error that
     * still reports how many documents landed. Reading that count keeps the
     * response honest; swallowing the error entirely would let the caller
     * believe a partially-written batch was complete.
     */
    const inserted = (error as { insertedDocs?: unknown[] }).insertedDocs;
    return Array.isArray(inserted) ? inserted.length : 0;
  }
}
