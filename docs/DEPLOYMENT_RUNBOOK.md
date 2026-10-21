# Ajooba Footwear — Deployment Runbook

**Scope:** how a fresh developer or operator starts, verifies and (later) deploys each application.
**Last verified:** 2026-10-21, against commit state of the initial scaffold.

> This runbook covers the **current** state of the repository. Payments, the admin API writes, and the real catalogue import do not exist yet. Nothing here should be read as "ready for production traffic" — it is a documented foundation, not a shipped product.

---

## 0. Prerequisites

| Requirement | Version | How to check |
| --- | --- | --- |
| Node.js | **>= 22.12.0** (LTS) | `node --version` |
| pnpm | **>= 10** | `pnpm --version` |
| MongoDB | Atlas cluster, or a local `mongod` for development | — |
| Git + Git LFS | LFS **v3.4+** | `git lfs version` |

The repository pins `packageManager: pnpm@10.26.2`. Corepack is the supported way to get the exact version:

```bash
corepack enable
corepack prepare pnpm@10.26.2 --activate
```

### 0.1 Git LFS is not optional

`public/` contains roughly **501 MB** of original product imagery, listing templates and the source workbook. These files are tracked by Git LFS via `.gitattributes` for `*.jpg *.jpeg *.png *.xlsx *.xls`. Without LFS:

- a fresh `git clone` pulls ~501 MB of binary blobs into the object store,
- the original assets get compressed/damaged by text-oriented tooling,
- the repo becomes slow to clone and diff.

```bash
git lfs install      # once per machine
git lfs pull         # after cloning, to materialise the assets
```

Verify the assets actually arrived:

```bash
# PowerShell
(Get-ChildItem -Recurse -File public | Measure-Object -Property Length -Sum).Sum / 1MB
```

Expect roughly 501 MB. If this is tiny, LFS pointers were cloned instead of the real files — run `git lfs pull`.

---

## 1. Repository layout

```text
C:\ajooba footwear\
├── apps\
│   ├── api\            Express 5 + Mongoose 9 REST API        (port 4000)
│   ├── storefront\     Next.js 16 + React 19 customer site    (port 3000)
│   └── admin\          Next.js 16 + React 19 admin panel      (port 3001)
├── packages\
│   └── contracts\      shared types, Zod schemas, env + health contracts
├── docs\
│   ├── catalog-audit.md       real catalogue + asset findings
│   ├── ARCHITECTURE.md        system and technology decisions
│   ├── DATA_MODEL.md          collections, fields, indexes
│   ├── API_CONTRACT.md        REST contract
│   └── DEPLOYMENT_RUNBOOK.md  this file
├── public\             ORIGINAL SOURCE ASSETS — never regenerated
│   ├── banner\  images\  products\
│   └── Ajooba_Footwear_Quotation_Updated_45000_v3.pdf
├── scripts\            audit tooling
├── .gitignore  .gitattributes  .prettierrc.json  pnpm-workspace.yaml
```

---

## 2. First-time setup

```bash
git clone <repo-url> "C:\ajooba footwear"
cd "C:\ajooba footwear"
git lfs install
git lfs pull
corepack enable
pnpm install
```

`pnpm install` at the root installs every workspace package at once — the three apps and the contracts package — and links `@ajooba/contracts` into each app via `workspace:*`.

Expected: no peer-dependency errors. If you see them, the lockfile and `package.json` have drifted; run `pnpm install` again and commit the updated `pnpm-lock.yaml`.

---

## 3. Environment configuration

### 3.1 The rule

- Environment variables come from the **platform** (Vercel / Render / Atlas / `.env` locally). There is no `mode="dev"` / `mode="pro"` branch anywhere in the code.
- Secrets never enter the repository and never enter the browser bundle. Only `NEXT_PUBLIC_*` variables reach the browser.
- A missing required variable is a **boot failure**, not a silent fallback. Each app validates its own environment through `@ajooba/contracts` at startup.

Schemas: `packages/contracts/src/env/index.ts` (`apiEnvSchema`, `storefrontEnvSchema`, `adminEnvSchema`).

### 3.2 Per-app environment files

```bash
# PowerShell
Copy-Item apps\api\.env.example         apps\api\.env
Copy-Item apps\storefront\.env.example  apps\storefront\.env.local
Copy-Item apps\admin\.env.example       apps\admin\.env.local
```

`.env`, `.env.local` and anything matching `.env*` are gitignored. Only `.env.example` is committed.

### 3.3 Required variables

**`apps/api/.env`**

| Variable | Required | Example | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | Defaults to 4000. |
| `MONGODB_URI` | **yes** | `mongodb+srv://user:pass@cluster.mongodb.net` | **Secret.** Never committed, never logged. |
| `MONGODB_DB` | no | `ajooba_dev` | Derived from the URI when omitted. |
| `API_PUBLIC_URL` | **yes** | `http://localhost:4000` | Must be a valid URL. |
| `CORS_ORIGINS` | **yes** | `http://localhost:3000,http://localhost:3001` | Comma separated. |
| `ADMIN_ORIGINS` | no | `http://localhost:3001` | Subset of `CORS_ORIGINS`. |
| `STOREFRONT_PUBLIC_URL` | **yes** | `http://localhost:3000` | |
| `ADMIN_PUBLIC_URL` | **yes** | `http://localhost:3001` | |
| `SESSION_SECRET` | **yes** | `openssl rand -base64 48` | **Secret**, >= 32 chars. |
| `RAZORPAY_KEY_ID` | no | — | Publishable, but server-configured. Optional until payments exist. |
| `RAZORPAY_KEY_SECRET` | **yes** (when payments exist) | — | **Secret.** Server only, never sent to the browser. |
| `LOG_LEVEL` | no | `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` |

**`apps/storefront/.env.local`**

| Variable | Required | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | **yes** | `http://localhost:3000` |
| `API_INTERNAL_URL` | **yes** | `http://localhost:4000` |
| `NEXT_PUBLIC_API_URL` | **yes** | `http://localhost:4000` |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no | `/` (default) |
| `CATALOG_REVALIDATE_SECONDS` | no | `300` (default) |

**`apps/admin/.env.local`**

| Variable | Required | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | **yes** | `http://localhost:3001` |
| `API_INTERNAL_URL` | **yes** | `http://localhost:4000` |
| `NEXT_PUBLIC_API_URL` | **yes** | `http://localhost:4000` |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no | `/` (default) |

### 3.4 Independent database targets

Development, staging and production each point at a **separate** MongoDB Atlas cluster (or separate database on one cluster). Nothing is inferred from `NODE_ENV`; the target comes from `MONGODB_URI`. A staging deployment therefore cannot read development data, and a development machine cannot reach production data.

Recommended Atlas layout:

| Environment | Cluster | Database | Notes |
| --- | --- | --- | --- |
| Development | `ajooba-dev` | `ajooba_dev` | Local user credentials. |
| Staging | `ajooba-staging` | `ajooba_staging` | Mirrors the production schema, empty data. |
| Production | `ajooba-prod` | `ajooba_prod` | Backups + point-in-time restore enabled. |

### 3.5 Secret rotation

`SESSION_SECRET` and `RAZORPAY_KEY_SECRET` are read at boot only. Rotating them requires a restart/redeploy. `MONGODB_URI` credentials can be rotated inside Atlas without a redeploy as long as the connection string stays valid, but Atlas will terminate existing sessions, so drain the instance first.

---

## 4. Running each application

### 4.1 Development

```bash
# everything, in parallel, with streamed logs
pnpm dev

# or one at a time
pnpm dev:api          # http://localhost:4000
pnpm dev:storefront   # http://localhost:3000
pnpm dev:admin        # http://localhost:3001
```

Verify each is up:

```bash
curl http://localhost:4000/health/live     # {"ok":true,...,"status":"ok"}
curl http://localhost:4000/health/ready    # 200 + mongodb check, or 503
curl http://localhost:4000/v1/catalog/products   # real (currently empty) catalogue
curl http://localhost:3000/api/health
curl http://localhost:3001/api/health
```

`/health/ready` returning **503** locally is expected and correct when MongoDB is not reachable. It is doing its job.

### 4.2 Tests

```bash
pnpm test                    # every workspace
pnpm --filter @ajooba/api test        # supertest integration tests
pnpm --filter @ajooba/contracts test  # schema tests
```

The API tests load `apps/api/.env.test`, so they need no live database and no `.env`.

### 4.3 Build

```bash
pnpm build                              # all three apps
pnpm --filter @ajooba/contracts build   # tsc -> packages/contracts/dist
pnpm --filter @ajooba/api build         # tsc -> apps/api/dist
pnpm --filter @ajooba/storefront build  # next build
pnpm --filter @ajooba/admin build       # next build
```

**`@ajooba/contracts` must be built before the apps.** Each app's `build`
script runs the contracts build first, so `pnpm build` at the root handles
this automatically. This matters: the contracts package ships compiled ESM
under `dist/`, because its sources use NodeNext `.js` extension imports that a
bundler cannot resolve from raw `.ts`.

All three builds were executed successfully on 2026-10-21 (Next.js 16.4.2,
Turbopack; TypeScript 5.9.3).

### 4.4 Catalogue audit

```bash
pnpm catalog:audit      # python scripts/catalog_audit.py
```

Requires `pip install openpyxl`. Opens `public/` read-only and prints the
verified catalogue and asset findings. See `docs/catalog-audit.md`.

---

## 5. Verification checklist

Run this before calling any phase complete. A check that was not run is
reported as not run.

| Command | What it checks | Status 2026-10-21 |
| --- | --- | --- |
| `pnpm format:check` | Prettier formatting | **passed** |
| `pnpm lint` | ESLint, type-aware, `--max-warnings 0` | **passed** |
| `pnpm typecheck` | `tsc --noEmit` across all 4 packages | **passed** |
| `pnpm test` | Vitest — 49 tests across 4 packages | **passed** |
| `pnpm build` | All three apps build | **passed** |
| `pnpm catalog:audit` | Re-derives the catalogue findings | **passed** |
| Runtime smoke test | All three services started and queried | **passed** |

```bash
pnpm check      # format:check + lint + typecheck + test
```

### 5.1 Health-check verification

```bash
curl http://localhost:4000/health/live
# expect HTTP 200, data.status === "ok"

curl http://localhost:4000/health/ready
# expect HTTP 200 and checks[0].status === "ok" when MongoDB is reachable
# expect HTTP 503 and data.status === "error" when it is not

curl http://localhost:3000/api/health
curl http://localhost:3001/api/health
# expect HTTP 200 with data.service === "storefront" | "admin"
```

### 5.2 No-fake-data verification

These must **never** show fabricated content:

- the storefront catalogue grid and product detail pages,
- the admin dashboard metric tiles and charts.

When the catalogue is empty or the API is unreachable, the correct output is an
explicit empty state — not placeholder products and not placeholder revenue.
This is enforced in `product-grid.tsx` and `apps/admin/src/app/page.tsx`, and
pinned by tests in `apps/admin/tests/dashboard.test.tsx` (asserts no `₹`
anywhere) and `apps/storefront/tests/product-grid.test.tsx`.

### 5.3 The three catalogue states

The storefront must distinguish these. Conflating the last two would tell a
customer that a real product does not exist when the truth is that the service
is down.

| Situation | `/products` | `/products/<slug>` |
| --- | --- | --- |
| API up, catalogue empty | "No products found" | "Page not found" (404) |
| API up, product missing | "No products found" | "Page not found" (404) |
| API down / failing | "Catalogue temporarily unavailable" | "Product temporarily unavailable" |

Verified live on 2026-10-21 against all three services.

---

## 6. Deployment: target platforms

Not yet executed. This is the intended shape.

### 6.1 API — Render or Railway

| Setting | Value |
| --- | --- |
| Root directory | `apps/api` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` |
| Start command | `node dist/server.js` |
| Health check path | `/health/ready` |
| Node version | 22.x |

Environment variables are set in the platform dashboard. `MONGODB_URI`, `SESSION_SECRET` and `RAZORPAY_KEY_SECRET` are marked secret and are never echoed into build logs.

### 6.2 Storefront and admin — Vercel

| Setting | Storefront | Admin |
| --- | --- | --- |
| Root directory | `apps/storefront` | `apps/admin` |
| Framework preset | Next.js | Next.js |
| Build command | `pnpm build` | `pnpm build` |
| Health path | `/api/health` | `/api/health` |

Configure **three separate projects** (production, staging, preview) per app so each environment gets its own env vars and its own database target. Do not reuse a single project with a runtime mode switch — that is exactly the pattern the environment layer exists to prevent.

`output: 'standalone'` is not configured in `next.config.ts`. Add it before deploying to a platform that runs `node server.js` directly (Render, Railway, Fly, a VM). Vercel does not need it.

### 6.3 Media assets — the real deployment problem

`public/products/` is ~501 MB of LFS-tracked originals. Three options, in increasing order of preference:

1. **Ship `public/` with the app.** Simple, but every deployment uploads ~501 MB. Acceptable for the first deploy only.
2. **Object storage** (S3 / Cloudflare R2). Upload the originals once, keep filenames byte-identical, and point `NEXT_PUBLIC_MEDIA_BASE_URL` at the bucket origin. Filenames must not change, or the paths recorded in MongoDB stop resolving.
3. **Image CDN on top of (2)** for resizing and format negotiation.

Option 2 is the right long-term answer and directly enables responsive image delivery on mobile. **Not yet implemented** — no upload script, no bucket, no CDN. The data model stores image URLs relative to `public/`, so the migration is a base-URL change plus an asset copy, not a re-export.

### 6.4 Production readiness gaps

| Gap | Impact | Priority |
| --- | --- | --- |
| Catalogue not imported into MongoDB | Storefront is empty; admin has nothing to manage | **Blocking** |
| No authentication on any endpoint | Admin API writes would be publicly callable | **Blocking** before admin writes |
| No payment integration | Cannot take money | **Blocking** for launch |
| No per-route rate-limit tuning | Abuse exposure | Medium |
| No error monitoring (Sentry or similar) | Silent production failures | Medium |
| No CDN for 501 MB of imagery | Slow first paint on mobile | Medium |
| No controlled index migration | Risk of a production collection lock | Medium |
| MongoDB TLS not pinned in the driver options | Atlas requires TLS; it negotiates automatically, but pinning `tls=true` is explicit | Low |
| No API docs served at runtime | `/health` lists routes; a full OpenAPI spec does not exist | Low |

---

## 7. Rollback

| Change type | Procedure |
| --- | --- |
| API code | Redeploy the previous Render/Railway commit. Stateless — no migration to reverse. |
| Storefront/admin code | Vercel instant rollback via **Deployments → Promote to Production**. |
| Catalogue data | Restore the database from the Atlas snapshot taken before the import. |
| Environment variables | Update in the dashboard, then redeploy. All three apps read env at boot. |

**Never** roll back by deleting products in the admin panel to "undo" an import — use the Atlas point-in-time restore. It is the only way to guarantee consistency across `products` and `variants`.

---

## 8. Operational notes

### 8.1 Logging

The API emits one Pino JSON object per request. In production set `LOG_LEVEL=info`; use `debug` locally only. `MONGODB_URI`, `SESSION_SECRET` and `RAZORPAY_KEY_SECRET` are in the redact list and never appear in a log line.

### 8.2 Database indices

Indexes are declared in the Mongoose schemas (`apps/api/src/models/*.model.ts`) and are created by Mongoose on boot, governed by the `autoIndex` setting. **Verify `autoIndex` is disabled in production** and that indexes are built by a controlled migration instead — an automatic index build against a large collection can lock it.

Not yet implemented: an index-creation migration script.

### 8.3 Source asset protection

`public/` is treated as read-only input. The operating rules:

1. Never delete, rename, move, overwrite or regenerate a file under `public/`.
2. New derived assets (thumbnails, WebP variants) go to a **new** directory, never on top of originals.
3. `.gitattributes` keeps originals in LFS; `git lfs ls-files` should list every source image and workbook.
4. If an asset looks wrong, fix the *database record*, not the file.

### 8.4 Currency and time

The source workbook contains bare integers with no currency column. The platform is INR-only, but nothing in the API response states that, so it is tracked as Q-3 in `docs/API_CONTRACT.md`. All timestamps are stored in UTC and serialised as ISO-8601 strings.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| API exits at boot with a Zod error naming a variable | Missing/malformed env var | Compare your `.env` against the table in §3.3 and `apps/api/.env.example` |
| `/health/ready` returns 503 | MongoDB unreachable | Check `MONGODB_URI`, the Atlas IP access list, and that the cluster is not paused |
| `pnpm install` fails with `ERR_PNPM_OUTDATED_LOCKFILE` | `package.json` and lockfile drift | Run `pnpm install` and commit the updated `pnpm-lock.yaml` |
| Product images 404 | Filenames changed, or `NEXT_PUBLIC_MEDIA_BASE_URL` wrong | Filenames must be byte-identical to the originals. Check the media base URL |
| `public/` is a few KB after clone | Git LFS pointers, not real files | `git lfs install && git lfs pull` |
| `Module '@ajooba/contracts' not found` | Workspace not linked | `pnpm install` at the **root**, not inside a single app |
| Port already in use | Another dev server is running | Change `PORT`, or stop the other process |
| Storefront shows the empty state but the DB has products | API unreachable from the Next server | Check `API_INTERNAL_URL` — it is the server-side URL and must be reachable from the Next process |
| ESLint reports "not found by the project service" | A file was added outside the tsconfig `include` | Add the file to the package's `tsconfig.json` include list, or to `allowDefaultProject` in `eslint.config.js` |

---

## 10. Where to look next

| Question | Document |
| --- | --- |
| What is actually in the catalogue? | `docs/catalog-audit.md`, decisions D-1…D-8 |
| Why these technologies? | `docs/ARCHITECTURE.md` § Version Matrix |
| What shape is this endpoint? | `docs/API_CONTRACT.md` |
| What fields does this collection have? | `docs/DATA_MODEL.md` |
| Anything not in those four documents | It does not exist yet. Do not assume it does. |