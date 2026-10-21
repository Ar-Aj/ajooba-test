# Ajooba Footwear — API Contract

**Status:** v0.1.0 — catalogue read surface only.
**Owner:** API team (`apps/api`)
**Source of truth:** `packages/contracts` — the TypeScript types and Zod schemas in that package *are* the contract. This document describes them in prose. If this document and the code disagree, **the code is correct** and this document is a bug.

---

## 1. Conventions

### 1.1 Base URL and versioning

| Environment | Base URL | Source of the value |
| --- | --- | --- |
| Development | `http://localhost:4000` | `API_PUBLIC_URL` (local `.env`) |
| Staging | platform-provided | `API_PUBLIC_URL` (staging env vars) |
| Production | platform-provided | `API_PUBLIC_URL` (production env vars) |

There is **no** `mode="dev"` / `mode="pro"` switch in the code. Which environment a process runs in is decided entirely by the environment variables the platform injects. A missing variable is a boot failure, not a silent fallback.

The REST surface is namespaced under `/v1`. `/health` sits outside versioning because it is operational, not part of the commercial contract.

### 1.2 Transport rules

- Content type is `application/json; charset=utf-8` on every response.
- Request bodies are limited to **1 MB** (`express.json({ limit: '1mb' })`).
- The server does not advertise itself (`x-powered-by` disabled).
- Responses are gzip-compressed when the client advertises support.
- `trust proxy` is set to `1` so client IPs are read correctly behind Vercel / Render / Cloudflare.

### 1.3 The response envelope

Every response — success **and** failure, including 404 and 500 — uses the same shape.

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

Defined in `packages/contracts/src/common/types.ts` (`ApiSuccess`, `ApiFailure`, `ApiResponse`, `ResponseMeta`, `PaginationMeta`). Emitted exclusively through `apps/api/src/core/http.ts` (`sendSuccess`, `sendFailure`), so the shape is guaranteed.

### 1.4 Error codes

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 422 | Request failed Zod validation. `error.details` lists offending fields. |
| `NOT_FOUND` | 404 | The addressed resource does not exist. |
| `CONFLICT` | 409 | The write would violate a uniqueness or state constraint. |
| `UNAUTHORIZED` | 401 | Missing, malformed or expired credentials. |
| `FORBIDDEN` | 403 | Authenticated but not permitted. |
| `RATE_LIMITED` | 429 | Request quota exceeded. `Retry-After` is set. |
| `INTERNAL_ERROR` | 500 | Unhandled failure. Never leaks internals to the client. |
| `SERVICE_UNAVAILABLE` | 503 | A hard dependency (currently MongoDB) is down. |

`error.message` is safe to render. Internal exception messages are redacted by the global error handler and written to the log against the request id instead.

### 1.5 Authentication

**Not implemented in this phase.** No endpoint accepts credentials yet.

The contract is reserved: authenticated endpoints will carry `Authorization: Bearer <token>`, and admin-only surfaces will additionally check the caller's role. The architecture reserves space for this without committing to an implementation. See `docs/ARCHITECTURE.md` § Authentication (Deferred) and unresolved decision D-6 in `docs/catalog-audit.md`.

### 1.6 Rate limiting

A global limiter is mounted at `/v1`: 300 requests / 60 s per client IP, `draft-7` standard headers. It deliberately does **not** wrap `/health`, so monitoring probes are never throttled. Route-specific, stricter limits (auth, order creation, coupon redemption) will be added when those routes exist.

### 1.7 CORS

Allowed origins come from `CORS_ORIGINS` and `ADMIN_ORIGINS` (comma separated) and are matched by exact string comparison. In non-production environments the two local dev origins (`http://localhost:3000`, `http://localhost:3001`) are appended automatically. Requests with no `Origin` header (server-to-server, `curl`) are allowed. Unknown origins are rejected by the CORS middleware without a 403 from application code.

### 1.8 Logging and observability

Structured JSON logs via Pino, one object per request, with automatic level selection (`5xx` → `error`, `4xx` → `warn`, else `info`). `/health/live` is excluded from access logging so probe traffic stays out of the log volume. Sensitive fields (`password`, `token`, `secret`, `authorization`, …) are redacted by the logger's redact list.

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

| Database state | `data.status` | HTTP |
| --- | --- | --- |
| Connected and ping succeeded | `ok` | 200 |
| Connected but slow / partially degraded | `degraded` | 200 |
| Not connected, or ping threw | `error` | **503** |

```json
{
  "ok": true,
  "data": {
    "status": "error",
    "service": "api",
    "checks": [
      { "name": "mongodb", "status": "error", "message": "Not connected." }
    ],
    "timestamp": "2026-10-21T11:04:22.913Z"
  },
  "meta": { "requestId": "…", "timestamp": "2026-10-21T11:04:22.913Z" }
}
```

Note that a *failed* readiness check still returns the `ok: true` transport envelope — the envelope reports whether the HTTP exchange succeeded, while `data.status` reports dependency health. This is deliberate: the readiness contract is itself part of the successful response.

Contract: `ReadinessResponse` / `HealthCheck` / `HealthStatus` in `packages/contracts/src/health/index.ts`, validated at test time by `readinessResponseSchema`.

### 2.3 `GET /health`

Convenience index of the service. Static object naming the service, version, the known service names and a machine-readable route list. Contains no secrets and no dynamic data.

```json
{
  "ok": true,
  "data": {
    "service": "api",
    "version": "0.1.0",
    "services": ["api", "storefront", "admin"],
    "endpoints": {
      "health": ["GET /health/live", "GET /health/ready"],
      "catalog": ["GET /v1/catalog/products", "GET /v1/catalog/products/:slug"]
    }
  },
  "meta": { "requestId": "…", "timestamp": "…" }
}
```

### 2.4 Storefront and admin health endpoints

Each Next.js app exposes its own health route returning the `LivenessResponse` shape.

| App | Path | Behaviour |
| --- | --- | --- |
| Storefront | `GET /api/health` | Static liveness of the Next.js process. |
| Admin | `GET /api/health` | Static liveness of the Next.js process. |

These are **pure liveness probes**. They do not currently check the API or MongoDB — they prove the Next.js process is up, not that the platform works end to end. Wiring them to the API is a deliberate follow-up (tracked as an unresolved decision below).

---

## 3. Catalogue endpoints

Catalogue reads are the only commercial endpoints that exist. The catalogue is **read-only in this phase**: writes happen through the admin API once the import pipeline exists. No product data is seeded from a fixture — every response is served from the real MongoDB catalogue, and an empty catalogue returns an empty result, not a placeholder.

### 3.1 `GET /v1/catalog/products`

Paginated, filterable product list. All query parameters are optional; an empty query returns the first page of the full catalogue.

#### Query parameters

| Parameter | Type | Default | Notes |
| --- | --- | --- | --- |
| `search` | string | — | Free-text over title / code / colour. |
| `subcategory` | slug | — | One of `mojri-jutti`, `shoe`, `sandal`, `chappal`. Canonicalised slug, not the raw workbook value. |
| `colour` | string | — | Matched against the workbook `Colour` value, case-insensitively. |
| `size` | integer | — | 5–13 inclusive. Matches products having a variant in that size. |
| `minPrice` | integer | — | Lower bound on selling price, inclusive. |
| `maxPrice` | integer | — | Upper bound on selling price, inclusive. |
| `inStock` | boolean | — | `true` / `false`, coerced from the query string. |
| `sort` | enum | `newest` | One of `newest`, `price-asc`, `price-desc`, `title-asc`, `title-desc`. |
| `page` | integer | 1 | 1-based. |
| `pageSize` | integer | 24 | Capped at `MAX_PAGE_SIZE` = 100. |

All coercion and bounding is enforced by `catalogQuerySchema` in `packages/contracts/src/catalog/schemas.ts`, applied by the `validateQuery` middleware. A malformed value is a `422 VALIDATION_FAILED`, never a silent coercion to something surprising.

#### Response `data`

Matches `CatalogListResult`:

```json
{
  "items": [ /* Product[] — see §3.4 */ ],
  "totalItems": 674,
  "page": 1,
  "pageSize": 24,
  "totalPages": 29
}
```

`totalItems` counts **designs** (SKU-pattern level), not individual size variants. The catalogue holds 55 distinct designs generating 674 unique SKUs. If `totalItems` is 0, the list is genuinely empty — the UI renders an explicit empty state, never a mock grid.

#### Curated example

`GET /v1/catalog/products?subcategory=mojri-jutti&colour=Golden&size=9&sort=price-asc&page=1&pageSize=2`

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "…",
        "code": "A11",
        "slug": "…",
        "title": "…",
        "subcategory": "Mojri / Jutti",
        "subcategorySlug": "mojri-jutti",
        "brand": "Ajooba Footwear",
        "colours": ["Golden"],
        "images": [],
        "variants": [],
        "mrp": 0,
        "sellingPrice": 0,
        "inStock": false,
        "createdAt": "…",
        "updatedAt": "…"
      }
    ],
    "totalItems": 0,
    "page": 1,
    "pageSize": 2,
    "totalPages": 0
  },
  "meta": { "requestId": "…", "timestamp": "…", "pagination": { "…": "…" } }
}
```

The placeholder values above (`"…"`, `0`, `[]`) are **shape illustrations, not catalogue data**. They are used because the MongoDB catalogue is not yet imported. Real values are filled in by the import pipeline and every one of them derives from the source workbook. Do not copy these numbers into seed files, fixtures or UI mocks.

### 3.2 `GET /v1/catalog/products/:slug`

Single product with its variants and images.

| Situation | HTTP | `error.code` |
| --- | --- | --- |
| Product exists | 200 | — |
| No product with that slug | 404 | `NOT_FOUND` |
| Slug fails validation (empty, over-long, illegal characters) | 422 | `VALIDATION_FAILED` |

Slug shape is enforced by `productSlugParamSchema`.

### 3.3 `Product` shape

Defined as `Product` in `packages/contracts/src/catalog/types.ts`. Field provenance:

| Field | Source in the real data |
| --- | --- |
| `code` | The `A<NN>` design code parsed from `Seller SKU Id`. |
| `subcategory` / `subcategorySlug` | The `Sub-category` column. Raw value preserved verbatim; slug added for routing. |
| `brand` | `Brand` = `"Ajooba Footwear"` on every Flipkart listing template row. |
| `colours` | Distinct values from the `Colour` column. |
| `variants[].sku` | `Seller SKU Id`, verbatim. Never reformatted. |
| `variants[].size` / `ukIndiaSize` / `euroSize` | `Size` and the Flipkart template `UK/India Size` / `Euro Size` columns. |
| `variants[].colour` / `colourToken` | The `Colour` column and the colour token embedded in the SKU. |
| `variants[].mrp` | `MRP`. |
| `variants[].sellingPrice` | `Your Selling Price`. |
| `variants[].discountPercent` | Derived: `round((MRP − SellingPrice) / MRP × 100)`. |
| `variants[].ean` | Flipkart template `EAN/UPC` — **empty in the source data**, hence optional. |
| `images[].url` | Path under `/products/AJ-A<NN>/`, relative to `public/`. Original filenames preserved; nothing renamed or regenerated. |
| `mrp` / `sellingPrice` | Min/max across the design's variants. The choice of which is the "headline" price is unresolved — see D-3. |

### 3.4 Not yet implemented

These are **not** endpoints. They are listed so the contract's shape is agreed before the work starts, and so nobody mistakes a 404 for a bug.

| Area | Planned surface | Status |
| --- | --- | --- |
| Auth | `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/auth/me` | Not started |
| Cart | `GET/POST/PATCH /v1/cart` | Not started |
| Checkout | `POST /v1/checkout/orders` | Not started |
| Orders | `GET /v1/orders`, `GET /v1/orders/:orderNumber` | Not started |
| Returns | `POST /v1/returns`, `GET /v1/returns` | Not started |
| Coupons | `POST /v1/coupons/validate` | Not started |
| Admin writes | `/v1/admin/products`, `/variants`, `/orders`, `/inventory`, `/coupons`, `/banners` | Not started |
| Payments | Razorpay order creation + webhook | **Explicitly out of scope for this step** |
| Facets | `GET /v1/catalog/facets` | Aggregation logic written in `catalog.service.ts`, route not mounted |

---

## 4. Contract governance

### 4.1 Where the contract lives

`packages/contracts` is the single source of truth. It is consumed as a workspace dependency (`"@ajooba/contracts": "workspace:*"`) by all three apps.

```
packages/contracts/src/
├── common/       envelopes, pagination, error codes, primitives
├── catalog/      Product, ProductVariant, ProductImage, catalog query
├── env/          API / storefront / admin environment schemas
├── health/       liveness + readiness contracts
└── index.ts      barrel
```

Changing a type or a Zod schema in `packages/contracts` changes the API's runtime validation **and** both Next.js apps' compile-time types in the same commit. There is no second definition to drift.

### 4.1.1 Version policy

`packages/contracts` is versioned `0.1.0`. It is consumed internally only (no external publish in this phase), so breaking changes are cheap: bump the minor, update all three apps in the same commit.

### 4.2 Verification

```bash
pnpm --filter @ajooba/contracts test    # schema + envelope tests
pnpm --filter @ajooba/api test          # supertest integration tests, incl. /health/*
pnpm -r typecheck                       # every app type-checks against the contracts
```

Contract schemas are themselves validated in `packages/contracts/tests/contracts.test.ts`, which parses real payload shapes — including a deliberately invalid one — through the Zod schemas.

### 4.3 Compatibility rules

1. **Additive changes are non-breaking.** New optional response fields are safe.
2. **Removing or renaming a response field is breaking.** Requires a `/v2` or a coordinated deploy.
3. **Tightening a Zod schema is breaking** for any caller already sending the looser value.
4. **Error codes are a closed set.** New codes require a contract change and a client update.

---

## 5. Endpoint index

| Endpoint | Method | Auth | Rate limit | Success | Failure modes |
| --- | --- | --- | --- | --- | --- |
| `/health/live` | GET | none | none | 200 | — |
| `/health/ready` | GET | none | none | 200 | 503 when MongoDB is down |
| `/health` | GET | none | none | 200 | — |
| `/v1/catalog/products` | GET | none | 300/min | 200 | 422, 429, 500, 503 |
| `/v1/catalog/products/:slug` | GET | none | 300/min | 200 | 404, 422, 429, 500, 503 |

Plus, outside the API: `GET /api/health` on the storefront and on the admin panel.

---

## 6. Open questions for this contract

| # | Question | Why it is unresolved |
| --- | --- | --- |
| Q-1 | Is `size` a filter on the design or on the variant? | Currently filters designs that *have* a variant in that size. If out-of-stock sizes must be excluded, the query needs a stock join. |
| Q-2 | Should `GET /v1/catalog/facets` be separate or embedded in the list response? | Facet aggregation is written but unmounted. Embedded costs bandwidth on every page; separate costs a round trip. |
| Q-3 | What is the canonical currency/locale contract? | The workbook has bare integers with no currency column. The platform is INR-only for now, but nothing in the response says so. |
| Q-4 | Should `EAN/UPC` be `null` or omitted when empty? | It is empty for every row in the source. `null` is more honest than `""`; omission is smaller. Currently optional-and-absent. |
| Q-5 | Is the 288-row ₹1 MRP/selling-price discrepancy systematic or clerical? | Needs a business answer before any price is written to MongoDB. See D-2 in the audit. |
| Q-6 | Is the 55-vs-674 product granularity right for the storefront URL structure? | A design with 14 size variants is one product page with 14 options, not 14 products. Confirm before building category pages. |