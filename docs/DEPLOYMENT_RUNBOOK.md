# Ajooba Footwear — Deployment Runbook

**Scope:** how a fresh developer or operator starts, verifies and (later) deploys each application.
**Last verified:** 2026-10-23, after the catalogue-administration work (G-1…G-6).

> **Status: catalogue administration is implemented and tested. Payments do not
> exist yet.** Nothing here should be read as "ready for production traffic".
> The platform is deliberately unsellable until real stock is counted — see §0.1.

---

## 0.1 Before any launch: the stock blocker

**All 674 variants in `ajooba_development` have `stock: 0`, and the source
workbook has no stock-quantity column.** No quantity was invented at any point.

A variant is purchasable only when all three hold:

```
photographyStatus !== 'pending-review'
&& inStock
&& (stock - reservedStock) > 0
```

Two conditions therefore block launch:

| Condition   | Current state                                                           | Cleared by                                                                                                                            |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Stock       | **0 of 674** SKUs have stock                                            | Physical count, then `PUT /v1/admin/catalog/skus/:sku/stock` per SKU, or `POST /v1/admin/catalog/inventory/stock-set` (dry-run first) |
| Photography | **15 of 674** SKUs are `verified`; **600 of 685** images have no colour | Image review queue at `/catalog/images`                                                                                               |

Both are **data** tasks requiring human decisions. Neither is a code task, and
neither may be shortcut by writing to the database directly.

The photography figure is worth stating precisely, because it is the honest one:
**85 images do have a verified colour** (Brown 20, Black 19, White 7, Tan 7,
Olive 7, Grey 6) and 19 are explicitly quarantined. The other 600 are held
back because their filename token could not be proven to match a colour the
design actually sells. Nothing was guessed, and no photograph is displayed in a
gallery it might not belong to.

### 0.2 Before an environment receives an import: hash the imagery

The cross-colour duplicate-photograph guard reads `products.images[].checksum`.
The JSON extract carries filenames, **not bytes**, so an environment seeded from
the extract alone will have no checksums and that guard will have nothing to
compare. Run this where `public/products/` is present, once, before the first
image review:

```bash
cd apps/api
npx tsx src/jobs/image-checksum-backfill.job.ts --dry-run   # lists duplicate groups
npx tsx src/jobs/image-checksum-backfill.job.ts --apply     # writes 685 checksums
```

Additive and idempotent — re-running reports `already stamped: 685` and writes
nothing. Executed against `ajooba_development` on 23 Oct 2026; it found exactly
one duplicate pair, `A10-7.jpg` / `A10-7(1).jpg`, matching the MD5 audit in
`docs/catalog-audit.md` §6.4.

---

## 0. Prerequisites

| Requirement   | Version                                            | How to check      |
| ------------- | -------------------------------------------------- | ----------------- |
| Node.js       | **>= 22.12.0** (LTS)                               | `node --version`  |
| pnpm          | **>= 10**                                          | `pnpm --version`  |
| MongoDB       | Atlas cluster, or a local `mongod` for development | —                 |
| Git + Git LFS | LFS **v3.4+**                                      | `git lfs version` |

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

> **The complete inventory is `docs/ENVIRONMENT.md`** — every variable, its
> default, whether it is a secret, and what each deployment target needs.
> The table below is the short version for `apps/api`; the three Resend,
> Shiprocket and Cloudinary groups are documented there too.

**`apps/api/.env`**

| Variable                                           | Required                      | Example                                       | Notes                                                                                       |
| -------------------------------------------------- | ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                         | yes                           | `development`                                 | `development` \| `test` \| `production`                                                     |
| `PORT`                                             | no                            | `4000`                                        | Defaults to 4000.                                                                           |
| `MONGODB_URI`                                      | **yes**                       | `mongodb+srv://user:pass@cluster.mongodb.net` | **Secret.** Never committed, never logged.                                                  |
| `MONGODB_DB`                                       | no                            | `ajooba_dev`                                  | Derived from the URI when omitted.                                                          |
| `API_PUBLIC_URL`                                   | **yes**                       | `http://localhost:4000`                       | Must be a valid URL.                                                                        |
| `CORS_ORIGINS`                                     | **yes**                       | `http://localhost:3000,http://localhost:3001` | Comma separated.                                                                            |
| `ADMIN_ORIGINS`                                    | no                            | `http://localhost:3001`                       | Subset of `CORS_ORIGINS`.                                                                   |
| `STOREFRONT_PUBLIC_URL`                            | **yes**                       | `http://localhost:3000`                       |                                                                                             |
| `ADMIN_PUBLIC_URL`                                 | **yes**                       | `http://localhost:3001`                       |                                                                                             |
| `SESSION_SECRET`                                   | **yes**                       | `openssl rand -base64 48`                     | **Secret**, >= 32 chars.                                                                    |
| `RAZORPAY_KEY_ID`                                  | no                            | —                                             | Publishable, but server-configured. Optional until payments exist.                          |
| `RAZORPAY_KEY_SECRET`                              | **yes** (when payments exist) | —                                             | **Secret.** Server only, never sent to the browser.                                         |
| `RAZORPAY_WEBHOOK_SECRET`                          | **yes** (when payments exist) | —                                             | **Secret.** A _different_ secret from the key secret. Without it every webhook is refused.  |
| `RAZORPAY_MODE`                                    | **yes** (when payments exist) | `test`                                        | `test` \| `live`. `live` requires the full triple above or boot fails.                      |
| `JWT_SECRET`                                       | **yes**                       | `openssl rand -base64 48`                     | **Secret**, >= 32 chars. Must differ from `SESSION_SECRET`.                                 |
| `RESEND_API_KEY` + `RESEND_FROM_EMAIL`             | no                            | —                                             | **Secrets.** Must be set together or both absent.                                           |
| `SHIPROCKET_API_EMAIL` + `SHIPROCKET_API_PASSWORD` | no                            | —                                             | **Secrets.** Must be set together or both absent.                                           |
| `EMAIL_ALLOWLIST`                                  | **unset in production**       | `you@example.com` (dev only)                  | In non-production, recipients not on this list are recorded as `skipped` and not delivered. |
| `LOG_LEVEL`                                        | no                            | `info`                                        | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`                                          |

**`apps/storefront/.env.local`**

| Variable                     | Required | Example                 |
| ---------------------------- | -------- | ----------------------- |
| `NEXT_PUBLIC_SITE_URL`       | **yes**  | `http://localhost:3000` |
| `API_INTERNAL_URL`           | **yes**  | `http://localhost:4000` |
| `NEXT_PUBLIC_API_URL`        | **yes**  | `http://localhost:4000` |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no       | `/` (default)           |
| `CATALOG_REVALIDATE_SECONDS` | no       | `300` (default)         |

**`apps/admin/.env.local`**

| Variable                     | Required | Example                 |
| ---------------------------- | -------- | ----------------------- |
| `NEXT_PUBLIC_SITE_URL`       | **yes**  | `http://localhost:3001` |
| `API_INTERNAL_URL`           | **yes**  | `http://localhost:4000` |
| `NEXT_PUBLIC_API_URL`        | **yes**  | `http://localhost:4000` |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | no       | `/` (default)           |

### 3.4 Independent database targets

Development, staging and production each point at a **separate** MongoDB Atlas cluster (or separate database on one cluster). Nothing is inferred from `NODE_ENV`; the target comes from `MONGODB_URI`. A staging deployment therefore cannot read development data, and a development machine cannot reach production data.

Recommended Atlas layout:

| Environment | Cluster          | Database         | Notes                                      |
| ----------- | ---------------- | ---------------- | ------------------------------------------ |
| Development | `ajooba-dev`     | `ajooba_dev`     | Local user credentials.                    |
| Staging     | `ajooba-staging` | `ajooba_staging` | Mirrors the production schema, empty data. |
| Production  | `ajooba-prod`    | `ajooba_prod`    | Backups + point-in-time restore enabled.   |

> **Development currently runs against a local `mongod`, not Atlas.** See
> §3.5 for the confirmed local target and §3.6 for the MCP connection
> procedure.

### 3.5 The confirmed development target

Verified 2026-10-22:

| Property                 | Value                                                       |
| ------------------------ | ----------------------------------------------------------- |
| Deployment               | Local standalone `mongod` 8.0.4 (Windows service `MongoDB`) |
| Endpoint                 | `mongodb://127.0.0.1:27017` — `bindIp` is loopback-only     |
| Database                 | `ajooba_development`                                        |
| In `apps/api/.env.local` | `MONGODB_URI` + `MONGODB_DB=ajooba_development`             |

The Atlas connections saved in MongoDB Compass
(`cluster0.k1tud.mongodb.net`) are **stale**: the hostname returns `NXDOMAIN`
and TCP 27017 is closed. Ignore them until a real Atlas project exists and its
hostname resolves.

### 3.6 MongoDB MCP connection procedure (developer tooling)

The MCP server is a **development tool for inspecting the database**. It is not
a runtime dependency of `apps/api` — the API reaches MongoDB through Mongoose
using the validated `MONGODB_URI` / `MONGODB_DB` variables only.

**One-time setup:**

```bash
pnpm mcp:setup     # creates the `ajooba_mcp` user (role: read@ajooba_development),
                   # generates a random password, writes .env.mcp.
                   # The password is NEVER printed and NEVER committed.
pnpm mcp:verify    # performs a real stdio MCP handshake and asserts that
                   # no write-capable tool is exposed
pnpm mcp:inspect   # read-only inspection of ajooba_development
```

**How the credential is kept out of the repository:**

| File               | Committed?                                     | Purpose                                                    |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| `.cursor/mcp.json` | yes                                            | Command + `envFile` + non-secret flags. **No credential.** |
| `.env.mcp`         | **no** — gitignored by `.gitignore` (`.env.*`) | Holds `MDB_MCP_CONNECTION_STRING`.                         |
| `.env.mcp.example` | yes                                            | Placeholder template only.                                 |

Cursor's `envFile` support loads `.env.mcp` at MCP launch and passes it to the
server as environment variables, so the connection string never appears in
`mcp.json`, in a commit, or in a process command line.

**Rotating the credential:** re-run `pnpm mcp:setup`. It drops the old user,
recreates it with the same `read` role, and rewrites `.env.mcp`. Restart
Cursor afterwards so the MCP server restarts with the new password.

**Two layers of read-only protection are active:**

1. `MDB_MCP_READ_ONLY=true` — the server refuses every
   create/update/delete operation type, and destructive tools are not exposed
   in `tools/list` at all.
2. `MDB_MCP_DISABLED_TOOLS` — the destructive tools are also named
   explicitly, so the intent survives a flag being dropped by mistake.

Cursor's own MCP approval and network controls are **not** disabled.

#### 3.6.1 Known gap — the local `mongod` does not enforce roles

`mongod` on this machine starts with the `security:` block commented out, so
`getCmdLineOpts` reports `authorization: false`. MongoDB still verifies
passwords, but it does **not enforce roles** — every authenticated user gets
full access to every database. The `read` role on `ajooba_mcp` is recorded
but not applied.

Read-only therefore rests on the MCP server and Cursor, not on the database.
`mongod` is bound to `127.0.0.1`, so this is not remotely reachable.

**To close the gap** (requires Administrator rights — deliberately not done
automatically):

1. Edit `C:\Program Files\MongoDB\Server\8.0\bin\mongod.cfg`:

   ```yaml
   security:
     authorization: enabled
   ```

2. Restart the service: `Restart-Service MongoDB`
3. Add credentials for the API and the importer, because they will now need
   to authenticate:
   - an application user with `readWrite` on `ajooba_development`,
   - point `MONGODB_URI` at it in `apps/api/.env.local`,
   - and supply the same URI to the importer.

Until this is done, treat `mongodb-mcp-server` read-only mode as the primary
control and avoid running credentialed scripts against the local instance.

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

#### 4.2.1 The throwaway `mongod` is shut down gracefully

Both the API suite and the Playwright suite boot a throwaway `mongod` through
`mongodb-memory-server`. The library stops a **standalone** server by sending
it a `SIGINT`, which on Windows never reaches the process: `mongod` keeps
running, the library waits out a hardcoded 10-second grace period, sends
`SIGKILL`, and then **rejects** with
`Process "mongodProcess" didnt exit`.

That rejection happens in the teardown, after every test has already passed. It
turns a green run into a **non-zero exit code**, which makes CI report a
failure that does not exist — and it adds ~16 seconds to every run.

`mongod` implements the MongoDB `shutdown` command, which is the supported way
to ask it to stop. The library already uses exactly that technique for replica
sets; only the standalone path skips it. The suites therefore send the command
themselves before calling `stop()`:

- `apps/api/tests/helpers/mongo-shutdown.ts`
- `tests/e2e/mongo-shutdown.ts`

The command **rejects** even when it succeeds — the reply is carried on the
connection that the shutdown itself closes, so the driver sees `ECONNRESET`.
That is the expected outcome, not a failure, and the helper verifies the real
result by waiting for the process to exit.

| Suite                            | Before                                        | After                            |
| -------------------------------- | --------------------------------------------- | -------------------------------- |
| `pnpm --filter @ajooba/api test` | 364 passed, **exit 1**, ~16 s stall           | 364 passed, **exit 0**, no stall |
| `pnpm test:e2e`                  | 22 passed, **exit 0** (library timing varied) | 22 passed, **exit 0**            |

If you ever see `A child-process didnt exit with signal "SIGINT" within 10
seconds` in a test log, the graceful shutdown was bypassed and the exit code
will be misleading. Check that `shutdownMongoServer()` still runs before
`server.stop()`.

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

| Command              | What it checks                         | Status 2026-10-25 |
| -------------------- | -------------------------------------- | ----------------- |
| `pnpm format:check`  | Prettier formatting                    | **passed**        |
| `pnpm lint`          | ESLint, type-aware, `--max-warnings 0` | **passed**        |
| `pnpm typecheck`     | `tsc --noEmit` across all 4 packages   | **passed**        |
| `pnpm test`          | Vitest — the **monorepo** total        | **passed**        |
| `pnpm build`         | All three apps build                   | **passed**        |
| `pnpm test:e2e`      | Playwright, real browser               | **passed**        |
| `pnpm env:check`     | Environment inventory vs. the schemas  | **passed**        |
| `pnpm catalog:audit` | Re-derives the catalogue findings      | **passed**        |
| Runtime smoke test   | All three services started and queried | **passed**        |

> **API tests and monorepo tests are different numbers.** The API's own count
> and the monorepo total across all four packages must be quoted separately.
> Never report one as the other. The current figures are in §5.0.0a.

### 5.0.1 Catalogue administration verification (2026-10-23)

The G-1…G-6 work added `apps/api/tests/catalog-admin.test.ts` (50) and
`apps/api/tests/catalog-import.test.ts` (26). All exercise the **real Express
stack** — no service-level shortcuts — against a throwaway in-memory MongoDB.

`tests/helpers/guard.ts` asserts the database is isolated _before_ the
application can open a connection, so none of this touched
`ajooba_development`, staging or production.

| Area                     | Checks                                                                        |
| ------------------------ | ----------------------------------------------------------------------------- |
| Dry run writes nothing   | `products` and `variants` are asserted empty after planning                   |
| Apply is gated           | Refused without `confirm: true`, and with a mismatched checksum               |
| Idempotency              | Applying twice yields `1` design and `1` SKU, never duplicates                |
| Import invents no stock  | Every imported SKU asserted at `stock: 0`, `inStock: false`, `pending-review` |
| Quarantine is honoured   | The quarantined row's title never reaches the database                        |
| Attribution              | Plan records the approving email; an audit entry names them                   |
| Cross-colour photo reuse | `409` when the same bytes are assigned to a second colour                     |
| Photography promotion    | First photo promotes the colourway out of `pending-review`                    |
| Stock concurrency        | `expectedCurrentStock` mismatch is `409`; below-reserved is `422`             |
| Sellability              | A pending-review variant is never labelled purchasable                        |
| Order history            | Archiving and re-importing leave past order lines byte-identical              |
| Authorization            | Unauthenticated `401`; wrong role `403`                                       |

Three of these tests exist because the defect was **only** visible against real
data — see `API_CONTRACT_GAPS.md` §13.1. Every fixture in the suite has a review
record and a checksum; the live catalogue had neither, and the
duplicate-photograph guard was therefore doing nothing. The tests now seed a
migrated image with no review record to close that gap.

### 5.0.2 One-time data steps after a fresh import

Run in this order. All are idempotent.

```bash
# 1. Populate the canonical category collection from the products' own
#    subcategorySlug values. Required before the category screens are useful.
POST /v1/admin/catalog/categories/seed
#    requires: catalog:write

# 2. Resolve the image review queue at /catalog/images in the admin panel.
#    Until a colour has a verified photograph, its SKUs cannot be sold.
#    Requires: catalog:write, and a reason of at least 10 characters per decision.

# 3. Count stock. Dry run first — it writes nothing.
POST /v1/admin/catalog/inventory/stock-set   { "rows": [...], "reason": "audit", "dryRun": true }
#    then repeat with "dryRun": false
#    requires: inventory:write
```

Step 3 deliberately has no "quick" path. There is no endpoint that sets stock
without a reason, a concurrency guard and a ledger entry.

### 5.0 Verification log — supersedes earlier per-phase snapshots

The figures below are the **most recent full run** of each command, executed
against the repository as it stands. Earlier logs recorded in this document
were captured mid-build and show smaller numbers; they are kept only where
they describe a specific experiment.

#### 5.0.0a Full-repository verification (2026-10-26)

| Command                                                  | Result                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `pnpm format:check`                                      | **4/4 packages clean**                                                             |
| `pnpm lint`                                              | **4/4 packages clean**, `--max-warnings 0`                                         |
| `pnpm typecheck`                                         | **4/4 packages clean**                                                             |
| `pnpm test` — `@ajooba/api`                              | **364 passed** (15 files)                                                          |
| `pnpm test` — `@ajooba/contracts`                        | **41 passed** (3 files)                                                            |
| `pnpm test` — `@ajooba/storefront`                       | **59 passed** (6 files)                                                            |
| `pnpm test` — `@ajooba/admin`                            | **24 passed** (3 files)                                                            |
| `pnpm test` — **monorepo total**                         | **488 passed**, 0 failed, 0 skipped                                                |
| `pnpm build`                                             | **passed** — `apps/api` (tsc), `apps/storefront` and `apps/admin` (Next.js 16.4.2) |
| `pnpm test:e2e`                                          | **22 passed** (Playwright, real Chromium)                                          |
| `pnpm check` (format+lint+types+test)                    | **exit 0**                                                                         |
| `node scripts/readiness-check.mjs http://127.0.0.1:4000` | **29 checks, 2 blocked, 3 warnings** — correctly refuses                           |
| `pnpm indexes:check`                                     | **128 indices match schema**, 0 need attention, across 24 models                   |

> **API tests and monorepo tests are different numbers.** The API's own count is 364. The monorepo total across all four packages is 488. Quote them
> separately; do not report 488 as the API count or 364 as the repo count.

> **The API suite now exits 0.** It used to exit 1 with every test green,
> because the throwaway `mongod` could not be stopped on Windows. See
> §4.2.1 for the cause and the fix. A non-zero exit from `pnpm test` now
> always means a test actually failed.

> **`NODE_ENV` must not be `development` during `next build`.** An inherited
> `NODE_ENV=development` makes Next.js 16 emit a non-standard-`NODE_ENV` warning
> and then fail while exporting `/_global-error` with
> `TypeError: Cannot read properties of null (reading 'useContext')`. This is
> not an application defect — the same commit builds cleanly with `NODE_ENV`
> unset. Unset it in any CI job that runs a production build:
> `Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue` (PowerShell) or
> `unset NODE_ENV` (POSIX).

#### 5.0.0b Homepage merchandising verification (2026-10-22)

Added with Phase 2–6. All checks below were run, not assumed. The counts in
this table are the _snapshot at that date_; §5.0.0a supersedes them.

| Check                                    | Result                                                                |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @ajooba/contracts test`   | **41 passed** (3 files)                                               |
| `pnpm --filter @ajooba/api test`         | **111 passed** (7 files) — includes 5 new round-trip regression tests |
| `pnpm -r typecheck`                      | **4/4 packages clean**                                                |
| `pnpm lint`                              | **4/4 packages clean**, `--max-warnings 0`                            |
| `pnpm format:check`                      | **4/4 packages clean**                                                |
| `pnpm --filter @ajooba/storefront build` | **passed**                                                            |
| `pnpm --filter @ajooba/admin build`      | **passed**                                                            |
| Storefront `/` renders live sections     | **HTTP 200**, real product ids and image paths in the HTML            |
| Section headings render once each        | **passed** — a duplicated "Shop by category" was found and fixed      |
| Unauthenticated admin read               | **401 `UNAUTHORIZED`**, no section data in the body                   |
| **Admin save reaches the storefront**    | **passed end-to-end** — see below                                     |

#### 5.0.0c Verified round trip (live, against the dev database)

Executed against the running API and storefront, not simulated:

```
version from GET: 1792692297903 | sections: 5
config.colours   : ["Black","Brown","Tan","Olive","Chickoo","Gold"]   <- editable input, unchanged
colourTiles      : 4 resolved tiles                                    <- derived output, separate field
tiles each have an image: true

PUT: 200 | new version: 1792694314855
public sections : 4        (hero hidden by the administrator)
storefront shows new heading : true
storefront still shows hero  : false

restored: 200 | public sections after restore: 5
```

This confirms, against live processes: an admin can read the page, change a
heading, hide a section, and see both changes on the customer-facing site —
then restore the original configuration.

#### 5.0.0 Defects found by actually exercising the round trip

The admin build and all tests were green while the editor was **completely
unusable**. Three separate defects each independently prevented any save from
succeeding. They are listed in `docs/API_CONTRACT_GAPS.md` §11.4; the durable
lesson is that "it builds" and "the tests pass" are not evidence that a feature
works.

The storefront also cached the homepage for 300 seconds, so a published change
could take five minutes to appear. `fetchHomepage()` now uses
`cache: 'no-store'`, because the homepage is the one surface an administrator
changes deliberately and expects to see immediately.

**Do not accept a future phase on build success alone.** Run the control → API →
customer-facing path end to end.

#### 5.0.1 Manual smoke test for merchandising

With the API on `:4000` and the storefront on `:3000`:

```powershell
# The public homepage must resolve, not fall back
curl.exe -s http://127.0.0.1:3000/ | Select-String "The Ajooba Edit"

# Admin auth must be enforced server-side, not just hidden in the UI
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:4000/v1/admin/content/homepage/sections
# expect 401, and no section data in the body
```

Open `http://127.0.0.1:3001/homepage`, sign in, and confirm that reordering a
section and pressing Save changes the order on `http://127.0.0.1:3000/` after a
reload. **If the admin build succeeds but this round trip does not, the
merchandising module is not finished** — that exact scenario occurred during
Phase 6 and is recorded above.

#### 5.0.2 Rollback for merchandising

A bad homepage is fully reversible without touching the catalogue: re-save the
previous configuration from the admin editor, or delete the rows in
`homepage_sections`. With no rows, the storefront falls back to its static
layout. `homepage_sections` holds **references only**, so no product data can be
lost by resetting it.

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

| Situation               | `/products`                         | `/products/<slug>`                |
| ----------------------- | ----------------------------------- | --------------------------------- |
| API up, catalogue empty | "No products found"                 | "Page not found" (404)            |
| API up, product missing | "No products found"                 | "Page not found" (404)            |
| API down / failing      | "Catalogue temporarily unavailable" | "Product temporarily unavailable" |

Verified live on 2026-10-21 against all three services.

### 5.4 Dev admin credential — action required

During Phase 6 verification the local development administrator's password was
reset through the supported bootstrap job so the admin round trip could be
exercised:

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = "owner@ajooba.test"
$env:BOOTSTRAP_ADMIN_NAME   = "Ajooba Owner"
$env:BOOTSTRAP_ADMIN_PASSWORD = "<set a local-only password>"
$env:BOOTSTRAP_ADMIN_ROLE   = "owner"
pnpm --filter @ajooba/api admin:bootstrap -- --force
```

| Item     | Value                                                   |
| -------- | ------------------------------------------------------- |
| Account  | `owner@ajooba.test` (`role: owner`, all 18 permissions) |
| Database | `ajooba_development` only                               |
| Created  | 22 Oct 2026                                             |

This account exists **only** in the development database and was never present
in any other environment. Set a real password before sharing the environment,
and do not reuse it anywhere. A production owner must be bootstrapped through
the deployment job with credentials from the platform secret store, never a
literal in a shell command like the one above.

---

## 6. Deployment: target platforms

Not yet executed. This is the intended shape.

### 6.0 Environment design — staging and production

> **Status: designed, not deployed.** Nothing in this section has been
> deployed to a staging or production host. There is no staging origin, no
> production origin, and no DNS record for either. Every statement below is
> a _design_, and every step in §6.0.3 is a _procedure to follow_, not a
> record of something that happened.

#### 6.0.1 The shape

Three environments, three databases, three sets of credentials, no shared
state of any kind.

|                | Development     | Staging                 | Production              |
| -------------- | --------------- | ----------------------- | ----------------------- |
| **Purpose**    | Day-to-day work | Rehearsal of production | Taking real orders      |
| **Database**   | local `mongod`  | separate Atlas cluster  | separate Atlas cluster  |
| **Node env**   | `development`   | `production`            | `production`            |
| **Razorpay**   | none            | **test** keys           | **live** keys           |
| **Resend**     | none            | verified staging domain | verified sending domain |
| **Shiprocket** | none            | real account, test AWBs | real account, live AWBs |
| **Email**      | allowlisted     | delivered to team inbox | delivered to customers  |
| **Origin**     | `localhost`     | `staging.*`             | apex domain             |

**Why staging runs `NODE_ENV=production`.** This is the single most important
line in the table. `NODE_ENV` is not a convenience switch; it is what
enables the production gates:

- `BCRYPT_COST >= 10` is enforced outside `test`;
- the `EMAIL_ALLOWLIST` is not consulted, so real mail actually flows;
- production cookie flags and `secure` attributes are set;
- the account-lockout budget is the production budget.

A staging box running `NODE_ENV=development` rehearses **none** of that,
and would then be the first place the production behaviour was ever
exercised — which is the opposite of the point.

**Why staging uses Razorpay _test_ keys.** The Razorpay Checkout flow,
signature verification, webhook delivery and refund idempotency are all
identical in test mode; only the money is not. Test mode is the only way to
rehearse a payment without moving money, and moving money is not something
a rehearsal should do.

**Why the databases are separate.** There is no `NODE_ENV` inference
anywhere: the target comes from `MONGODB_URI` alone. A staging deployment
therefore _cannot_ read development data, and a development machine
_cannot_ reach production data, because the credentials differ. The
guarantee is in the connection string, not in a conditional.

#### 6.0.2 What each environment is allowed to do

| Action                  | Development | Staging           | Production                            |
| ----------------------- | ----------- | ----------------- | ------------------------------------- |
| Take a real order       | no          | no                | **yes**                               |
| Capture real money      | no          | no                | **yes**                               |
| Send real email         | no          | to a team mailbox | to customers                          |
| Create a real shipment  | no          | no                | **yes**                               |
| Import a catalogue      | yes         | yes               | only via an audited plan              |
| Set stock               | yes         | yes               | yes, with a reason and a ledger entry |
| Create an administrator | local only  | yes               | via the bootstrap job                 |

#### 6.0.3 Standing procedure for a new environment

Run in this order. Each step names what proves it worked.

```bash
# 1. Build the contracts package. The apps import compiled ESM from it.
pnpm --filter @ajooba/contracts build

# 2. Prove the environment inventory matches the code. No credentials needed.
pnpm env:check

# 3. Create the database and its user.
#    The user needs index-creation rights, or the boot gate refuses to start.
#    Grant: readWriteAnyDatabase on the target database, and createIndex.

# 4. Set the platform's environment variables. See docs/ENVIRONMENT.md §9.0
#    for the complete per-target matrix. Secrets go in the platform's secret
#    store, never into a repository file and never into a shell command.

# 5. Deploy. The API's boot gate provisions every index and refuses to start
#    if any fails.
#
#    Proof:
curl -fsS https://<api-origin>/health/ready
#    expect HTTP 200 and data.status === "ok"

# 6. Reconcile indexes on an environment created before 23 Oct 2026.
pnpm --filter @ajooba/api indexes:check
pnpm --filter @ajooba/api indexes:reconcile   # only if the check reports conflicts

# 7. Seed the catalogue. Dry run first; it writes nothing.
#    POST /v1/admin/catalog/imports  { payload, sourceFilename }
#    POST /v1/admin/catalog/categories/seed
#    POST /v1/admin/catalog/inventory/stock-set { rows, reason, dryRun: true }

# 8. Bootstrap the first administrator, from the platform's secret store.
$env:BOOTSTRAP_ADMIN_EMAIL    = "<from the secret store>"
$env:BOOTSTRAP_ADMIN_PASSWORD = "<from the secret store>"
$env:BOOTSTRAP_ADMIN_NAME     = "<from the secret store>"
$env:BOOTSTRAP_ADMIN_ROLE     = "owner"
pnpm --filter @ajooba/api admin:bootstrap -- --force

# 9. Configure the providers. See §9.6.1 for the exact dashboard steps.
#    These need provider access and DNS; they cannot be automated here.

# 10. Run the readiness gate against the new origin.
pnpm readiness https://<api-origin>
#     Exit code 0 means every blocking gate passed.
```

#### 6.0.4 Promotion: staging to production

The promotion is a **configuration change plus a deploy**, not a copy.

1. Staging must have passed `pnpm readiness` with exit code 0, and the
   operator must have signed off the manual provider checklist in §9.6.1.
2. The production environment gets its **own** values from the matrix in
   `docs/ENVIRONMENT.md` §9.0. Nothing is copied from staging except the
   _shape_, never the values.
3. The production catalogue is imported **fresh** into the production
   database. Staging's database is discarded, not promoted — it contains
   test orders, test returns and test refunds that would corrupt the
   production ledger.
4. Stock is counted for production separately. The import never sets stock.
5. The production Razorpay keys are switched from `test` to `live`, and
   `RAZORPAY_MODE=live` — which the schema refuses to accept without the
   full triple of key id, key secret and webhook secret.

#### 6.0.5 DNS records required

These need DNS access and **have not been created**. The names are the
shape; the actual domain is the operator's.

| Record             | Name            | Purpose                               |
| ------------------ | --------------- | ------------------------------------- |
| `A`/`AAAA`         | `api`           | API origin                            |
| `A`/`AAAA`         | `staging-api`   | Staging API origin                    |
| `CNAME`            | `staging`       | Staging storefront                    |
| `CNAME`            | `staging-admin` | Staging admin panel                   |
| `CNAME`            | `admin`         | Production admin panel                |
| `A`/`AAAA`         | apex            | Production storefront                 |
| `TXT`              | Resend DKIM     | Resend domain verification            |
| `TXT`/`MX`/`CNAME` | Resend SPF      | Resend domain verification            |
| `TXT`              | `_dmarc`        | DMARC policy (add after verification) |

Two DNS rules that are easy to get wrong:

- **Do not proxy the Resend CNAME records through Cloudflare.** Verification
  cannot complete behind an orange cloud. The records must be DNS-only.
- **The Shiprocket callback URL must not contain `shiprocket`, `kartrocket`,
  `sr` or `kr`.** The canonical path `/webhooks/carrier/track` contains none
  of them; the provider rejects a URL that does.

### 6.1 API — Render or Railway

| Setting           | Value                                          |
| ----------------- | ---------------------------------------------- |
| Root directory    | `apps/api`                                     |
| Build command     | `pnpm install --frozen-lockfile && pnpm build` |
| Start command     | `node dist/server.js`                          |
| Health check path | `/health/ready`                                |
| Node version      | 22.x                                           |

Environment variables are set in the platform dashboard. `MONGODB_URI`, `SESSION_SECRET` and `RAZORPAY_KEY_SECRET` are marked secret and are never echoed into build logs.

### 6.2 Storefront and admin — Vercel

| Setting          | Storefront        | Admin         |
| ---------------- | ----------------- | ------------- |
| Root directory   | `apps/storefront` | `apps/admin`  |
| Framework preset | Next.js           | Next.js       |
| Build command    | `pnpm build`      | `pnpm build`  |
| Health path      | `/api/health`     | `/api/health` |

Configure **three separate projects** (production, staging, preview) per app so each environment gets its own env vars and its own database target. Do not reuse a single project with a runtime mode switch — that is exactly the pattern the environment layer exists to prevent.

`output: 'standalone'` is not configured in `next.config.ts`. Add it before deploying to a platform that runs `node server.js` directly (Render, Railway, Fly, a VM). Vercel does not need it.

### 6.3 Media assets — the real deployment problem

`public/products/` is ~501 MB of LFS-tracked originals. Three options, in increasing order of preference:

1. **Ship `public/` with the app.** Simple, but every deployment uploads ~501 MB. Acceptable for the first deploy only.
2. **Object storage** (S3 / Cloudflare R2). Upload the originals once, keep filenames byte-identical, and point `NEXT_PUBLIC_MEDIA_BASE_URL` at the bucket origin. Filenames must not change, or the paths recorded in MongoDB stop resolving.
3. **Image CDN on top of (2)** for resizing and format negotiation.

Option 2 is the right long-term answer and directly enables responsive image delivery on mobile. **Not yet implemented** — no upload script, no bucket, no CDN. The data model stores image URLs relative to `public/`, so the migration is a base-URL change plus an asset copy, not a re-export.

### 6.4 Production readiness status

Reviewed **25 Oct 2026** against the code as it stands, after the Phase 2–10
work (Resend email, Shiprocket shipping, security and commercial audit,
end-to-end testing, environment design and the production-readiness gates).

"Closed" means verified by an automated test in this repository, not by a
manual inspection. "Open" means a real gap remains.

| Gap                                          | Status       | Evidence                                                                    |
| -------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| Catalogue not imported into MongoDB          | **Open**     | 0 stock across 674 variants; images unverified. See §0.1.                   |
| Admin API unauthenticated                    | **Closed**   | `authorization.test.ts`; `/health/ready` + live 401 probe.                  |
| No payment integration                       | **Closed**   | Razorpay create/verify/webhook/refund. Test-key only; **not live**.         |
| No shipping integration                      | **Closed**   | Shiprocket adapter + tracking webhook. **Not enabled on an account.**       |
| No transactional email                       | **Closed**   | Resend outbox with dedupe. **Domain not verified.**                         |
| No per-route rate-limit tuning               | **Closed**   | Eight per-route budgets in `apiEnvSchema`.                                  |
| Silent index-build failures                  | **Closed**   | Boot gate provisions every index and refuses to start without it. See §6.5. |
| Webhook schema rejected valid captures       | **Closed**   | `payment.test.ts` "razorpay documented payload shape".                      |
| A failed refund marked the payment failed    | **Closed**   | `payment.test.ts` "refund.failed event as a refund problem".                |
| Unbounded admin list queries                 | **Closed**   | `authorization.test.ts`; 400 on `limit=999999`.                             |
| **Route index omitted the payment surface**  | **Closed**   | `route-index.test.ts`; `/health` now lists every mounted group.             |
| **Env inventory drifted from the schemas**   | **Closed**   | `pnpm env:check` — 18 checks; `IMPORT_APPLY_TEMPLATE_STOCK` was missing.    |
| **A configured-but-unverifiable gateway**    | **Closed**   | `readiness-check.mjs` fails on `configured && !webhooksEnabled`.            |
| Dev admin credential in the repo             | **Open**     | Rotate before any shared environment. See §5.4.                             |
| No error monitoring (Sentry or similar)      | **Open**     | Medium.                                                                     |
| No CDN for ~500 MB of imagery                | **Open**     | Medium. See §6.3.                                                           |
| No controlled index migration                | **Resolved** | `pnpm indexes:check` / `indexes:reconcile`. See §6.5.                       |
| MongoDB TLS not pinned in the driver options | **Open**     | Atlas negotiates TLS automatically; pinning is explicit but not required.   |
| No API docs served at runtime                | **Open**     | Low.                                                                        |
| **No staging environment built yet**         | **Open**     | Nothing has been deployed. See §6.0 and §10.                                |
| **No production environment built yet**      | **Open**     | Nothing has been deployed. See §6.0 and §10.                                |
| **Catalogue stock is zero**                  | **Open**     | 0 of 674 SKUs. Blocks launch regardless of the code. See §0.1.              |
| **Provider accounts not provisioned**        | **Open**     | Razorpay live, Resend domain, Shiprocket API user. See §9.6.1.              |
| **Social sign-in credentials not issued**    | **Open**     | Code and UI are complete; the Google/Facebook client pairs are not. Absent pairs simply mean no button. See §9.6.1. |

### 6.4.1 The Phase 4 security and commercial audit — what was checked

Each row is a property that was **exercised**, not merely read.

| Property                                                            | How it was verified                                                    | Result |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| The Razorpay webhook signature is computed over the **raw** body    | `payment.test.ts` — a re-serialised body must fail verification        | Pass   |
| The webhook payload shape is Razorpay's documented one              | `payment.test.ts` — `entity: "event"`, `contains: ["payment"]`         | Pass   |
| The payment fields are read from `payload.payment.entity.*`         | `payment.test.ts` — the documented nesting                             | Pass   |
| A redelivered webhook cannot settle an order twice                  | `payment.test.ts` — the same event id twice                            | Pass   |
| A late `payment.failed` cannot undo a `payment.captured`            | `payment.test.ts` — out-of-order delivery                              | Pass   |
| A captured amount that disagrees with the order is not applied      | `payment.test.ts` — amount mismatch                                    | Pass   |
| A `refund.failed` event does **not** fail the payment               | `payment.test.ts` — refund failure is a refund problem                 | Pass   |
| A return approval is not a refund                                   | `refund.service.ts` — only a provider `processed` settles a refund     | Pass   |
| A refund cannot exceed the remaining refundable balance             | `refund.service.ts` — rejected, never silently clamped                 | Pass   |
| A refund request is idempotent across retries                       | `refund.service.ts` — stable `X-Refund-Idempotency`                    | Pass   |
| Stock is restored exactly once per refunded return                  | `refund.service.ts` — `stockRestoredAt` conditional claim              | Pass   |
| Email delivery never runs inline on the money path                  | `notification.service.ts` — the outbox records, a dispatcher delivers  | Pass   |
| A duplicate email is recorded, not sent twice                       | `email.test.ts` — unique `(template, idempotencyKey)`                  | Pass   |
| A non-allowlisted recipient is recorded as `skipped`, not delivered | `email.test.ts` — outside production                                   | Pass   |
| A failed email never rolls back a payment                           | `notification.service.ts` — delivery failures are data, not exceptions | Pass   |
| A password-reset link is never re-rendered from stored state        | `notification.service.ts` — excluded from `reRender`                   | Pass   |
| The Shiprocket callback URL contains no forbidden substring         | `shipping.test.ts` — no `shiprocket`/`kartrocket`/`sr`/`kr`            | Pass   |
| The tracking webhook rejects a delivery with the wrong key          | `shipping.test.ts` — `x-api-key` comparison is constant-time           | Pass   |
| The tracking webhook answers only HTTP 200                          | `shipping.test.ts` — the provider retries anything else                | Pass   |
| A delivered shipment is never moved backwards by a late scan        | `shipping.test.ts` — monotonic transitions                             | Pass   |
| A customer can read only their own shipment                         | `shipping.test.ts` — ownership checked server-side                     | Pass   |
| Only `owner`/`admin`/`manager` may dispatch a parcel                | `shipping.routes.ts` — `requirePermission` on the write routes         | Pass   |
| The admin surface is not open                                       | `authorization.test.ts`; live 401 probe on every admin group           | Pass   |
| The published route index lists every mounted group                 | `route-index.test.ts` — the index is checked against the routes        | Pass   |

Two findings were **fixed** during this phase, both in code rather than
configuration:

1. **The `/health` route index omitted the payment, shipping, refund and
   webhook route groups.** A caller reading the published index would have
   concluded those endpoints did not exist. Fixed, and pinned by
   `route-index.test.ts` against the actual mounted routers.
2. **`IMPORT_APPLY_TEMPLATE_STOCK` was in the importer schema but in
   neither the committed template nor the documentation.** An operator
   following the template had no way to know the variable existed — and it
   is the one switch that could write stock from a marketplace export. Fixed
   in `apps/api/.env.example`, and `pnpm env:check` now prevents the
   recurrence.

### 6.5 Index provisioning — a hard boot requirement

`connectToDatabase()` builds every model's indexes and **refuses to start**
if any fails. This exists because of a defect that was invisible for months.

Mongoose's `autoIndex` starts building indexes in the background and does not
wait for them. Worse, **a unique index that fails to build is not an error** —
writes still succeed, they simply stop being deduplicated. The server boots,
health checks pass, and the guarantee is quietly absent.

Five index definitions were found to have never created their index in any
environment:

| Collection   | Index                               | What it actually protected                                                                                            |
| ------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `shipments`  | `orderId` partial unique            | One live shipment per order — twice named `orderId_1`, and it used `$nin`, which MongoDB rejects in a partial filter. |
| `carts`      | `customerId` unique, sparse         | One cart per signed-in customer.                                                                                      |
| `carts`      | `sessionId` unique, sparse          | One cart per guest session.                                                                                           |
| `payments`   | `idempotencyKey` unique, partial    | One payment record per client retry.                                                                                  |
| `email_logs` | `(template, idempotencyKey)` unique | Exactly one transactional email per logical event.                                                                    |

Four were name collisions (two `schema.index()` calls auto-generating the
same name) and one was a `$nin` in a `partialFilterExpression`, which
MongoDB rewrites to `$not` and then rejects. All four failed silently under
`autoIndex`.

Two consequences for deployment:

1. **The database user needs index-creation rights.** A user limited to
   `readWrite` now fails the boot gate with an explicit message instead of
   starting a store that silently accepts duplicates.
2. **An existing environment may already hold stale indexes.** Reconcile
   before the first deploy to an environment that was created before this
   fix:

```bash
# Read-only report. Exits non-zero-free; safe on any environment.
pnpm --filter @ajooba/api indexes:check

# Applies only what is provably safe: it refuses to drop an index when
# existing documents would violate the new constraint.
pnpm --filter @ajooba/api indexes:reconcile
```

The script refuses to run against a database whose name looks like
production unless `--force-production` is also passed, and it always proves
no existing document violates the new uniqueness before dropping anything.

---

## 7. Rollback

| Change type           | Procedure                                                                         |
| --------------------- | --------------------------------------------------------------------------------- |
| API code              | Redeploy the previous Render/Railway commit. Stateless — no migration to reverse. |
| Storefront/admin code | Vercel instant rollback via **Deployments → Promote to Production**.              |
| Catalogue data        | Restore the database from the Atlas snapshot taken before the import.             |
| Environment variables | Update in the dashboard, then redeploy. All three apps read env at boot.          |

**Never** roll back by deleting products in the admin panel to "undo" an import — use the Atlas point-in-time restore. It is the only way to guarantee consistency across `products` and `variants`.

---

## 8. Operational notes

### 8.1 Logging

The API emits one Pino JSON object per request. In production set `LOG_LEVEL=info`; use `debug` locally only. `MONGODB_URI`, `SESSION_SECRET` and `RAZORPAY_KEY_SECRET` are in the redact list and never appear in a log line.

### 8.2 Database indices

Indexes are declared in the Mongoose schemas (`apps/api/src/models/*.model.ts`)
and are provisioned **by the application itself** at connection time —
`connectToDatabase()` awaits `Model.init()` for every registered model and
**refuses to start** if any fails.

This replaced a design where `autoIndex` did the work implicitly, which was
unsafe: `autoIndex` is fire-and-forget, and a unique index that fails to
build produces no error at all — the process starts and simply stops
deduplicating. Five indexes had never been created as a result. See §6.5.

Two things follow:

- **The database user must be able to create indexes.** A user limited to
  `readWrite` now fails the boot gate with an explicit message.
- **`NODE_ENV=production` disables `autoIndex`** (as it always did), which
  is why the explicit `ensureIndexes` step is load-bearing rather than
  redundant.

Before the first deploy to an environment created before 23 Oct 2026, run
`pnpm --filter @ajooba/api indexes:check`, then `indexes:reconcile` if it
reports conflicts.

An automatic index build against a large collection can lock it. On a
production cluster with real data, run `indexes:reconcile` during a
maintenance window rather than at first boot.

### 8.3 Source asset protection

`public/` is treated as read-only input. The operating rules:

1. Never delete, rename, move, overwrite or regenerate a file under `public/`.
2. New derived assets (thumbnails, WebP variants) go to a **new** directory, never on top of originals.
3. `.gitattributes` keeps originals in LFS; `git lfs ls-files` should list every source image and workbook.
4. If an asset looks wrong, fix the _database record_, not the file.

### 8.4 Currency and time

The source workbook contains bare integers with no currency column. The platform is INR-only, but nothing in the API response states that, so it is tracked as Q-3 in `docs/API_CONTRACT.md`. All timestamps are stored in UTC and serialised as ISO-8601 strings.

---

## 9. Troubleshooting

| Symptom                                                  | Cause                                                      | Fix                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API exits at boot with a Zod error naming a variable     | Missing/malformed env var                                  | Compare your `.env` against the table in §3.3 and `apps/api/.env.example`                                                                                                                                                                                  |
| `/health/ready` returns 503                              | MongoDB unreachable                                        | Check `MONGODB_URI`, the Atlas IP access list, and that the cluster is not paused                                                                                                                                                                          |
| `pnpm install` fails with `ERR_PNPM_OUTDATED_LOCKFILE`   | `package.json` and lockfile drift                          | Run `pnpm install` and commit the updated `pnpm-lock.yaml`                                                                                                                                                                                                 |
| Product images 404                                       | Filenames changed, or `NEXT_PUBLIC_MEDIA_BASE_URL` wrong   | Filenames must be byte-identical to the originals. Check the media base URL                                                                                                                                                                                |
| `public/` is a few KB after clone                        | Git LFS pointers, not real files                           | `git lfs install && git lfs pull`                                                                                                                                                                                                                          |
| `Module '@ajooba/contracts' not found`                   | Workspace not linked                                       | `pnpm install` at the **root**, not inside a single app                                                                                                                                                                                                    |
| Port already in use                                      | Another dev server is running                              | Change `PORT`, or stop the other process                                                                                                                                                                                                                   |
| Storefront shows the empty state but the DB has products | API unreachable from the Next server                       | Check `API_INTERNAL_URL` — it is the server-side URL and must be reachable from the Next process                                                                                                                                                           |
| ESLint reports "not found by the project service"        | A file was added outside the tsconfig `include`            | Add the file to the package's `tsconfig.json` include list, or to `allowDefaultProject` in `eslint.config.js`                                                                                                                                              |
| An import or script writes to the **wrong database**     | An ambient environment variable is overriding `.env.local` | `dotenv` does **not** override variables already set in the shell. Check `echo $env:MONGODB_DB` and `echo $env:NODE_ENV` — if `NODE_ENV` is not `development`, `apps/api` reads `.env` instead of `.env.local`. Clear the ambient variables for that shell |
| `pnpm mcp:verify` fails to authenticate                  | The `ajooba_mcp` user was dropped or its password rotated  | Re-run `pnpm mcp:setup`, then restart Cursor so the MCP server reloads `.env.mcp`                                                                                                                                                                          |

---

## 9.5 Catalogue import approval procedure (G-6)

**No catalogue import was executed as part of the G-6 work.** The workflow was
built and exercised entirely against the throwaway in-memory test database.
`ajooba_development` was never written to.

The source workbook is on a developer's `C:` drive. **No deployment target can
read it**, so the import endpoint accepts the extract as an **uploaded payload**,
never as a filesystem path, and runs no command.

| Step | Call                                                                                     | Operator must confirm                                        |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1    | `POST /v1/admin/catalog/imports` with `{ payload, sourceFilename }`                      | `targetDatabase` is the environment you intend               |
| 2    | Read the plan                                                                            | `designsToCreate` vs `designsToUpdate` match the intent      |
| 3    | Read `findings`                                                                          | every `quarantine` / `reject` row is understood and accepted |
| 4    | `POST /v1/admin/catalog/imports/:planId/apply` with `{ payloadChecksum, confirm: true }` | the checksum is copied **from the plan**, not assumed        |
| 5    | `GET /v1/admin/catalog/imports/:planId`                                                  | `status: 'applied'`; the audit entry names you               |

Guarantees, each covered by a test:

- **The dry run writes nothing** to `products` or `variants`.
- **The checksum must match.** If the file changes between the dry run and the
  approval, the approved report no longer describes what would be written and
  the apply is refused.
- **A plan cannot be applied twice.** Re-planning the same file yields the same
  checksum, so a retry after a partial failure creates no duplicates.
- **Ambiguous rows are quarantined, never applied.** A duplicate design code, a
  duplicate SKU, a missing category, unusable pricing or an image row without a
  `sourceFile` is excluded and reported.
- **Import never sets stock.** Every imported SKU is written at `stock: 0`,
  `inStock: false`, `photographyStatus: 'pending-review'`.
- **History is preserved.** Orders, payments, customers and audit logs are
  untouched by an import.

### 9.5.1 Permissions

| Role           | `catalog:read` | `catalog:write` | `inventory:write` | `import:run` |
| -------------- | -------------- | --------------- | ----------------- | ------------ |
| owner          | yes            | yes             | yes               | yes          |
| admin          | yes            | yes             | yes               | yes          |
| manager        | yes            | yes             | **no**            | **no**       |
| support        | yes            | no              | no                | no           |
| content-editor | yes            | **no**          | no                | no           |

A manager may edit the catalogue but **cannot** import into it or set stock.

---

## 9.6 Go-live verification

Run this before pointing real traffic at a deployment. It is read-only and
moves no money, sends no email and books no parcel.

```bash
pnpm --filter @ajooba/contracts build
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

pnpm env:check                                        # local, no network
pnpm readiness https://staging-api.yourdomain.com    # against a live origin
```

`scripts/readiness-check.mjs` exits non-zero when a blocking gate fails, so
it works as a CI deploy gate. It checks:

| Gate                           | Blocking | What a failure means                                                   |
| ------------------------------ | -------- | ---------------------------------------------------------------------- |
| HTTPS                          | yes      | Cookies and bearer tokens cross the wire in the clear.                 |
| `/health/ready` 200            | yes      | The database is unreachable, or its indexes are not provisioned.       |
| Unsigned webhook → 4xx         | yes      | Either the secret is unset (503) or verification is not running (200). |
| `/v1/admin/*` → 401/403        | yes      | The admin surface is open.                                             |
| Payments configured            | warn     | Payments are switched off; checkout refuses a card.                    |
| **Webhooks enabled**           | yes      | The gateway would take money with no way to confirm it.                |
| **Payment mode is `live`**     | warn     | Test mode cannot move real money.                                      |
| **Integration surfaces → 401** | yes      | The shipping/payment configuration surfaces are open.                  |
| `limit=999999` → 400           | no       | An unbounded list query is being served.                               |
| `x-request-id` present         | yes      | Logs and support tickets cannot be correlated.                         |
| `nosniff`, HSTS                | no       | Hardening, not correctness.                                            |
| Repository + scripts           | yes      | Documentation or the readiness gate itself is missing.                 |
| **Environment inventory**      | yes      | The templates, the schemas and `docs/ENVIRONMENT.md` disagree.         |

The single most important line is the unsigned-webhook probe, because it
needs no credentials:

```bash
curl -i -X POST https://api.yourdomain.com/webhooks/razorpay \
  -H 'Content-Type: application/json' \
  -d '{"entity":"event","event":"payment.captured","payload":{}}'
```

**A 400/401/403 is the correct answer and requires no setup.** A 200 means
signature verification is not running — treat that deployment as unsafe. A
503 means `RAZORPAY_WEBHOOK_SECRET` is unset and payments cannot be
confirmed at all.

### 9.6.0 The gate that matters most: configured _and_ verifiable

A deployment can be individually correct on every variable and still be
unable to confirm a payment. The dangerous state is:

```
configured: true          <- the gateway keys are present
webhooksEnabled: false    <- but no webhook secret
```

In that state the gateway would happily take a customer's money while **no
payment confirmation could ever be verified**. Every order would sit unpaid
forever, and the customer would have been charged. Nothing in the UI would
look wrong.

`scripts/readiness-check.mjs` fails on exactly that combination, and the
public configuration endpoint reports it without needing any credential:

```bash
curl -fsS https://api.yourdomain.com/v1/payments/configuration
```

| Field             | Required in production | Meaning if wrong                           |
| ----------------- | ---------------------- | ------------------------------------------ |
| `configured`      | `true`                 | The gateway keys are absent.               |
| `webhooksEnabled` | `true`                 | **Payments cannot be confirmed. Blocker.** |
| `mode`            | `live`                 | Test mode cannot move real money.          |
| `keyId`           | present                | Checkout cannot open.                      |

This endpoint is public by design — the storefront needs it to decide
whether to offer a card option — and it exposes only _whether_ the
integration is configured. It never returns a secret.

### 9.6.1 Manual provider setup — externally unverified

Everything below needs a provider account or DNS access and **has not been
performed**. Each step is stated so an operator can complete it exactly.

**Razorpay (production)**

1. Switch the dashboard to **Live mode**; copy the live `key_id` and
   `key_secret` into `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`.
2. Set `RAZORPAY_MODE=live`. Boot now fails unless all three Razorpay
   variables are present — that refusal is intentional.
3. Dashboard → **Settings → Webhooks** → add
   `https://api.yourdomain.com/webhooks/razorpay`.
4. Set a **secret** and copy it into `RAZORPAY_WEBHOOK_SECRET`. This is a
   _different_ secret from the key secret.
5. Subscribe to: `payment.authorized`, `payment.captured`, `payment.failed`,
   `refund.processed`, `refund.failed`.
6. Verify with a **test** card/`pay` in live mode, or use Razorpay's webhook
   tester, then confirm the `webhook_events` row and the order's
   `paymentStatus`.

**Resend (production)**

1. Resend dashboard → **Domains** → add the sending domain (a subdomain such
   as `mail.yourdomain.com` is preferable to the root).
2. Copy the **DKIM (TXT)** and **SPF (TXT/MX/CNAME)** records into DNS
   exactly as generated. If a CNAME is shown, **do not proxy it** through
   Cloudflare — verification cannot complete behind an orange cloud.
3. Wait for verification (typically ~15 minutes; DNS propagation can take up
   to 72 hours).
4. Add a **DMARC** record afterwards.
5. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL`; leave `EMAIL_ALLOWLIST`
   **unset**.

**Shiprocket (production)**

1. Create an API user under **Settings → API**; copy the email and password
   into `SHIPROCKET_API_EMAIL` / `SHIPROCKET_API_PASSWORD`.
2. Add the pickup location in the dashboard and set
   `SHIPROCKET_PICKUP_LOCATION` to that **exact** name — Shiprocket rejects
   an unknown location.
3. Set `SHIPROCKET_WEBHOOK_SECRET` to a shared secret.
4. Dashboard → **Settings → API → Webhooks** → add
   `https://api.yourdomain.com/webhooks/carrier/track`.
5. **The callback URL must not contain `shiprocket`, `kartrocket`, `sr` or
   `kr` anywhere in it.** Shiprocket's own documentation states this
   verbatim, and the provider rejects a URL containing any of them. The
   canonical path above contains none of them.

   > This is not a stylistic rule. The platform's obvious path,
   > `/webhooks/shiprocket`, contains `shiprocket` and **cannot be used**.
   > A legacy alias at `/webhooks/shiprocket` is still served for an
   > environment that was configured before the rule was applied, but the
   > canonical path is `/webhooks/carrier/track` and that is what every
   > document, the readiness probe and the dashboard must use.

6. Confirm the endpoint returns **only** HTTP 200.

**Google and Facebook sign-in (optional, production)**

Both are optional: an unconfigured pair means no button on the storefront,
never a broken one. Configure a pair only when the provider console is
reachable and the redirect URI can be registered exactly.

1. **Google Cloud Console** → *APIs & Services → Credentials* → **Create
   credentials → OAuth client ID → Web application**.
2. Add an **Authorized redirect URI** of exactly
   `https://api.yourdomain.com/v1/auth/oauth/google/callback`, and the
   matching `http://localhost:4000/...` URI for local work. A trailing slash,
   a different port or a different scheme is a provider-side rejection.
3. Copy the client id and client secret into `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET`.
4. **Meta for Developers** → your app → *Facebook Login → Settings* → add
   `https://api.yourdomain.com/v1/auth/oauth/facebook/callback` under
   **Valid OAuth Redirect URIs**.
5. Copy the app id and app secret into `FACEBOOK_OAUTH_APP_ID` /
   `FACEBOOK_OAUTH_APP_SECRET`.
6. Restart the API, then check `GET /v1/auth/providers` — the ids that come
   back are precisely the buttons the storefront will draw. If a provider is
   missing from that list, its pair is incomplete or was not read.
7. Sign in once with each provider against a **staging** origin and confirm
   the account was created with `passwordHash: ""`. An account created this
   way has no usable password and must never be given one silently.

> The `state` parameter is a signed, five-minute JWT bound to the provider,
> so a link minted for Google cannot be replayed at the Facebook callback.
> Do not add any `state` handling of your own on top of it.

**MongoDB Atlas (production)**

1. Create the cluster and the database user.
2. Grant it **`readWriteAnyDatabase`** or equivalent — it must be able to
   **create indexes**, or the boot gate in §6.5 will refuse to start.
3. Add the deployment platform's outbound IPs to the network access list.
4. Enable backups and point-in-time restore before go-live.

---

## 10. Where to look next

| Question                                | Document                                                |
| --------------------------------------- | ------------------------------------------------------- |
| What is actually in the catalogue?      | `docs/catalog-audit.md`, decisions D-1…D-8              |
| Why these technologies?                 | `docs/ARCHITECTURE.md` → Version Matrix                 |
| What shape is this endpoint?            | `docs/API_CONTRACT.md`, `docs/API_CONTRACT_GAPS.md` §12 |
| What fields does this collection have?  | `docs/DATA_MODEL.md`                                    |
| What does each environment variable do? | `docs/ENVIRONMENT.md`                                   |
| What does each provider actually send?  | `docs/PROVIDER_CONTRACTS.md`                            |
| What is still blocking launch?          | `DEPLOYMENT_RUNBOOK.md` §0.1                            |
| Anything not in those documents         | It does not exist yet. Do not assume it does.           |
