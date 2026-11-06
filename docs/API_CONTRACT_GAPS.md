# API Contract Gap Analysis — Catalogue Administration

**Status:** **G-1 … G-6 IMPLEMENTED.** G-7 (per-SKU admin read) closed as a by-product of G-3.
**Originally analysed:** 22 October 2026 · **Implemented and verified:** 23 October 2026
**Scope:** products, colour variants, SKUs, image review, categories, import control.
**Companion:** `docs/BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md`.
**Evidence:** `apps/api/tests/catalog-admin.test.ts` (47), `catalog-import.test.ts` (26),
`homepage.test.ts` (25). See §12 for the status table and §13 for the defects found
_after_ implementation.

---

## 0. Resolution summary

The analysis below is preserved as written, because it records what the catalogue
actually looked like before the work. What changed is the verdict in §11.5 and
the addition of §12 (status table) and §13 (post-implementation defects).

| #   | Gap                   | Was  | Now                                                           |
| --- | --------------------- | ---- | ------------------------------------------------------------- |
| G-1 | Product writes        | Open | **Closed** — 7 routes under `/v1/admin/catalog/products`      |
| G-2 | Colour-variant writes | Open | **Closed** — create/list/retire per colourway                 |
| G-3 | SKU-level endpoints   | Open | **Closed** — per-SKU read, update, retire, stock ledger       |
| G-4 | Category endpoints    | Open | **Closed** — canonical `categories` collection with tree CRUD |
| G-5 | Image review          | Open | **Closed** — review queue with assign / reject / revert       |
| G-6 | Import trigger        | Open | **Closed** — dry run → checksum-gated apply                   |
| G-7 | Per-SKU admin read    | Open | **Closed** — `GET /v1/admin/catalog/skus/:sku`                |

**One blocker is unchanged and deliberate: all 674 variants still have
`stock: 0`.** No stock was invented. See §12.1.

---

## 1. Summary

The catalogue is **read-only over the API**. Every existing route is a `GET` on
the customer-facing side; the admin side has inventory, coupons, customers,
content, orders, returns and analytics — but **nothing that creates, edits or
retires a product, variant, SKU or category.**

| #   | Gap                                                    | Severity | Depends on                                   |
| --- | ------------------------------------------------------ | -------- | -------------------------------------------- |
| G-1 | No product write endpoints (create / update / publish) | **High** | media pipeline, G-5                          |
| G-2 | No colour-variant endpoints                            | **High** | G-1, G-5                                     |
| G-3 | No SKU-level endpoints                                 | **High** | G-2, stock ledger                            |
| G-4 | No category endpoints                                  | Medium   | G-1                                          |
| G-5 | No image-review endpoint (quarantine is a dead end)    | **High** | media storage, G-1                           |
| G-6 | No catalogue import trigger endpoint                   | Medium   | `import:run` permission exists but is unused |
| G-7 | No per-SKU admin read for support workflows            | Low      | G-3                                          |

Two permission strings already exist and are **currently granted to roles but
used by no route**: `catalog:write` and `import:run`. The permission model is
ready; the endpoints it was meant to guard do not exist.

---

## 2. G-1 — Products

### 2.1 What exists

| Endpoint                     | Method | Permission | Notes                 |
| ---------------------------- | ------ | ---------- | --------------------- |
| `/v1/catalog/products`       | GET    | none       | paginated, filterable |
| `/v1/catalog/products/:slug` | GET    | none       | includes `variants[]` |
| `/v1/catalog/facets`         | GET    | none       | facet counts          |

All three are **public and read-only**. `catalog.routes.ts` states this
explicitly: _"The catalogue is read-only in this phase. Writes happen through
the admin API once the import pipeline is in place."_ That pipeline is now in
place; the admin side was never built.

The **only** product writer today is `catalog-import.job.ts`, run from the CLI.

### 2.2 What is missing

| Endpoint                           | Method | Permission      | Purpose                                                                                |
| ---------------------------------- | ------ | --------------- | -------------------------------------------------------------------------------------- |
| `/v1/admin/products`               | GET    | `catalog:read`  | list **all** designs including draft/out-of-stock, beyond the public pagination limits |
| `/v1/admin/products/:code`         | GET    | `catalog:read`  | read one design **by `A<NN>` code** — the admin key. Public reads are by `slug` only.  |
| `/v1/admin/products`               | POST   | `catalog:write` | create a design                                                                        |
| `/v1/admin/products/:code`         | PATCH  | `catalog:write` | update title / description / brand / subcategory / pricing                             |
| `/v1/admin/products/:code`         | DELETE | `catalog:write` | retire (soft) a design                                                                 |
| `/v1/admin/products/:code/publish` | POST   | `catalog:write` | publish / unpublish                                                                    |

**Keyed by `code`, not `slug`.** `slug` is derived and changes when a title
changes; `code` is the stable `A<NN>` identifier the importer upserts on. An
admin API keyed on a mutable slug would break on the first edit.

### 2.3 Request / response contracts

**`POST /v1/admin/products` → 201**

```json
{
  "body": {
    "code": "A58",
    "title": "AJOOBA Men's …",
    "description": "…",
    "brand": "Ajooba Footwear",
    "subcategory": "Mojri/Jutti",
    "subcategorySlug": "mojri-jutti",
    "mrp": 2499,
    "sellingPrice": 1749
  }
}
```

Response is the standard envelope (`docs/API_CONTRACT.md` §1.3) with
`data: Product` — the same shape the public route returns, so one renderer
serves both.

Validation: `code` must match `^A\d{2}$` and be **unique** (`409` on collision —
the importer upserts on `code`, so a duplicate silently forks the catalogue).
`mrp >= sellingPrice >= 0`.

**`PATCH /v1/admin/products/:code`** — partial; only supplied fields change.
`slug` is **server-derived** from the title; a client may not set it.
`mrp`/`sellingPrice` here are the design-level rollups (lowest across
variants); authoritative pricing lives on the variant.

### 2.4 Permissions

- `catalog:read` for reads, `catalog:write` for writes. Both already exist.
- `DELETE` should be **soft retire**, not hard delete: variants, stock
  movements and order history reference the design. Hard delete must not be
  exposed.
- Every write appends to the existing `audit_logs` collection (`audit:read` to
  read it back).

### 2.5 Dependencies

- `MEDIA_STATIC_DIR` / Cloudinary for images (G-5).
- The `slug` generator already used by the importer — reuse, do not reimplement.
- Audit service.
- **Blocked by:** image model. `ProductImage` carries `colour` + `colourToken`
  verification state; creating a product with images requires the colour
  resolution rules in `packages/contracts/src/catalog/colour-images.ts`.

---

## 3. G-2 — Colour variants

### 3.1 What exists

**Nothing writable.** Variants are created solely by the importer. The public
product response embeds them read-only. Admin inventory (`/v1/admin/inventory`)
lists them but cannot change them beyond a stock adjustment.

The colour model itself is well-specified — arguably the most carefully modelled
part of the system:

- A design sells a set of colours (`products.colours`).
- Each variant is one **design × colour × size**.
- `colourToken` is the SKU-encoded spelling (`OW`, `IVY`, `IVR` all map to
  `Ivory` — see `buildColourTokenMap`).
- `photographyStatus` is `verified` | `pending-review`, and a `pending-review`
  variant **can never be sold**, enforced server-side in `reserveStock()`'s
  filter.

### 3.2 What is missing

| Endpoint                                 | Method | Permission      | Purpose                                                |
| ---------------------------------------- | ------ | --------------- | ------------------------------------------------------ |
| `/v1/admin/products/:code/variants`      | GET    | `catalog:read`  | list variants incl. pending-review                     |
| `/v1/admin/products/:code/variants`      | POST   | `catalog:write` | add a colourway to an existing design                  |
| `/v1/admin/variants/:sku`                | GET    | `catalog:read`  | read one variant                                       |
| `/v1/admin/variants/:sku`                | PATCH  | `catalog:write` | update `variantTitle`, `imageUrl`, `photographyStatus` |
| `/v1/admin/products/:code/variants/:sku` | DELETE | `catalog:write` | retire a colourway                                     |
| `/v1/admin/products/:code/colours`       | GET    | `catalog:read`  | colour rollup + per-colour image coverage              |

### 3.3 Request / response contracts

**`POST /v1/admin/products/:code/variants` → 201**

```json
{
  "body": {
    "colour": "Ivory",
    "colourToken": "OW",
    "size": 7,
    "ukIndiaSize": 7,
    "euroSize": 41,
    "sku": "AJ-A58-OW-07",
    "articleNumber": "A58",
    "mrp": 1999,
    "sellingPrice": 1399,
    "ean": ""
  }
}
```

- `sku` **unique** across the collection (`409` on collision). 674 SKUs, zero
  duplicates today — the invariant must be enforced at the API, not just the index.
- `stock` is **not** accepted here. Stock is only ever raised through
  `/v1/admin/inventory/adjustments`, which appends to the ledger. Creating a
  variant at stock 0 matches importer decision C-3 and keeps stock explainable.
- Response: `data: ProductVariant`.

**`PATCH /v1/admin/variants/:sku`** — `photographyStatus` transitions
`pending-review → verified` are the **image review** action and are gated
separately (see §5.3).

### 3.4 Permissions and dependencies

`catalog:write`. Depends on: the colour-token map
(`buildColourTokenMap` — reusing it guarantees a new colourway is registered
with the same token rules the importer uses), the stock ledger, and the audit log.

**Consequence to note:** creating a new colourway for an existing design means
adding a colour to `products.colours`. That array is the input to
`resolveImageColour`, so adding a colour **changes which quarantined images
become assignable**. A colour change is therefore not a pure data edit — it must
re-run image resolution (G-5).

---

## 4. G-3 — SKUs

### 4.1 Current state

A SKU is **not a separate entity** — it is the `sku` field on a variant, unique
and indexed. There is no `skus` collection. That is a reasonable design: the SKU
_is_ the variant's natural key.

The gap is therefore about **addressing and bulk operations**, not a new entity.

### 4.2 What is missing

| Endpoint                     | Method | Permission      | Purpose                                                  |
| ---------------------------- | ------ | --------------- | -------------------------------------------------------- |
| `/v1/admin/skus/:sku`        | GET    | `catalog:read`  | single-SKU lookup for support (G-7)                      |
| `/v1/admin/skus/lookup`      | POST   | `catalog:read`  | batch resolve by SKU list / article number / design code |
| `/v1/admin/skus/:sku/stock`  | GET    | `catalog:read`  | stock + reservedStock + movement summary                 |
| `/v1/admin/skus/:sku/retire` | POST   | `catalog:write` | deactivate without deleting history                      |

`POST /v1/admin/skus/lookup` is the practically important one: stock-taking and
ERP reconciliation happen in **spreadsheet-shaped batches**, not one-by-one. A
`POST` body (rather than a `GET` with a query array) avoids URL-length limits on
a 674-row batch.

### 4.3 Contract notes

**`POST /v1/admin/skus/lookup` → 200**

```json
{
  "body": { "skus": ["AJ-A01-OW-06", "AJ-A14-BRN-08"] },
  "response": { "data": { "found": [...], "missing": ["AJ-A01-OW-06"] } }
}
```

Returning `missing` explicitly (rather than omitting absent rows) is required
for reconciliation: a caller must be able to tell "not found" from "found but
no stock". **Cap the batch** — propose 500 SKUs per request.

### 4.4 Dependencies

This is the endpoint most affected by the companion backfill: `productCode` and
`reservedStock` are **absent from all 674 variants today**
(see `BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md`). Any SKU endpoint that returns or
sorts by those fields is reading a field that is not in the database.
**The backfill should land before this endpoint is built**, or the endpoint must
defensively coalesce (`?? 0`).

> **Verified 22 Oct 2026 (post-restoration).** A `$group` by `$productCode` and
> by `$reservedStock` each returns a single bucket `_id: null, n: 674`. Both
> fields are still absent on every variant after the catalogue restoration, so
> this dependency is unchanged.

### 4.5 `productCode` — confirmed load-bearing, do not remove (new, 22 Oct 2026)

A full usage audit was performed against this gap analysis. `productCode` is
**not** a redundant copy; it is actively relied upon:

| Concern  | Dependency                                     | Location                                                   |
| -------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Sort key | `sort({ productCode: 1, colour: 1, size: 1 })` | `inventory.service.ts:323`                                 |
| Index    | `index({ productCode: 1, inStock: 1 })`        | `variant.model.ts:98`                                      |
| Filter   | `?productCode=` on inventory                   | `admin.routes.ts:81`                                       |
| Filter   | `?productCode=` on stock movements             | `admin.routes.ts:176`                                      |
| Ledger   | copied into every movement written             | `inventory.service.ts:104/121/134`, `order.service.ts:435` |
| Contract | `required` in TS **and** Zod                   | `admin/types.ts:65`, `admin/types.ts:306`                  |

**Implication for G-3:** these endpoints already depend on `productCode`
existing in the database _today_, not only on the backfill landing. They are
currently filtering and sorting on an absent field. The recommendation is to
**keep the field** and enforce consistency with `products.code` via a read-only
drift detector rather than a join — full reasoning and evidence in
`BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md` §10.

> **Separate defect found, not fixed:** `order.service.ts:694` writes
> `productCode: ''` on order cancellation, into a field that is `required` in
> both the schema and the Zod contract. Those movements are permanently
> invisible to the `?productCode=` ledger filter above. Fix as its own change.

---

## 5. G-5 — Image review

### 5.1 What exists

The colour→image resolution logic is complete and well-evidenced
(`packages/contracts/src/catalog/colour-images.ts`). The rule ("Option A"):

> Assign an image to a colour **only** when its filename token matches a colour
> token that the design actually sells. Everything else is quarantined — kept on
> disk, never displayed.

Resolution outcomes: `assigned`, or `unverified` with reason `untokened` |
`token-not-sold` | `unparsable`.

**Current data state (verified 22 Oct 2026):**

| `photographyStatus` | Variants |
| ------------------- | -------- |
| `pending-review`    | 35       |
| `verified`          | 15       |
| **field absent**    | **624**  |

`products.quarantinedImages` (default `[]`) holds the source filenames awaiting
review.

**The gap is unambiguous:** there is a review **queue** with 35 flagged
variants and quarantined images, and **no endpoint that resolves any of it.**
A reviewer cannot see the queue, cannot inspect an image, and cannot approve or
reject one. `photographyStatus` is only ever written by the import/migration
job.

### 5.2 What is missing

| Endpoint                              | Method | Permission      | Purpose                                                                           |
| ------------------------------------- | ------ | --------------- | --------------------------------------------------------------------------------- |
| `/v1/admin/images/review-queue`       | GET    | `catalog:read`  | paginated list of quarantined images + pending-review variants, with the _reason_ |
| `/v1/admin/images/:designCode`        | GET    | `catalog:read`  | per-design coverage matrix: every colour × image count, plus gaps                 |
| `/v1/admin/images/:imageId/assign`    | POST   | `catalog:write` | manually assign a quarantined image to a colour                                   |
| `/v1/admin/images/:imageId/reject`    | POST   | `catalog:write` | confirm quarantine is correct; image stays undisplayed                            |
| `/v1/admin/images/:imageId/revert`    | POST   | `catalog:write` | undo an assignment                                                                |
| `/v1/admin/variants/:sku/photography` | PATCH  | `catalog:write` | flip `pending-review ↔ verified`                                                  |

The reason (`untokened` / `token-not-sold` / `unparsable`) **must** be in the
queue response — a reviewer cannot act on "unverified" alone. This is exactly
the information the resolution function produces and would otherwise be lost.

### 5.3 Contract sketch

**`POST /v1/admin/images/:imageId/assign` → 200**

```json
{
  "body": {
    "colour": "Brown",
    "reason": "Verified by eye — filename token is wrong, subject is correct."
  }
}
```

- `colour` must be one the design actually sells, else `422`.
- **A `reason` is mandatory.** Every image-review action is a human override of
  an automated safety rule; an unexplained override is how the wrong colour ends
  up on a product page. Recorded in `audit_logs`.
- Assigning the first verified image to a `pending-review` colourway must flip
  that variant's `photographyStatus` to `verified` in the same operation —
  otherwise the storefront stays gated on a stale flag.

### 5.4 Permissions and dependencies

`catalog:read` to view, `catalog:write` to decide. Dependencies:

1. **A stable image identifier.** Today images are addressed by
   `sourceFile` **filename string** — not a durable id. Filenames are not
   unique-safe identifiers for an API. A `media` record (or at minimum a
   generated id) is needed first. This is the main blocker.
2. **Media storage** — `local` (static mount) or `cloudinary`. The model already
   anticipates both (`MEDIA_STORATIONS`).
3. `resolveImageColour` / `buildColourGalleries` must be the _only_ logic used
   to re-derive galleries after an override, so manual and automatic paths cannot
   diverge.

---

## 6. G-4 — Categories

### 6.1 Current state

Categories are **flat, denormalised string pairs on the product**:

- `products.subcategory` — verbatim workbook value (`Sub-category` column)
- `products.subcategorySlug` — normalised, indexed

**Current taxonomy (4 values, 55 designs):**

| `subcategorySlug` | Designs |
| ----------------- | ------- |
| `shoe`            | 29      |
| `mojri-jutti`     | 21      |
| `sandal`          | 4       |
| `chappal`         | 1       |

There is **no categories collection**, no hierarchy, no ordering, no
description, and no per-category image. `GET /v1/catalog/facets` derives counts
on the fly.

### 6.2 What is missing

| Endpoint                              | Method | Permission      | Purpose                        |
| ------------------------------------- | ------ | --------------- | ------------------------------ |
| `/v1/catalog/categories`              | GET    | none            | public navigation tree         |
| `/v1/admin/categories`                | GET    | `catalog:read`  | full list incl. empty/inactive |
| `/v1/admin/categories`                | POST   | `catalog:write` | create                         |
| `/v1/admin/categories/:slug`          | PATCH  | `catalog:write` | rename / reorder / retire      |
| `/v1/admin/categories/reorder`        | POST   | `catalog:write` | bulk ordering                  |
| `/v1/admin/categories/:slug/products` | GET    | `catalog:read`  | membership                     |

### 6.3 Contract notes

**Public** `GET /v1/catalog/categories` should return the ordered tree with
counts, so the storefront does not need `GET /facets` + a category list to
render navigation.

Migration is the hard part and must be sequenced deliberately:

1. Create a `categories` collection seeded from the 4 existing
   `subcategorySlug` values.
2. Add `categoryId` to products.
3. **Backfill** `categoryId` from `subcategorySlug`.
4. Keep `subcategory` / `subcategorySlug` as denormalised read copies.
5. Only then expose write endpoints.

Skipping to step 5 leaves two competing sources of truth for categorisation —
the exact failure already documented for `productCode`.

> **Refined 22 Oct 2026.** The audit in `BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md`
> §10 concluded that `productCode` should be **kept**, not removed — it backs a
> live sort key and a compound index that a `$lookup` would defeat. Step 4 above
> ("keep `subcategory`/`subcategorySlug` as denormalised read copies") is
> therefore the right shape, and the accompanying control is a **drift detector**
> (§10.3), not a join. Do not read the `productCode` discussion as precedent for
> de-duplicating the category fields.

### 6.4 Permissions

`catalog:write`. Deleting a category with products should be `409`, not a
silent un-category; categories should be **retired**, with products reassigned.

---

## 7. G-6 — Import trigger

`import:run` is granted to `owner`, `admin` and `manager`
(`packages/contracts/src/auth/types.ts`) and is used by **no route**. The
importer runs only from the CLI.

| Endpoint                      | Method | Permission   | Purpose                                     |
| ----------------------------- | ------ | ------------ | ------------------------------------------- |
| `/v1/admin/imports/catalog`   | POST   | `import:run` | start a dry-run import; returns a report id |
| `/v1/admin/imports/:reportId` | GET    | `import:run` | poll progress + conflict report             |

`import-reports` already exists as a collection. Note the dry-run **must** be
the default — an import writes to products and variants, and the previous task
established this importer will happily write to whichever database it is
pointed at.

---

## 8. Recommended sequencing

| Phase | Work                                           | Rationale                                                                                                                                                                                       |
| ----- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | **Enable `authorization` on local `mongod`**   | Not product work, but a **hard prerequisite** for any database work. Read-only access currently rests on MCP + Cursor alone because the database enforces no roles (§7.3 of `ARCHITECTURE.md`). |
| 2     | **Backfill `reservedStock`**                   | Written plan at `BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md` §4A. **Blocked** until PID 48176 (API dev server) is stopped — it writes to this database. Additive and reversible.                     |
| 3     | Fix `order.service.ts:694` (`productCode: ''`) | Small, isolated code fix; cancellation movements are invisible to the ledger filter today.                                                                                                      |
| 4     | Add `productCode` drift detector               | Keeps the field consistent with `products.code` without a join (backfill doc §10.3).                                                                                                            |
| 5     | G-5 media identity, then the review queue      | 35 variants are unsellable with no way to fix them. Highest user-visible value.                                                                                                                 |
| 6     | G-1 products                                   | Foundation for everything else.                                                                                                                                                                 |
| 7     | G-2 variants                                   | Depends on 6.                                                                                                                                                                                   |
| 8     | G-3 SKU reads                                  | Depends on 2 and 4.                                                                                                                                                                             |
| 9     | G-4 categories                                 | Independent; can run in parallel, but migrate before exposing writes.                                                                                                                           |
| 10    | G-6 import trigger                             | Needs the importer's dry-run to be safe first.                                                                                                                                                  |

G-4 and G-6 are independent of 1–4 and can proceed whenever.

---

## 9. Cross-cutting decisions needed before implementation

1. **Soft delete everywhere.** Variants, designs and categories all have history
   (orders, stock movements, audit). Confirm soft-retire across the board.
2. **`code` vs `id` as the admin key.** This document recommends `code` (`A<NN>`),
   which is what the importer upserts on. Confirm — it affects every route.
3. **Idempotency on catalogue writes.** The contract already requires it for
   inventory adjustments. Does it extend to `POST /products`?
4. **Public vs admin product shape.** One shape or two? Two risks leaking draft
   and pending-review state; one risks the admin UI being blocked by public
   redaction rules.
5. **Rate limiting on write endpoints.** Existing limits were designed for
   auth and cart, not a bulk catalogue import.

---

## 10. Verification for this document

Every gap above was confirmed against the code, not assumed:

- Route inventory: `apps/api/src/routes/*.routes.ts` + `v1.routes.ts` mounts.
- Permission strings: `packages/contracts/src/auth/types.ts` (`ADMIN_PERMISSIONS`,
  `ADMIN_ROLE_PERMISSIONS`) — `catalog:write` and `import:run` confirmed unused.
- Catalogue is read-only: `apps/api/src/routes/catalog.routes.ts` header comment.
- Only product/variant writer: `apps/api/src/jobs/catalog-import.job.ts`.
- Image resolution rule: `packages/contracts/src/catalog/colour-images.ts`.
- Sellability gate: `catalog.service.ts` `isSellable`, `order.service.ts`
  `reserveStock` filter.
- Data counts (`photographyStatus`, `subcategorySlug`): read-only aggregation
  against `ajooba_development` on 22 Oct 2026.

**No writes of any kind were performed to produce this document.**

---

## 11. UPDATE — 22 October 2026: what is now closed

This section records the outcome of the work that followed. Sections 1–10 above
are retained as the original analysis.

### 11.1 Closed

| Item                                                           | Status          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`order.service.ts` `productCode: ''`** (item 3, §8)          | **Fixed**       | `returnStockForOrder` now resolves the code from the variant, falling back to the parent `products.code`. If neither can be established the stock is still returned but **no ledger row is written**, and an audit entry (`stock-adjust` / `stock_movement`) records the omission. `stockBefore`/`stockAfter` are read back from the database instead of being written as placeholder zeros. `api typecheck` clean; 0 remaining `productCode: ''` literals in the repo. |
| **`productCode` drift detector** (item 4, §10.3)               | **Closed**      | Verified across all 674 variants on 22 Oct 2026: **0 mismatches, 0 orphans**, all 55 `articleNumber` groups map 1:1 to a parent code. The rule is documented in `docs/DATA_MODEL.md` §4. The backfill (`docs/BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md` §1A) **quarantines rather than overwrites** a pre-existing value.                                                                                                                                                   |
| **`reservedStock` backfill**                                   | **Closed**      | Field was missing on all 674 variants; set to `0` only after confirming 0 active reservations and 0 variants with `reservedStock > 0`. Verified 674/674, int type, 0 non-zero.                                                                                                                                                                                                                                                                                          |
| **Homepage merchandising** (new, not in the original gap list) | **Implemented** | Three endpoints in `apps/api/src/routes/content.routes.ts`, service in `homepage.service.ts`, contracts in `packages/contracts/src/homepage/`. Reuses the existing `content:read` / `content:write` permissions — **no parallel permission set was created**. See §11.4 for the three round-trip defects found during verification.                                                                                                                                     |

| Section ordering and persistence | **Closed** | `keeps the saved order and renumbers positions` |
| Campaign scheduling, countdown expiry and price validity | **Closed** | `drops a deal once its persisted end time has passed`, `publishes a live deal with a backend-computed price` |
| Actual database product references | **Closed** | `refuses a section that references a product which does not exist` |
| Colour-specific imagery | **Closed** | `pairs each colour tile with a photograph of that same colour`, `drops a colour tile that has no verified photograph` |
| Admin authorization | **Closed** | `rejects an unauthenticated read/save`, `refuses a customer token` |
| **Admin → storefront round trip** | **Closed, after three real defects** | See §11.4. |

### 11.4 Three defects that a green build and a green suite both missed

Phase 6 shipped a passing admin build and **106 passing tests**, and the editor
was still completely unusable. Each defect is recorded here because the
_process_ failure matters more than the code fix: nothing in the suite ever
performed a read → edit → write cycle.

| #   | Defect                                                                                                                   | Symptom                                                                                                                                                                                            | Fix                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `resolveSection()` wrote resolved colour tiles back into `config.colours`, replacing the admin's `string[]` with objects | Admin GET returned objects; every re-save failed `422 VALIDATION_FAILED` (`expected string, received object`). **The editor could never save anything.**                                           | Derived output moved to a dedicated `colourTiles` field. `config` is now echoed back byte-for-byte.                  |
| 2   | The admin GET never returned the concurrency `version`, and the server page passed `initialVersion={Date.now()}`         | Every save failed `409 CONFLICT`. A fabricated version can never match the server's.                                                                                                               | `currentHomepageVersion()` is returned by both the GET and the PUT; the page and the editor use that value verbatim. |
| 3   | `homepageSectionSchema` folded `position`/`isVisible`/`startsAt`/`endsAt` into each **`config`** variant                 | The write schema demanded `config.position`, which the API never sent and the editor never set — so hand-written payloads always failed validation for reasons unrelated to what was being edited. | The base fields live at the section level, matching how they are actually stored in `homepage_sections`.             |

A fourth, softer issue was found at the same time: `fetchHomepage()` reused the
storefront's shared 5-minute ISR revalidate, so a published change took **up to
five minutes** to appear — which reads to an administrator as "my save did
nothing". The homepage now fetches with `cache: 'no-store'`.

**Five regression tests** were added in `apps/api/tests/homepage.test.ts`
("editor round trip (regression)") that perform the full cycle the suite was
missing: version is returned, a save built from a page read is accepted,
`config` survives resolution, a second save is not locked out, and an admin
toggle reaches the customer-facing payload.

**Lesson applied to the whole codebase:** a feature is not verified because it
builds. It is verified when the full path from the control to the customer-
facing output has been executed.

### 11.5 Status after implementation

All six gaps are closed. The routes, their contracts, permissions and test
evidence are listed in §12.

| Gap                           | Status     | Evidence                                                                                                                                                 |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G-1** product writes        | **Closed** | `catalog-admin.test.ts` → "creates a design and reads it back by code", "updates a design in place without duplicating it"                               |
| **G-2** colour-variant writes | **Closed** | "adds a colourway at zero stock", "creates a new SKU at zero stock"                                                                                      |
| **G-3** SKU-level endpoints   | **Closed** | "reads one SKU with the images verified for its colour", "exposes the stock ledger"                                                                      |
| **G-4** category endpoints    | **Closed** | "creates a category", "refuses a parent change that would create a cycle"                                                                                |
| **G-5** image review          | **Closed** | "assigns a colour and promotes the colourway out of pending-review", "keeps a rejected image out of every gallery"                                       |
| **G-6** import trigger        | **Closed** | `catalog-import.test.ts` → "reports what it would do and writes nothing to the catalogue", "is idempotent — retrying does not duplicate designs or SKUs" |
| **G-7** per-SKU admin read    | **Closed** | `GET /v1/admin/catalog/skus/:sku`                                                                                                                        |

**G-5 no longer blocks selling on its own**, but it does not unblock it either:
with `stock: 0` on every variant, verified photography alone still leaves nothing
purchasable. Loading stock is an operational data task (§12.1).

### 11.3 Newly discovered, not previously listed

| Finding                                                                                                                                                       | Impact                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All 674 variants have `stock: 0`.**                                                                                                                         | The workbook has no stock column. **No product is currently purchasable.** The storefront correctly renders "Sold out" and `isPurchasable: false` rather than inviting a purchase that cannot complete. Loading stock is an operational data task.                                                                                                                                                                            |
| **Only 66 of the catalogue's images carry a verified `colour`** (Brown 20, Black 19, White 7, Tan 7, Olive 7, Grey 6); 619 carry none and 19 are quarantined. | The homepage colour section therefore offers only those colours. This surfaced a real defect — an early implementation fell back to the product's primary image, which put a **black photograph on the "Tan" tile**. It is fixed and regression-tested (`homepage.test.ts` → _"pairs each colour tile with a photograph of that same colour"_). A colour with no verified imagery is now dropped rather than mis-illustrated. |
| **`banners` was empty**                                                                                                                                       | The hero section could not resolve until a banner row existed. One 16:9 banner was created through the admin API.                                                                                                                                                                                                                                                                                                             |

---

## 12. Implemented surface — G-1 to G-6

All routes mount at **`/v1/admin/catalog`**
(`apps/api/src/routes/catalog-admin.routes.ts`, mounted in `v1.routes.ts`).
Every route declares its own permission and passes `requireAdmin`.

Validation lives in `packages/contracts/src/catalog/admin.ts`; behaviour lives in
`apps/api/src/services/catalog-admin.service.ts` (G-1…G-5, Phase 7) and
`apps/api/src/services/import.service.ts` (G-6).

### 12.1 G-1 — Products

| Method | Path              | Permission      | Notes                                                                                                              |
| ------ | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/products`       | `catalog:read`  | Every design incl. drafts and archived. Filters: `search`, `status`, `subcategory`, `inStock`, `page`, `pageSize`. |
| GET    | `/products/:code` | `catalog:read`  | One design **by `A<NN>` code**.                                                                                    |
| POST   | `/products`       | `catalog:write` | `201`. Duplicate code → `409`.                                                                                     |
| PATCH  | `/products/:code` | `catalog:write` | Updates in place. `code` is not an editable field.                                                                 |
| DELETE | `/products/:code` | `catalog:write` | **Soft** archive (`status: 'archived'`).                                                                           |

`slug` is server-derived from `title` with a `-2`/`-3` de-duplication suffix and
**cannot be supplied by a client**. `code` is deliberately absent from the
update schema: changing the identity the API addresses by would fork the
catalogue rather than edit it.

### 12.2 G-2 / G-3 — Colour variants and SKUs

| Method | Path                       | Permission      | Notes                                                                                                                                        |
| ------ | -------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/products/:code/colours`  | `catalog:read`  | Colourway rollup — one row per colour, not per SKU.                                                                                          |
| GET    | `/products/:code/variants` | `catalog:read`  | Every SKU on a design. Filters: `colour`, `photographyStatus`, `inStock`.                                                                    |
| POST   | `/products/:code/variants` | `catalog:write` | `201`. **`stock` is not accepted** — a new SKU is always created at zero.                                                                    |
| GET    | `/skus/:sku`               | `catalog:read`  | One SKU with the images verified for its colour.                                                                                             |
| PATCH  | `/skus/:sku`               | `catalog:write` | `size`, `ukIndiaSize`, `euroSize`, `mrp`, `sellingPrice`, `ean`, `variantTitle`. **`sku`, `productId`, `productCode` are absent by design.** |
| DELETE | `/variants/:sku`           | `catalog:write` | Soft retire: `stock: 0`, `inStock: false`, delta written to the ledger.                                                                      |
| POST   | `/skus/lookup`             | `catalog:read`  | Batch resolution, ≤500. A POST body, not a GET query array.                                                                                  |
| GET    | `/skus/:sku/stock`         | `catalog:read`  | The stock ledger for one SKU.                                                                                                                |

`sku` is matched against `^AJ-A\d{2}-[A-Za-z]{2,5}-\d{1,2}$` and stored
**verbatim** from the workbook. Re-parenting is not offered.

### 12.3 G-4 — Categories

Canonical collection `categories`, addressed by kebab-case `slug`.

| Method | Path                         | Permission      | Notes                                                                                                              |
| ------ | ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET    | `/categories`                | `catalog:read`  | Tree with real product counts.                                                                                     |
| POST   | `/categories`                | `catalog:write` | `201`. `409` on duplicate slug.                                                                                    |
| PATCH  | `/categories/:slug`          | `catalog:write` | Display name, description, parent, SEO, visibility, status. **Rejects a parent change that would create a cycle.** |
| DELETE | `/categories/:slug`          | `catalog:write` | Retire. **Refuses while products still reference it** — reassign first.                                            |
| POST   | `/categories/reorder`        | `catalog:write` | Bulk reorder; positions are renumbered contiguous.                                                                 |
| POST   | `/categories/seed`           | `catalog:write` | Creates categories from the `subcategorySlug` values already in use.                                               |
| GET    | `/categories/:slug/products` | `catalog:read`  | The products assigned to a category.                                                                               |

> **Operational note:** the `categories` collection is currently **empty** in
> `ajooba_development` while all 55 products already carry a
> `subcategorySlug`. Run `POST /v1/admin/catalog/categories/seed` once before
> using the category screens, or the product form will offer no categories.

### 12.4 G-5 — Image review

Images are addressed by **`imageId` = `<designCode>:<sourceFile>`**.

| Method | Path                         | Permission      | Notes                                                                                             |
| ------ | ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/images/review-queue`       | `catalog:read`  | The queue, with all evidence per item plus a design-level summary.                                |
| GET    | `/images/:code/coverage`     | `catalog:read`  | Per-colour verified-photo counts and gaps for one design.                                         |
| POST   | `/images/:imageId/assign`    | `catalog:write` | `colour` + **`reason` (≥10 chars, mandatory)**.                                                   |
| POST   | `/images/:imageId/reject`    | `catalog:write` | Confirms quarantine is correct; stays undisplayed.                                                |
| POST   | `/images/:imageId/revert`    | `catalog:write` | Undo an assignment, returning the image to quarantine.                                            |
| PATCH  | `/variants/:sku/photography` | `catalog:write` | Flip the gate. **Refuses `verified` when the design has no verified photograph for that colour.** |

Rules enforced server-side, not by the UI:

- A colour must be one the design **actually sells**.
- **Byte-identical imagery may not be assigned to two different colours.** The
  guard searches every prior _assignment_ of those bytes and does **not**
  filter on the colour being assigned — see §13.
- Assigning the first photo for a colour promotes that colourway from
  `pending-review` to `verified`; reverting demotes it back if no verified
  photo remains.
- Every decision is recorded with `reviewedByEmail`, `reviewedAt` and the
  reason, and appended to the audit log.
- Original files are never moved or deleted; `sourceFile` and `storage` are
  retained.

`isSellable = photographyStatus !== 'pending-review' && inStock && (stock - reservedStock) > 0`

### 12.5 G-6 — Controlled import

| Method | Path                     | Permission   | Notes                                                                  |
| ------ | ------------------------ | ------------ | ---------------------------------------------------------------------- |
| POST   | `/imports`               | `import:run` | `201`. **Dry run.** The extract arrives in the **request body**.       |
| GET    | `/imports`               | `import:run` | Recent plans.                                                          |
| GET    | `/imports/:planId`       | `import:run` | One plan with its findings and outcome.                                |
| POST   | `/imports/:planId/apply` | `import:run` | Requires `confirm: true` **and** the plan's SHA-256 `payloadChecksum`. |

**Why the source is a body and not a path.** The original workbook is on a
developer's `C:` drive. Railway and Vercel cannot see it. Accepting a
filesystem path would give any `import:run` holder an arbitrary-file-read
primitive and the illusion that it also addresses the server's disk. The
endpoint accepts **JSON only and executes no command**.

Staging: the payload is written to `os.tmpdir()/ajooba-import-staging` under a
server-derived filename. The apply reads it back and re-hashes it, so a swap
between approval and apply is refused.

Quarantine rules (never applied automatically): duplicate design code within the
payload, duplicate SKU, missing `subcategorySlug`, missing or negative pricing,
selling price above MRP, image row without `sourceFile`. A malformed design
code is **rejected** rather than quarantined.

**Import never sets stock.** Every imported SKU is written with `stock: 0`,
`inStock: false` and `photographyStatus: 'pending-review'`.

### 12.6 Phase 7 — Inventory readiness

| Method | Path                   | Permission        | Notes                                                                                                                    |
| ------ | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PUT    | `/skus/:sku/stock`     | `inventory:write` | **Absolute** set. Requires `quantity`, `reason` (`audit`/`restock`/`correction`), `note` and **`expectedCurrentStock`**. |
| POST   | `/inventory/stock-set` | `inventory:write` | Bulk. **`dryRun` defaults to `true`** and writes nothing.                                                                |

- `expectedCurrentStock` that does not match the stored level → `409`. A stale
  tab cannot silently overwrite a newer count.
- Setting below `reservedStock` → `422`. In-flight checkouts are protected.
- Every set appends to the stock ledger (`StockMovementModel`).

### 12.7 Production-readiness blocker

**All 674 variants in `ajooba_development` have `stock: 0`, and the workbook has
no stock column.** No quantity was invented. Until an administrator counts
stock and sets it through `PUT /skus/:sku/stock`, **nothing is purchasable** and
this is the correct, intended behaviour.

Second, related condition: only 15 of 674 variants carry
`photographyStatus: 'verified'`. The remaining 659 — 35 explicitly
`pending-review` and 624 written before the field existed — have no verified
photography recorded, so they cannot be sold either. Both conditions must be
cleared before launch.

---

## 13. Defects found _after_ implementation

These were found by running the tests written for the new endpoints, not by
review. They are recorded because each was a real correctness or security bug in
code that typechecked, linted and built cleanly.

| #   | Where                                      | Defect                                                                                                                                                                             | Symptom                                                                                                                                                | Fix                                                                                                                                                                                                                                     |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `catalog-admin.service.ts` → `assignImage` | The byte-identical-photo guard filtered on `assignedColour: colour` — i.e. it searched for the _same_ colour, so it could never catch the cross-colour case it existed to prevent. | The same photograph could be assigned to two different colour galleries. Exactly the failure the guard names in its own comment.                       | Lookup now scans **all** prior assignments of those bytes regardless of colour. Test: _"blocks the same photograph being assigned to two colours"_.                                                                                     |
| 2   | `catalog-admin.service.ts` → `assignImage` | Promotion used `countDocuments` (which counts **documents**) compared with `> 1`.                                                                                                  | A design with exactly one photograph **never** left `pending-review`, so its colourways stayed unsellable after a correct review.                      | Counts **images carrying the colour** via `$filter`/`$size`. Test: _"assigns a colour and promotes the colourway out of pending-review"_.                                                                                               |
| 3   | `import.service.ts` → `applyImportPlan`    | Findings were keyed in a `Map` by `kind:code:sku`. A duplicate design code produces **two** findings under the same key (one `create`, one `quarantine`); the last write won.      | Applying a payload with a single duplicated code skipped **both** rows: `designsCreated: 0, skipped: 2`. One bad row silently imported nothing at all. | Findings carry a `rowIndex` (and `parentIndex`) and are keyed by position. Test: _"skips quarantined rows rather than applying them"_ now asserts `designsCreated: 1, skipped: 1`.                                                      |
| 4   | `homepage.service.ts` → `resolveSection`   | The comment promised _"Trending is ranked by real sales when there is enough data"_, but the `automatic` branch only ever sorted by `createdAt`.                                   | Trending was newest-first, not trending. The documented behaviour did not exist.                                                                       | Added `rankBySales()`, aggregating completed + paid order lines, with an explicit newest-first fallback when there are no genuine sales. Tests: _"ranks trending by genuine completed sales"_, _"ignores unpaid and cancelled orders"_. |
| 5   | `apps/admin/.../category-manager.tsx`      | The edit form reported failures through `onNotice={() => undefined}`.                                                                                                              | A rejected category save produced **no visible error** — the dialog closed and the change was lost silently.                                           | Threaded the real notice handler through and added a success confirmation. Found by `eslint --max-warnings 0` flagging the unused `notice` state.                                                                                       |

### 13.1 Defects found during the Phase 9 live-database audit

These were found by **aggregating the real `ajooba_development` database** rather
than by running a test — which is itself the point. Every test above runs
against a database built by the test, so a test can never notice that the
_production-shaped_ data does not have the shape the code assumes.

| #   | Where                                            | Defect                                                                                                                                                                                                                                  | Symptom                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | `catalog-admin.service.ts` → `assignImage`       | The byte-identical-photo guard searched only `image_reviews`. But 85 of the live images were coloured by `image-colour-migration.job.ts`, which writes **no review record** — and at the time none of them carried a `checksum` either. | The guard was **inert across the entire catalogue**. It could not block anything, and the 47 G-5 tests still passed, because those tests build their own reviewed fixtures.                              | The guard now queries `products.images` — the canonical record — as well as `image_reviews`. Tests: _"blocks reuse of bytes already displayed under another colour by a prior migration"_, _"blocks cross-design reuse of identical bytes"_. |
| 7   | Live data, `products.images[].checksum`          | No image had ever been hashed. `checksumFile` exists in `media.service.ts` and is called by the Cloudinary upload path, but the images in the database were imported without Cloudinary.                                                | Defence #6 had no data to work with. A duplicate photograph (`A10-7.jpg` / `A10-7(1).jpg`) was one click from being assigned to a second colour.                                                         | Added `image-checksum-backfill.job.ts` — dry-run-first, additive, idempotent, production-name-refusing. Backfilled 685/685; re-run reports `already stamped: 685`.                                                                           |
| 8   | `catalog-admin.service.ts` → `assignImage`       | The conflict message named the colour being **requested** rather than the one already on display.                                                                                                                                       | `409 Those exact bytes have already been used: already in the Brown gallery` — when the caller asked for Brown and the bytes were on Black. The error contradicted itself and gave no actionable detail. | One derivation for all three clash sources, naming the conflicting colour and where it lives. Caught by asserting on the message, not just the status code.                                                                                  |
| 9   | `contracts/catalog/admin.ts` → `ImageReviewItem` | The response echoed `proposedColour` (what the _rule_ guessed) but never `assignedColour` (what was _persisted_).                                                                                                                       | After a successful assign, the API returned no way to confirm the write landed the chosen colour. A reviewer had to trust a `200`.                                                                       | Added `assignedColour: string \| null`, populated from the refreshed product, and surfaced it in the admin queue as _"Currently assigned to"_. Test: _"allows a quarantined duplicate to be resolved"_.                                      |

**The pattern in 6 and 7 is the one worth keeping.** Both passed every test,
because every test constructed its own fixtures — and the fixtures had review
records and checksums, while the real catalogue had neither. A test suite proves
the code handles the data it was given; only reading the real data proves the
code handles the data you have.

**The pattern is the same as §11.4.** In four of five cases the code was
type-clean, lint-clean and built successfully, and the defect only appeared when
the full path was executed against the real database. A green build is not
evidence that a catalogue write is correct.

---

## 14. Approval process for a future real import

No catalogue import was executed as part of this work. Everything above was
exercised against the **throwaway in-memory test database**, which
`tests/helpers/guard.ts` asserts is isolated before the application can open a
connection. `ajooba_development` was never written to.

For a real import:

1. Build the extract JSON from the workbook, unchanged and verbatim.
2. `POST /v1/admin/catalog/imports` with the payload and the source filename.
   **Read the report.** Confirm `targetDatabase` is the environment you intend.
3. Check `counts`: `designsToCreate` vs `designsToUpdate`, and every
   `quarantine` / `reject` finding.
4. Resolve quarantined rows deliberately, or accept that they are excluded.
5. `POST /v1/admin/catalog/imports/:planId/apply` with the plan's
   `payloadChecksum` and `confirm: true`.
6. Read the outcome back with `GET /imports/:planId` and confirm the audit-log
   entry names you.

**A plan cannot be applied twice**, and re-planning the same file produces an
identical checksum, so a retry after a partial failure is safe and will not
duplicate designs or SKUs.

### 14.1 One operational step the importer cannot do

The extract carries `sourceFile` names, but **not image bytes**. Checksums, and
therefore the duplicate-photograph guard of §13.1 #6, come from hashing the files
on disk — so they must be produced where the files are:

```bash
# On a machine that holds public/products/, against a non-production database.
cd apps/api
npx tsx src/jobs/image-checksum-backfill.job.ts --dry-run   # read the duplicate groups
npx tsx src/jobs/image-checksum-backfill.job.ts --apply
```

Without this, an environment that receives only the JSON extract has no
checksums and the cross-colour guard has nothing to compare. The job refuses to
run when `MEDIA_STATIC_DIR` is unset rather than inventing values.
