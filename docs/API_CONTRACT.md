# Ajooba Footwear — API Contract

**Status:** v0.1.0 — catalogue, cart, checkout, orders, returns, wishlist, content and admin surfaces.
**Owner:** API team (`apps/api`)
**Source of truth:** `packages/contracts` — the TypeScript types and Zod schemas in that package _are_ the contract. This document describes them in prose. If this document and the code disagree, **the code is correct** and this document is a bug.

---

## 1. Conventions

### 1.1 Base URL and versioning

| Environment | Base URL                | Source of the value                      |
| ----------- | ----------------------- | ---------------------------------------- |
| Development | `http://localhost:4000` | `API_PUBLIC_URL` (`apps/api/.env.local`) |
| Staging     | platform-provided       | `API_PUBLIC_URL` (staging env vars)      |
| Production  | platform-provided       | `API_PUBLIC_URL` (production env vars)   |

There is **no** `mode="dev"` / `mode="pro"` switch in the code. Which environment a process runs in is decided entirely by the environment variables the platform injects. A missing variable is a boot failure, not a silent fallback.

The REST surface is namespaced under `/v1`. `/health` sits outside versioning because it is operational, not part of the commercial contract.

### 1.2 Transport rules

- Content type is `application/json; charset=utf-8` on every response.
- Request bodies are limited to **1 MB** (`express.json({ limit: '1mb' })`).
- The server does not advertise itself (`x-powered-by` disabled).
- Responses are gzip-compressed when the client advertises support.
- `trust proxy` is set to `1` so client IPs are read correctly behind Vercel / Render / Cloudflare.
- Helmet is applied globally. CSP is explicitly disabled because the API is JSON-only; `cross-origin-resource-policy: cross-origin` allows the storefront to fetch it.

### 1.3 The response envelope

Every response — success **and** failure, including 404 and 500 — uses the same shape. Emitted exclusively through `apps/api/src/core/http.ts` (`sendSuccess`, `sendFailure`), so the shape is guaranteed.

**Success**

```json
{
  "ok": true,
  "data": { "...": "endpoint-specific" },
  "meta": {
    "requestId": "5f0a1c1e-2b3d-4a5e-8f90-1a2b3c4d5e6f",
    "timestamp": "2026-10-21T11:04:22.913Z"
  }
}
```

**Success with pagination**

```json
{
  "ok": true,
  "data": {
    "items": [],
    "totalItems": 0,
    "page": 1,
    "pageSize": 24,
    "totalPages": 0
  },
  "meta": {
    "requestId": "5f0a1c1e-2b3d-4a5e-8f90-1a2b3c4d5e6f",
    "timestamp": "2026-10-21T11:04:22.913Z",
    "pagination": {
      "page": 1,
      "pageSize": 24,
      "totalItems": 0,
      "totalPages": 0,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  }
}
```

**Failure**

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed.",
    "details": [{ "field": "pageSize", "message": "Too big: expected number to be <=100" }],
    "requestId": "5f0a1c1e-2b3d-4a5e-8f90-1a2b3c4d5e6f"
  },
  "meta": {
    "requestId": "5f0a1c1e-2b3d-4a5e-8f90-1a2b3c4d5e6f",
    "timestamp": "2026-10-21T11:04:22.913Z"
  }
}
```

`meta.requestId` is echoed in the `x-request-id` response header. If a client supplies its own `x-request-id`, it is preserved; otherwise the server generates a UUID v4.

Defined in `packages/contracts/src/common/types.ts` (`ApiSuccess`, `ApiFailure`, `ApiResponse`, `ResponseMeta`, `PaginationMeta`).

### 1.4 Error codes

| Code                  | HTTP status | Meaning                                                                |
| --------------------- | ----------- | ---------------------------------------------------------------------- |
| `VALIDATION_FAILED`   | 422         | Request failed Zod validation. `error.details` lists offending fields. |
| `NOT_FOUND`           | 404         | The addressed resource does not exist.                                 |
| `CONFLICT`            | 409         | The write would violate a uniqueness or state constraint.              |
| `UNAUTHORIZED`        | 401         | Missing, malformed or expired credentials.                             |
| `FORBIDDEN`           | 403         | Authenticated but not permitted.                                       |
| `RATE_LIMITED`        | 429         | Request quota exceeded. `Retry-After` is set.                          |
| `INTERNAL_ERROR`      | 500         | Unhandled failure. Never leaks internals to the client.                |
| `SERVICE_UNAVAILABLE` | 503         | A hard dependency (currently MongoDB) is down.                         |

`error.message` is safe to render. Internal exception messages are redacted by the global error handler and written to the log against the request id instead.

### 1.5 Authentication

Two independent identity spaces, each with its own login surface and its own token audience:

| Space         | Login                       | Principal                           |
| ------------- | --------------------------- | ----------------------------------- |
| Customer      | `POST /v1/auth/login`       | `requireCustomer`                   |
| Administrator | `POST /v1/admin/auth/login` | `requireAdmin` + a permission check |

Both return the same `AuthSession` envelope (`{ user, tokens }`). Tokens are JWTs: `access` (15 minutes) and `refresh` (30 days), sent as `Authorization: Bearer <accessToken>`. Refresh tokens are stored hashed and are revoked on logout, on password change, and on `logout-all`.

A customer token **cannot** reach an admin route and an admin token **cannot** reach a customer route. This is enforced server-side, never by the UI.

### 1.6 Authorisation — admin roles and permissions

Five roles, nineteen permissions, grants declared in `packages/contracts/src/auth/types.ts` (`ADMIN_ROLE_PERMISSIONS`).

| Role             | Summary                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `owner`          | Every permission, including `settings:write` and `admin:write`.                                              |
| `admin`          | Everything except `settings:write` and `admin:write`.                                                        |
| `manager`        | Catalogue, inventory, orders, returns, coupons, customers, analytics. No settings, no admin management.      |
| `support`        | Orders and returns only. Deliberately cannot touch the catalogue, coupons, settings or other administrators. |
| `content-editor` | Banners, content blocks, catalogue read. Nothing commercial.                                                 |

Every admin route declares its permission explicitly (`requirePermission('orders:write')`). Least privilege is applied literally.

### 1.7 Idempotency

Order creation is the only endpoint that is safe to retry blindly, and it is the only one that accepts an idempotency key.

`POST /v1/checkout/orders` reads the key from the `Idempotency-Key` header **and** from `idempotencyKey` in the body. The two must agree.

| Outcome                             | Status | `data`                                    |
| ----------------------------------- | ------ | ----------------------------------------- |
| First request, key unseen           | 201    | The created order                         |
| Retry, same key, **same body**      | 201    | The **original** order, byte-identical    |
| Retry, same key, **different body** | 409    | — (`CONFLICT`)                            |
| Original request failed 4xx/5xx     | —      | Nothing is stored, so the key is reusable |

The stored response is written to MongoDB **before** the HTTP response is flushed to the client. Writing it on the socket's `finish` event would leave a window in which a client that retries immediately — a double tap on "place order", a proxy replaying a timed-out request — reaches the API before the record lands, finds the cart already emptied, and receives a conflict instead of the order that already exists. Records are scoped by `(kind, subjectId, route, key)` and expire after a TTL.

Inventory is decremented exactly once regardless of how many times the request is sent.

### 1.8 Rate limiting

A global limiter is mounted at `/v1`: 300 requests / 60 s per client IP, `draft-7` standard headers. It deliberately does **not** wrap `/health`.

Route-specific limiters are applied per endpoint group, configured by env vars so production and test budgets can differ without code changes:

| Group       | Env var                      | Applied to               |
| ----------- | ---------------------------- | ------------------------ |
| Register    | `RATE_LIMIT_REGISTER_MAX`    | `POST /v1/auth/register` |
| Login       | `RATE_LIMIT_AUTH_MAX`        | customer + admin login   |
| Refresh     | `RATE_LIMIT_REFRESH_MAX`     | token refresh            |
| Password    | `RATE_LIMIT_PASSWORD_MAX`    | change-password          |
| Checkout    | `RATE_LIMIT_CHECKOUT_MAX`    | order creation           |
| Coupon      | `RATE_LIMIT_COUPON_MAX`      | coupon apply + validate  |
| Analytics   | `RATE_LIMIT_ANALYTICS_MAX`   | event recording          |
| Admin write | `RATE_LIMIT_ADMIN_WRITE_MAX` | admin mutations          |

### 1.9 CORS

Allowed origins come from `CORS_ORIGINS` and `ADMIN_ORIGINS` (comma separated) and are matched by **exact string comparison**. In non-production the two local dev origins are appended automatically. Requests with no `Origin` header (server-to-server, `curl`) are allowed. Unknown origins are rejected by the CORS middleware without a 403 from application code.

### 1.10 Logging and observability

Structured JSON logs via Pino, one object per request, with automatic level selection (`5xx` → `error`, `4xx` → `warn`, else `info`). `/health/live` is excluded from access logging so probe traffic stays out of the log volume. Sensitive fields (`password`, `token`, `secret`, `authorization`, …) are redacted.

---

## 2. Health endpoints

Liveness and readiness are separated so a platform can restart an unhealthy process without needlessly pulling a merely-degraded instance out of rotation.

### 2.1 `GET /health/live`

Proves the process is running. **Never** touches MongoDB. Always `200`.

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "service": "api",
    "uptimeSeconds": 8123,
    "timestamp": "2026-10-21T11:04:22.913Z"
  },
  "meta": { "requestId": "…", "timestamp": "2026-10-21T11:04:22.913Z" }
}
```

Contract: `LivenessResponse` in `packages/contracts/src/health/index.ts`.

### 2.2 `GET /health/ready`

Proves the process can actually serve traffic. Pings MongoDB.

| Database state                          | `data.status` | HTTP    |
| --------------------------------------- | ------------- | ------- |
| Connected and ping succeeded            | `ok`          | 200     |
| Connected but slow / partially degraded | `degraded`    | 200     |
| Not connected, or ping threw            | `error`       | **503** |

```json
{
  "ok": true,
  "data": {
    "status": "error",
    "service": "api",
    "checks": [{ "name": "mongodb", "status": "error", "message": "Not connected." }],
    "timestamp": "2026-10-21T11:04:22.913Z"
  },
  "meta": { "requestId": "…", "timestamp": "2026-10-21T11:04:22.913Z" }
}
```

Note that a _failed_ readiness check still returns the `ok: true` transport envelope — the envelope reports whether the HTTP exchange succeeded, while `data.status` reports dependency health. This is deliberate: the readiness contract is itself part of the successful response.

Contract: `ReadinessResponse` / `HealthCheck` / `HealthStatus` in `packages/contracts/src/health/index.ts`, validated at test time by `readinessResponseSchema`.

### 2.3 `GET /health`

Convenience index of the service: the version, the known service names, and a **complete machine-readable route list**. Contains no secrets and no dynamic data.

```json
{
  "ok": true,
  "data": {
    "service": "api",
    "version": "0.1.0",
    "services": ["api", "storefront", "admin"],
    "endpoints": {
      "health": ["GET /health/live", "GET /health/ready"],
      "catalog": ["GET /v1/catalog/facets", "…"],
      "cart": ["GET /v1/cart", "…"]
    }
  },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

The route list is exhaustive by policy. An index that lists only a handful of routes is worse than none, because a caller treats it as a complete capability list and concludes that an endpoint which 404s was never meant to exist. **This list must be updated in the same commit as any route change.**

### 2.4 Storefront and admin health endpoints

Each Next.js app exposes its own health route returning the `LivenessResponse` shape.

| App        | Path              | Behaviour                               |
| ---------- | ----------------- | --------------------------------------- |
| Storefront | `GET /api/health` | Static liveness of the Next.js process. |
| Admin      | `GET /api/health` | Static liveness of the Next.js process. |

These are **pure liveness probes**. They do not currently check the API or MongoDB — they prove the Next.js process is up, not that the platform works end to end. Wiring them to the API is a deliberate follow-up (see Q-5).

---

## 3. Environments and database isolation

| Concern                  | Guarantee                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Which database           | `MONGODB_URI` + `MONGODB_DB`. Nothing is hardcoded.                                                                                                                                                                                                                                                                      |
| Wrong-environment writes | `assertNotProductionDatabase()` in the import worker refuses to run if the database name contains `prod`, `production` or `live`. Override deliberately with `IMPORT_BLOCK_PRODUCTION=false`.                                                                                                                            |
| Test runs                | `tests/helpers/guard.ts` asserts the resolved `MONGODB_URI` is **byte-for-byte** the URI published by the Vitest global setup, that it is loopback, that it is not Atlas, and that the database name is the per-worker throwaway `ajooba_test_<worker>`. Any failure aborts the run before a single document is written. |
| Parallel test files      | Each Vitest worker gets its own database, so files cannot see or clobber each other.                                                                                                                                                                                                                                     |

> **Operational note.** A local MongoDB on `127.0.0.1:27017` is not necessarily dedicated to this project. The API addresses only its configured `MONGODB_DB`, so other databases on the same server are untouched — but confirm the configured name before any write.

---

## 4. Public endpoints

### 4.1 `GET /v1/catalog/products`

Paginated, filterable product list. All query parameters are optional; an empty query returns the first page of the full catalogue.

| Parameter     | Type    | Default  | Notes                                                                                              |
| ------------- | ------- | -------- | -------------------------------------------------------------------------------------------------- |
| `search`      | string  | —        | Free-text over title / code / colour.                                                              |
| `subcategory` | slug    | —        | One of `mojri-jutti`, `shoe`, `sandal`, `chappal`. Canonicalised slug, not the raw workbook value. |
| `colour`      | string  | —        | Matched against the workbook `Colour` value, case-insensitively.                                   |
| `size`        | integer | —        | 5–13 inclusive. Matches products having a variant in that size.                                    |
| `minPrice`    | integer | —        | Lower bound on selling price, inclusive.                                                           |
| `maxPrice`    | integer | —        | Upper bound on selling price, inclusive.                                                           |
| `inStock`     | boolean | —        | `true` / `false`, coerced from the query string.                                                   |
| `sort`        | enum    | `newest` | One of `newest`, `price-asc`, `price-desc`, `title-asc`, `title-desc`.                             |
| `page`        | integer | 1        | 1-based.                                                                                           |
| `pageSize`    | integer | 24       | Capped at `MAX_PAGE_SIZE` = 100.                                                                   |

All coercion and bounding is enforced by `catalogQuerySchema` in `packages/contracts/src/catalog/schemas.ts`, applied by the `validateQuery` middleware. A malformed value is a `422 VALIDATION_FAILED`, never a silent coercion to something surprising.

`data` matches `CatalogListResult`:

```json
{
  "items": [/* Product[] — see §4.4 */],
  "totalItems": 674,
  "page": 1,
  "pageSize": 24,
  "totalPages": 29
}
```

`totalItems` counts **designs**, not individual size variants. The catalogue holds 55 distinct designs generating 674 unique SKUs. If `totalItems` is 0, the list is genuinely empty — the UI renders an explicit empty state, never a mock grid.

### 4.2 `GET /v1/catalog/products/:slug`

Single product with its variants and images.

| Situation                                                    | HTTP | `error.code`        |
| ------------------------------------------------------------ | ---- | ------------------- |
| Product exists                                               | 200  | —                   |
| No product with that slug                                    | 404  | `NOT_FOUND`         |
| Slug fails validation (empty, over-long, illegal characters) | 422  | `VALIDATION_FAILED` |

Slug shape is enforced by `productSlugParamSchema`.

### 4.3 `GET /v1/catalog/facets`

Facet counts for the filter sidebar (subcategories, colours, sizes, price bounds). The aggregation lives in `catalog.service.ts`; the route is mounted.

### 4.4 `Product` shape

Defined as `Product` in `packages/contracts/src/catalog/types.ts`. Field provenance:

| Field                                          | Source in the real data                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`                                         | The `A<NN>` design code parsed from `Seller SKU Id`.                                                                                                                             |
| `slug`                                         | `<design-code>-<stable-design-slug>`, computed at import time and frozen (decision C-2).                                                                                         |
| `subcategory` / `subcategorySlug`              | The `Sub-category` column. Raw value preserved verbatim; slug added for routing.                                                                                                 |
| `brand`                                        | `Brand` = `"Ajooba Footwear"` on every Flipkart listing template row.                                                                                                            |
| `colours`                                      | Distinct values from the `Colour` column.                                                                                                                                        |
| `variants[].sku`                               | `Seller SKU Id`, verbatim. Never reformatted.                                                                                                                                    |
| `variants[].size` / `ukIndiaSize` / `euroSize` | `Size` and the Flipkart template `UK/India Size` / `Euro Size` columns.                                                                                                          |
| `variants[].colour` / `colourToken`            | The `Colour` column and the colour token embedded in the SKU. **Three tokens (`OW`, `IVY`, `IVR`) all mean Ivory** — the token is not a reversible encoding, so both are stored. |
| `variants[].mrp`                               | `MRP`.                                                                                                                                                                           |
| `variants[].sellingPrice`                      | `Your Selling Price`.                                                                                                                                                            |
| `variants[].discountPercent`                   | Derived: `round((MRP − SellingPrice) / MRP × 100)`.                                                                                                                              |
| `variants[].ean`                               | Flipkart template `EAN/UPC` — **empty in the source data**, hence optional.                                                                                                      |
| `images[].url`                                 | Path under `/products/AJ-A<n>/`, relative to `public/`. Original filenames preserved; nothing renamed or regenerated.                                                            |
| `mrp` / `sellingPrice`                         | Min/max across the design's variants. Which is the "headline" price is unresolved — see Q-4.                                                                                     |
| `inStock`                                      | Rollup of the variants' stock. **Every imported variant is `false`** until an authorised stock source writes a real number (decision C-3).                                       |

### 4.5 Content and marketing

| Endpoint               | Method | `data`                                                                                            |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `/v1/content/banners`  | GET    | Banners active for the `placement` query param at this instant.                                   |
| `/v1/content/blocks`   | GET    | Editable content blocks, keyed.                                                                   |
| `/v1/content/settings` | GET    | Store settings as the storefront sees them (store open/closed, contact details, shipping config). |
| `/v1/content/homepage` | GET    | **The resolved, publishable homepage.** See §4.7.                                                 |

### 4.7 `GET /v1/content/homepage` — the resolved homepage

Returns the homepage as the storefront should render it. The API — not the
client — decides what is publishable, so an expired campaign or a stale
product reference cannot reach a shopper.

```json
{
  "ok": true,
  "data": {
    "sections": [
      {
        "id": "6ada…",
        "type": "featured",
        "position": 2,
        "isVisible": true,
        "heading": "The Ajooba Edit",
        "subheading": "Hand-finished, built to last.",
        "startsAt": null,
        "endsAt": null,
        "config": { "layout": "spotlight", "spotlightProductId": "6ad9…" },
        "products": [
          {
            "id": "6ad9…",
            "code": "A57",
            "slug": "…",
            "title": "…",
            "subcategory": "shoe",
            "subcategorySlug": "shoe",
            "mrp": 1999,
            "sellingPrice": 1499,
            "inStock": false,
            "imageUrl": "/products/AJ-A57/A57-BLK-1.jpeg",
            "imageAlt": "…",
            "isPurchasable": false,
            "verifiedColours": []
          }
        ],
        "deals": [],
        "colourTiles": [],
        "unresolvedProductIds": [],
        "hiddenBecause": null,
        "campaignEndsAt": null
      }
    ],
    "count": 5
  }
}
```

**`config` is echoed back unchanged, and derived data lives in sibling fields.**

This is the single most important contract rule on this page. `config` is the
administrator's editable input and is returned byte-for-byte, so a client can
read a section and immediately save it back. Resolved output lives in
`products`, `deals` and `colourTiles` — never inside `config`.

> Folding resolved values back into `config` silently broke the admin editor:
> the client read tiles where it expected colour names, and the write schema
> then rejected its own read payload. See `API_CONTRACT_GAPS.md` §11.4.

| Field                  | Shape                       | Meaning                                                                                                                                                          |
| ---------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`             | `HomepageProductCard[]`     | Resolved from `products`/`variants` at read time.                                                                                                                |
| `deals`                | `HomepageDealPrice[]`       | Backend-computed campaign prices. Empty unless a `deal`.                                                                                                         |
| `colourTiles`          | `HomepageColourTile[]`      | Resolved shop-by-colour tiles. **Each tile's image is verified to be that colour**; a colour with no verified photograph is dropped rather than mis-illustrated. |
| `unresolvedProductIds` | `string[]`                  | References that could not be resolved. Non-empty hides the section.                                                                                              |
| `hiddenBecause`        | `SectionHideReason \| null` | Why the storefront is not rendering it. `null` when live.                                                                                                        |
| `campaignEndsAt`       | ISO \| null                 | The persisted campaign end the countdown reads — the same value the visibility check used, so the countdown and the hide logic cannot disagree.                  |

**Guarantees this endpoint makes**

| Rule                                                                                                                                                                                                   | Where it is enforced                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Only renderable sections are returned. A section that is disabled, outside its window, expired, has no products, has no running campaign, or whose references did not resolve is **omitted entirely**. | `resolveSection()` in `homepage.service.ts` |
| `isPurchasable` uses the same gate as checkout: `photographyStatus !== 'pending-review'` **and** `stock - reservedStock > 0`.                                                                          | `isSellable()`                              |
| Deal prices are produced by `computeDiscount()` — the same pricing service checkout uses — so a badge cannot disagree with a charge.                                                                   | `buildDeals()`                              |
| A colour tile only appears if a photograph **verified as that colour** exists. A colour with no verified imagery is dropped rather than illustrated with the wrong shoe.                               | `colour-shop` branch                        |
| `categorySlugs` are filtered to categories that currently have products.                                                                                                                               | `category-grid` branch                      |
| `campaignEndsAt` is the same persisted timestamp the visibility check used, so the countdown and the hide logic can never disagree.                                                                    | `resolveSection()`                          |

### 4.8 Coupons and analytics

| Endpoint                    | Method | Notes                                                                                                                                                                                        |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/coupons/validate` | POST   | Public. Checks a code against a subtotal **without** applying it, so the storefront can show a live preview.                                                                                 |
| `POST /v1/analytics/events` | POST   | Public, fire-and-forget. A failure to record an event must never affect the customer's shopping, so recording errors are logged and swallowed. Feeds `GET /v1/admin/analytics/search-terms`. |

---

## 5. Customer endpoints

All require `Authorization: Bearer <accessToken>` from `POST /v1/auth/login` or `/register`.

### 5.1 Authentication

| Endpoint                   | Method | Body / effect                                                                                                  |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `/v1/auth/register`        | POST   | `{ email, password, firstName, phone?, lastName? }` → `AuthSession`. Password ≥ 10 chars, ≥ 1 letter, ≥ 1 digit. |
| `/v1/auth/login`           | POST   | `{ email, password }` → `AuthSession`.                                                                         |
| `/v1/auth/providers`       | GET    | The social providers actually configured: `{ providers: [{ id, label }] }`. Empty when none are.                |
| `/v1/auth/oauth/:provider/start`    | GET | 302 to the provider's consent screen with a signed `state`. `?next=` carries a **relative** return path. |
| `/v1/auth/oauth/:provider/callback` | GET | 302 back to the storefront. Success lands on `/auth/callback#accessToken=…` (fragment, never the body). |
| `/v1/auth/refresh`         | POST   | `{ refreshToken }` → a fresh `AuthSession`.                                                                    |
| `/v1/auth/logout`          | POST   | `{ refreshToken }`. Revokes that one refresh token.                                                            |
| `/v1/auth/logout-all`      | POST   | Revokes every refresh token for the customer.                                                                  |
| `/v1/auth/me`              | GET    | The signed-in `CustomerProfile`.                                                                               |
| `/v1/auth/me`              | PATCH  | Update own profile.                                                                                            |
| `/v1/auth/change-password` | POST   | **Revokes every refresh token**, so every other device is signed out.                                          |

Failed-login attempts are counted; exceeding `MAX_FAILED_LOGIN_ATTEMPTS` locks the account for `ACCOUNT_LOCKOUT_SECONDS`.

`CustomerProfile` is a public projection. It contains **no** password material and no internal flags.

### 5.2 Cart

| Endpoint                    | Method | Effect                                                         |
| --------------------------- | ------ | -------------------------------------------------------------- |
| `/v1/cart`                  | GET    | The cart with line items, subtotal, discount, shipping, total. |
| `/v1/cart/items`            | POST   | `{ variantId, quantity }`.                                     |
| `/v1/cart/items/:variantId` | PATCH  | `{ quantity }`. **A quantity of zero removes the line.**       |
| `/v1/cart/items/:variantId` | DELETE | Remove one line.                                               |
| `/v1/cart`                  | DELETE | Empty the cart.                                                |
| `/v1/cart/coupon`           | POST   | Apply a coupon code.                                           |
| `/v1/cart/coupon`           | DELETE | Remove the coupon.                                             |

Every write returns the **whole updated cart**, so the client never has to re-fetch.

Id handling is deliberately asymmetric and this is tested:

- A malformed `variantId` **in the request body** is schema-validated → `422 VALIDATION_FAILED`.
- A malformed `variantId` **in the URL path** is not schema-validated, so the lookup itself decides → `404 NOT_FOUND`.

### 5.3 Wishlist

| Endpoint                  | Method | Effect                                                   |
| ------------------------- | ------ | -------------------------------------------------------- |
| `/v1/wishlist`            | GET    | The customer's wishlist.                                 |
| `/v1/wishlist`            | POST   | `{ productId }` — adding twice is a no-op, not an error. |
| `/v1/wishlist/:productId` | DELETE | Remove.                                                  |

### 5.4 Checkout

`POST /v1/checkout/orders` — body:

```json
{
  "shippingAddress": {
    "fullName": "…",
    "line1": "…",
    "city": "…",
    "state": "…",
    "postalCode": "…",
    "country": "India",
    "phone": "…"
  },
  "paymentMethod": "cod",
  "idempotencyKey": "…"
}
```

`paymentMethod` is `cod` (cash on delivery) or `razorpay`. **Razorpay is not integrated in this phase** — a `razorpay` selection is rejected rather than silently simulated. No fake payment flow exists.

| Situation                                      | HTTP                     |
| ---------------------------------------------- | ------------------------ |
| Order placed                                   | 201                      |
| Cart empty, or every line unavailable          | 409 `CONFLICT`           |
| Retried with the same key and body             | 201 + the original order |
| Retried with the same key and a different body | 409 `CONFLICT`           |

Placing an order is transactional: stock is decremented with a conditional update so two concurrent checkouts cannot oversell the same variant, the cart is cleared, and the order is written. A failure at any point leaves stock untouched.

### 5.5 Orders

| Endpoint                  | Method | Effect                            |
| ------------------------- | ------ | --------------------------------- |
| `/v1/orders`              | GET    | The customer's own orders.        |
| `/v1/orders/:orderNumber` | GET    | One of the customer's own orders. |

The lookup is **scoped to the customer**, so an order belonging to someone else is a `404`, not a `403`. A `403` would confirm that the order number exists, which is a small information leak.

### 5.6 Returns

| Endpoint                | Method | Effect                                                   |
| ----------------------- | ------ | -------------------------------------------------------- |
| `/v1/returns`           | POST   | Raise a return against one of the customer's own orders. |
| `/v1/returns`           | GET    | The customer's own return requests.                      |
| `/v1/returns/:returnId` | GET    | One of the customer's own returns.                       |

Customer-scoped, so a return belonging to another customer is a `404`.

---

## 6. Admin endpoints

All require an **admin** token from `POST /v1/admin/auth/login` plus the named permission. An `owner` has every permission; a `support` agent has neither `catalog:write` nor `settings:write`.

### 6.1 Dashboard and inventory

| Endpoint                          | Method | Permission        |
| --------------------------------- | ------ | ----------------- |
| `/v1/admin/dashboard`             | GET    | `analytics:read`  |
| `/v1/admin/inventory`             | GET    | `catalog:read`    |
| `/v1/admin/inventory/adjustments` | POST   | `inventory:write` |
| `/v1/admin/inventory/movements`   | GET    | `catalog:read`    |

Inventory is a **ledger**, not a mutable number. `POST /inventory/adjustments` appends a movement; the on-hand figure is derived. The operation is **idempotent** — a retried request with the same idempotency key returns the original result instead of applying the adjustment twice. A retry that double-counts stock is worse than a failed request.

### 6.2 Orders and returns

| Endpoint                           | Method | Permission                                  |
| ---------------------------------- | ------ | ------------------------------------------- |
| `/v1/admin/orders`                 | GET    | `orders:read`                               |
| `/v1/admin/orders/:orderId`        | GET    | `orders:read`                               |
| `/v1/admin/orders/:orderId/status` | PATCH  | `orders:write`                              |
| `/v1/admin/returns`                | GET    | `returns:read`                              |
| `/v1/admin/returns/:returnId`      | PATCH  | `returns:write` (approve / reject / refund) |

Admin reads are **not** customer-scoped: an admin may read any order by id. Status transitions are validated against the order state machine; an illegal transition is a `409`, never a silent no-op.

### 6.3 Coupons, customers, audit

| Endpoint                              | Method | Permission       |
| ------------------------------------- | ------ | ---------------- |
| `/v1/admin/coupons`                   | GET    | `coupons:read`   |
| `/v1/admin/coupons`                   | POST   | `coupons:write`  |
| `/v1/admin/coupons/:couponId`         | PATCH  | `coupons:write`  |
| `/v1/admin/coupons/:couponId`         | DELETE | `coupons:write`  |
| `/v1/admin/coupons/:couponId/preview` | POST   | `coupons:read`   |
| `/v1/admin/customers`                 | GET    | `customers:read` |
| `/v1/admin/audit-logs`                | GET    | `audit:read`     |

`POST /coupons/:id/preview` shows what a coupon would do to a subtotal **without applying it** — the admin can check a promotion before publishing it.

The audit log is **append-only** and records who changed what, when, and from which IP.

### 6.4 Content and settings

| Endpoint                              | Method | Permission               |
| ------------------------------------- | ------ | ------------------------ |
| `/v1/admin/content/banners`           | GET    | `content:read`           |
| `/v1/admin/content/banners`           | POST   | `content:write`          |
| `/v1/admin/content/banners/:bannerId` | PATCH  | `content:write`          |
| `/v1/admin/content/banners/:bannerId` | DELETE | `content:write`          |
| `/v1/admin/content/blocks`            | PUT    | `content:write` (upsert) |
| `/v1/admin/content/settings`          | PUT    | `settings:write`         |
| `/v1/admin/content/homepage/products` | GET    | `content:read`           |
| `/v1/admin/content/homepage/sections` | GET    | `content:read`           |
| `/v1/admin/content/homepage/sections` | PUT    | `content:write`          |

`PUT` on blocks and settings is an **upsert by key**, not a create-then-update pair, so the admin panel can save a form idempotently.

### 6.5 Homepage merchandising

The merchandising surface is three endpoints. It reuses the existing `content:*`
permissions — no parallel permission set was introduced.

#### `GET /v1/admin/content/homepage/products`

The product picker. Searches the **real** catalogue and reports each row's
problems as first-class fields, so an administrator can see before publishing
that a product has no imagery or nothing buyable.

| Parameter         | Type           | Default | Notes                                  |
| ----------------- | -------------- | ------- | -------------------------------------- |
| `search`          | string         | —       | Matches `title` or `code`.             |
| `subcategory`     | slug           | —       | Restricts to one real sub-category.    |
| `purchasableOnly` | `true`/`false` | `false` | Only products with a sellable variant. |
| `page`            | int ≥ 1        | 1       |                                        |
| `pageSize`        | int 1–60       | 24      |                                        |

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "6ad9…",
        "code": "A57",
        "slug": "…",
        "title": "…",
        "subcategory": "shoe",
        "subcategorySlug": "shoe",
        "sellingPrice": 1499,
        "mrp": 1999,
        "inStock": false,
        "imageUrl": "/products/AJ-A57/A57-BLK-1.jpeg",
        "colours": ["Black", "Brown", "Chickoo", "Olive"],
        "hasImage": true,
        "hasSellableVariant": false,
        "hasQuarantinedImages": true
      }
    ],
    "totalItems": 55,
    "page": 1,
    "pageSize": 24,
    "totalPages": 3
  }
}
```

#### `GET /v1/admin/content/homepage/sections`

Every section **including the hidden ones**. The editor must be able to see a
section that is switched off, out of window or expired — otherwise an
administrator could never re-enable it.

```json
{ "ok": true, "data": { "items": [{ "id": "…", "section": { …ResolvedHomepageSection } }], "count": 5, "version": 1792683437552 } }
```

Each section carries `hiddenBecause` — one of `disabled`, `not-scheduled`,
`expired`, `no-products`, `no-campaign`, `unresolved-references` — or `null` when
it is live.

**`version` is required, not optional.** It is the optimistic-concurrency token
the client must echo back on save. A client that omits it, or invents one (a
timestamp is the tempting mistake), will have **every save rejected with 409**:
there is no valid value it could produce. If you are writing a new client, take
`version` from this response and send it back unchanged.

#### `PUT /v1/admin/content/homepage/sections`

Replaces the whole page. Ordering and visibility are page-level concerns, so the
admin saves one coherent document rather than issuing per-section PATCHes.

```json
{
  "version": 0,
  "publish": true,
  "sections": [
    {
      "position": 0,
      "isVisible": true,
      "startsAt": null,
      "endsAt": null,
      "config": {
        "type": "featured",
        "heading": "The Ajooba Edit",
        "subheading": "",
        "layout": "spotlight",
        "mode": "manual",
        "productIds": ["6ad9…"],
        "limit": 4,
        "spotlightProductId": "6ad9…"
      }
    }
  ]
}
```

**Server-side guarantees**

| Guarantee                                                                                                                             | Failure                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Authenticated and permission-checked server-side. The admin UI's visibility rules are a convenience, never the authority.             | 401 / 403                            |
| `config` validated against `homepageSectionSchema` (a discriminated union on `type`).                                                 | 422 `VALIDATION_FAILED`              |
| **Every** product id resolved against the catalogue before anything is written.                                                       | 409 `CONFLICT` naming the section    |
| Category slugs checked against the four real sub-categories.                                                                          | 409 `CONFLICT`                       |
| A hero must point at a banner that exists.                                                                                            | 404 `NOT_FOUND`                      |
| **All sections validated before the first write** — there is no partial save.                                                         | 409 `CONFLICT` listing every problem |
| Optimistic concurrency: `version` is compared against the newest `updatedAt`. A second admin editing the same page is told to reload. | 409 `CONFLICT`                       |
| Audited as `entity: "homepage"`, `action: "update"`.                                                                                  | —                                    |

The response is `{ ok, data: { sections, count, version } }` — the freshly resolved
page **plus the new concurrency token**, so the client can keep editing without
reloading. The client renders exactly what is now live rather than an optimistic
guess.

**Section vs `config`**

`position`, `isVisible`, `startsAt` and `endsAt` are **section-level** fields,
siblings of `config` — not nested inside it. `config` holds only the
type-specific merchandising choices. This mirrors how the data is stored in
`homepage_sections` (four columns plus a `config` document) and how the admin
editor models its drafts.

> An earlier version of `homepageSectionSchema` folded the base fields into each
> `config` variant. The write schema then demanded `config.position`, which the
> API never sent and no client ever set — so a correctly-formed save was
> rejected for a reason that had nothing to do with what was being saved.
> §11.4 of `API_CONTRACT_GAPS.md`.

For a `deal`, the campaign window **is** the section-level `startsAt`/`endsAt`.
The countdown, the visibility check and the admin form all read that one pair of
fields, so a campaign cannot expire in one place and keep running in another.

### 6.6 Admin analytics

| Endpoint                                | Method | Permission       |
| --------------------------------------- | ------ | ---------------- |
| `/v1/admin/analytics/search-terms`      | GET    | `analytics:read` |
| `/v1/admin/analytics/top-viewed`        | GET    | `analytics:read` |
| `/v1/admin/analytics/events`            | GET    | `analytics:read` |
| `/v1/admin/analytics/insights`          | GET    | `analytics:read` |
| `/v1/admin/analytics/visitors`          | GET    | `analytics:read` |
| `/v1/admin/analytics/visitors/:id`      | GET    | `analytics:read` |

`search-terms` is what shoppers actually typed. A term with **zero results** is the highest-value signal in the system — it is a product the store should stock and a search that should be fixed.

`insights` is the whole interaction report in one document — totals, the
session-counted funnel, surface and action breakdowns, per-design and
per-category tables, device split and a dense daily trend. Accepts
`?days=1..365`, `?limit=1..50` and `?categorySlug=<slug>`; the category view is
the same aggregation filtered, not a second implementation, so the two can
never disagree. Write side: `POST /v1/analytics/events` and
`POST /v1/analytics/events/batch` (max 25 events), both public with
`optionalAuth` — a customer id comes from the token and is never read from the
body.

The `funnel` block reports **sessions**, not events, at every step: `browsed`,
`viewedDesign`, `addedToCart`, `startedCheckout`, `ordered`. Each is a
conditional `$addToSet` on the session id, so no step can exceed the one above
it. The `totals` deliberately cannot be used to build this — `visitors` counts
sessions while `productViews` counts events, and dividing one by the other
produced drop-offs that were arithmetic rather than behaviour.

`visitors` lists signed-in customers with activity in the window, ranked by taps,
capped at 50. `visitors/:id` returns one person's profile: their designs,
categories, surfaces, actions, devices and their 20 most recent events. An id
with no account **and** no events is `404`; an id whose account was removed but
whose events remain is `200`, because those visits happened.

See `docs/ANALYTICS_LEDGER.md` for the recording rules, the consent gate and why
a tap is defined as "any event carrying an `action`".

### 6.7 Catalogue administration (G-1 … G-6)

Added 2026-10-23. Full request/response schemas live in
`packages/contracts/src/catalog/admin.ts`; the schemas are named below and are
imported directly by both the API routes and the admin client.

**Products are addressed by their `A<NN>` code, variants by their `sku`.**
Titles and slugs are editable and therefore unstable; a slug-keyed admin API
would 404 the first time somebody corrected a name.

| Endpoint                                      | Method           | Permission                       | Contract                         |
| --------------------------------------------- | ---------------- | -------------------------------- | -------------------------------- |
| `/v1/admin/catalog/products`                  | GET              | `catalog:read`                   | `adminProductQuerySchema`        |
| `/v1/admin/catalog/products`                  | POST             | `catalog:write`                  | `createProductRequestSchema`     |
| `/v1/admin/catalog/products/:code`            | GET              | `catalog:read`                   | —                                |
| `/v1/admin/catalog/products/:code`            | PATCH            | `catalog:write`                  | `updateProductRequestSchema`     |
| `/v1/admin/catalog/products/:code`            | DELETE           | `catalog:write`                  | — (archive)                      |
| `/v1/admin/catalog/products/:code/colours`    | GET              | `catalog:read`                   | —                                |
| `/v1/admin/catalog/products/:code/variants`   | GET              | `catalog:read`                   | `adminVariantQuerySchema`        |
| `/v1/admin/catalog/products/:code/variants`   | POST             | `catalog:write`                  | `createVariantRequestSchema`     |
| `/v1/admin/catalog/variants/:sku`             | DELETE           | `catalog:write`                  | — (retire)                       |
| `/v1/admin/catalog/variants/:sku/photography` | PATCH            | `catalog:write`                  | `photographyRequestSchema`       |
| `/v1/admin/catalog/skus/lookup`               | POST             | `catalog:read`                   | `skuLookupRequestSchema`         |
| `/v1/admin/catalog/skus/:sku`                 | GET              | `catalog:read`                   | —                                |
| `/v1/admin/catalog/skus/:sku`                 | PATCH            | `catalog:write`                  | `updateVariantRequestSchema`     |
| `/v1/admin/catalog/skus/:sku/stock`           | GET              | `catalog:read`                   | — (ledger)                       |
| `/v1/admin/catalog/skus/:sku/stock`           | PUT              | `inventory:write`                | `setStockRequestSchema`          |
| `/v1/admin/catalog/inventory/stock-set`       | POST             | `inventory:write`                | `bulkStockSetRequestSchema`      |
| `/v1/admin/catalog/categories`                | GET              | `catalog:read`                   | `categoryQuerySchema`            |
| `/v1/admin/catalog/categories`                | POST             | `catalog:write`                  | `createCategoryRequestSchema`    |
| `/v1/admin/catalog/categories/seed`           | POST             | `catalog:write`                  | —                                |
| `/v1/admin/catalog/categories/reorder`        | POST             | `catalog:write`                  | `reorderCategoriesRequestSchema` |
| `/v1/admin/catalog/categories/:slug`          | GET/PATCH/DELETE | `catalog:read` / `catalog:write` | `updateCategoryRequestSchema`    |
| `/v1/admin/catalog/categories/:slug/products` | GET              | `catalog:read`                   | —                                |
| `/v1/admin/catalog/images/review-queue`       | GET              | `catalog:read`                   | `imageReviewQuerySchema`         |
| `/v1/admin/catalog/images/:code/coverage`     | GET              | `catalog:read`                   | —                                |
| `/v1/admin/catalog/images/:imageId/assign`    | POST             | `catalog:write`                  | `assignImageRequestSchema`       |
| `/v1/admin/catalog/images/:imageId/reject`    | POST             | `catalog:write`                  | `reviewImageRequestSchema`       |
| `/v1/admin/catalog/images/:imageId/revert`    | POST             | `catalog:write`                  | `reviewImageRequestSchema`       |
| `/v1/admin/catalog/imports`                   | GET/POST         | `import:run`                     | `createImportPlanRequestSchema`  |
| `/v1/admin/catalog/imports/:planId`           | GET              | `import:run`                     | —                                |
| `/v1/admin/catalog/imports/:planId/apply`     | POST             | `import:run`                     | `applyImportPlanRequestSchema`   |

### 6.7.1 Rules that are enforced server-side, not just documented

| Rule                                                       | Where it is enforced                           | Failure                 |
| ---------------------------------------------------------- | ---------------------------------------------- | ----------------------- |
| A design code is unique                                    | `createProduct` index + service check          | `409`                   |
| A SKU is unique                                            | `createVariant` / `updateVariant`              | `409`                   |
| A category slug is unique                                  | `createCategory`                               | `409`                   |
| A category cannot contain itself, directly or transitively | `updateCategory` walks ancestors               | `409`                   |
| A category in use cannot be retired                        | `retireCategory` counts references             | `409`                   |
| Every review decision needs a reason ≥ 10 chars            | `reviewImageRequestSchema`                     | `422`                   |
| An image's colour must be one the design sells             | `assignImage`                                  | `422`                   |
| The same bytes cannot serve two colours                    | checksum scan across all assigned images       | `409`                   |
| New SKUs start at `stock: 0`                               | `stock` is not in `createVariantRequestSchema` | n/a — rejected at parse |
| Stock cannot drop below `reservedStock`                    | `setStock`                                     | `422`                   |
| Stock writes are concurrency-guarded                       | `expectedCurrentStock` must match              | `409`                   |
| A colour cannot be marked `verified` with no photo         | `setPhotographyStatus`                         | `409`                   |
| Import never writes stock                                  | `import.service` never touches stock fields    | n/a                     |
| An import apply needs `confirm` + a matching checksum      | `applyImportPlan`                              | `409` / `422`           |

### 6.7.2 Response shapes

```jsonc
// GET /v1/admin/catalog/products/:code
{
  "data": {
    "code": "A46",
    "title": "…",
    "slug": "…",
    "status": "draft | published | archived",
    "categories": ["formal-shoes"],
    "images": [
      {
        "imageId": "A46:IMG_4021.jpg",
        "colour": "black",
        "checksum": "9f2c…",
        "previewUrl": "/media/…",
        "reviewStatus": "assigned | quarantined | rejected",
      },
    ],
    "colours": [
      {
        "colour": "black",
        "verifiedPhotoCount": 2,
        "skuCount": 6,
        "sellable": false, // stock 0 → never purchasable
      },
    ],
  },
  "meta": { "requestId": "…" },
}
```

The `"no verified photo yet"` state is a **first-class response**, not an empty
array with a 500 behind it: a colour with no verified photograph returns
`verifiedPhotoCount: 0` and its SKUs carry
`photographyStatus: "pending-review"`, which the storefront renders as the
explicit placeholder rather than reusing another colour's photograph.

### 6.7.3 Response shapes — import plans

```jsonc
// POST /v1/admin/catalog/imports  → 201
{
  "data": {
    "planId": "…",
    "status": "planned",
    "targetDatabase": "ajooba_development",
    "sourceFilename": "ajooba-export.json",
    "payloadChecksum": "sha256:3a7f…",
    "summary": {
      "designsToCreate": 4,
      "designsToUpdate": 0,
      "variantsToCreate": 18,
      "variantsToSkip": 0,
      "imagesQuarantined": 2,
    },
    "findings": [
      {
        "rowIndex": 3,
        "code": "A46",
        "severity": "quarantine",
        "message": "Colour 'navy' is not in the workbook row for A46.",
      },
    ],
  },
}
```

`payloadChecksum` must be echoed back on apply. If the payload changes between
the dry run and the approval, the approved report no longer describes what
would be written, so the apply is refused.

### 6.7.4 Response shapes — bulk stock

```jsonc
// POST /v1/admin/catalog/inventory/stock-set
{
  "data": {
    "mode": "dry-run | applied",
    "reason": "2026-10 physical count, aisle 3",
    "considered": 674,
    "changed": 674,
    "unchanged": 0,
    "skipped": 0,
    "skippedDetail": [{ "sku": "AJ-A01-BLK-42", "reason": "expectedCurrentStock mismatch" }],
    "failures": [{ "sku": "AJ-A01-BLK-43", "reason": "would drop below reservedStock (2)" }],
  },
}
```

`mode: "dry-run"` writes nothing. There is no endpoint that changes stock
without a reason, a concurrency guard and a ledger entry.

---

## 7. Contract governance

### 7.1 Where the contract lives

`packages/contracts` is the single source of truth. It is consumed as a workspace dependency (`"@ajooba/contracts": "workspace:*"`) by all three apps.

```
packages/contracts/src/
├── common/       envelopes, pagination, error codes, primitives
├── auth/         credentials, roles, permissions, sessions
├── catalog/      Product, ProductVariant, ProductImage, catalog query
├── cart/         cart lines, totals, coupons
├── checkout/     orders, payment methods, order state machine
├── returns/      return requests and their resolution
├── content/      banners, content blocks, store settings
├── analytics/    event payloads
├── env/          API / storefront / admin environment schemas
├── health/       liveness + readiness contracts
└── index.ts      barrel
```

Changing a type or a Zod schema in `packages/contracts` changes the API's runtime validation **and** both Next.js apps' compile-time types in the same commit. There is no second definition to drift.

`packages/contracts` is versioned `0.1.0`. It is consumed internally only, so breaking changes are cheap: bump the minor, update all three apps in the same commit.

### 7.2 Verification

```bash
pnpm --filter @ajooba/contracts test    # schema + envelope tests
pnpm --filter @ajooba/api test          # supertest integration tests
pnpm -r typecheck                       # every app type-checks against the contracts
```

### 7.3 Compatibility rules

1. **Additive changes are non-breaking.** New optional response fields are safe.
2. **Removing or renaming a response field is breaking.** Requires a `/v2` or a coordinated deploy.
3. **Tightening a Zod schema is breaking** for any caller already sending the looser value.
4. **Error codes are a closed set.** New codes require a contract change and a client update.

---

## 8. Full endpoint index

| Endpoint                                      | Method | Auth                      | Success | Failure modes                          |
| --------------------------------------------- | ------ | ------------------------- | ------- | -------------------------------------- |
| `/health/live`                                | GET    | none                      | 200     | —                                      |
| `/health/ready`                               | GET    | none                      | 200     | 503 when MongoDB is down               |
| `/health`                                     | GET    | none                      | 200     | —                                      |
| `/v1/catalog/facets`                          | GET    | none                      | 200     | 500, 503                               |
| `/v1/catalog/products`                        | GET    | none                      | 200     | 422, 429, 500, 503                     |
| `/v1/catalog/products/:slug`                  | GET    | none                      | 200     | 404, 422, 429, 500, 503                |
| `/v1/content/banners`                         | GET    | none                      | 200     | 500, 503                               |
| `/v1/content/blocks`                          | GET    | none                      | 200     | 500, 503                               |
| `/v1/content/settings`                        | GET    | none                      | 200     | 500, 503                               |
| `/v1/coupons/validate`                        | POST   | none                      | 200     | 404, 422, 429, 500, 503                |
| `/v1/analytics/events`                        | POST   | none                      | 202     | 422, 429, 500, 503                     |
| `/v1/auth/register`                           | POST   | none                      | 201     | 409, 422, 429, 500, 503                |
| `/v1/auth/login`                              | POST   | none                      | 200     | 401, 422, 429, 500, 503                |
| `/v1/auth/providers`                          | GET    | none                      | 200     | 500, 503                               |
| `/v1/auth/oauth/:provider/start`              | GET    | none                      | 302     | 404, 429, 500, 503                     |
| `/v1/auth/oauth/:provider/callback`           | GET    | none                      | 302     | 404, 429, 500, 503                     |
| `/v1/auth/refresh`                            | POST   | refresh token             | 200     | 401, 422, 429, 500, 503                |
| `/v1/auth/logout`                             | POST   | none                      | 200     | 500, 503                               |
| `/v1/auth/me`                                 | GET    | customer                  | 200     | 401, 500, 503                          |
| `/v1/auth/me`                                 | PATCH  | customer                  | 200     | 401, 422, 500, 503                     |
| `/v1/auth/change-password`                    | POST   | customer                  | 200     | 401, 422, 429, 500, 503                |
| `/v1/auth/logout-all`                         | POST   | customer                  | 200     | 401, 500, 503                          |
| `/v1/cart`                                    | GET    | customer                  | 200     | 401, 500, 503                          |
| `/v1/cart/items`                              | POST   | customer                  | 200     | 401, 404, 409, 422, 500, 503           |
| `/v1/cart/items/:variantId`                   | PATCH  | customer                  | 200     | 401, 404, 422, 500, 503                |
| `/v1/cart/items/:variantId`                   | DELETE | customer                  | 200     | 401, 404, 500, 503                     |
| `/v1/cart`                                    | DELETE | customer                  | 200     | 401, 500, 503                          |
| `/v1/cart/coupon`                             | POST   | customer                  | 200     | 401, 409, 422, 429, 500, 503           |
| `/v1/cart/coupon`                             | DELETE | customer                  | 200     | 401, 500, 503                          |
| `/v1/wishlist`                                | GET    | customer                  | 200     | 401, 500, 503                          |
| `/v1/wishlist`                                | POST   | customer                  | 200     | 401, 404, 500, 503                     |
| `/v1/wishlist/:productId`                     | DELETE | customer                  | 200     | 401, 404, 500, 503                     |
| `/v1/checkout/orders`                         | POST   | customer                  | 201     | 401, 409, 422, 429, 500, 503           |
| `/v1/orders`                                  | GET    | customer                  | 200     | 401, 500, 503                          |
| `/v1/orders/:orderNumber`                     | GET    | customer                  | 200     | 401, 404, 500, 503                     |
| `/v1/returns`                                 | POST   | customer                  | 201     | 401, 404, 409, 422, 500, 503           |
| `/v1/returns`                                 | GET    | customer                  | 200     | 401, 500, 503                          |
| `/v1/returns/:returnId`                       | GET    | customer                  | 200     | 401, 404, 500, 503                     |
| `/v1/admin/auth/login`                        | POST   | none                      | 200     | 401, 422, 429, 500, 503                |
| `/v1/admin/auth/refresh`                      | POST   | admin refresh             | 200     | 401, 422, 429, 500, 503                |
| `/v1/admin/auth/logout`                       | POST   | none                      | 200     | 500, 503                               |
| `/v1/admin/auth/me`                           | GET    | admin                     | 200     | 401, 403, 500, 503                     |
| `/v1/admin/auth/change-password`              | POST   | admin                     | 200     | 401, 422, 429, 500, 503                |
| `/v1/admin/dashboard`                         | GET    | admin + `analytics:read`  | 200     | 401, 403, 500, 503                     |
| `/v1/admin/inventory`                         | GET    | admin + `catalog:read`    | 200     | 401, 403, 500, 503                     |
| `/v1/admin/inventory/adjustments`             | POST   | admin + `inventory:write` | 201     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/inventory/movements`               | GET    | admin + `catalog:read`    | 200     | 401, 403, 500, 503                     |
| `/v1/admin/coupons`                           | GET    | admin + `coupons:read`    | 200     | 401, 403, 500, 503                     |
| `/v1/admin/coupons`                           | POST   | admin + `coupons:write`   | 201     | 401, 403, 409, 422, 429, 500, 503      |
| `/v1/admin/coupons/:couponId`                 | PATCH  | admin + `coupons:write`   | 200     | 401, 403, 404, 422, 429, 500, 503      |
| `/v1/admin/coupons/:couponId`                 | DELETE | admin + `coupons:write`   | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/coupons/:couponId/preview`         | POST   | admin + `coupons:read`    | 200     | 401, 403, 404, 422, 500, 503           |
| `/v1/admin/customers`                         | GET    | admin + `customers:read`  | 200     | 401, 403, 500, 503                     |
| `/v1/admin/audit-logs`                        | GET    | admin + `audit:read`      | 200     | 401, 403, 500, 503                     |
| `/v1/admin/orders`                            | GET    | admin + `orders:read`     | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/orders/:orderId`                   | GET    | admin + `orders:read`     | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/orders/:orderId/status`            | PATCH  | admin + `orders:write`    | 200     | 401, 403, 404, 409, 422, 500, 503      |
| `/v1/admin/returns`                           | GET    | admin + `returns:read`    | 200     | 401, 403, 500, 503                     |
| `/v1/admin/returns/:returnId`                 | PATCH  | admin + `returns:write`   | 200     | 401, 403, 404, 409, 422, 500, 503      |
| `/v1/admin/content/banners`                   | GET    | admin + `content:read`    | 200     | 401, 403, 500, 503                     |
| `/v1/admin/content/banners`                   | POST   | admin + `content:write`   | 201     | 401, 403, 422, 429, 500, 503           |
| `/v1/admin/content/banners/:bannerId`         | PATCH  | admin + `content:write`   | 200     | 401, 403, 404, 422, 500, 503           |
| `/v1/admin/content/banners/:bannerId`         | DELETE | admin + `content:write`   | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/content/blocks`                    | PUT    | admin + `content:write`   | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/content/settings`                  | PUT    | admin + `settings:write`  | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/analytics/search-terms`            | GET    | admin + `analytics:read`  | 200     | 401, 403, 500, 503                     |
| `/v1/admin/analytics/top-viewed`              | GET    | admin + `analytics:read`  | 200     | 401, 403, 500, 503                     |
| `/v1/admin/analytics/events`                  | GET    | admin + `analytics:read`  | 200     | 401, 403, 500, 503                     |
| `/v1/admin/analytics/insights`                | GET    | admin + `analytics:read`  | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/analytics/visitors`                | GET    | admin + `analytics:read`  | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/analytics/visitors/:customerId`    | GET    | admin + `analytics:read`  | 200     | 401, 403, 404, 422, 500, 503           |
| `/v1/admin/catalog/products`                  | GET    | admin + `catalog:read`    | 200     | 401, 403, 422, 429, 500, 503           |
| `/v1/admin/catalog/products`                  | POST   | admin + `catalog:write`   | 201     | 401, 403, 409, 422, 429, 500, 503      |
| `/v1/admin/catalog/products/:code`            | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/products/:code`            | PATCH  | admin + `catalog:write`   | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/products/:code`            | DELETE | admin + `catalog:write`   | 200     | 401, 403, 404, 429, 500, 503           |
| `/v1/admin/catalog/products/:code/colours`    | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/products/:code/variants`   | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 422, 500, 503           |
| `/v1/admin/catalog/products/:code/variants`   | POST   | admin + `catalog:write`   | 201     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/variants/:sku`             | DELETE | admin + `catalog:write`   | 200     | 401, 403, 404, 429, 500, 503           |
| `/v1/admin/catalog/variants/:sku/photography` | PATCH  | admin + `catalog:write`   | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/skus/lookup`               | POST   | admin + `catalog:read`    | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/catalog/skus/:sku`                 | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/skus/:sku`                 | PATCH  | admin + `catalog:write`   | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/skus/:sku/stock`           | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/skus/:sku/stock`           | PUT    | admin + `inventory:write` | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/inventory/stock-set`       | POST   | admin + `inventory:write` | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/categories`                | GET    | admin + `catalog:read`    | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/catalog/categories`                | POST   | admin + `catalog:write`   | 201     | 401, 403, 409, 422, 429, 500, 503      |
| `/v1/admin/catalog/categories/seed`           | POST   | admin + `catalog:write`   | 200     | 401, 403, 429, 500, 503                |
| `/v1/admin/catalog/categories/reorder`        | POST   | admin + `catalog:write`   | 200     | 401, 403, 422, 429, 500, 503           |
| `/v1/admin/catalog/categories/:slug`          | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/categories/:slug`          | PATCH  | admin + `catalog:write`   | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/categories/:slug`          | DELETE | admin + `catalog:write`   | 200     | 401, 403, 404, 409, 429, 500, 503      |
| `/v1/admin/catalog/categories/:slug/products` | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 422, 500, 503           |
| `/v1/admin/catalog/images/review-queue`       | GET    | admin + `catalog:read`    | 200     | 401, 403, 422, 500, 503                |
| `/v1/admin/catalog/images/:code/coverage`     | GET    | admin + `catalog:read`    | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/images/:imageId/assign`    | POST   | admin + `catalog:write`   | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |
| `/v1/admin/catalog/images/:imageId/reject`    | POST   | admin + `catalog:write`   | 200     | 401, 403, 404, 422, 429, 500, 503      |
| `/v1/admin/catalog/images/:imageId/revert`    | POST   | admin + `catalog:write`   | 200     | 401, 403, 404, 422, 429, 500, 503      |
| `/v1/admin/catalog/imports`                   | GET    | admin + `import:run`      | 200     | 401, 403, 500, 503                     |
| `/v1/admin/catalog/imports`                   | POST   | admin + `import:run`      | 201     | 401, 403, 422, 429, 500, 503           |
| `/v1/admin/catalog/imports/:planId`           | GET    | admin + `import:run`      | 200     | 401, 403, 404, 500, 503                |
| `/v1/admin/catalog/imports/:planId/apply`     | POST   | admin + `import:run`      | 200     | 401, 403, 404, 409, 422, 429, 500, 503 |

Plus, outside the API: `GET /api/health` on the storefront and on the admin panel, and `GET /products/*` static catalogue media when `MEDIA_STATIC_DIR` is configured.

---

## 9. Open questions for this contract

| #   | Question                                                                     | Why it is unresolved                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-1 | Is `size` a filter on the design or on the variant?                          | Currently filters designs that _have_ a variant in that size. If out-of-stock sizes must be excluded, the query needs a stock join.                                                              |
| Q-2 | Should facets be embedded in the list response?                              | `GET /v1/catalog/facets` is separate. Embedded costs bandwidth on every page; separate costs a round trip. Now that both exist, the trade-off is measurable rather than theoretical.             |
| Q-3 | What is the canonical currency/locale contract?                              | The workbook has bare integers with no currency column. The platform is INR-only for now, but nothing in the response says so.                                                                   |
| Q-4 | Is the 288-row ₹1 selling-price discrepancy systematic or clerical?          | Needs a business answer before the conflicting rows are imported. See `docs/CATALOG_CONFLICTS.md` §3.1 and decision D-3 in `docs/catalog-audit.md`.                                              |
| Q-5 | Should the Next.js health routes check the API?                              | They are pure process-liveness probes today, so a storefront with a dead API still reports healthy.                                                                                              |
| Q-6 | Is the 55-vs-674 product granularity right for the storefront URL structure? | A design with 14 size variants is one product page with 14 options, not 14 products. Confirm before building category pages.                                                                     |
| Q-7 | Should the four homepage category entry points become a five-level tree?     | Phase 3 added subcategory depth. The homepage currently renders a flat four. Confirm before wiring `parentSlug` into the homepage sections.                                                      |
| Q-8 | Where do real stock counts come from?                                        | The workbook has no stock column, so all 674 SKUs are at `0`. `PUT /skus/:sku/stock` and the bulk dry run exist, but the **count itself** is a business input. See `DEPLOYMENT_RUNBOOK.md` §0.1. |
| Q-9 | Should an import plan expire?                                                | Plans are immutable once applied and safe to re-apply only via a fresh dry run, but an old plan can still be applied weeks later. A TTL on unapplied plans would close that.                     |
