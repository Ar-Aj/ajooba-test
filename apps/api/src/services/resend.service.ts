import { readProviderSetting } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ServiceUnavailableError } from '../core/errors.js';

/**
 * Resend transactional email client.
 *
 * Hand-rolled `fetch` against `POST https://api.resend.com/emails`, for the
 * same reason as `razorpay.service.ts`: the REST contract is small, and a
 * direct client keeps the dependency surface minimal while still following
 * the documented request shape exactly.
 *
 * Contract, verified against Resend's own API reference on 23 Oct 2026:
 *
 * ```
 * POST https://api.resend.com/emails
 * Authorization: Bearer re_xxxxxxxxx
 * Content-Type: application/json
 * Idempotency-Key: <optional, <=256 chars, expires after 24h>
 *
 * 200 { "id": "49a3999c-..." }
 * 4xx/5xx { "statusCode": 422, "message": "...", "name": "validation_error" }
 * ```
 *
 * Three documented facts shape this module:
 *
 *  1. **The Node SDK returns `{ data, error }` and does not throw.** A caller
 *     written with only `try/catch` silently "succeeds" on a rejected send.
 *     We therefore check `res.ok` ourselves and never rely on an exception.
 *  2. **The domain must be verified.** Sending from an unverified address is
 *     rejected outright, so `from` is configuration, not a constant.
 *  3. **`Idempotency-Key` is per API request and expires after 24 hours.**
 *     Our durable duplicate suppression lives in MongoDB; this header is a
 *     second, provider-side line of defence for a tight retry window.
 */

const RESEND_BASE = 'https://api.resend.com';

/** The provider's success payload. */
export interface ResendSendResult {
  /** The provider's message id, e.g. `49a3999c-0ce1-4ea6-ab68-afcd6dc2e794`. */
  readonly id: string;
}

/** A failure from the provider, with the status needed to decide on a retry. */
export class ResendApiError extends Error {
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(message: string, httpStatus: number, retryable: boolean) {
    super(message);
    this.name = 'ResendApiError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Can email actually be sent?
 *
 * Requires **both** an API key and a verified sender. A key without a
 * sender is the exact misconfiguration Resend rejects at request time, so it
 * is reported as unconfigured rather than discovered from a bounce.
 */
export function isEmailConfigured(): boolean {
  return Boolean(resendApiKey() && resendFromEmail());
}

/** The API key. Never returned to a caller or placed in a response. */
function resendApiKey(): string | undefined {
  return readProviderSetting('RESEND_API_KEY');
}

/** The verified sender, e.g. `Ajooba Footwear <orders@example.com>`. */
export function resendFromEmail(): string | undefined {
  return readProviderSetting('RESEND_FROM_EMAIL');
}

/** The optional reply-to address, falling back to the sender. */
export function resendReplyTo(): string | undefined {
  return readProviderSetting('RESEND_REPLY_TO') ?? resendFromEmail();
}

/**
 * Recipients allowed to receive real mail outside production.
 *
 * `EMAIL_ALLOWLIST` is a comma-separated list. When `NODE_ENV` is not
 * `production`, a recipient that is not on the list is **not delivered** —
 * the send is recorded as `skipped` instead. This is what makes running the
 * test suite, a staging seed or a local smoke test incapable of emailing a
 * real customer.
 *
 * An empty allowlist means *nothing* is delivered outside production. That is
 * the safe reading: an operator who has not opted in gets no mail.
 */
export function emailAllowlist(): readonly string[] {
  const raw = readProviderSetting('EMAIL_ALLOWLIST');
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * May this recipient actually receive mail right now?
 *
 * In production the allowlist is not consulted at all — it is a development
 * safety mechanism, and consulting it in production would silently break
 * real deliveries.
 */
export function isRecipientAllowed(to: string): boolean {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }
  return emailAllowlist().includes(to.trim().toLowerCase());
}

function requireConfiguration(): { apiKey: string; from: string } {
  const apiKey = resendApiKey();
  const from = resendFromEmail();

  if (!apiKey || !from) {
    throw new ServiceUnavailableError(
      'Transactional email is not configured on this deployment. Set RESEND_API_KEY and ' +
        'RESEND_FROM_EMAIL to enable it.',
    );
  }
  return { apiKey, from };
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Send one email.
 *
 * Returns the provider's message id. Throws `ResendApiError` on any
 * non-2xx, with `retryable` set for the statuses worth trying again.
 *
 * The body deliberately carries **only** documented fields. An unknown field
 * is a validation error, and `tags` are constrained to ASCII letters,
 * digits, `_` and `-` — so the template name is sanitised before use rather
 * than passed through.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side idempotency key; must be stable across retries. */
  idempotencyKey: string;
  /** Used as the Resend `tag` for filtering in the dashboard. */
  tag: string;
}): Promise<ResendSendResult> {
  const { apiKey, from } = requireConfiguration();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${RESEND_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        // A plain-text alternative is sent explicitly rather than letting
        // Resend derive one, so the text a customer sees in a text-only
        // client is written deliberately.
        text: input.text,
        reply_to: resendReplyTo(),
        tags: [{ name: 'template', value: sanitiseTag(input.tag) }],
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const body = (parsed ?? {}) as { message?: string; name?: string };

      /*
       * 429 is the documented rate limit (10 requests/second/team) and 5xx
       * is a provider fault: both are worth retrying. A 4xx means the request
       * itself is wrong, so retrying it unchanged will fail identically.
       */
      const retryable = response.status === 429 || response.status >= 500;

      logger.warn(
        { httpStatus: response.status, retryable, providerName: body.name ?? null },
        'Resend send failed',
      );

      throw new ResendApiError(
        body.message ?? `Resend returned HTTP ${response.status}.`,
        response.status,
        retryable,
      );
    }

    const successBody = (parsed ?? {}) as { id?: unknown };
    if (typeof successBody.id !== 'string' || successBody.id.length === 0) {
      /*
       * A 2xx with no message id is not a delivery we can prove. Treating it
       * as success would write `sent` for a message that may not exist.
       */
      throw new ResendApiError('Resend returned no message id.', 502, true);
    }

    return { id: successBody.id };
  } catch (error) {
    if (error instanceof ResendApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ResendApiError('The email provider did not respond in time.', 504, true);
    }
    throw new ResendApiError('The email provider could not be reached.', 503, true);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make a string safe for a Resend tag.
 *
 * Tags accept only ASCII letters, digits, `_` and `-`, max 256 characters.
 * The template name is our own constant, but sanitising here means a future
 * template with an unusual name degrades to something the provider accepts
 * rather than failing the whole send with a validation error.
 */
export function sanitiseTag(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 256);
}
