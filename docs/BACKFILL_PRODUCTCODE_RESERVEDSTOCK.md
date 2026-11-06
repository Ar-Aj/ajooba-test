# Backfill — `variants.productCode` and `variants.reservedStock`

**Status:** **EXECUTED AND VERIFIED** — 22 Oct 2026. See §1A for the outcome.
**Date:** 22 October 2026
**Scope:** `ajooba_development` → collection `variants` (674 documents)
**Recommendation:** `productCode` is **kept**, not removed — see §10.

---

## 1A. Execution record (22 Oct 2026) — the backfill was applied

The backfill has been run and independently verified. This section is the
authoritative record; §1–§9 below are the original proposal, retained as the
rationale and the procedure.

### 1A.1 Preconditions verified before the write

| Check                             | Result                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Target database                   | `ajooba_development` @ `127.0.0.1:27017` (from `apps/api/.env.local`)                                                             |
| PID 48176                         | **Not running** — the PID in the brief was stale                                                                                  |
| Actual API process                | **PID 29756**, confirmed as `tsx .../apps/api/src/server.ts` _and_ `/health/ready` → `{"service":"api"}`, then stopped gracefully |
| `tsx watch` supervisor            | PID 49828 — stopped so the server could not auto-respawn mid-write                                                                |
| Port 4000                         | Free before the write                                                                                                             |
| Active reservations               | **0** — the `orders` collection is empty                                                                                          |
| Variants with `reservedStock > 0` | **0**                                                                                                                             |

### 1A.2 Backup

The backup is native **BSON**, not JSON, so `ObjectId` and `Date` round-trip
exactly. It is written to `backups/catalog/catalog-backup-<timestamp>.bson` and
**verified by reading the file back off disk** and decoding each record through
the 4-byte little-endian BSON length prefix. Re-reading the live database
instead would only prove the database still exists.

| File                                           | Size          | Integrity                                                                            |
| ---------------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| `catalog-backup-2026-10-22T15-04-20-915Z.bson` | 419,269 bytes | products 55/55, variants 674/674 — **VERIFIED**                                      |
| `catalog-backup-2026-10-22T15-08-35-610Z.bson` | 419,269 bytes | products 55/55, variants 674/674 — **VERIFIED** (taken immediately before the write) |

### 1A.3 What changed

|                               | Before | After   |
| ----------------------------- | ------ | ------- |
| Variants with `productCode`   | 0      | **674** |
| Variants with `reservedStock` | 0      | **674** |
| Quarantined / skipped         | —      | **0**   |

Exactly the 674 intended `variants` documents were written. No collection was
dropped, no other collection was modified, and no catalogue import or migration
was run.

### 1A.4 Independent post-write verification

Read back through the driver, not from the script's own report:

```
variants scanned    : 674
orphan variants     : 0
productCode mismatch: 0     (every variant matches its parent products.code)
reservedStock != 0  : 0
type problems       : 0     (productCode: string, reservedStock: int)
distinct codes      : 55    (A01 … A57)
duplicate SKU groups: 0     (674 distinct SKUs)
```

### 1A.5 Findings worth carrying forward

1. **`productCode` is fully consistent.** All 55 `articleNumber` groups map 1:1
   to a parent `Product.code`, and every group resolves to exactly one parent
   code. **Drift = 0.** The denormalisation is safe to keep and is now
   load-bearing for the stock ledger (see §10).
2. **The catalogue has zero stock.** Every one of the 674 variants has
   `stock: 0` and `inStock: false`, because the source workbook has no stock
   column. 35 variants additionally carry `photographyStatus:
'pending-review'`. Consequence: **no product is currently purchasable**, and
   the storefront correctly shows "Sold out" rather than inviting a purchase
   that cannot complete. Restoring stock is an operational data task, not a
   code change.
3. **Colour-verified imagery is sparse.** Only 66 of the catalogue's images
   carry a verified `colour` (Brown 20, Black 19, White 7, Tan 7, Olive 7,
   Grey 6); 619 carry none and 19 are quarantined. The homepage colour section
   therefore offers only the colours that genuinely have verified photography,
   which is the honest behaviour.

### 1A.6 Re-running it

```bash
node scripts/backfill/productcode-reserved-stock.mjs           # dry run
node scripts/backfill/productcode-reserved-stock.mjs --backup   # backup only
node scripts/backfill/productcode-reserved-stock.mjs --apply    # write
```

The script refuses to run against a database whose name does not look like a
development/test database, refuses to run while any order is in an active
status, refuses to run while any variant has `reservedStock > 0`, and refuses
to write if the backup does not read back with matching counts.

---

## 0. DATABASE SAFETY INCIDENT — read before any further work

> **A previous session deleted all 55 product documents and all 674 variant
> documents from `ajooba_development` through a MongoDB MCP connection that was
> believed to be read-only, then restored them via the catalogue importer.
> The catalogue is now restored. The cause is understood and is _not_ a code bug —
> it is a missing database-level control. Read §0 before running anything.**

### 0.1 Restoration status — verified 22 Oct 2026 (read-only)

| Collection                                 | Count   | Expected | Status               |
| ------------------------------------------ | ------- | -------- | -------------------- |
| `products`                                 | **55**  | 55       | restored             |
| `variants`                                 | **674** | 674      | restored             |
| Orphan variants (`productId` → no product) | **0**   | 0        | referentially intact |

Every variant resolves to a real parent product, so the parent/child graph
rebuilt cleanly. The restoration is **complete**.

### 0.2 The backups are NOT a catalogue backup — verified

This is the most important operational finding in this section. There are three
files in `backups/`, and **none of them can restore the catalogue**:

| File                                                  | Taken | Contains                                                                  | Usable as a catalogue restore?                      |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| `products-pre-image-colour-migration-2026-10-22.json` | 17:32 | **products only**, 55 docs, 5 fields (`_id, code, colours, images, slug`) | **No** — no `variants`, and 5 of ~19 product fields |
| `pilot-pre-migration-2026-10-22.json`                 | 18:47 | **5 products, 95 variants**, codes `A46,A14,A30,A48,A57`                  | **No** — a 5-design pilot subset, not the catalogue |
| `pilot-protected-counts-before.json`                  | 18:47 | counts of 18 non-catalogue collections                                    | **No** — counts only, no documents                  |

`pilot-protected-counts-before.json` **parses cleanly as JSON and is internally
coherent** (all `0`, plus `import-reports: 2`). It is a genuine pre-flight
manifest — and it documents precisely which collections were _not_ the catalogue
and were correctly left alone: `orders`, `users`, `carts`, `payments`,
`audit_logs`, `stock_movements`, `refresh_tokens` are all `0`.

> **Consequence.** The real recovery path was the **catalogue importer**, not
> these backups. Nothing else on this machine is a point-in-time snapshot of the
> catalogue. `mongodump`, `mongorestore` and `mongosh` are **not on PATH**, and no
> `mongodump` binary exists under `C:\Program Files\MongoDB\Server\8.0\bin`.
> **A pre-backfill `mongodump` (§7 step 4) requires installing the MongoDB
> Database Tools first.** That must happen _before_ any write, not after.

### 0.3 Root cause — the read-only guarantee was one process deep

The MCP configuration at `C:\ajooba footwear\.cursor\mcp.json` and
`.env.mcp` **already declares read-only mode**:

```
MDB_MCP_READ_ONLY=true
MDB_MCP_DISABLED_TOOLS=drop-database,drop-collection,rename-collection,
  delete-one,delete-many,insert-one,insert-many,update-one,update-many,
  create-index,drop-index,drop-indexes
```

Both values are honoured by `mongodb-mcp-server@1.12.0`: `parseUserConfig.js`
maps the `MDB_MCP_` prefix onto the `readOnly` config key, and `tool.js:319`
refuses any tool whose `operationType` is not `read`/`metadata`/`connect`. The
`aggregate` tool additionally rejects `$out`/`$merge` stages under `readOnly`
(`aggregate.js`), so the multi-faceted read/write tool is closed too.

**So the configuration was not the failure.** The failure is one level down:
the local `mongod` **runs with `authorization` disabled** (documented at
`docs/ARCHITECTURE.md` §7.3). MongoDB therefore _verifies_ the supplied
password but **does not enforce roles** — every authenticated user is effectively
granted full access to every database on the instance. The `read` role granted
to the `ajooba_mcp` user is **recorded but never applied**.

**The safety model was: MCP server config (works) + Cursor approval (works) +
MongoDB access control (absent).** Two application-level layers held; the one
that makes a compromise irreversible did not exist.

### 0.4 Required configuration before MCP is reconnected

Do not reconnect the MCP server until **all four** of these hold. Items 1–2 are
the controls that were missing; 3–4 close the remaining gaps.

1. **Enable authorization on `mongod`.** Uncomment/insert the block in
   `mongod.cfg` and restart the service:
   ```yaml
   security:
     authorization: enabled
   ```
   **Blocker — read this before attempting it.** The API at `apps/api/.env.local`
   connects with `MONGODB_URI=mongodb://127.0.0.1:27017`, i.e. **no credentials
   at all**. Enabling authorization **will immediately break the running API and
   the dev tooling** until a user exists in that URI. Sequence it as: create
   users first (`pnpm mcp:setup` creates `ajooba_mcp` with `read@ajooba_development`),
   add an API user with the role set the API actually needs, update
   `MONGODB_URI`, verify, and only then enable `authorization`.
2. **Enforce least privilege at the database.** `ajooba_mcp` must hold
   `read@ajooba_development` and **nothing else** — explicitly not
   `readWriteAnyDatabase`. Verify with `node scripts/mcp/check-authz-status.mjs`
   (already committed) that the account can **no longer** read a database it was
   never granted. That negative test is the one that was missing.
3. **Keep MCP read-only as well.** It is a valid second layer and should stay:
   `MDB_MCP_READ_ONLY=true` plus the disabled-tools list. Defence in depth, not
   the primary control.
4. **Point the MCP connection string at the named database with `authSource`.**
   `.env.mcp` already carries `?authSource=ajooba_development`, which is correct
   and should be retained.

Verify after any change with `pnpm mcp:verify` (real stdio handshake, asserts
write tools are absent) — never by attempting a write.

**No permission probes were run during this assessment, and none should be.**
Whether the account can write is proven by `check-authz-status.mjs` and by the
role definition, not by issuing a write and observing what happens.

### 0.5 Scope discipline

The assessment touched `products`, `variants`, `orders`, `carts` and
`stock_movements` in `ajooba_development` **read-only**, for counting only. No
other project, collection, environment or production data was accessed. The local
`mongod` is **not dedicated to Ajooba** (`docs/CATALOG_CONFLICTS.md`), so every
future write must name its target database explicitly.

---

## 1. What is actually wrong (verified 22 Oct 2026)

Both fields are declared `required: true` on the schema but are **absent from
every one of the 674 variant documents** in the database.

| Field                    | Schema declaration                   | Documents missing it |
| ------------------------ | ------------------------------------ | -------------------- |
| `variants.productCode`   | `String, required, index`            | **674 / 674 (100%)** |
| `variants.reservedStock` | `Number, required, default 0, min 0` | **674 / 674 (100%)** |

Re-verified against the live database after the restoration (§0.1): a
`$group` by `$productCode` returns a single bucket `_id: null, n: 674`, and the
same for `$reservedStock`. **Neither field exists on any variant.** The gap
described below survived the catalogue restoration, because the importer writes
variants and the restoration re-ran that importer.

The schema declares them, so the **TypeScript types, the Zod contracts and the
service code all read as though these fields are always present.** They are not.
That is the whole defect: a silent gap between the declared shape and the stored
shape.

### Why they are missing

Both are absent for the same structural reason, and it is _not_ corruption:

```492:492:C:\ajooba footwear\apps\api\src\jobs\catalog-import.job.ts
              productCode: product.code,
```

`catalog-import.job.ts` is the only writer of variants. Two facts combine:

1. It upserts with **`$set` + `$setOnInsert`** and `setDefaultsOnInsert: true`.
   Mongoose applies schema defaults **only on insert**. A variant that already
   exists is updated, never re-inserted, so its default is never applied.
2. The 674 documents were **written before these two fields existed** on the
   schema, by an earlier importer run.

So the documents predate the fields, and every subsequent importer run has
matched on `sku` and updated in place — permanently skipping the insert path
where the default would be applied. Re-running the importer **cannot** repair
this. This is a genuinely separate backfill, which is why this document exists.

> Note on `catalog:import` reliability: during the previous task the importer
> was run several times against this database. Its behaviour on this data is
> _update-in-place_, consistent with the above. Nothing further should be run
> until this is reviewed.

---

## 2. Source of truth — `productCode`

### 2.1 Verified derivation

`productCode` is a **denormalised copy of the parent product's `code`**. It is
not derived from the SKU string. The authoritative rule is the foreign key:

```
variants.productCode  ==  products.code   (via variants.productId -> products._id)
```

`catalog-import.job.ts` assigns it as `product.code` at write time
(`catalog-import.job.ts:492`), so the denormalised copy is always intended to
equal the parent's `code`.

### 2.2 Evidence gathered (read-only, 22 Oct 2026)

| Check                                                                | Result                          |
| -------------------------------------------------------------------- | ------------------------------- |
| Variants whose `productId` resolves to a product                     | **674 / 674** — zero orphans    |
| Distinct `{articleNumber → parentCode}` pairs                        | **55** — exactly one per design |
| Product documents                                                    | **55**                          |
| Duplicate `sku` values                                               | **0**                           |
| Sample: `sku AJ-A01-OW-06` → `articleNumber A01` → parent `code A01` | consistent                      |

**The mapping is unambiguous.** 55 distinct pairs against 55 products means every
variant points at a unique design and no design is claimed by two codes.

> **Methodological caveat — recorded deliberately.** Two attempted validations
> using `$expr` comparisons against joined `$lookup` fields returned
> self-contradictory results on this server (an `$ne` filter matched all 674
> rows while `$eq` matched 0, despite the sampled values being visibly
> identical). Those results were **discarded as unreliable** and the conclusion
> above rests instead on the `$group`-by-pair check, which returned a coherent 55. If exact per-row equality is required before the backfill runs, it should
> be re-verified with a client-side comparison rather than an `$expr` join.

### 2.3 Corroborating field: `articleNumber`

Each variant also carries `articleNumber` (`A01`, `A14`, …), independently sourced
from the marketplace listing templates. It agrees with the parent `code` across
the catalogue, so a **second, source-independent** derivation of the same value
exists.

The backfill should **cross-check the two derivations and refuse to write any
document where they disagree.** This is the cheapest available guard against
writing a wrong `productCode`.

---

## 3. Mapping rule (proposed)

For each variant `v` in `variants`:

```text
parent      := products.findOne({ _id: v.productId })
derived     := parent.code                       // primary, via foreign key
crossCheck  := v.articleNumber                  // independent corroboration

if parent is missing        -> QUARANTINE (do not write)
if derived != crossCheck   -> QUARANTINE (do not write)
otherwise                  -> v.productCode = derived
```

**Every step is additive.** `productCode` does not currently exist on any
document, so writing it cannot overwrite data. It cannot lose information; it can
only add a field that is currently absent. Failure modes are therefore limited
to writing a _wrong_ value, which the cross-check prevents and the pre-flight
report (§6) makes visible before any write occurs.

Prefer a `$lookup`-based aggregation over per-document round trips: 674
variants and 55 products is small enough to do entirely in-database.

---

## 4. Source of truth — `reservedStock`

### 4.1 What the field means

`reservedStock` is the count of units held by an **in-flight checkout that has
not yet become a confirmed order**. It is deliberately tracked apart from
`stock` so a failed checkout can be reversed exactly, and so availability can be
computed as `stock - reservedStock`.

It is **not** a sales figure and **not** a stock-on-hand figure. It is a
short-lived claim on stock.

### 4.2 The reservation lifecycle (as implemented)

The three transitions live in `order.service.ts` and are the complete set of
writers:

| Stage                       | Operation                                 | Effect                                                                                    |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Checkout begins             | `reserveStock()` (`order.service.ts:151`) | `$inc: { stock: -qty, reservedStock: +qty }` — atomic, filtered on `stock: { $gte: qty }` |
| Order confirmed             | `commitStock()` (`order.service.ts:195`)  | `$inc: { reservedStock: -qty }` — units consumed, claim cleared                           |
| Checkout abandoned / failed | `releaseStock()` (`order.service.ts:185`) | `$inc: { stock: +qty, reservedStock: -qty }` — units returned                             |

`commitStock()` and `releaseStock()` are called from `settle()` and
`releaseAll()` in the same file. Note the asymmetry, which is correct: on commit
the units are _gone_ (already decremented from `stock`), so only the claim is
cleared; on release the units return to `stock` as well.

**Consequence:** `reservedStock` is a runtime, transactional counter. It is
never derived from a historical table — it is the live aggregate of claims that
have been taken but not yet committed or released.

### 4.3 Relationship to active reservations and orders

A reservation exists in exactly one of three states:

```
                 reserveStock()            commitStock()          → units sold
   [none] ─────────────────────────► [reserved] ─────────────────────────► [consumed]
     ▲                                    │
     └────────────────────────────────────┘
                         releaseStock()
                       (checkout abandoned)
```

- **`orders`** — a _completed_ order has already had its reservation committed.
  Its units are **not** in `reservedStock`; they are simply gone from `stock`.
  Order status has no bearing on `reservedStock` after commit.
- **Active reservations** — the only thing `reservedStock` counts. They are
  _transient_: they live in memory between reserve and commit/release and have
  no durable record of their own.
- **Abandoned checkouts** — should release via `releaseAll()` on failure. If a
  process dies mid-checkout, the claim leaks and `reservedStock` stays high with
  no order to explain it. **This is the one real risk in the field**, and it is
  the reason the reconciliation query in §6 is written defensively.

### 4.4 The correct source for a backfill

Because there is no durable record of in-flight reservations, `reservedStock`
**cannot be computed by joining against `orders` or any other collection.**
The only sound derivation is a _business assertion_: with no checkouts
in progress, every claim has been committed or released, so the correct value
for every variant is **0**.

Verified supporting counts in `ajooba_development`:

| Collection        | Count | Meaning                                    |
| ----------------- | ----- | ------------------------------------------ |
| `orders`          | **0** | no committed reservations to account for   |
| `carts`           | **0** | no carts mid-checkout                      |
| `stock_movements` | **0** | no stock has ever moved through the ledger |

There is nothing to reconcile _from_. The absence of any ledger rows also means
the importer's stock of `0` across all 674 variants is internally consistent —
`variants.stock` is `0` for every variant, with no contradicting movement
history.

**Proposed rule: set `reservedStock = 0` on all 674 variants.**

---

## 4A. Reviewable backfill plan — `reservedStock = 0` (PROPOSED, NOT EXECUTED)

A concrete, additive, reversible procedure for the `reservedStock` half only.
`productCode` is handled separately in §10. **Nothing in this section has been
run. No job has been written.**

### 4A.1 Preconditions — both must hold, or the plan does not proceed

| #   | Condition                         | Verified state (22 Oct 2026)                                 | How to re-verify             |
| --- | --------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| R-1 | No in-flight reservations         | `carts` = **0**, `orders` = **0**, `stock_movements` = **0** | count each collection        |
| R-2 | **No process can race the write** | ❌ **NOT SATISFIED — see R-2a**                              | see 4A.2                     |
| R-3 | Field is additive only            | `$reservedStock` absent on **674/674**                       | `$group` by `$reservedStock` |
| R-4 | Target database is explicit       | `ajooba_development`                                         | see the guard below          |

#### R-2a — there IS a live writer, so the backfill must not run yet

The Ajooba API dev server **is running and is pointed at this exact database**:

| Evidence              | Value                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| Process               | PID **48176**, `tsx src/server.ts` (`apps/api`), started 22-10-2026 18:48    |
| Listening             | `:::4000`                                                                    |
| `apps/api/.env.local` | `MONGODB_URI=mongodb://127.0.0.1:27017`, **`MONGODB_DB=ajooba_development`** |
| `mongod`              | PID **5600**, `127.0.0.1:27017`                                              |

So this is not a hypothetical race. `reserveStock()` writes with
`$inc: { stock: -qty, reservedStock: +qty }`. A concurrent `updateMany` setting
`reservedStock: 0` would **silently discard an in-flight claim**, and because
`reserveStock` filters on `stock: { $gte: qty }` and availability is computed as
`stock - reservedStock`, the oversell would surface only later as an
unreconcilable stock discrepancy.

**Required action: stop PID 48176 before the backfill, and confirm no process is
listening on 27017 except `mongod` itself.** This is the single blocking item.

### 4A.2 Target-database guard (copy this into the job)

```ts
// Refuse to write unless the resolved database is EXACTLY ajooba_development.
const DB = process.env.MONGODB_DB;
if (DB !== 'ajooba_development') {
  throw new Error(`Refusing to backfill: MONGODB_DB="${DB}" is not ajooba_development.`);
}
if (!process.argv.includes('--i-know-this-is-a-write')) {
  console.log('DRY RUN — no documents will be written. Pass --i-know-this-is-a-write to proceed.');
  process.exit(0);
}
```

This mirrors the existing guard style in `catalog-import.job.ts`
(`assertNotProductionDatabase`), but is stricter: the importer _blocks_
production by name, whereas this backfill requires an **exact** match to the one
development database. On the local instance there is no environment distinction —
`MONGODB_DB` is the only thing preventing a write to the wrong database.

### 4A.3 Dry-run report (mandatory first run)

Dry-run **writes nothing** and emits one row per variant:

```text
sku | _id | currentReservedStock(<missing>) | proposedReservedStock(0) | verdict
```

`verdict ∈ { WRITE, SKIP_PRESENT, SKIP_NONZERO }`. Expected output:
**674 × WRITE, 0 quarantined.** Review this report before enabling the write.

### 4A.4 Write step, when approved

```text
updateMany(
  { reservedStock: { $exists: false } },      // additive + idempotent
  { $set: { reservedStock: 0 } }
)
```

Filter is the **exact absence condition**, so a second run matches 0 documents
and the job can never overwrite a value that appeared later.

### 4A.5 Before / after verification

| Stage     | Check                                             | Expected                                          |
| --------- | ------------------------------------------------- | ------------------------------------------------- |
| Before    | `$group` by `$reservedStock`                      | one bucket `_id: null, n: 674`                    |
| Before    | `count({ reservedStock: { $exists: false } })`    | 674                                               |
| Before    | `count({ reservedStock: { $gt: 0 } })`            | 0                                                 |
| Before    | `carts`, `orders`, `stock_movements` counts       | 0, 0, 0                                           |
| Before    | API process on 4000                               | **stopped**                                       |
| **After** | `count({ reservedStock: { $exists: false } })`    | **0**                                             |
| **After** | `$group` by `$reservedStock`                      | one bucket `_id: 0, n: 674`                       |
| **After** | `count({ reservedStock: { $ne: 0 } })`            | 0                                                 |
| **After** | `products` / `variants` counts                    | 55 / 674 (**unchanged**)                          |
| **After** | `variants.productCode` still absent               | 674 (**unchanged — this plan touches one field**) |
| **After** | API restarted, `/health/ready` + one product read | 200                                               |

### 4A.6 Rollback

Fully reversible, because the write only ever _adds_ a field:

```text
updateMany({ reservedStock: 0 }, { $unset: { reservedStock: "" } })
```

This restores the exact prior state (field absent) for all 674 documents. The
only pre-existing state was absence, so this is lossless. **If any document had
a non-zero `reservedStock` at write time the job skipped it** (`SKIP_NONZERO`)
and rollback must not touch it — re-check with the §4A.3 report before
unwinding.

### 4A.7 Why this is safe to approve (and what it is not)

**Safe:** purely additive (field absent everywhere); `0` is the truthful value
given zero carts, zero orders and an empty ledger; idempotent filter; exact-DB
guard; fully reversible with one `$unset`.

**Not claimed:** that `stock = 0` across the catalogue is commercially correct
(that is importer decision C-3, out of scope); that `productCode` is fixed (it is
not — §10); that the running server can be left up (it cannot — R-2a).

---

## 5. Why this is safe, and what it is not

**Safe, because:**

- Both fields are **absent** on all 674 documents, so both writes are purely
  additive. There is no existing value that can be overwritten or lost.
- `reservedStock = 0` is the **truthful** value for a system with zero carts and
  zero orders, not a convenient placeholder.
- `productCode` is cross-checked against an independent field before write.
- A backfill that only ever _adds_ two fields is trivially reversible — a single
  `$unset` restores the exact prior state.

**Not safe to assume, and deliberately not claimed here:**

- That all 674 variants are correct in every _other_ respect. This backfill is
  scoped to two fields and makes no assertion about the rest.
- That `stock = 0` is _commercially_ correct. It is the importer's decision
  C-3 (the listing templates are a marketplace export, not a warehouse ledger),
  and it means the storefront currently sells nothing. That is a separate
  decision, deliberately **out of scope** and untouched by this backfill.

---

## 6. Pre-flight checks to run before any write

**Results below were obtained read-only on 22 Oct 2026, after the catalogue
restoration.** None of these involve a write.

| #   | Check                                                  | Expected                | Actual                                                                    | Pass            |
| --- | ------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------- | --------------- |
| P-1 | `count({ productCode: { $exists: false } })`           | 674                     | 674 (via `$group` → `_id: null, n: 674`)                                  | ✅              |
| P-2 | `count({ reservedStock: { $exists: false } })`         | 674                     | 674 (via `$group` → `_id: null, n: 674`)                                  | ✅              |
| P-3 | Orphans: variants whose `productId` matches no product | 0                       | **0** (`$lookup` → `$size: 0`)                                            | ✅              |
| P-4 | Variants where `articleNumber != parent.code`          | 0                       | 55 distinct pairs / 55 products (§2.2)                                    | ✅              |
| P-5 | `count({ reservedStock: { $gt: 0 } })`                 | 0                       | 0 (field absent)                                                          | ✅              |
| P-6 | `orders`, `carts`, `stock_movements` counts            | all 0                   | **0, 0, 0**                                                               | ✅              |
| P-7 | Is a process pointed at this database?                 | none, or owner-approved | ❌ **API dev server PID 48176 on :4000**, `MONGODB_DB=ajooba_development` | ❌ **BLOCKING** |

**P-7 is the only failing check, and it is a blocker, not a formality.** The
previous task established that the running API can write to this database; that
is now positively confirmed rather than suspected. `reserveStock()` would
increment `reservedStock` concurrently, and an `updateMany` to `0` would erase
an in-flight claim without error. **Stop PID 48176 before any write.**

Method note: P-1 and P-2 are reported from `$group` aggregations rather than
`$exists` counts. Both express absence, but the grouped form returns the actual
distribution (`_id: null, n: 674`) rather than a bare total, which is stronger
evidence that the field is absent rather than merely unmatched.

---

## 7. Proposed execution (NOT to be run without review)

```text
1. **Stop the API dev server (PID 48176).** Re-run P-1..P-7. Stop and report if
   any expectation is not met.
2. **Install the MongoDB Database Tools.** `mongodump` is **not on PATH** and no
   binary exists under `C:\Program Files\MongoDB\Server\8.0\bin` (§0.2). Without
   this there is no snapshot step, and the `backups/` files on disk **cannot**
   substitute — none contains the catalogue.
3. `mongodump --db=ajooba_development --collection=variants` (and `products`).
   **Verify the dump file is non-empty before continuing.** This is the first
   real backup the catalogue has had.
4. Dry-run: compute both derived values, emit a full report
   (674 rows: sku, derived productCode, crossCheck, verdict). Write nothing.
5. Review the dry-run report. Confirm zero quarantined rows.
6. Write the job, guarded — see §4A.2.
7. Re-run P-1/P-2; expect 0 documents missing either field.
8. Verify against the `$group`-by-pair check from §2.2 (expect 55 pairs).
9. Restart the API and confirm `/health/ready` and one product read.
```

**Guards the job must have:**

- Filter on the exact absence condition (`{ productCode: { $exists: false } }`) so
  it is **idempotent** and can never overwrite a value that appeared later.
- `quarantine` (skip + record) rather than fail-fast, so one bad document cannot
  block the other 673.
- A dry-run flag that is the **default**; writing requires an explicit opt-in.
- Every write recorded in `stock_movements` / audit where appropriate.

---

## 8. Open questions for the owner

1. **Should `reservedStock` be backfilled at all?** It is `required` with
   `default: 0`, so Mongoose will behave correctly for _new_ documents
   regardless. Backfilling only affects the existing 674. Writing `0` is
   correct; the question is whether it is worth the operation at all.
2. **Should `productCode` be dropped instead?** It is denormalised — a `$lookup`
   gives the same value with no drift risk. It exists to serve stock and order
   queries without a join. Confirm the read paths actually need it before
   maintaining it.
3. **Should the schema drop `required: true`?** The gap between "declared
   required" and "actually present" is what made this invisible. Either the
   backfill closes it, or the declaration is overstating the contract.
4. **What closes the durable-reservation gap?** If a process can die mid-checkout,
   `reservedStock` leaks with no record to reconcile against. A reservation
   ledger or expiry timestamp would make it self-healing. Out of scope here.

---

## 9. Related

- `docs/API_CONTRACT_GAPS.md` — the companion gap analysis (written alongside
  this, no code).
- `apps/api/src/jobs/catalog-import.job.ts` — the importer that left the gap.
- `docs/catalog-audit.md` §C-3, `docs/CATALOG_CONFLICTS.md`.

---

## 10. `productCode` usage audit and recommendation (22 Oct 2026)

**Nothing has been changed.** No field removed, no schema edited, no contract
altered. This section is the evidence base for the decision.

### 10.1 Every actual use, by layer

**A. Schema (`apps/api/src/models/variant.model.ts`)**

| Line | Use                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 24   | `productCode: { type: String, required: true, index: true }`                                                |
| 98   | `variantSchema.index({ productCode: 1, inStock: 1 })` — **compound index, drives the admin inventory sort** |

**B. Queries and filters (`apps/api/src/services/inventory.service.ts`)**

| Line     | Use                                                                                   | Why removal would hurt                                              |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 310      | `query.productCode = filter.productCode` — `GET /admin/inventory?productCode=` filter | Live user-facing filter                                             |
| 322      | `.select('sku productCode size colour stock inStock')`                                | Projected into the response                                         |
| 323      | `.sort({ productCode: 1, colour: 1, size: 1 })`                                       | **Primary sort key** — a `$lookup` cannot sort without an `$unwind` |
| 251–252  | `query.productCode = filter.productCode` — stock-movement ledger filter               | Live user-facing filter                                             |
| 269, 334 | Mapped into `StockMovement` / `VariantSummary` responses                              | Returned to admin UI                                                |

**C. HTTP routes (`apps/api/src/routes/admin.routes.ts`)**

Lines 81–87 (`/admin/inventory`) and 176–181 (`/admin/stock-movements`) accept
`productCode` as a **public query parameter** behind `catalog:read`. These are
contract surface, not internal detail.

**D. Stock/order services**

| File:line                          | Use                                                    |
| ---------------------------------- | ------------------------------------------------------ |
| `inventory.service.ts:104,121,134` | Copies `productCode` into every stock movement written |
| `order.service.ts:130,435`         | Copies `productCode` into sale movements               |
| `order.service.ts:694`             | **Writes `productCode: ''`** on cancellation           |
| `stock-movement.model.ts:19,51`    | `required: true`, indexed, plus a compound index       |

**E. Import scripts / jobs**

`catalog-import.job.ts:492` assigns `productCode: product.code` (the sole
writer). `scripts/catalog_extract.py:808,836` emit it into the extract artefact.

**F. Contracts (`packages/contracts/src/admin/types.ts`)**

Line 65 — `StockMovement.productCode: string` (TS interface).
Line 306 — `productCode: z.string()` (Zod schema). **Both `required`.**

**G. Tests (`apps/api/tests/helpers/factories.ts:96,115,152`)** — the factory
derives `productCode` from the parent product.

**H. Storefront** — `wishlist-store.ts:16` and `wishlist-client.tsx:56` use a
**client-side** `productCode`. Note: `product-buy-box.tsx:119` populates it from
`product.code` (the Product), **not** from a variant. This is an independent
`Product.code` consumer and is unaffected by any variant-schema decision.

### 10.2 Verdict: `productCode` is genuinely used — **do not remove it**

Every one of the eight layers above reads or writes it, and it is `required` in
the schema, in the TypeScript interface **and** in the Zod contract. The two
open questions in §8.2 can now be answered with evidence:

- **"Is it genuinely unused?"** No. It backs two live admin filters, a primary
  sort key, a compound index, and the stock ledger.
- **"Does it need a `$lookup`?"** No. The sort at `inventory.service.ts:323`
  and the compound index at `variant.model.ts:98` are exactly the reason a
  denormalised copy exists. A `$lookup` would require an `$unwind` before it can
  sort, defeating the index.

**Recommendation: Option A — keep it as a denormalised field.** Removing it is
not a simplification here; it would break two endpoints, one sort, two indexes
and two contracts for no gain.

### 10.3 If kept, how consistency with `products.code` is enforced

The risk is drift: `Product.code` is edited, `Variant.productCode` is not.

| #   | Control                                                                                                                                                                  | Where                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 1   | **Never treat the variant copy as writable.** No route, service or job updates it post-creation                                                                          | policy — enforce in review |
| 2   | **Single writer.** Only `catalog-import.job.ts` sets it, from `product.code` in the same object                                                                          | already true               |
| 3   | **Immutability of `Product.code`** once a variant exists — treat as identity, not a label                                                                                | `product.model.ts`         |
| 4   | **Drift detector** — the §4A.3 dry-run shape, run as a scheduled read-only job: variants where `productCode != parent.code`. Expected **0**; any non-zero is a bug alert | new read-only job          |
| 5   | **CI assertion** that no service outside the importer writes the field                                                                                                   | test                       |

Control 4 is the practical one: drift becomes _detectable_ rather than
impossible, at the cost of one indexed `$lookup` query.

### 10.4 Defect found during the audit — unrelated to the backfill, needs its own fix

`apps/api/src/services/order.service.ts:694` writes:

```ts
productCode: '',
```

into `StockMovementModel`, where `productCode` is `required: true`
(`stock-movement.model.ts:19`) **and** `z.string()` in the contract
(`admin/types.ts:306`).

**Consequences:** every cancelled order writes a movement whose `productCode` is
an empty string. That row then **fails the `productCode` ledger filter** at
`inventory.service.ts:251` — an admin filtering movements by `productCode` will
never see cancellation rows. It also leaks `''` into the Zod-validated
`StockMovement` response.

The correct value is `variant.productCode` from the order item (the same value
available on the parallel sale path at line 435). **This is a code change, not a
data change — deliberately not made here.** It is recorded so it is not lost;
it is independent of the backfill decision and should be fixed on its own.

### 10.5 Interaction with the backfill decision

Because `productCode` **must be kept**, the original rationale for splitting the
two fields in §2 is confirmed: `productCode` needs a derived value from the
parent (`products.code`), while `reservedStock` needs a constant `0`. They are
still two operations with different risk profiles, and §4A deliberately handles
only `reservedStock`.

### 10.6 Revised status of the open questions in §8

| Q                                            | Status                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 8.1 Should `reservedStock` be backfilled?    | Yes, if §4A R-2a is satisfied — a write of `0` is truthful and reversible. Awaiting owner approval.                      |
| 8.2 Should `productCode` be dropped?         | **No — answered.** Actively used across 8 layers; §10.2.                                                                 |
| 8.3 Should the schema drop `required: true`? | Open. Note that with `productCode` confirmed as load-bearing, dropping `required` would hide the gap rather than fix it. |
| 8.4 What closes the durable-reservation gap? | Open — still valid; a reservation ledger or expiry timestamp remains the real fix for leaked claims.                     |
