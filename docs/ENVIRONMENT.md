# Environment reference

The single inventory of every environment variable this monorepo reads, what
it does, which value each deployment target needs, and what breaks if it is
wrong.

This document is derived from the code, not from intention. The authoritative
schemas live in `packages/contracts/src/env/index.ts`:

| Schema                | Used by                                   |
| --------------------- | ----------------------------------------- |
| `apiEnvSchema`        | `apps/api` (server), catalogue importer   |
| `importerEnvSchema`   | catalogue importer (`apiEnvSchema` + one) |
| `storefrontEnvSchema` | `apps/storefront`                         |
| `adminEnvSchema`      | `apps/admin`                              |

There is **no** `mode: dev | prod` switch anywhere in the code. Each
deployment target supplies its own variables through its platform, and the
API validates them once at boot. A missing or malformed required variable is
a startup failure with a readable message, never a silent fallback.

### This document is checked by an automated gate

`pnpm env:check` (`scripts/env-inventory-check.mjs`) reads the **actual Zod
schemas** out of `@ajooba/contracts` — the single source of truth — and
compares them against the committed `.env.example` templates and against
this document. It fails when:

- a variable the schema declares is missing from the matching template;
- a template names a variable the code never reads;
- a variable is undocumented here;
- a template appears to carry a real credential;
- the four pair rules stop being enforced by the schema.

It is **not** a substitute for this document, and this document is **not** a
substitute for it. The gate proves they agree; the prose explains why.

Run it before every deployment. It needs no credentials and no network.

---

## 1. How to read the tables

| Column      | Meaning                                                          |
| ----------- | ---------------------------------------------------------------- |
| **Secret**  | Must never be committed, logged, or sent to a browser.           |
| **Default** | The value used when the variable is absent. Blank = `undefined`. |
| **prod**    | Whether production _must_ set it to run safely.                  |

`blankToUndefined` means an empty or whitespace-only value is treated as
"not configured" — not as an error. That is deliberate: deployment templates
routinely ship empty placeholders, and an integration is switched on by
setting the variables and restarting.

### Pair rules

Four pairs are validated together. A half-configured integration is a worse
state than an absent one, because it looks enabled and then fails.

| Pair                                               | Rule                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`          | Required together when `RAZORPAY_MODE=live`. |
| `RAZORPAY_WEBHOOK_SECRET`                          | Required when `RAZORPAY_MODE=live`.          |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL`             | Must both be set or both be absent.          |
| `SHIPROCKET_API_EMAIL` + `SHIPROCKET_API_PASSWORD` | Must both be set or both be absent.          |

---

## 2. `apps/api` — core

| Variable                | Secret  | Default                      | prod        | Notes                                                                                                                                                     |
| ----------------------- | ------- | ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | no      | —                            | yes         | `development` \| `test` \| `production`. Gates bcrypt floor and the `EMAIL_ALLOWLIST`.                                                                    |
| `PORT`                  | no      | `4000`                       | no          | 1–65535.                                                                                                                                                  |
| `MONGODB_URI`           | **yes** | —                            | yes         | Atlas SRV string. The database user needs **index-creation rights** — see §7.                                                                             |
| `MONGODB_DB`            | no      | derived from URI             | no          | Set it explicitly so a misconfigured URI cannot point at the wrong database.                                                                              |
| `API_PUBLIC_URL`        | **yes** | —                            | yes         | Absolute URL. Used to build absolute links in emails.                                                                                                     |
| `CORS_ORIGINS`          | **yes** | —                            | yes         | Comma separated. The storefront origins.                                                                                                                  |
| `ADMIN_ORIGINS`         | no      | falls back to `CORS_ORIGINS` | recommended | Comma separated. **Overrides** `CORS_ORIGINS` for `/v1/admin` and `/webhooks`; it does not add to them. Separating them is hardening, not a prerequisite. |
| `STOREFRONT_PUBLIC_URL` | **yes** | —                            | yes         |                                                                                                                                                           |
| `ADMIN_PUBLIC_URL`      | **yes** | —                            | yes         |                                                                                                                                                           |
| `MEDIA_STATIC_DIR`      | no      | `(disabled)`                 | depends     | Directory the API mounts read-only at `/products`. Blank = JSON only, which is correct when a CDN serves the images.                                      |
| `SESSION_SECRET`        | **yes** | —                            | yes         | ≥ 32 chars. Signs admin session cookies.                                                                                                                  |
| `LOG_LEVEL`             | no      | `info`                       | no          | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`. Use `info` or `warn` in production.                                                                   |

### Authentication

| Variable                    | Secret  | Default      | prod | Notes                                                                                             |
| --------------------------- | ------- | ------------ | ---- | ------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                | **yes** | —            | yes  | ≥ 32 chars. Rotating it invalidates **every** issued token.                                       |
| `JWT_ISSUER`                | no      | `ajooba-api` | no   | Informational claim; makes a token traceable to its environment.                                  |
| `ACCESS_TOKEN_TTL_SECONDS`  | no      | `900`        | no   | 60–86400.                                                                                         |
| `REFRESH_TOKEN_TTL_SECONDS` | no      | `2592000`    | no   | 300–31536000 (30 days).                                                                           |
| `BCRYPT_COST`               | no      | `12`         | yes  | **Must be ≥ 10 outside `test`.** Enforced by `superRefine`; the schema refuses to boot otherwise. |
| `MAX_FAILED_LOGIN_ATTEMPTS` | no      | `10`         | yes  | Per account. `0` disables lockout.                                                                |
| `ACCOUNT_LOCKOUT_SECONDS`   | no      | `900`        | yes  | 30–86400.                                                                                         |

### Social sign-in (Google and Facebook)

Two credential pairs, each optional and each **all-or-nothing**. A half-set
pair is a boot failure rather than a button that lands on a 503: the
storefront renders only the doors the API reports as configured, so an absent
pair means no button, and a partial pair must never look like a working one.

| Variable                    | Secret  | Default | prod | Notes                                                                                                                                    |
| --------------------------- | ------- | ------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_OAUTH_CLIENT_ID`    | no      | —       | no   | OAuth 2.0 Web application client. Read at call time, so it can be enabled by setting the pair and restarting. Must pair with the secret. |
| `GOOGLE_OAUTH_CLIENT_SECRET`| **yes** | —       | no   | Server only. Never reaches the browser. Must pair with the client id.                                                                    |
| `FACEBOOK_OAUTH_APP_ID`     | no      | —       | no   | Facebook Login app id. Must pair with the app secret.                                                                                    |
| `FACEBOOK_OAUTH_APP_SECRET` | **yes** | —       | no   | Server only. Also used to app-secret-proof the token exchange. Must pair with the app id.                                                 |

The redirect URI is derived from `API_PUBLIC_URL`, never configured
separately, so it cannot drift from the origin the API actually serves:

```
<API_PUBLIC_URL>/v1/auth/oauth/google/callback
<API_PUBLIC_URL>/v1/auth/oauth/facebook/callback
```

Register exactly those two URIs in the respective consoles. A mismatch is the
provider's error, not ours: the exchange fails before any account is touched.
The storefront's `GET /v1/auth/providers` answer is the source of truth for
which buttons exist, so no storefront variable is needed to enable social
sign-in.

---

### Rate limiting

Per-IP windows. Defaults are the shipped values; raise them only for a
deployment genuinely behind shared NAT.

| Variable                     | Default | Applies to                                |
| ---------------------------- | ------- | ----------------------------------------- |
| `RATE_LIMIT_AUTH_MAX`        | `10`    | sign-in — the credential-stuffing surface |
| `RATE_LIMIT_REFRESH_MAX`     | `30`    | token refresh                             |
| `RATE_LIMIT_REGISTER_MAX`    | `5`     | registration                              |
| `RATE_LIMIT_CHECKOUT_MAX`    | `20`    | checkout                                  |
| `RATE_LIMIT_COUPON_MAX`      | `30`    | coupon checks                             |
| `RATE_LIMIT_PASSWORD_MAX`    | `10`    | password changes                          |
| `RATE_LIMIT_ANALYTICS_MAX`   | `120`   | analytics events                          |
| `RATE_LIMIT_ADMIN_WRITE_MAX` | `120`   | administrative writes                     |

---

## 3. `apps/api` — Razorpay

| Variable                  | Secret  | Default | prod | Notes                                                                                       |
| ------------------------- | ------- | ------- | ---- | ------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`         | no      | —       | yes¹ | Publishable key id. Still server-configured.                                                |
| `RAZORPAY_KEY_SECRET`     | **yes** | —       | yes¹ | Server only. Never sent to the browser.                                                     |
| `RAZORPAY_WEBHOOK_SECRET` | **yes** | —       | yes¹ | **A different secret** from the key secret. Signs `X-Razorpay-Signature` over the raw body. |
| `RAZORPAY_MODE`           | no      | `test`  | yes  | `test` \| `live`. Never inferred. `live` requires the full triple above or the boot fails.  |

¹ Required in production once payments are switched on. A deployment may
start with all four blank — payments are then simply disabled — but a store
that _takes orders_ without them cannot ever confirm a payment.

---

## 4. `apps/api` — Resend (transactional email)

| Variable            | Secret  | Default             | prod      | Notes                                                                                                                                                                                                                                                              |
| ------------------- | ------- | ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RESEND_API_KEY`    | **yes** | —                   | yes       | Server only.                                                                                                                                                                                                                                                       |
| `RESEND_FROM_EMAIL` | no      | —                   | yes       | e.g. `Ajooba Footwear <orders@yourdomain.com>`. The **domain must already be verified** in Resend or every send is rejected.                                                                                                                                       |
| `RESEND_REPLY_TO`   | no      | `RESEND_FROM_EMAIL` | no        | Optional reply-to address.                                                                                                                                                                                                                                         |
| `EMAIL_ALLOWLIST`   | no      | —                   | **unset** | Comma separated. When `NODE_ENV !== 'production'`, a recipient not on this list is recorded as `skipped` and **not delivered**. In production it is not consulted at all. **Leave it unset in production** — setting it there would be meaningless and misleading. |

The email path is an **outbox**: callers record an intent row, a dispatcher
delivers it. The money path never awaits the mail provider, so a slow or
unreachable Resend can never make a settled payment look failed.

---

## 5. `apps/api` — Shiprocket

| Variable                     | Secret  | Default | prod | Notes                                                                                                      |
| ---------------------------- | ------- | ------- | ---- | ---------------------------------------------------------------------------------------------------------- |
| `SHIPROCKET_API_EMAIL`       | **yes** | —       | yes¹ | Mints a bearer token valid for **10 days**; the adapter refreshes it.                                      |
| `SHIPROCKET_API_PASSWORD`    | **yes** | —       | yes¹ |                                                                                                            |
| `SHIPROCKET_PICKUP_LOCATION` | no      | —       | yes¹ | Must already exist in the Shiprocket account; unknown locations are rejected.                              |
| `SHIPROCKET_COURIER_ID`      | no      | —       | no   | Pins AWBs to one courier. Blank lets Shiprocket choose from the serviceable list.                          |
| `SHIPROCKET_WEBHOOK_SECRET`  | no      | —       | yes  | Checked against the tracking webhook's `x-api-key` header. Blank **disables webhook acceptance outright**. |

¹ Required once orders are actually shipped.

### The tracking webhook URL

The callback URL configured in the Shiprocket dashboard is **not** a free
choice — Shiprocket rejects a URL containing `shiprocket`, `kartrocket`, `sr`
or `kr` anywhere in it.

The platform's canonical path is:

```
POST https://api.yourdomain.com/webhooks/carrier/track
```

It contains none of the four forbidden substrings. The path
`/webhooks/shiprocket` **cannot** be used — the provider would refuse to
register it and tracking updates would never arrive. A legacy alias at
`/webhooks/shiprocket` is still served for an environment configured before
this rule was applied; do not use it for a new deployment.

The endpoint must answer **only** HTTP 200, because Shiprocket treats any
other status as a failed delivery and retries indefinitely.

---

## 6. `apps/api` — Cloudinary and catalogue import

| Variable                       | Secret  | Default                          | Notes                                                                                                      |
| ------------------------------ | ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `CLOUDINARY_CLOUD_NAME`        | no      | —                                | Blank keeps local `public/` paths and disk-served media.                                                   |
| `CLOUDINARY_API_KEY`           | no      | —                                | Server only.                                                                                               |
| `CLOUDINARY_API_SECRET`        | **yes** | —                                | Server only. Never in a log, response or bundle.                                                           |
| `CLOUDINARY_PRODUCT_FOLDER`    | no      | `ajooba/products`                |                                                                                                            |
| `CLOUDINARY_DELIVERY_BASE_URL` | no      | —                                | Override for a custom CDN domain.                                                                          |
| `CLOUDINARY_TRANSFORMATION`    | no      | `w_1600,c_limit,q_auto,f_auto`   | Applied to every upload.                                                                                   |
| `CATALOG_SOURCE_DIR`           | no      | `../../public`                   | Import reads it read-only.                                                                                 |
| `CATALOG_REPORT_DIR`           | no      | `../../artifacts/import-reports` | Import audit trail.                                                                                        |
| `IMPORT_BLOCK_PRODUCTION`      | no      | `true`                           | Refuses an import whose database name looks like production.                                               |
| `IMPORT_APPLY_TEMPLATE_STOCK`  | no      | `false`                          | **Importer only.** Off by default: the listing templates are a marketplace export, not a warehouse ledger. |

---

## 7. Index provisioning — a hard boot requirement

`connectToDatabase()` builds **every** model's indexes and refuses to start
if any fails. This is not performance tuning. Four of them are correctness
constraints:

| Collection                    | Index                               | Guarantee it provides                                                                |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `email_logs`                  | `(template, idempotencyKey)` unique | Exactly one transactional email per logical event.                                   |
| `webhook_events`              | `eventId` unique                    | Webhook idempotency — a redelivered `payment.captured` cannot settle an order twice. |
| `shipments`                   | `orderId` partial unique            | One live shipment per order; a concurrent double-dispatch is impossible.             |
| `payments`, `stock_movements` | uniqueness constraints              | Prevents a race double-decrementing stock.                                           |

**The database user must have index-creation rights.** A user limited to
`readWrite` will fail this gate at boot with an explicit message rather than
starting a store that silently accepts duplicates.

> This gate exists because Mongoose's `autoIndex` is fire-and-forget: it
> _starts_ index builds and does not wait, and **a unique index that fails to
> build is not an error** — writes still succeed, they just stop being
> deduplicated. Two real index definitions were found to have never created
> their index in _any_ environment (see the runbook §9).

---

## 8. `apps/storefront` and `apps/admin`

Both are Next.js applications. Only `NEXT_PUBLIC_*` values reach the browser
bundle.

| Variable                     | Storefront | Admin    | Notes                                                                                                                              |
| ---------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                   | yes        | yes      |                                                                                                                                    |
| `API_INTERNAL_URL`           | **yes**    | **yes**  | Server-side base URL of the API.                                                                                                   |
| `NEXT_PUBLIC_API_URL`        | **yes**    | **yes**  | Browser-facing base URL.                                                                                                           |
| `NEXT_PUBLIC_SITE_URL`       | **yes**    | **yes**  | Canonical origin, used for SEO/metadata.                                                                                           |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no (`/`)   | no (`/`) | Prefix for root-relative catalogue image paths. In production point at the CDN origin, **not** the API, if a CDN serves the media. |
| `CATALOG_REVALIDATE_SECONDS` | no (`300`) | —        | Storefront only.                                                                                                                   |

---

## 9. Per-target values

Replace the placeholders. Nothing here has been deployed or verified against
a live provider — see the runbook §10.

### 9.0 The complete per-target matrix

This is the authoritative deployment matrix. Every row is a variable whose
value differs between the three targets, or whose presence is a
go-live decision.

| Variable                     | Development              | Staging                             | Production                         |
| ---------------------------- | ------------------------ | ----------------------------------- | ---------------------------------- |
| `NODE_ENV`                   | `development`            | `production`                        | `production`                       |
| `PORT`                       | `4000`                   | platform-assigned                   | platform-assigned                  |
| `MONGODB_URI`                | local `mongod`           | staging cluster                     | production cluster                 |
| `MONGODB_DB`                 | `ajooba_development`     | `ajooba_staging`                    | `ajooba_production`                |
| `API_PUBLIC_URL`             | `http://localhost:4000`  | `https://staging-api.…`             | `https://api.…`                    |
| `STOREFRONT_PUBLIC_URL`      | `http://localhost:3000`  | `https://staging.…`                 | `https://…`                        |
| `ADMIN_PUBLIC_URL`           | `http://localhost:3001`  | `https://staging-admin.…`           | `https://admin.…`                  |
| `CORS_ORIGINS`               | both localhost origins   | staging storefront only             | production storefront only         |
| `ADMIN_ORIGINS`              | `http://localhost:3001`  | staging admin only                  | production admin only              |
| `SESSION_SECRET`             | local throwaway          | generated secret                     | generated secret                    |
| `JWT_SECRET`                 | local throwaway          | generated secret                     | generated secret                    |
| `BCRYPT_COST`                | `10`                     | `12` (default)                      | `12` (default)                     |
| `LOG_LEVEL`                  | `debug`                  | `info`                              | `info`                             |
| `RAZORPAY_MODE`              | `test`                   | `test`                              | `live`                             |
| `RAZORPAY_KEY_ID`            | blank                    | test key                            | live key                           |
| `RAZORPAY_KEY_SECRET`        | blank                    | test secret                         | live secret                        |
| `RAZORPAY_WEBHOOK_SECRET`    | blank                    | test webhook secret                 | live webhook secret                |
| `RESEND_API_KEY`             | blank                    | Resend key                          | Resend key                         |
| `RESEND_FROM_EMAIL`          | blank                    | `orders-staging@…`                  | `orders@…`                         |
| `EMAIL_ALLOWLIST`            | **required**             | unset (deliberately)                | unset (deliberately)               |
| `SHIPROCKET_API_EMAIL`       | blank                    | Shiprocket API user                 | Shiprocket API user                |
| `SHIPROCKET_API_PASSWORD`    | blank                    | Shiprocket API password             | Shiprocket API password            |
| `SHIPROCKET_PICKUP_LOCATION` | blank                    | exact account name                  | exact account name                 |
| `SHIPROCKET_WEBHOOK_SECRET`  | blank                    | shared secret                       | shared secret                      |
| `MEDIA_STATIC_DIR`           | local `public/`          | blank (CDN serves media)            | blank (CDN serves media)           |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | API origin               | CDN origin                          | CDN origin                         |

Three of these deserve emphasis:

- **`EMAIL_ALLOWLIST` is unset in staging.** Staging runs
  `NODE_ENV=production`, which is what disables the allowlist — so staging
  genuinely delivers mail, and the staging Resend domain must point at a
  team mailbox, never at a customer's.
- **`RAZORPAY_MODE=test` in staging.** A staging deployment holding live
  keys is the most dangerous configuration in this table: it looks
  production, behaves like production, and takes real money. The schema
  refuses `live` without the full triple, but it cannot refuse `test` with
  live credentials — that is an operator decision.
- **`MEDIA_STATIC_DIR` blank in production** is correct when a CDN serves
  the images. The API then returns JSON only, which is the intended
  behaviour, not a fault.

### Development

```
NODE_ENV=development
PORT=4000
API_PUBLIC_URL=http://localhost:4000
STOREFRONT_PUBLIC_URL=http://localhost:3000
ADMIN_PUBLIC_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
ADMIN_ORIGINS=http://localhost:3001
RAZORPAY_MODE=test
EMAIL_ALLOWLIST=you@example.com,ops@example.com
LOG_LEVEL=debug
```

`EMAIL_ALLOWLIST` is **required in development** to keep a test run from
emailing a real customer. Outside production a recipient not on the list is
recorded as `skipped`, not delivered.

### Staging

Staging exists to rehearse the production configuration. It uses its own
database, its own Razorpay **test** keys, and a real Resend domain pointed at
a team mailbox.

```
NODE_ENV=production
API_PUBLIC_URL=https://staging-api.yourdomain.com
STOREFRONT_PUBLIC_URL=https://staging.yourdomain.com
ADMIN_PUBLIC_URL=https://staging-admin.yourdomain.com
CORS_ORIGINS=https://staging.yourdomain.com
ADMIN_ORIGINS=https://staging-admin.yourdomain.com
RAZORPAY_MODE=test
RESEND_FROM_EMAIL="Ajooba Staging <orders-staging@yourdomain.com>"
EMAIL_ALLOWLIST=            # deliberately unset
LOG_LEVEL=info
```

> `NODE_ENV=production` in staging is deliberate. It is what makes the
> `BCRYPT_COST >= 10` floor, the disabled allowlist and the production cookie
> flags actually get exercised before go-live. A staging box running
> `NODE_ENV=development` rehearses none of that.

### Production

```
NODE_ENV=production
API_PUBLIC_URL=https://api.yourdomain.com
STOREFRONT_PUBLIC_URL=https://yourdomain.com
ADMIN_PUBLIC_URL=https://admin.yourdomain.com
CORS_ORIGINS=https://yourdomain.com
ADMIN_ORIGINS=https://admin.yourdomain.com
RAZORPAY_MODE=live
EMAIL_ALLOWLIST=            # must be unset
LOG_LEVEL=info
```

---

## 10. Generating secrets

```bash
# SESSION_SECRET and JWT_SECRET — must be >= 32 characters
openssl rand -base64 48
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`SESSION_SECRET` and `JWT_SECRET` must be **different values**. Rotating
either invalidates the sessions or tokens it signed.

---

## 11. Verifying a deployment's configuration

The API prints a safe summary at startup — variable _names_ and counts, never
secret values:

```
NODE_ENV, PORT, API_PUBLIC_URL, STOREFRONT_PUBLIC_URL, ADMIN_PUBLIC_URL,
CORS_ORIGINS (count), ADMIN_ORIGINS (count), MONGODB_DB,
MEDIA_STATIC_DIR, RAZORPAY_CONFIGURED, LOG_LEVEL
```

Note what is **not** in that summary: no key id, no secret, no origin list
beyond a count, no database URI. It is safe to paste into a ticket.

Four checks confirm a deployment is wired correctly without any live
transaction:

```bash
# 0. The environment inventory matches the code (local, no network).
pnpm env:check

# 1. Liveness — must be 200, status "ok"
curl -fsS https://api.yourdomain.com/health/live

# 2. Readiness — must be 200; a 503 here means the database or its indexes
#    are not in place
curl -fsS https://api.yourdomain.com/health/ready

# 3. Webhook reachability — an unsigned delivery must be REJECTED (400).
#    A 200 here means signature verification is not running, which is
#    worse than not having the endpoint at all.
curl -i -X POST https://api.yourdomain.com/webhooks/razorpay \
  -H 'Content-Type: application/json' \
  -d '{"entity":"event","event":"payment.captured","payload":{}}'
```

A 400 on that third call is the **correct** result and needs no credentials.

A fourth probe reports whether the deployment can actually take money. It is
public by design — the storefront needs it to decide whether to offer a card
option — and it exposes only *whether* the integration is configured, never a
secret:

```bash
curl -fsS https://api.yourdomain.com/v1/payments/configuration
# expect data.configured === true
# expect data.webhooksEnabled === true   <- the dangerous combination
# expect data.mode === "live"            <- on a production origin
```

`configured: true` with `webhooksEnabled: false` is the worst state a
deployment can be in: the gateway would accept money while **no payment
confirmation could ever be verified**, so every order would sit unpaid and
the customer would have been charged. `scripts/readiness-check.mjs` fails on
exactly that combination.

See `scripts/readiness-check.mjs`, which runs all of this plus the
documentation gates for a given origin, and `scripts/env-inventory-check.mjs`
(`pnpm env:check`), which proves this document and the committed templates
still match the schemas.
