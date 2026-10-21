# Ajooba Footwear — Architecture

**Status:** initial platform architecture (post-audit, pre-implementation)
**Last updated:** 21 October 2026

---

## 1. Purpose and principles

Ajooba Footwear is a mobile-first e-commerce platform for an Indian footwear
brand selling ethnic and casual footwear — mojris, juttis, sandals and
chappals.

### 1.1 Guiding principles

1. **The catalogue is the product.** The business sells 55 real designs and
   674 real variants. The platform's job is to present them accurately, not to
   decorate them. No component may invent a product, a price, an order or a
   metric.
2. **Validate at every boundary.** Every HTTP request, every environment
   variable and every message payload is parsed by a Zod schema before it is
   trusted.
3. **Server-side secrets stay server-side.** Credentials live in the API
   process. The browser bundle contains only `NEXT_PUBLIC_*` values, and those
   are public by definition.
4. **Fail fast at boot.** Invalid configuration crashes the process at start-up,
   not on the first request that needs the value.
5. **Auditability over convenience.** Where the source data conflicts, the
   resolution is recorded, logged and reviewable — never silently applied.
6. **Contracts are shared, not duplicated.** One package defines the types and
   schemas that every app and service uses.

---

## 2. System overview

```
                         ┌───────────────────────────┐
   Browser (mobile-first)│  Customer Storefront       │
   ──────────────────────▶  apps/storefront            │
                         │  Next.js 16 · App Router   │
                         │  React 19 · Tailwind v4    │
                         └────────────┬───────────────┘
                                      │ HTTP/JSON (server-side fetch)
                                      │
   Browser (owner)       ┌────────────▼───────────────┐
   ──────────────────────▶  Admin Panel                │
                         │  apps/admin                 │
                         │  Next.js 16 · App Router    │
                         └────────────┬───────────────┘
                                      │ HTTP/JSON
                                      │
                         ┌────────────▼───────────────┐
                         │  REST API                  │
                         │  apps/api                  │
                         │  Express 5 · TypeScript    │
                         │  Zod · Mongoose · Pino     │
                         └────────────┬───────────────┘
                                      │ Mongoose
                         ┌────────────▼───────────────┐
                         │  MongoDB Atlas             │
                         │  (one cluster/database     │
                         │   per environment)         │
                         └────────────────────────────┘

              ┌──────────────────────────────────────────┐
              │  packages/contracts                      │
              │  Types · Zod schemas · API contracts     │
              │  Consumed by all three applications      │
              └──────────────────────────────────────────┘
```

Both Next.js applications are **server-side consumers** of the REST API. The
browser bundle of the storefront only talks to the API for genuinely
client-side needs (cart state, search-as-you-type); everything that can be
rendered on the server is rendered on the server.

### 2.1 Why a separate REST API?

The quotation specifies "Node.js / REST API architecture" with a "structured
backend API layer for storefront and management panel". Beyond contractual
compliance, the separation buys:

- **One place for business rules** — pricing, stock, order state machine.
- **Independent scaling** — the API scales differently from the UI.
- **A future mobile app** can consume the same API without a rewrite.
- **Admin and storefront share one authorisation surface**, not two.

---

## 3. Repository layout

```
C:\ajooba footwear\
├── apps/
│   ├── api/                     Express 5 REST API
│   │   ├── src/
│   │   │   ├── config/          env.ts (validated), logger.ts
│   │   │   ├── core/            errors.ts, http.ts
│   │   │   ├── db/              connection.ts
│   │   │   ├── middleware/      error-handler.ts, validate.ts
│   │   │   ├── models/          product, variant, user
│   │   │   ├── routes/          health.routes.ts, catalog.routes.ts, v1.routes.ts
│   │   │   ├── services/        catalog.service.ts
│   │   │   ├── app.ts           Express assembly (testable, no socket)
│   │   │   └── server.ts        Bootstrap + graceful shutdown
│   │   ├── tests/
│   │   └── .env.example
│   │
│   ├── storefront/              Customer-facing Next.js app
│   │   ├── src/
│   │   │   ├── app/             App Router: /, /products, /products/[slug], /api/health
│   │   │   ├── features/
│   │   │   │   └── catalog/     Product grid + skeleton + container
│   │   │   ├── lib/             env.ts (validated), api.ts (server client)
│   │   │   └── components/      Shared UI (shadcn/ui to be added)
│   │   └── .env.example
│   │
│   └── admin/                   Admin panel Next.js app
│       ├── src/
│       │   ├── app/
│       │   ├── features/        (per-module: products, orders, customers…)
│       │   └── lib/
│       └── .env.example
│
├── packages/
│   └── contracts/               @ajooba/contracts — shared types + schemas
│       └── src/
│           ├── common/          envelopes, errors, pagination, primitives
│           ├── catalog/         product, variant, image, facets
│           ├── env/             env schemas for api / storefront / admin
│           └── health/          liveness + readiness contracts
│
├── docs/
│   ├── catalog-audit.md         ← the real catalogue findings
│   ├── ARCHITECTURE.md          ← this file
│   ├── DATA_MODEL.md
│   ├── API_CONTRACT.md
│   └── DEPLOYMENT_RUNBOOK.md
│
├── scripts/                     Catalogue audit tooling
│   └── catalog_audit.py         Re-derives every finding in catalog-audit.md
├── public/                      SOURCE ASSETS — never modified
│   ├── products/                54 folders, 692 images, 1 workbook, 77 .xls
│   ├── banner/                  3 hero banners
│   └── images/logo/             brand logo
│
├── .env.example                 root reference
├── .gitattributes               Git LFS for source assets
├── package.json                 pnpm workspace root
└── pnpm-workspace.yaml
```

### 3.1 Feature-oriented layering

Within each application, code is organised by **feature**, not by file type:

```
src/
├── app/            Next.js routing only — thin, no business logic
├── features/       One folder per business capability
│   └── catalog/
│       ├── components/   presentational
│       └── server/       data access (storefront) / mutations (admin)
├── lib/            Cross-cutting: env, api client, http, logger
└── components/     Design-system primitives (shadcn/ui)
```

A route handler in `app/` composes a feature; it does not contain the logic.

---

## 4. Technology decisions

| Concern | Choice | Version | Rationale |
| --- | --- | --- | --- |
| Monorepo | **pnpm workspaces** | 10.26.2 | Native workspace protocol, strict node_modules isolation, fast install, no hoisting surprises |
| Storefront & admin | **Next.js** App Router | 16.4.2 | Required by the brief. App Router gives RSC, streaming and route handlers. |
| UI runtime | **React** | 19.3.1 | Required peer of Next 16. |
| Language | **TypeScript** | 5.9.3 | `typescript-eslint@8.72` supports `>=4.8.4 <6.1.0`; TS 7.x is **not** yet supported by the lint toolchain. 5.9.3 is the newest version inside the supported window. |
| API runtime | **Node.js** + **Express** | 22.12 / 5.3.0 | Required by the brief. Express 5 has native async error propagation — no wrapper needed. |
| Database | **MongoDB Atlas** + **Mongoose** | 9.11.2 | Required by the brief. |
| Validation | **Zod** | 4.6.7 | One schema library shared by all three apps. Works at every boundary. |
| Styling | **Tailwind CSS** v4 | 4.3.3 | CSS-first config, no `tailwind.config.js` needed. |
| Components | **shadcn/ui** | — | Source-copied, owned by us. No runtime dependency lock-in. |
| Lint | **ESLint** 9 flat config | 9.39.5 | `eslint-config-next@16.4.2` requires `eslint >=9`. `eslint-plugin-jsx-a11y@6.10` and `eslint-plugin-import@2.32` do **not** yet declare eslint 10 support, so 9.x is the safe choice. |
| Formatting | **Prettier** | 3.9.10 | Runs after ESLint so the two never disagree. |
| Tests | **Vitest** | 5.0.5 | Same runner across Node and Next projects; V8 coverage without extra babel config. |

### 4.1 Version compatibility — how these were chosen

Every pin was resolved against the live registry, not from memory:

```
typescript-eslint@8.72.0  peer: typescript >=4.8.4 <6.1.0
  → TypeScript 7.0.2 (latest) is OUTSIDE this range → pin 5.9.3

eslint-config-next@16.4.2 peer: eslint >=9.0.0
eslint-plugin-jsx-a11y@6.10.0 peer: eslint ^3||^4||^5||^6||^7||^8||^9
eslint-plugin-import@2.32.0   peer: eslint ^2||…||^9
  → eslint 10 breaks jsx-a11y/import peer ranges → pin 9.39.5

@tailwindcss/postcss@4.3.3  → matches tailwindcss 4.3.3
vitest@5.0.5                 peer: vite ^6.4 || ^7 || ^8
@t3-oss/env-nextjs@0.13.11   peer: zod ^3.24 || ^4  → zod 4.6.7 ✓
```

### 4.2 How `@ajooba/contracts` is consumed

`packages/contracts` ships **compiled ESM under `dist/`**, with `main`,
`types` and an `exports` map pointing at the build output:

```jsonc
{
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":           { "types": "./dist/index.d.ts",           "default": "./dist/index.js" },
    "./catalog":   { "types": "./dist/catalog/index.d.ts",   "default": "./dist/catalog/index.js" },
    "./common":    { "types": "./dist/common/index.d.ts",    "default": "./dist/common/index.js" },
    "./health":    { "types": "./dist/health/index.d.ts",    "default": "./dist/health/index.js" },
    "./env":       { "types": "./dist/env/index.d.ts",       "default": "./dist/env/index.js" }
  }
}
```

**Why not ship raw TypeScript source?** An earlier draft of this repository
did exactly that (`"main": "./src/index.ts"`). It was changed after the build
failed for a concrete, reproducible reason:

```
Error: Export 'storefrontEnvSchema' doesn't exist in target module
  [project]/packages/contracts/src/index.ts [app-rsc] (ecmascript).
The module has no exports at all.
```

The contracts sources use **NodeNext-style `.js` extension imports**
(`export * from './common/index.js'`) because the API is ESM and Node requires
the explicit extension. TypeScript resolves those to the `.ts` files when
`moduleResolution` is `NodeNext`, but a bundler reading the raw `.ts` source
does not — it looks for a literal `common/index.js` on disk, finds nothing,
and concludes the module has no exports.

Shipping a real build sidesteps this entirely, and it also means the
**compiled API in `dist/` actually runs**. Without it, `node dist/server.js`
would fail at startup for exactly the same reason.

**Build ordering is therefore explicit.** Every app's `build` script runs
`pnpm --filter @ajooba/contracts build` first, and the root `typecheck` and
`test` scripts do the same. `pnpm build` at the root handles it in order.

**Cost:** one extra build step and a possible stale-`dist` class of bug. That
is mitigated by `prepare` (pnpm runs it on install) and by the root scripts
building contracts before anything consumes it.

---

## 5. Environment strategy

### 5.1 The rule

> **There is no `mode: 'dev' | 'pro'` switch.**
> Each environment supplies its own variables through its platform
> (Vercel, Render, Railway, Atlas, Kubernetes…). The application reads exactly
> what the platform provides and validates it at boot.

This means:

- `NODE_ENV` is set by the platform, not by us.
- `API_PUBLIC_URL`, `STOREFRONT_PUBLIC_URL`, `ADMIN_PUBLIC_URL` are per-target.
- `MONGODB_URI` points at a different cluster or database per target.
- `SESSION_SECRET` is a different random value per target.
- CORS origins differ per target.

### 5.2 Development / Staging / Production matrix

| Variable | Development | Staging | Production |
| --- | --- | --- | --- |
| `MONGODB_URI` | `.../ajooba_development` | `.../ajooba_staging` | `.../ajooba_production` |
| `MONGODB_DB` | `ajooba_development` | `ajooba_staging` | `ajooba_production` |
| `API_PUBLIC_URL` | `http://localhost:4000` | `https://api-staging.…` | `https://api.…` |
| `STOREFRONT_PUBLIC_URL` | `http://localhost:3000` | `https://staging.…` | `https://…` |
| `ADMIN_PUBLIC_URL` | `http://localhost:3001` | `https://admin-staging.…` | `https://admin.…` |
| `CORS_ORIGINS` | localhost origins | staging origins | production origins |
| `SESSION_SECRET` | local random | CI-injected random | CI-injected random |
| `RAZORPAY_*` | empty | test keys | live keys |
| `LOG_LEVEL` | `debug` | `info` | `info` |

### 5.3 Validation layer

`packages/contracts/src/env/index.ts` owns three Zod schemas:

| Schema | Consumer | Required |
| --- | --- | --- |
| `apiEnvSchema` | `apps/api` | `MONGODB_URI`, `API_PUBLIC_URL`, `CORS_ORIGINS`, `STOREFRONT_PUBLIC_URL`, `ADMIN_PUBLIC_URL`, `SESSION_SECRET` (≥32 chars) |
| `storefrontEnvSchema` | `apps/storefront` | `API_INTERNAL_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` |
| `adminEnvSchema` | `apps/admin` | `API_INTERNAL_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` |

Each application has exactly **one** module that reads `process.env`
(`src/config/env.ts` in the API, `src/lib/env.ts` in the Next apps). No other
file in the codebase may touch `process.env` directly. The module exports a
frozen object; validation failure throws with a message listing every
offending variable.

`SESSION_SECRET` has **no default value** — a missing secret is a boot
failure, not a silent fallback to a well-known string.

### 5.4 Secret handling

| Rule | Enforcement |
| --- | --- |
| `.env` is never committed | `.gitignore` blocks `.env` and `.env.*` but allows `.env.example` |
| Secrets are not in `NEXT_PUBLIC_*` | Only `NEXT_PUBLIC_*` is inlined into the browser bundle by Next.js |
| The API never sends secrets to a client | `sendSuccess` / `sendFailure` serialise explicitly-typed payloads; no generic object is spread into a response |
| Logs redact sensitive headers | `pino` `redact` covers `authorization`, `cookie`, `x-api-key`, `set-cookie` and `*.password` |
| Error messages are safe by construction | `AppError.toApiError()` replaces the message with a generic string for any 5xx |
| `describeEnv()` reports names, not values | Startup log shows which integrations are configured, never their contents |

---

## 6. API design

### 6.1 Envelope

Every response — success or failure — uses the same envelope:

```jsonc
// success
{ "ok": true, "data": { /* payload */ }, "meta": { "requestId": "…", "timestamp": "…" } }

// failure
{ "ok": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "requestId": "…" },
  "meta": { "requestId": "…", "timestamp": "…" } }
```

The envelope is defined once in `packages/contracts/src/common/` and enforced
by `apiSuccessSchema` / `apiErrorSchema`.

### 6.2 Error handling

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 422 | Zod parse failure; `details[]` lists field-level problems |
| `NOT_FOUND` | 404 | No such resource or route |
| `CONFLICT` | 409 | State conflict |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected — message is generic, detail is logged |
| `SERVICE_UNAVAILABLE` | 503 | A dependency is down |

### 6.3 Middleware order

```
helmet → cors → compression → body parsers → requestId → pino-http
       → rate limit (/v1) → routes → notFound → errorHandler
```

The request id is attached **before** `pino-http` so every log line carries
it, and it is echoed in the `x-request-id` response header and in the
envelope `meta`.

### 6.4 Versioning

All business routes live under `/v1`. Health checks live at `/health` because
they are operational, not versioned business surface.

---

## 7. Data & persistence

- **MongoDB Atlas.** One cluster (or one database per environment) with
  `MONGODB_URI` + `MONGODB_DB`.
- **Mongoose 9** with explicit schemas, `timestamps: true`, and indexes on
  every field used in a filter or sort.
- **No auto-index in production** (`autoIndex: env.NODE_ENV !== 'production'`)
  so a production deploy cannot trigger an index build.
- **Connection before listening.** The server connects to MongoDB *before* it
  accepts traffic, so a misconfigured database fails at boot.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` stop accepting connections,
  close the Mongo connection, and exit; a 10 s timer forces exit if a
  connection hangs.

Full detail: [`docs/DATA_MODEL.md`](./DATA_MODEL.md).

---

## 8. Catalogue ingestion

This is deliberately **not** implemented in this step — but its shape is
decided, because it drives the data model.

```
public/products/products data.xlsx  ──┐
public/products/AJ-*/*.xls           ──┼──▶ [ Import worker ] ──▶ MongoDB
public/products/AJ-*/images ───────── ──┘            │
                                                       ▼
                                          import-report.json
                                          (conflicts, gaps, counts)
```

Requirements the import must satisfy, derived from
[`docs/catalog-audit.md`](./catalog-audit.md):

1. **Join on `Seller SKU Id`.** Never on the product title or on folder names.
2. **Design code** is the `A<NN>` segment of the SKU.
3. **Store both the colour token and the colour.** `OW`, `IVY` and `IVR` all
   mean Ivory — they are not interchangeable.
4. **Resolve images by folder → design, then by colour token**, with an
   explicit fallback for un-tokenised filenames (12 designs, 69 files).
5. **Emit a diff report** for every conflict resolved, especially the 288
   price, 6 size and 65 colour disagreements.
6. **Fail loudly on anything not in the audit.** An unknown SKU shape, an
   unmatched folder or a design with no images is a report entry, never a
   silent skip.
7. **Never write to `public/`.** The importer reads the source assets; it
   writes only to the database.

---

## 9. Security

| Concern | Measure |
| --- | --- |
| Injection | Mongoose queries are typed and parameterised; `$regex` inputs are escaped |
| CORS | Explicit allow-list per environment; credentials enabled; origin rejected if not listed |
| Clickjacking | `X-Frame-Options: DENY` on both Next apps |
| MIME sniffing | `X-Content-Type-Options: nosniff` (helmet + Next headers) |
| Referrer leakage | `Referrer-Policy: strict-origin-when-cross-origin` |
| Brute force | `express-rate-limit` (300 req/min on `/v1`); tighter per-route limits added with auth |
| Password storage | bcrypt hash only (schema field `passwordHash`); plaintext never persisted |
| Session integrity | `SESSION_SECRET` ≥ 32 chars, per environment, injected by CI |
| Payment data | No card data touches the platform; Razorpay handles it. Webhook signatures are verified. **Not implemented yet — out of scope for this step.** |
| Error leakage | 5xx messages are generic; stack traces stay in the logs |
| Secrets in the bundle | Only `NEXT_PUBLIC_*` is inlined; every secret variable is read in server-only modules |
| Admin indexing | `X-Robots-Tag: noindex, nofollow` on the admin app |

---

## 10. Testing strategy

| Layer | Tool | What it covers |
| --- | --- | --- |
| Contracts | Vitest | SKU format, query coercion, schema rejection of invalid payloads |
| API | Vitest + supertest | Health endpoints, error envelope, 404 handling, request-id propagation |
| Storefront / admin | Vitest | Component and unit tests as features land |
| End-to-end | Playwright (planned) | Catalogue browse → product → add-to-cart journey |

The API's Express app is built by `createApp()` separately from the server
bootstrap, so tests can mount it with supertest **without opening a socket or
requiring a database**.

CI runs `pnpm check` = `format:check && lint && typecheck && test`.

---

## 11. Mobile-first approach

The storefront is designed mobile-first, not "responsive after the fact":

- Base styles target a 360–430 px viewport; breakpoints *add* space.
- Tap targets are ≥ 44 px.
- `100dvh` (not `100vh`) for full-height layouts, avoiding the iOS URL-bar
  jump.
- Product grid: 2 columns on mobile → 3 at `sm` → 4 at `lg`.
- The catalogue API is paginated with a default `pageSize` of 24 to keep
  payloads small on cellular connections.
- Images use `next/image` with AVIF/WebP output and explicit `sizes`.

---

## 12. Project rule — no fabricated data

> **No dummy shoe catalogue, fake revenue, fake orders or fake customer
> analytics in production-facing screens.**

This is a hard rule, implemented rather than merely stated:

- The API serves the catalogue **only** from MongoDB. There is no in-memory
  seed, no fallback fixture and no `Math.random()`.
- The storefront renders an explicit **"No products found"** state when the
  catalogue is empty.
- The admin dashboard renders an explicit **"No store data yet"** panel
  explaining that metrics are computed from live records only.
- No component contains a hardcoded product, price, order count or currency
  amount.
- Any future seed or fixture script must be namespaced under
  `scripts/` , must require an explicit `--allow-seed` flag, and must refuse
  to run against a production database URI.

---

## 13. Deliberate non-goals in this step

Per the brief, the following are **not** implemented yet:

- Catalogue import execution (the pipeline shape is specified in §8).
- Authentication and session handling (schemas and models are in place).
- Cart, checkout, orders, returns, coupons, payments.
- The full admin module set.
- Razorpay integration.
- Product upload to any live marketplace service.

---

## 14. References

| Document | Contents |
| --- | --- |
| [`catalog-audit.md`](./catalog-audit.md) | The real catalogue and asset findings, with unresolved decisions D-1 … D-8 |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | MongoDB collections, fields and indexes |
| [`API_CONTRACT.md`](./API_CONTRACT.md) | Endpoint-by-endpoint contract |
| [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md) | Environment setup and deployment procedure |
