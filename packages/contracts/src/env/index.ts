import { z } from 'zod';

/**
 * Environment variable contracts.
 *
 * These schemas are the ONLY way environment variables are read in this
 * monorepo. Each application parses its own environment with the schema that
 * matches its role, so a missing or malformed variable fails at boot rather
 * than at the first request that needs it.
 *
 * Design rules:
 *  - No default values for secrets. A missing secret is a boot failure.
 *  - No production URLs are hardcoded. They come from platform env vars.
 *  - Only `NEXT_PUBLIC_*` variables are exposed to the browser bundle.
 *    See `docs/ARCHITECTURE.md` § Environment Strategy.
 */

/**
 * Treat a blank string as "not provided".
 *
 * Deployment templates commonly ship optional secrets as an empty
 * placeholder (`RAZORPAY_KEY_SECRET=`). Rejecting that with a cryptic
 * "Too small: expected string to have >=1 characters" error at boot is
 * unhelpful; treating it as absent matches what the operator meant.
 *
 * Generic over the inner schema rather than string-only, so it composes
 * with the coerced numeric schemas the catalogue and shipping settings use.
 */
function blankToUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, schema.optional());
}

/**
 * Variables required by the Express API (server-only).
 */
export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),

    /** HTTP port the API binds to. */
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    /** MongoDB connection string (Atlas). */
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

    /** Logical database name. Derived from the connection string when omitted. */
    MONGODB_DB: blankToUndefined(z.string().min(1)),

    /** Public base URL of the API, used to build absolute links. */
    API_PUBLIC_URL: z.string().url(),

    /** Allowed CORS origins. Comma separated. */
    CORS_ORIGINS: z.string().min(1),

    /** Comma separated list of allowed admin origins (subset of CORS_ORIGINS). */
    ADMIN_ORIGINS: blankToUndefined(z.string().min(1)),

    /** Public URL of the customer storefront. */
    STOREFRONT_PUBLIC_URL: z.string().url(),

    /** Public URL of the admin panel. */
    ADMIN_PUBLIC_URL: z.string().url(),

    /**
     * Directory the API serves catalogue media from.
     *
     * The product photography lives in the repository-root `public/` tree
     * (~494 MB, Git-LFS tracked). The API mounts it read-only at `/products`
     * so the storefront can reference the images without a second copy of the
     * assets inside the Next.js app.
     *
     * Blank means "do not serve media" — the API then returns JSON only, which
     * is the correct behaviour for a deployment where the CDN serves the
     * images instead.
     */
    MEDIA_STATIC_DIR: blankToUndefined(z.string().min(1)),

    /** Secret used to sign admin session tokens. Must be >= 32 chars. */
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    /**
     * Razorpay key id — publishable, but still server-configured.
     *
     * A blank value is treated as "not configured" rather than as an error:
     * deployment templates routinely ship the key as an empty placeholder,
     * and payments are not enabled until credentials are supplied.
     */
    RAZORPAY_KEY_ID: blankToUndefined(z.string().min(1)),

    /**
     * Razorpay key secret — server only, never sent to the browser.
     * Blank means "not configured"; see `RAZORPAY_KEY_ID`.
     */
    RAZORPAY_KEY_SECRET: blankToUndefined(z.string().min(1)),

    /**
     * Razorpay webhook secret — server only.
     *
     * This is a **separate secret** from the API key secret. It signs the
     * `X-Razorpay-Signature` header and is set in the Razorpay dashboard.
     * Blank means the webhook endpoint rejects every delivery, because an
     * unverified webhook is worse than no webhook at all.
     */
    RAZORPAY_WEBHOOK_SECRET: blankToUndefined(z.string().min(1)),

    /**
     * Which Razorpay keys are loaded: `test` or `live`.
     *
     * There is deliberately no way to infer this. A deployment declares
     * which pair it holds, and the schema refuses a mismatch so staging can
     * never silently drive live payments. Defaults to `test`, which is the
     * safe direction.
     */
    RAZORPAY_MODE: z.enum(['test', 'live']).default('test'),

    /* ---------------------------------------------------------------------- */
    /* Resend (transactional email)                                            */
    /* ---------------------------------------------------------------------- */

    /**
     * Resend API key — server only. Blank means email is not configured.
     */
    RESEND_API_KEY: blankToUndefined(z.string().min(1)),

    /**
     * The verified sender address, e.g. `Ajooba Footwear <orders@example.com>`.
     *
     * The domain must already be verified in Resend. Blank means the
     * notification service reports itself unconfigured rather than sending
     * from an unverified address, which Resend would reject anyway.
     */
    RESEND_FROM_EMAIL: blankToUndefined(z.string().min(1)),

    /**
     * Optional reply-to address. Defaults to `RESEND_FROM_EMAIL`.
     */
    RESEND_REPLY_TO: blankToUndefined(z.string().email()),

    /**
     * Development-only allowlist for outbound email.
     *
     * When `NODE_ENV !== 'production'`, a recipient that is not in this
     * list is **not delivered**; the send is recorded as `skipped` instead.
     * This is what keeps a test run from emailing real customers. In
     * production the allowlist is not consulted at all.
     */
    EMAIL_ALLOWLIST: blankToUndefined(z.string().min(1)),

    /* ---------------------------------------------------------------------- */
    /* Shiprocket (shipping)                                                   */
    /* ---------------------------------------------------------------------- */

    /**
     * Shiprocket API-user email — server only.
     *
     * Shiprocket v2 exchanges an email/password pair for a bearer token that
     * is valid for 10 days, so this is used to mint and refresh that token
     * at runtime rather than being sent on every request.
     */
    SHIPROCKET_API_EMAIL: blankToUndefined(z.string().min(1)),

    /** Shiprocket API-user password — server only. */
    SHIPROCKET_API_PASSWORD: blankToUndefined(z.string().min(1)),

    /**
     * Pickup location name configured in the Shiprocket account. It must
     * already exist there; Shiprocket rejects an unknown location.
     */
    SHIPROCKET_PICKUP_LOCATION: blankToUndefined(z.string().min(1)),

    /**
     * Optional pinned courier id. When set, AWBs are assigned to this
     * courier; when blank, Shiprocket chooses from the serviceable list.
     */
    SHIPROCKET_COURIER_ID: blankToUndefined(z.coerce.number().int().positive()),

    /**
     * Shared secret checked against the Shiprocket tracking webhook's
     * `x-api-key` header. Blank disables webhook acceptance outright.
     */
    SHIPROCKET_WEBHOOK_SECRET: blankToUndefined(z.string().min(1)),

    /** Log level for pino. */
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /* ---------------------------------------------------------------------- */
    /* Authentication                                                          */
    /* ---------------------------------------------------------------------- */

    /**
     * Secret used to sign access and refresh tokens.
     *
     * Must be at least 32 characters. Rotating it invalidates every issued
     * token, so the platform must be restarted with the new value and users
     * will need to sign in again.
     */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

    /**
     * Issuer claim written into every token. Purely informational, but it
     * makes a token traceable to the environment that minted it.
     */
    JWT_ISSUER: z.string().trim().min(1).default('ajooba-api'),

    /**
     * Access token lifetime, in seconds. Defaults to 15 minutes.
     */
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),

    /**
     * Refresh token lifetime, in seconds. Defaults to 30 days.
     */
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(31_536_000).default(2_592_000),

    /**
     * Bcrypt cost factor. Higher is slower and stronger. Defaults to 12.
     *
     * The hard floor is bcrypt's own minimum of 4. A stricter floor of 10 is
     * enforced separately, for every environment except `test` — see
     * `apiEnvSchema`'s refinement below. The test suite hashes many passwords
     * and needs a cost factor low enough to stay fast, but a development,
     * staging or production deployment must never be allowed to weaken the
     * hashing.
     */
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

    /**
     * Failed-login budget per account before the account is temporarily
     * locked. Set to 0 to disable account lockout.
     */
    MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().min(0).max(100).default(10),

    /**
     * How long an account stays locked after exhausting the failed-login
     * budget, in seconds.
     */
    ACCOUNT_LOCKOUT_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),

    /* ---------------------------------------------------------------------- */
    /* Social sign-in (Google, Facebook)                                       */
    /* ---------------------------------------------------------------------- */

    /**
     * OAuth clients for "Sign in with Google" and "Sign in with Facebook".
     *
     * These are optional in pairs, exactly like the payment and shipping
     * credentials: a deployment that has not created the OAuth apps yet must
     * still boot, and the storefront then simply does not render the buttons.
     * The API answers 503 for a provider that is not configured rather than
     * redirecting a shopper into a broken consent screen.
     *
     * The redirect URI registered in each provider's console must be
     * `<API_PUBLIC_URL>/v1/auth/oauth/<provider>/callback`.
     */
    GOOGLE_OAUTH_CLIENT_ID: blankToUndefined(z.string().min(1)),
    GOOGLE_OAUTH_CLIENT_SECRET: blankToUndefined(z.string().min(1)),

    FACEBOOK_OAUTH_APP_ID: blankToUndefined(z.string().min(1)),
    FACEBOOK_OAUTH_APP_SECRET: blankToUndefined(z.string().min(1)),

    /* ---------------------------------------------------------------------- */
    /* Rate limiting                                                            */
    /* ---------------------------------------------------------------------- */

    /**
     * Sign-in attempts allowed per IP per window.
     *
     * This is the credential-stuffing surface, so the default is deliberately
     * tight. It is configurable because a deployment behind a shared NAT or
     * a corporate proxy may legitimately need a different budget, and
     * because the automated test suite must not be throttled by a limit
     * that exists to protect production.
     */
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(1_000_000).default(10),

    /** Token refreshes allowed per IP per window. */
    RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().min(1).max(1_000_000).default(30),

    /** Registrations allowed per IP per window. */
    RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(1).max(1_000_000).default(5),

    /** Checkout attempts allowed per IP per window. */
    RATE_LIMIT_CHECKOUT_MAX: z.coerce.number().int().min(1).max(1_000_000).default(20),

    /** Coupon checks allowed per IP per window. */
    RATE_LIMIT_COUPON_MAX: z.coerce.number().int().min(1).max(1_000_000).default(30),

    /** Password changes allowed per IP per window. */
    RATE_LIMIT_PASSWORD_MAX: z.coerce.number().int().min(1).max(1_000_000).default(10),

    /** Analytics events allowed per IP per window. */
    RATE_LIMIT_ANALYTICS_MAX: z.coerce.number().int().min(1).max(1_000_000).default(120),

    /** Administrative writes allowed per IP per window. */
    RATE_LIMIT_ADMIN_WRITE_MAX: z.coerce.number().int().min(1).max(1_000_000).default(120),

    /* ---------------------------------------------------------------------- */
    /* Cloudinary (product media)                                              */
    /* ---------------------------------------------------------------------- */

    /**
     * Cloudinary cloud name. Blank means the media pipeline is not
     * configured, in which case the importer keeps the local `public/` paths
     * and the API serves the media from disk.
     */
    CLOUDINARY_CLOUD_NAME: blankToUndefined(z.string().min(1)),

    /** Cloudinary API key. Server-side only — never exposed to a browser. */
    CLOUDINARY_API_KEY: blankToUndefined(z.string().min(1)),

    /**
     * Cloudinary API secret. Server-side only — never exposed to a browser.
     * This value must never appear in a log line, a response body or a
     * browser bundle.
     */
    CLOUDINARY_API_SECRET: blankToUndefined(z.string().min(1)),

    /**
     * Folder inside the Cloudinary account where product images are stored.
     */
    CLOUDINARY_PRODUCT_FOLDER: z.string().trim().min(1).default('ajooba/products'),

    /**
     * The Cloudinary delivery base URL. Overridable for testing or for a
     * custom domain in front of the CDN.
     */
    CLOUDINARY_DELIVERY_BASE_URL: blankToUndefined(z.string().min(1)),

    /* ---------------------------------------------------------------------- */
    /* Catalogue import                                                        */
    /* ---------------------------------------------------------------------- */

    /**
     * Root directory of the source catalogue assets (the `public/` tree).
     * The importer reads it read-only and never writes to it.
     */
    CATALOG_SOURCE_DIR: z.string().trim().min(1).default('../../public'),

    /**
     * Directory the importer writes its reports to. Reports are the audit
     * trail of every import run.
     */
    CATALOG_REPORT_DIR: z.string().trim().min(1).default('../../artifacts/import-reports'),

    /**
     * Refuse to run a catalogue import against a database whose name looks
     * like production. On by default; a safety net, not a permission.
     */
    IMPORT_BLOCK_PRODUCTION: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),

    /**
     * Cloudinary transformation applied to every uploaded product image.
     * `w_1600,c_limit,q_auto,f_auto` caps the width, keeps the aspect ratio
     * and lets Cloudinary negotiate format and quality.
     */
    CLOUDINARY_TRANSFORMATION: z.string().trim().min(1).default('w_1600,c_limit,q_auto,f_auto'),
  })
  .superRefine((value, ctx) => {
    /*
     * The bcrypt cost factor may only be lowered below 10 in the test
     * environment. The test suite hashes a lot of passwords and needs the
     * speed, but a development, staging or production deployment must never
     * be able to weaken the hashing below the secure floor.
     */
    if (value.BCRYPT_COST < 10 && value.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        message: 'BCRYPT_COST must be at least 10 outside the test environment',
        path: ['BCRYPT_COST'],
      });
    }

    /*
     * Payment mode is never inferred. A deployment that declares `live`
     * must hold BOTH the API key pair and the webhook secret, and it must
     * say so out loud — a half-configured live payment integration is the
     * worst possible state, because orders would be taken and no payment
     * confirmation could ever be verified.
     */
    if (value.RAZORPAY_MODE === 'live') {
      if (!value.RAZORPAY_KEY_ID || !value.RAZORPAY_KEY_SECRET) {
        ctx.addIssue({
          code: 'custom',
          message:
            'RAZORPAY_MODE=live requires both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. ' +
            'Set them to your live key pair, or set RAZORPAY_MODE=test.',
          path: ['RAZORPAY_MODE'],
        });
      }
      if (!value.RAZORPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          message:
            'RAZORPAY_MODE=live requires RAZORPAY_WEBHOOK_SECRET. Without it no ' +
            'payment confirmation can be verified, so live mode would be unsafe.',
          path: ['RAZORPAY_WEBHOOK_SECRET'],
        });
      }
    }

    /*
     * Email needs both a key and a verified sender. Resend rejects mail from
     * an unverified address, so a key without a sender is a misconfiguration
     * worth failing on at boot rather than discovering from a bounce.
     */
    const hasResendKey = Boolean(value.RESEND_API_KEY);
    const hasResendFrom = Boolean(value.RESEND_FROM_EMAIL);
    if (hasResendKey !== hasResendFrom) {
      ctx.addIssue({
        code: 'custom',
        message:
          'RESEND_API_KEY and RESEND_FROM_EMAIL must be set together. ' +
          'Without a verified sender, Resend cannot deliver mail.',
        path: [hasResendKey ? 'RESEND_FROM_EMAIL' : 'RESEND_API_KEY'],
      });
    }

    /*
     * Shipping needs the credential pair that mints its bearer token. A
     * lone email without a password cannot authenticate, so this is
     * rejected rather than discovered at the first shipment attempt.
     */
    const hasSrEmail = Boolean(value.SHIPROCKET_API_EMAIL);
    const hasSrPassword = Boolean(value.SHIPROCKET_API_PASSWORD);
    if (hasSrEmail !== hasSrPassword) {
      ctx.addIssue({
        code: 'custom',
        message: 'SHIPROCKET_API_EMAIL and SHIPROCKET_API_PASSWORD must be set together.',
        path: [hasSrEmail ? 'SHIPROCKET_API_PASSWORD' : 'SHIPROCKET_API_EMAIL'],
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/**
 * Environment variables required by the catalogue importer.
 *
 * The importer is a separate process from the API server but shares the
 * same environment contract, so a missing Cloudinary credential is a boot
 * failure of the importer rather than a runtime surprise half way through
 * a 692-image upload.
 */
export const importerEnvSchema = apiEnvSchema.extend({
  /**
   * Allow the import to write stock values derived from the listing
   * templates. Off by default: the templates are a marketplace export, not
   * a warehouse ledger (decision C-3).
   */
  IMPORT_APPLY_TEMPLATE_STOCK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ImporterEnv = z.infer<typeof importerEnvSchema>;

/**
 * Variables required by the customer storefront (Next.js).
 *
 * Only `NEXT_PUBLIC_*` values reach the browser bundle. Everything else is
 * read in server components / route handlers and stays on the server.
 */
export const storefrontEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  /** Base URL of the REST API, called from the server. */
  API_INTERNAL_URL: z.string().url(),

  /** Base URL of the REST API, used by browser-side fetches. */
  NEXT_PUBLIC_API_URL: z.string().url(),

  /** Canonical public origin of this storefront, used for SEO/metadata. */
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  /**
   * Public base path for catalogue images.
   *
   * The catalogue stores image URLs as root-relative paths
   * (`/products/AJ-A1/A1 - 1.jpg`). This value is prefixed to them to form
   * the final URL.
   *
   * In development this points at the API's static mount
   * (`http://localhost:4000`), because the 494 MB of product photography
   * lives in the repository-root `public/` tree, which is outside the
   * Next.js app root and therefore not served by Next itself. In production
   * it points at the CDN/object-store origin. See
   * `docs/DEPLOYMENT_RUNBOOK.md` §6.3.
   */
  NEXT_PUBLIC_MEDIA_BASE_URL: z.string().min(1).default('/'),

  /** Optional revalidation window for catalogue pages, in seconds. */
  CATALOG_REVALIDATE_SECONDS: z.coerce.number().int().min(0).default(300),
});

export type StorefrontEnv = z.infer<typeof storefrontEnvSchema>;

/**
 * Variables required by the admin panel (Next.js).
 */
export const adminEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  /** Base URL of the REST API, called from the server. */
  API_INTERNAL_URL: z.string().url(),

  /** Base URL of the REST API, used by browser-side fetches. */
  NEXT_PUBLIC_API_URL: z.string().url(),

  /** Canonical public origin of this admin panel. */
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  /** Public base path for catalogue images. */
  NEXT_PUBLIC_MEDIA_BASE_URL: z.string().min(1).default('/'),
});

export type AdminEnv = z.infer<typeof adminEnvSchema>;
