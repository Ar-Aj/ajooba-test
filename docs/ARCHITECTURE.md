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
│   ├── CATALOG_CONFLICTS.md     ← the 502 conflicts, per SKU, and what is blocked
│   ├── ARCHITECTURE.md          ← this file
│   ├── DATA_MODEL.md
│   ├── API_CONTRACT.md
│   └── DEPLOYMENT_RUNBOOK.md
│
├── scripts/                     Catalogue audit tooling
│   ├── catalog_audit.py         Re-derives every finding in catalog-audit.md
│   ├── catalog_extract.py       Source assets → extract payload (read-only)
│   └── conflict_classify.py     Sizes what is importable vs blocked
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

| Concern            | Choice                           | Version       | Rationale                                                                                                                                                                             |
| ------------------ | -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo           | **pnpm workspaces**              | 10.26.2       | Native workspace protocol, strict node_modules isolation, fast install, no hoisting surprises                                                                                         |
| Storefront & admin | **Next.js** App Router           | 16.4.2        | Required by the brief. App Router gives RSC, streaming and route handlers.                                                                                                            |
| UI runtime         | **React**                        | 19.3.1        | Required peer of Next 16.                                                                                                                                                             |
| Language           | **TypeScript**                   | 5.9.3         | `typescript-eslint@8.72` supports `>=4.8.4 <6.1.0`; TS 7.x is **not** yet supported by the lint toolchain. 5.9.3 is the newest version inside the supported window.                   |
| API runtime        | **Node.js** + **Express**        | 22.12 / 5.3.0 | Required by the brief. Express 5 has native async error propagation — no wrapper needed.                                                                                              |
| Database           | **MongoDB Atlas** + **Mongoose** | 9.11.2        | Required by the brief.                                                                                                                                                                |
| Validation         | **Zod**                          | 4.6.7         | One schema library shared by all three apps. Works at every boundary.                                                                                                                 |
| Styling            | **Tailwind CSS** v4              | 4.3.3         | CSS-first config, no `tailwind.config.js` needed.                                                                                                                                     |
| Components         | **shadcn/ui**                    | —             | Source-copied, owned by us. No runtime dependency lock-in.                                                                                                                            |
| Lint               | **ESLint** 9 flat config         | 9.39.5        | `eslint-config-next@16.4.2` requires `eslint >=9`. `eslint-plugin-jsx-a11y@6.10` and `eslint-plugin-import@2.32` do **not** yet declare eslint 10 support, so 9.x is the safe choice. |
| Formatting         | **Prettier**                     | 3.9.10        | Runs after ESLint so the two never disagree.                                                                                                                                          |
| Tests              | **Vitest**                       | 5.0.5         | Same runner across Node and Next projects; V8 coverage without extra babel config.                                                                                                    |

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
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./catalog": { "types": "./dist/catalog/index.d.ts", "default": "./dist/catalog/index.js" },
    "./common": { "types": "./dist/common/index.d.ts", "default": "./dist/common/index.js" },
    "./health": { "types": "./dist/health/index.d.ts", "default": "./dist/health/index.js" },
    "./env": { "types": "./dist/env/index.d.ts", "default": "./dist/env/index.js" },
  },
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

| Variable                | Development              | Staging                   | Production              |
| ----------------------- | ------------------------ | ------------------------- | ----------------------- |
| `MONGODB_URI`           | `.../ajooba_development` | `.../ajooba_staging`      | `.../ajooba_production` |
| `MONGODB_DB`            | `ajooba_development`     | `ajooba_staging`          | `ajooba_production`     |
| `API_PUBLIC_URL`        | `http://localhost:4000`  | `https://api-staging.…`   | `https://api.…`         |
| `STOREFRONT_PUBLIC_URL` | `http://localhost:3000`  | `https://staging.…`       | `https://…`             |
| `ADMIN_PUBLIC_URL`      | `http://localhost:3001`  | `https://admin-staging.…` | `https://admin.…`       |
| `CORS_ORIGINS`          | localhost origins        | staging origins           | production origins      |
| `SESSION_SECRET`        | local random             | CI-injected random        | CI-injected random      |
| `RAZORPAY_*`            | empty                    | test keys                 | live keys               |
| `LOG_LEVEL`             | `debug`                  | `info`                    | `info`                  |

### 5.3 Validation layer

`packages/contracts/src/env/index.ts` owns three Zod schemas:

| Schema                | Consumer          | Required                                                                                                                     |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apiEnvSchema`        | `apps/api`        | `MONGODB_URI`, `API_PUBLIC_URL`, `CORS_ORIGINS`, `STOREFRONT_PUBLIC_URL`, `ADMIN_PUBLIC_URL`, `SESSION_SECRET` (≥32 chars)   |
| `storefrontEnvSchema` | `apps/storefront` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`; `API_INTERNAL_URL` locally or the Vercel `API_SERVICE_URL` binding at runtime |
| `adminEnvSchema`      | `apps/admin`      | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`; `API_INTERNAL_URL` locally or the Vercel `API_SERVICE_URL` binding at runtime |

Each application has exactly **one** module that reads `process.env`
(`src/config/env.ts` in the API, `src/lib/env.ts` in the Next apps). No other
file in the codebase may touch `process.env` directly. The module exports a
frozen object; validation failure throws with a message listing every
offending variable.

`SESSION_SECRET` has **no default value** — a missing secret is a boot
failure, not a silent fallback to a well-known string.

### 5.4 Secret handling

| Rule                                      | Enforcement                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `.env` is never committed                 | `.gitignore` blocks `.env` and `.env.*` but allows `.env.example`                                              |
| Secrets are not in `NEXT_PUBLIC_*`        | Only `NEXT_PUBLIC_*` is inlined into the browser bundle by Next.js                                             |
| The API never sends secrets to a client   | `sendSuccess` / `sendFailure` serialise explicitly-typed payloads; no generic object is spread into a response |
| Logs redact sensitive headers             | `pino` `redact` covers `authorization`, `cookie`, `x-api-key`, `set-cookie` and `*.password`                   |
| Error messages are safe by construction   | `AppError.toApiError()` replaces the message with a generic string for any 5xx                                 |
| `describeEnv()` reports names, not values | Startup log shows which integrations are configured, never their contents                                      |

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

| Code                  | HTTP | Meaning                                                   |
| --------------------- | ---- | --------------------------------------------------------- |
| `VALIDATION_FAILED`   | 422  | Zod parse failure; `details[]` lists field-level problems |
| `NOT_FOUND`           | 404  | No such resource or route                                 |
| `CONFLICT`            | 409  | State conflict                                            |
| `UNAUTHORIZED`        | 401  | Not authenticated                                         |
| `FORBIDDEN`           | 403  | Authenticated but not permitted                           |
| `RATE_LIMITED`        | 429  | Rate limit exceeded                                       |
| `INTERNAL_ERROR`      | 500  | Unexpected — message is generic, detail is logged         |
| `SERVICE_UNAVAILABLE` | 503  | A dependency is down                                      |

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
- **Connection before listening.** The server connects to MongoDB _before_ it
  accepts traffic, so a misconfigured database fails at boot.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` stop accepting connections,
  close the Mongo connection, and exit; a 10 s timer forces exit if a
  connection hangs.

### 7.1 Development database — confirmed configuration

Verified on **2026-10-22** against the running local deployment.

| Property       | Value                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Deployment     | **Local standalone `mongod` 8.0.4** (Windows service `MongoDB`)                |
| Host / port    | `127.0.0.1:27017` (`bindIp` is loopback-only — not reachable from the network) |
| Database       | `ajooba_development`                                                           |
| Server version | 8.0.4                                                                          |

The Atlas entries in MongoDB Compass (`cluster0.k1tud.mongodb.net`) are **not
reachable**: the hostname does not resolve (`NXDOMAIN`) and TCP 27017 is
closed. They are stale saved connections, not a working cluster. Do not point
any configuration at them until a live Atlas project is created and its
hostname resolves.

> The architecture diagrams above show Atlas for production. That remains the
> intent for staging/production. **Development is a local `mongod`.**

### 7.2 Connecting with the MongoDB MCP server (developer tooling only)

Cursor is wired to MongoDB through the official `mongodb-mcp-server` (v1.12.0 —
the newest release whose `engines` range accepts Node `v22.12.0`).

| File                                    | Committed           | Contents                                                          |
| --------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `.cursor/mcp.json`                      | **yes**             | Server command, `envFile` path, non-secret flags. No credentials. |
| `.env.mcp`                              | **no** (gitignored) | `MDB_MCP_CONNECTION_STRING` — holds the password.                 |
| `.env.mcp.example`                      | **yes**             | Placeholder template, safe to share.                              |
| `scripts/mcp/setup-local-mcp-user.cjs`  | **yes**             | Creates the least-privilege user and writes `.env.mcp`.           |
| `scripts/mcp/verify-mcp-connection.mjs` | **yes**             | End-to-end handshake + read-only assertion.                       |
| `scripts/mcp/inspect-dev-db.mjs`        | **yes**             | Read-only inspection of the dev database.                         |
| `scripts/mcp/check-authz-status.mjs`    | **yes**             | Reports whether this `mongod` enforces authorization.             |

The committed `mcp.json` is safe to share because it contains **no credential**:
the connection string is supplied through Cursor's `envFile` mechanism, which
reads `.env.mcp` at launch.

```jsonc
{
  "mcpServers": {
    "mongodb": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/node_modules/mongodb-mcp-server/dist/esm/index.js"],
      "envFile": "${workspaceFolder}/.env.mcp",
      "env": {
        "MDB_MCP_READ_ONLY": "true",
        "MDB_MCP_TELEMETRY": "disabled",
        "MDB_MCP_DISABLED_TOOLS": "drop-database,drop-collection,rename-collection,delete-one,delete-many,insert-one,insert-many,update-one,update-many,create-index,drop-index,drop-indexes",
      },
    },
  },
}
```

The server reads configuration from `MDB_MCP_*` environment variables, so no
CLI flag carries a secret and nothing appears in a process listing.

**Set up (once per machine, then on any credential rotation):**

```bash
pnpm mcp:setup     # creates ajooba_mcp with role read@ajooba_development,
                   # generates a password, writes .env.mcp (password never printed)
pnpm mcp:verify    # real stdio handshake + asserts write tools are absent
pnpm mcp:inspect   # read-only inspection of the dev database
```

### 7.3 Defence in depth — and the one layer that is currently missing

Read-only is enforced **twice**:

1. **MCP level** — `MDB_MCP_READ_ONLY=true` makes the server refuse every
   `create`/`update`/`delete` operation type, and the destructive tools are not
   even advertised in `tools/list`. Verified: 18 tools exposed, none of them
   write-capable.
2. **Cursor level** — MCP tool calls are still subject to Cursor's own approval
   and network controls. Those are **not** disabled to make this work.

There is a third layer that this machine currently lacks:

> ⚠️ **The local `mongod` runs with authorization disabled.** Its config has the
> `security:` block commented out, so `getCmdLineOpts` reports
> `authorization: false`. MongoDB still _verifies_ the password (a wrong
> password is rejected), but it does **not enforce roles** — every
> authenticated user is effectively granted full access to every database.
>
> The `read` role on `ajooba_mcp` is therefore **recorded but not applied**. A
> test confirmed the account can read databases it was never granted.
>
> **Until this is changed, read-only access rests on the MCP server and Cursor
> alone.** The safety net is real (the MCP layer is verified working and
> loopback binding limits reachability to this machine), but it is one process
> deep rather than enforced by the database.
>
> Enabling `authorization: enabled` in `mongod.cfg` and restarting the service
> makes the `read` role real. That is a machine-level change requiring
> Administrator rights and is deliberately **not** done automatically here —
> it would also require adding credentials for the API and importer. See
> `docs/DEPLOYMENT_RUNBOOK.md` §3.6 for the procedure.

Full detail: [`docs/DATA_MODEL.md`](./DATA_MODEL.md).

---

## 8. Catalogue ingestion

The pipeline **is implemented** and runs in two halves. The write half has
been exercised as a dry run only — no production data has been imported,
because 317 of 674 variants are blocked on business decisions.

```
public/products/products data.xlsx  ──┐
public/products/AJ-*/*.xls           ──┼──▶ [ catalog_extract.py ] ──▶ artifacts/
public/products/AJ-*/images ───────── ──┘        (READ ONLY)        catalog-extract.json
                                                                      │
                                                                      ▼
                                                        [ catalog-import.job.ts ]
                                                                      │
                                       ┌──────────────────────────────┴───┐
                                       ▼                                  ▼
                                 MongoDB                        import-report.json
                            (dry run: nothing)            (conflicts, gaps, counts)
```

### 8.1 The two halves

| Stage    | Command                                            | Writes                                         |
| -------- | -------------------------------------------------- | ---------------------------------------------- |
| Extract  | `pnpm catalog:extract`                             | `artifacts/catalog-extract.json` only          |
| Classify | `pnpm catalog:conflicts`                           | Nothing — prints what is importable vs blocked |
| Import   | `pnpm --filter @ajooba/api catalog:import`         | MongoDB + `import-report.json`                 |
| Dry run  | `pnpm --filter @ajooba/api catalog:import:dry-run` | **Nothing**                                    |

The extract step is deliberately separate from the write step. It is a pure
function of the source assets, so it can be re-run, diffed and reviewed without
a database anywhere in the picture — which is what makes the conflicts
reviewable by a merchant who has no access to the platform.

### 8.2 Current state

```
designsRead 55   variantsRead 674   imagesRead 685
conflicts 502    unresolved   0
designsWritten 0  variantsWritten 0  imagesUploaded 0
```

`unresolved: 0` means every one of the 674 rows validates against the
platform schema. The 502 conflicts are **source disagreements**, not malformed
data. See [`CATALOG_CONFLICTS.md`](./CATALOG_CONFLICTS.md).

### 8.3 Requirements the import satisfies

Derived from [`docs/catalog-audit.md`](./catalog-audit.md):

1. **Join on `Seller SKU Id`.** Never on the product title or on folder names.
2. **Design code** is the `A<NN>` segment of the SKU. Image folder names are
   **not** zero-padded (`AJ-A1` vs `A01`), so the join is on the numeric
   design number, case-insensitively.
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
8. **Refuse to import into a production-named database** unless the operator
   overrides `IMPORT_BLOCK_PRODUCTION` deliberately.
9. **Import with `stock = 0` and `inStock = false`** (decision C-3). The `.xls`
   `Stock` column is a marketplace artefact recording 1–2 units per SKU, not a
   warehouse ledger. Nothing is sellable until an authorised stock source
   writes a real number.

### 8.4 The controlled import surface (added 2026-10-23)

The pipeline above runs from a **developer's machine**, where the source
workbook physically exists. Railway, Vercel and any other deployment target
have no access to a `C:` drive, so the CLI path is unusable in production and
must never be reachable from a browser.

G-6 adds a **separate, controlled** import surface that closes that gap without
exposing script execution:

```
browser ──POST /v1/admin/catalog/imports──▶ [ plan import.service ]
           body: { payload, sourceFilename }      │
           (never a filesystem path)              ├─▶ import_plans record (the only write)
                                                    └─▶ findings report
                                                               │
   operator reads findings + summary ◀───────────────────────────┘
                                                               │
   operator pastes payloadChecksum ◀────────────────────────────┘
                                                               │
browser ──POST /imports/:planId/apply { payloadChecksum, confirm:true }──▶ write
```

Three properties make this safe to expose over HTTP:

| Property                      | Mechanism                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No path traversal**         | The body carries the extracted JSON. `apps/admin/src/app/api/admin/catalog/route.ts` sanitises the forwarded path, and no route accepts a path or executes a command. |
| **No unreviewed writes**      | Planning writes only the plan record. Products and variants are untouched until an apply that must echo the plan's own `payloadChecksum`.                             |
| **No accidental duplication** | The checksum is a SHA-256 of the payload. Re-planning an unchanged file yields the same checksum, so a retry is recognised rather than double-applied.                |

### 8.5 Why two import surfaces exist

They are not duplicates — they are different trust boundaries.

|               | CLI (`catalog-import.job.ts`)        | API (`import.service.ts` via G-6)              |
| ------------- | ------------------------------------ | ---------------------------------------------- |
| Runs on       | A workstation with the source files  | A server with no filesystem access             |
| Caller        | An engineer                          | An authenticated administrator                 |
| Authorisation | Process environment                  | `import:run` permission + checksum + `confirm` |
| Payload       | Reads paths from disk                | Receives the payload in the request body       |
| Writes        | Yes, with a `--dry-run` flag         | Only on an explicit apply                      |
| Retained      | For local analysis and re-extraction | For the audited, attributable production path  |

The CLI remains the tool for _producing_ the extract. The API is the only
supported way to _apply_ one in an environment that cannot see `C:`.

---

## 9. Security

| Concern                           | Measure                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection                         | Mongoose queries are typed and parameterised; `$regex` inputs are escaped                                                                                                                                           |
| CORS                              | Explicit allow-list per environment; credentials enabled; origin rejected if not listed                                                                                                                             |
| Clickjacking                      | `X-Frame-Options: DENY` on both Next apps                                                                                                                                                                           |
| MIME sniffing                     | `X-Content-Type-Options: nosniff` (helmet + Next headers)                                                                                                                                                           |
| Referrer leakage                  | `Referrer-Policy: strict-origin-when-cross-origin`                                                                                                                                                                  |
| Brute force                       | `express-rate-limit` (300 req/min on `/v1`), plus 8 tighter per-route budgets (register, login, refresh, password, checkout, coupon, analytics, admin write), each configured by env var                            |
| Password storage                  | bcrypt hash only (schema field `passwordHash`); plaintext never persisted                                                                                                                                           |
| Session integrity                 | `SESSION_SECRET` and `JWT_SECRET` ≥ 32 chars and distinct, per environment, injected by CI                                                                                                                          |
| Privilege escalation              | Customer and admin are separate token audiences; a customer token cannot reach an admin route and vice versa. Admin routes additionally check one of 19 declared permissions against the caller's role, server-side |
| Account takeover                  | Failed-login counting with temporary lockout; `change-password` revokes **every** refresh token, signing out all other devices                                                                                      |
| IDOR                              | Customer-facing order and return lookups are scoped to the owner — another customer's order is a `404`, not a `403`, so a valid id is never confirmed                                                               |
| Overselling                       | Stock is decremented with a conditional update inside the checkout transaction, so concurrent checkouts cannot both take the last unit                                                                              |
| Double-charging / double-ordering | Order creation is idempotent; the key is written to MongoDB **before** the response is flushed, so an immediate retry replays the original order instead of failing                                                 |
| Replay of admin inventory         | Adjustments are idempotent by key — a retried request returns the original result rather than counting stock twice                                                                                                  |
| Payment data                      | No card data touches the platform; Razorpay handles it. Webhook signature verification is reserved. **Razorpay is not integrated** — a `razorpay` payment method is rejected rather than silently simulated         |
| Error leakage                     | 5xx messages are generic; stack traces stay in the logs                                                                                                                                                             |
| Secrets in the bundle             | Only `NEXT_PUBLIC_*` is inlined; every secret variable is read in server-only modules                                                                                                                               |
| Admin indexing                    | `X-Robots-Tag: noindex, nofollow` on the admin app                                                                                                                                                                  |

---

## 10. Testing strategy

| Layer              | Tool                 | What it covers                                                         |
| ------------------ | -------------------- | ---------------------------------------------------------------------- |
| Contracts          | Vitest               | SKU format, query coercion, schema rejection of invalid payloads       |
| API                | Vitest + supertest   | Health endpoints, error envelope, 404 handling, request-id propagation |
| Storefront / admin | Vitest               | Component and unit tests as features land                              |
| End-to-end         | Playwright (planned) | Catalogue browse → product → add-to-cart journey                       |

The API's Express app is built by `createApp()` separately from the server
bootstrap, so tests can mount it with supertest **without opening a socket or
requiring a database**.

CI runs `pnpm check` = `format:check && lint && typecheck && test`.

---

## 11. Mobile-first approach

The storefront is designed mobile-first, not "responsive after the fact":

- Base styles target a 360–430 px viewport; breakpoints _add_ space.
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

## 13. Deliberate non-goals

The following are **not** implemented:

- **Executing a production catalogue import.** The pipeline is built and
  verified as a dry run (§8). It is blocked on business decisions, not on
  engineering — 317 of 674 variants have an unresolved source conflict.
- **Razorpay.** A `razorpay` payment method is rejected at checkout rather
  than silently simulated. There is no fake payment flow anywhere in the
  system, and the storefront says so plainly.
- **Product upload to any live marketplace service.** The Flipkart CDN URLs in
  the legacy templates are recorded as `marketplaceImageUrls` for reference
  only; they are never published to.
- **Real stock.** Every imported variant is `stock = 0`, `inStock = false`
  (decision C-3) until an authorised stock source exists.
- **Bulk catalogue data entry.** The quotation excludes it beyond the agreed
  support, which is why the import pipeline is auditable and reusable rather
  than a one-off script.

---

## 14. References

| Document                                                                           | Contents                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`catalog-audit.md`](./catalog-audit.md)                                           | The real catalogue and asset findings, with unresolved decisions D-1 … D-8     |
| [`CATALOG_CONFLICTS.md`](./CATALOG_CONFLICTS.md)                                   | The 502 source conflicts enumerated per SKU, and which 317 variants they block |
| [`DATA_MODEL.md`](./DATA_MODEL.md)                                                 | MongoDB collections, fields and indexes                                        |
| [`API_CONTRACT.md`](./API_CONTRACT.md)                                             | Endpoint-by-endpoint contract                                                  |
| [`DEPLOYMENT_RUNBOOK.md`](./DEPLOYMENT_RUNBOOK.md)                                 | Environment setup and deployment procedure                                     |
| [`API_CONTRACT_GAPS.md`](./API_CONTRACT_GAPS.md)                                   | Known API gaps, and which are now closed (§11)                                 |
| [`BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md`](./BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md) | The executed and verified additive backfill                                    |

---

## 15. Homepage merchandising

_Added 22 October 2026._

### 15.1 The shape of the problem

The homepage needs to be arranged by a human, but the products it shows must come
from the catalogue. That creates a standing risk: merchandising that **copies**
product data will drift the moment a price, image or stock level changes.

### 15.2 The rule: store references, resolve at read time

`homepage_sections` stores **ids only**. A section says "show these four
products"; it never stores a title, price, image or stock count. Every read
re-resolves those fields from `products` and `variants`.

The consequence is deliberate: **a merchandising mistake can never display a
false price or a stale photograph**, because the page has no copy to go stale.

### 15.3 Who decides what is publishable

**The API, not the client.**

```
admin saves  →  validate every reference  →  persist ids only
                                    ↓
storefront loads  →  GET /v1/content/homepage  →  resolve + filter  →  render
```

`resolveSection()` in `homepage.service.ts` drops any section that is disabled,
outside its scheduling window, expired, empty, out of campaign, or has
unresolved references. The storefront receives a list it can render directly —
it never has to decide whether something is safe to show.

This is the same gate checkout uses (`isSellable()`), so a product the homepage
advertises as buyable is genuinely buyable. When they disagree, the homepage
cannot promise something checkout will refuse.

### 15.4 Where the honesty rules live

| Rule                                                              | Enforced in                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Expired campaigns disappear on their own                          | `resolveSection()` window check                        |
| Deal prices equal charged prices                                  | `computeDiscount()`, shared with checkout              |
| A colour tile shows a photo of _that_ colour                      | `colour-shop` branch; mismatched tiles dropped         |
| Empty categories are not rendered                                 | `category-grid` branch filters to populated categories |
| Unresolved references hide the section rather than render a blank | `hiddenBecause: 'unresolved-references'`               |

### 15.5 Interaction budget

Phase 3 deliberately added motion **only** where it aids shopping:

| Treatment          | Technique                             | Reduced-motion fallback               |
| ------------------ | ------------------------------------- | ------------------------------------- |
| Marquee            | One CSS `translate3d` keyframe        | Static, non-animating strip           |
| Card tilt          | CSS `transform` on pointer move       | No transform                          |
| Product rail       | Native scroll-snap + a small JS nudge | Native scrolling                      |
| Featured spotlight | Colour swatch swap                    | Unchanged — it is content, not motion |

No WebGL, no canvas, no animation library. Total added JS is small and no
interaction sits on top of a colour swatch, size button or add-to-cart target.

### 15.6 Admin and API share one contract

`apps/admin` does not maintain its own notion of a section. It edits
`homepageSectionSchema` — the same discriminated union the API validates with —
imported from `@ajooba/contracts`. A control cannot exist in the admin UI for a
field the API would reject.

### 15.7 Verified by executing the path, not by building

The first implementation of this feature **passed its build and all 106 tests
and was completely unusable**: an administrator could load the editor but not
save a single change. Three independent defects each blocked every write:

| Defect                                                        | Why nothing caught it                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Resolved colour tiles were written back into `config.colours` | Unit tests asserted the tiles; none re-saved the page it had just read                          |
| The concurrency `version` was never returned to the client    | The server fabricated one, and the server compared it against itself                            |
| The write schema demanded `position` inside `config`          | The API built payloads that omitted it — and only hand-written test payloads ever hit that path |

This is why §15.6 is not a nicety. The shared contract did not prevent these
bugs; it _contained_ them, because every layer was individually consistent and
the inconsistency was **between** layers.

**The rule this produced:** a feature is not verified when it compiles or when
its tests pass. It is verified when the full path — control → API → persisted →
customer-facing output — has been executed at least once, with the client's own
round-tripped data as the input to the write.

---

## 16. Catalogue administration (G-1 … G-6)

_Added 23 October 2026._

### 16.1 What changed

Phase 1–7 closed six gaps that made the catalogue **read-only** in practice.
The product page could display a design, but no authenticated user could create
one, add a colourway, set a category, resolve a photograph, or apply an import.

|                | Before                          | After                                               |
| -------------- | ------------------------------- | --------------------------------------------------- |
| Parent designs | Read-only                       | `A<NN`-addressed CRUD with archival                 |
| Colourways     | Derived from variant rows       | First-class, with a per-colour photo rollup         |
| SKUs           | Derived                         | Addressable by `sku`, with a stock ledger           |
| Categories     | A string on the product         | A canonical collection with a validated tree        |
| Photographs    | Folder-name heuristics          | A review queue with mandatory, attributed decisions |
| Import         | A CLI on one developer's laptop | A two-phase, checksum-gated, permissioned API       |

### 16.2 The addressing rule

Three identifiers, each chosen for a specific reason:

| Entity        | Key                                | Why not something else                                                                                                            |
| ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Parent design | `code` (`A<NN>`)                   | The title is editable, so a title-keyed edit would fork into a new parent. The code is in the workbook and in every image folder. |
| Colourway     | `colour` token **within** a design | Colour names are merchant text and repeat across designs; the pair is the identity.                                               |
| SKU           | `sku` (`AJ-A<NN>-<TOKEN>-<SIZE>`)  | The merchant's own identifier, preserved byte-for-byte, and the thing an order line already references.                           |

The slug remains a **derived** field, regenerated from the title on every save
with `-2`/`-3` disambiguation. It is for URLs. It is never an admin key.

### 16.3 Sellability is one predicate, used everywhere

```typescript
isSellable = photographyStatus !== 'pending-review' && inStock && stock - reservedStock > 0;
```

This appears in the storefront product page, the homepage resolver, the cart,
the wishlist and the checkout validator. **A single formula**, so the homepage
cannot advertise something checkout will refuse — and so filling in an admin
form cannot make an unphotographed, unstocked variant purchasable.

### 16.4 The photography gate

A colourway starts life at `pending-review`. It leaves that state on exactly one
event: **a verified photograph is assigned to its colour**. Not a checkbox, not
a form field — an actual image whose bytes are tied to that colour in the
catalogue.

The consequence is that "no verified photo yet" is the _default_ state, and it
stays until somebody resolves it by hand. The storefront renders it as an
explicit placeholder. It does not fall back to another colour's photograph,
because a shopper who selects "Navy" and sees a photograph of "Black" is being
told a lie by the interface.

Two guards keep the assignment honest:

- **The colour must be one the design actually sells.** Assigning an image to a
  colour the workbook never lists is a `422`, not a new colourway.
- **The same bytes cannot serve two colours.** The checksum is checked against
  every prior assignment regardless of colour, so a copied folder cannot quietly
  populate two galleries with one photograph.

### 16.5 Reviews are attributed, reasoned and reversible

Every review decision requires a reason of at least ten characters and is
written to `image_reviews` with the administrator's id, email, timestamp and IP.
`POST /images/:imageId/revert` returns an assignment to quarantine and records
itself as a new decision — the history is append-only, so a mistaken review is
correctable without erasing the fact that it happened.

### 16.6 Nothing is hard-deleted

| Entity   | Removal                               | Why                                                      |
| -------- | ------------------------------------- | -------------------------------------------------------- |
| Product  | `status: 'archived'`                  | Order lines reference it by code                         |
| Variant  | `stock: 0`, `inStock: false`, retired | Order lines reference it by `sku`                        |
| Category | `status: 'retired'`                   | Referenced by product `categories` and homepage sections |

A category that still has products assigned **cannot** be retired — the caller
is told to reassign them first, so nothing is silently un-categorised.

### 16.7 Stock is a ledger with a counted-on-hand assertion

`PUT /skus/:sku/stock` does not accept a number alone. It requires a reason and
`expectedCurrentStock` — the level the administrator believes is on hand. If the
database disagrees, the write is a `409` and nothing changes. This catches the
common failure of two people counting the same aisle from two tabs.

The bulk equivalent defaults to `dryRun: true` and reports exactly what it would
change before anything is written.

### 16.8 Layering

```
apps/admin/src/features/catalog/components/
        │  typed client (catalog-api.ts)
        ▼
apps/admin/src/app/api/admin/catalog/route.ts        ← cookie → bearer, path sanitised
        ▼
apps/api/src/routes/catalog-admin.routes.ts          ← permission + rate limit + Zod
        ▼
apps/api/src/services/catalog-admin.service.ts       ← invariants, audit, idempotency
apps/api/src/services/import.service.ts              ← plan → checksum → apply
        ▼
packages/contracts/src/catalog/admin.ts              ← one definition of every payload
```

The admin panel never talks to MongoDB and never constructs a bearer token. The
service layer is where every invariant in §16.4–§16.7 lives, so a `curl` cannot
bypass what the UI enforces.
