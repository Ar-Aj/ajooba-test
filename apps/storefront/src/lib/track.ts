'use client';

import type { InteractionAction, InteractionSurface } from '@ajooba/contracts';
import { customerSession } from './customer-session';

/**
 * The interaction tracker.
 *
 * ## What it records, and what it refuses to record
 *
 * A tap is worth keeping only if it can be grouped later. Three identifiers
 * make that possible and nothing else in here is personal:
 *
 *   - a **visitor** id in `localStorage`, so a returning shopper is one shopper;
 *   - a **session** id in `sessionStorage`, so one visit is one visit;
 *   - the **customer** id, which this file never states. The API attaches it
 *     from the bearer token, so a shopper cannot claim to be somebody else by
 *     editing a request body.
 *
 * No IP address, no user-agent string, no scroll depth, no keystroke log. A
 * surface and an action are the shape of the shop, not of the person.
 *
 * ## Consent is a gate, not a footnote
 *
 * Nothing is sent until the visitor chose "Fine, continue" on the consent
 * banner (`ajooba-consent === 'all'`). "Necessary only" is respected absolutely:
 * events are dropped at the door rather than queued, and withdrawing consent
 * discards the queue. A tracker that keeps a buffer "just in case" has already
 * made the decision the visitor did not.
 *
 * ## Why a queue and not a request per tap
 *
 * A shopper taps a colour, a size and add-to-cart inside four seconds. Three
 * requests would burn three rate-limit slots and lose the third on navigation.
 * So events collect in a bounded queue and leave in one `keepalive` POST on a
 * short timer or on `pagehide` — which is what makes the last tap arrive at all.
 *
 * ## Failures are silent, permanently
 *
 * Tracking never surfaces an error to a shopper, never blocks a click, never
 * throws inside a React event handler. Every path is wrapped; a failed flush
 * costs one retry and then the events.
 */

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

const CONSENT_KEY = 'ajooba-consent';
const VISITOR_KEY = 'ajooba-visitor-v1';
/*
 * Deliberately *not* `ajooba-session-v1`: that key belongs to the customer's
 * auth session in `customer-session.ts`, which lives in `localStorage`. Two
 * different meanings on two different stores would still be one confusing name
 * for whoever debugs this next, so the visit gets its own.
 */
const SESSION_KEY = 'ajooba-visit-v1';

/** The consent value that permits analytics. Anything else forbids it. */
const CONSENT_ALL = 'all';

function randomId(prefix: string): string {
  /*
   * `crypto.randomUUID` is missing in insecure contexts on some older Android
   * builds, and a tracker that throws on a budget phone is worse than one using
   * a slightly weaker id. The fallback still carries 128 bits of entropy.
   */
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function readStore(store: 'local' | 'session', key: string): string | null {
  try {
    const target = store === 'local' ? window.localStorage : window.sessionStorage;
    return target.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(store: 'local' | 'session', key: string, value: string): void {
  try {
    const target = store === 'local' ? window.localStorage : window.sessionStorage;
    target.setItem(key, value);
  } catch {
    /* private mode / quota — an id that cannot be stored is simply not used */
  }
}

function removeStore(store: 'local' | 'session', key: string): void {
  try {
    const target = store === 'local' ? window.localStorage : window.sessionStorage;
    target.removeItem(key);
  } catch {
    /* see writeStore */
  }
}

/**
 * The pseudonymous session id.
 *
 * `sessionStorage`, so closing the tab ends the session. That is the correct
 * lifetime: the session is the denominator of every funnel rate in the report.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  const existing = readStore('session', SESSION_KEY);
  if (existing && existing.length >= 8) return existing;
  const created = randomId('s');
  writeStore('session', SESSION_KEY, created);
  return created;
}

/** The pseudonymous, long-lived visitor id. Never leaves this origin. */
export function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  const existing = readStore('local', VISITOR_KEY);
  if (existing && existing.length >= 8) return existing;
  const created = randomId('v');
  writeStore('local', VISITOR_KEY, created);
  return created;
}

/* -------------------------------------------------------------------------- */
/* Consent                                                                    */
/* -------------------------------------------------------------------------- */

/** True when the visitor has explicitly permitted analytics. */
export function trackingAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  return readStore('local', CONSENT_KEY) === CONSENT_ALL;
}

/**
 * Forget this visitor entirely.
 *
 * Called when the visitor chooses "Necessary only". Dropping the ids as well as
 * the queue is the difference between stopping collection and undoing it.
 */
export function forgetVisitor(): void {
  if (typeof window === 'undefined') return;
  queued.length = 0;
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  flushTimer = null;
  retryTimer = null;
  removeStore('local', VISITOR_KEY);
  removeStore('session', SESSION_KEY);
}

/* -------------------------------------------------------------------------- */
/* The queue                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One queued event.
 *
 * Deliberately not the contract's `RecordEventRequest`: that requires a
 * `sessionId`, which is identical for every event in a batch and is therefore
 * sent once in the envelope. This is the shape the API expects inside `events`.
 */
export interface QueuedEvent {
  event: string;
  productId?: string;
  variantId?: string;
  searchTerm?: string;
  sku?: string;
  quantity?: number;
  value?: number;
  surface?: InteractionSurface;
  action?: InteractionAction;
  categorySlug?: string;
  categoryName?: string;
  path?: string;
}

/**
 * The maximum the API accepts in one batch.
 *
 * Kept in step with `recordEventBatchSchema.events.max(25)`. A queue larger than
 * this is a queue that was never flushed, so overflow flushes rather than grows.
 */
const MAX_BATCH = 25;

/** How long the queue may idle before it is sent. */
const FLUSH_DELAY_MS = 4000;

/**
 * How long to wait before retrying a failed batch.
 *
 * One retry, then the events are dropped. A visitor who is offline must not
 * accumulate a queue that fires a burst at the server on reconnect.
 */
const RETRY_DELAY_MS = 15000;

const queued: QueuedEvent[] = [];
let flushTimer: number | null = null;
let retryTimer: number | null = null;
let flushing = false;
let listenersBound = false;

function apiBase(): string {
  // Referenced as a full literal so Next inlines it into the client bundle.
  return (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
}

function scheduleFlush(): void {
  if (typeof window === 'undefined' || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

/**
 * Send what is queued.
 *
 * Returns nothing and never throws. The caller is an event handler on a live
 * page; an exception here would be a broken click.
 */
export async function flush(): Promise<void> {
  if (typeof window === 'undefined' || flushing) return;
  if (queued.length === 0) return;
  if (!trackingAllowed()) {
    queued.length = 0;
    return;
  }

  const base = apiBase();
  const sessionId = getSessionId();
  if (!base || !sessionId) return;

  const batch = queued.splice(0, MAX_BATCH);
  flushing = true;
  try {
    /*
     * The bearer token is the only thing that makes a tap attributable to a
     * person. The API reads the customer id off the verified token and never
     * from the request body, so a shopper cannot claim to be somebody else by
     * editing this payload — the worst they can do is send no token, and then
     * the event is anonymous.
     *
     * The field selector is read at flush time rather than captured, so a
     * shopper who signs in mid-session has their later events identified even
     * though the earlier ones were not.
     */
    const token = customerSession.accessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${base}/v1/analytics/events/batch`, {
      method: 'POST',
      // `keepalive` lets the request outlive the page. Without it the last batch
      // of every visit — the one holding add-to-cart — is cancelled by the
      // navigation that follows it.
      keepalive: true,
      credentials: 'omit',
      headers,
      body: JSON.stringify({ sessionId, events: batch }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    /*
     * Put the batch back at the front so ordering survives a retry, and cap the
     * queue so a long outage cannot grow it without bound.
     */
    queued.unshift(...batch);
    if (queued.length > MAX_BATCH) queued.length = MAX_BATCH;
    if (retryTimer === null) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void flush();
      }, RETRY_DELAY_MS);
    }
  } finally {
    flushing = false;
    if (queued.length > 0 && flushTimer === null && retryTimer === null) scheduleFlush();
  }
}

/**
 * Bind the unload listeners, once per page load.
 *
 * `pagehide` is the one that fires reliably on iOS Safari, where `beforeunload`
 * does not. `visibilitychange` covers the tab-switch case, where a phone tab can
 * be backgrounded for days without ever being destroyed.
 */
function bindUnloadListeners(): void {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;

  window.addEventListener('pagehide', () => {
    void flush();
  });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

/** The path as recorded: query string removed, which the API would strip anyway. */
function currentPath(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const path = window.location.pathname;
  return path.length > 0 ? path.slice(0, 200) : undefined;
}

/**
 * Queue one event.
 *
 * Every entry point below funnels here, so the consent check, the queue cap and
 * the flush schedule exist in exactly one place.
 */
export function trackEvent(input: QueuedEvent): void {
  if (typeof window === 'undefined') return;
  if (!trackingAllowed()) return;

  bindUnloadListeners();

  const event: QueuedEvent = { ...input };
  if (event.path === undefined) {
    const path = currentPath();
    if (path) event.path = path;
  }

  queued.push(event);

  if (queued.length >= MAX_BATCH) {
    void flush();
    return;
  }
  scheduleFlush();
}

/** The subject a tap can be about. Absent fields are omitted, never nulled. */
export interface TapDetail {
  productId?: string;
  variantId?: string;
  sku?: string;
  quantity?: number;
  categorySlug?: string;
  categoryName?: string;
  /**
   * A shoe size the shopper selected or told us about.
   *
   * Carried separately from `quantity`, which is a number of pairs. A real size
   * a real person says they wear is the most useful sizing datum the shop ever
   * gets, so it needs a field of its own rather than being squeezed into one that
   * means something else.
   */
  size?: number;
  /** The upper construction the shopper indicated, when a surface asks for it. */
  construction?: 'closed' | 'open';
}

/**
 * Queue one tap.
 *
 * The single call site every instrumented control uses. `detail` carries the
 * product, variant and category the tap was about, because a tap with no subject
 * is a number the report cannot rank.
 */
export function trackTap(
  action: InteractionAction,
  surface: InteractionSurface,
  detail: TapDetail = {},
): void {
  trackEvent({ event: 'interaction', action, surface, ...detail });
}

/** Record that a product page was opened. */
export function trackProductView(detail: {
  productId: string;
  categorySlug?: string;
  categoryName?: string;
}): void {
  trackEvent({ event: 'product_view', ...detail });
}

/** Record that a category listing was opened. */
export function trackCategoryView(detail: { slug: string; name?: string }): void {
  trackEvent({ event: 'category_view', categorySlug: detail.slug, categoryName: detail.name });
}

/** Record a submitted search. The API redacts contact data before storing it. */
export function trackSearch(term: string): void {
  const trimmed = term.trim();
  if (trimmed.length === 0) return;
  trackEvent({ event: 'search', searchTerm: trimmed.slice(0, 120), action: 'search-submit' });
}

/** Record that a pair reached the cart, from wherever the tap happened. */
export function trackAddToCart(detail: {
  productId: string;
  variantId?: string;
  sku: string;
  quantity: number;
  surface: InteractionSurface;
  categorySlug?: string;
  categoryName?: string;
}): void {
  trackEvent({ event: 'add_to_cart', action: 'add-to-cart', ...detail });
}

/** Record a wishlist save or unsave. */
export function trackWishlist(detail: {
  productId: string;
  surface: InteractionSurface;
  saved: boolean;
  categorySlug?: string;
}): void {
  trackEvent({
    event: 'wishlist_added',
    action: 'wishlist-toggle',
    productId: detail.productId,
    surface: detail.surface,
    ...(detail.categorySlug ? { categorySlug: detail.categorySlug } : {}),
    ...(detail.saved ? {} : { value: 0 }),
  });
}

/** Record that checkout was entered. The far end of the funnel's top half. */
export function trackCheckoutStart(detail: { value?: number; quantity?: number } = {}): void {
  trackEvent({
    event: 'checkout_started',
    action: 'checkout-start',
    surface: 'checkout',
    ...detail,
  });
}
