# Ajooba Footwear — Catalogue Conflict Report (502)

**Generated:** 22 October 2026
**Source of truth for these figures:** `artifacts/catalog-extract.json`
(produced by `scripts/catalog_extract.py`, read-only over `public/`)
**Reproduce with:** `pnpm --filter @ajooba/api catalog:import:dry-run`
**Reproduce the classification:** `python scripts/conflict_classify.py`

> **Nothing in this document was resolved by guessing.** Every conflict below is
> reported with both source values, the source file that disagrees, and an
> explicit _unresolved_ status. No conflicted row was imported. No image was
> uploaded to Cloudinary. No production data was modified.

---

## 1. Where the conflicts come from

The catalogue has **two independent sources** that disagree. The importer must
pick one, and that choice is a business decision, not an engineering one.

| Source                               | Role                                                 | Authority                           |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------- |
| `public/products/products data.xlsx` | Ajooba-authored catalogue workbook, 674 rows         | **Commercial authority** (proposed) |
| 77 × `C_<category>_*.xls`            | Flipkart marketplace listing export, 663 unique SKUs | Marketplace artefact, **derived**   |

A conflict is recorded whenever the workbook and a template disagree on a field
the platform stores. MRP agrees 100% — every conflict is on `sellingPrice`,
`size` or `colour`.

---

## 2. The 502 conflicts, by kind

| Kind                            | Count   | Affected designs                               | Field          | Nature                             |
| ------------------------------- | ------- | ---------------------------------------------- | -------------- | ---------------------------------- |
| `price-conflict`                | **288** | A11, A19–A27, A41–A43, A45, A47, A50, A51, A57 | `sellingPrice` | ₹1 drift                           |
| `colour-without-images`         | **127** | 16 designs                                     | `images`       | Media gap, not a data disagreement |
| `colour-conflict`               | **65**  | A15, A22–A27                                   | `colour`       | Spelling or compound colour        |
| `duplicate-template-row`        | **13**  | A02, A06, A41                                  | `*`            | Same SKU in 2 templates            |
| `size-conflict`                 | **6**   | A13, A16, A47                                  | `size`         | Adjacent-size transposition        |
| `untokened-images-multi-colour` | **2**   | A13, A44                                       | `images`       | Filenames carry no colour token    |
| `missing-image-folder`          | **1**   | A17                                            | `images`       | No folder at all                   |
| **Total**                       | **502** |                                                |                |                                    |

> **The 502 figure is a raw count of disagreement _events_, not 502 blocked
> products.** The number that matters for an import run is at the bottom of
> §4: **317 of 674 variants are blocked.** The two differ because a media gap is
> not a data conflict (§3.5) and because 12 of the 13 duplicate-template rows
> name SKUs that are not in the workbook at all (§3.4).

---

## 3. Breakdown by data conflict

### 3.1 Price conflicts — 288 SKUs (57.4% of all conflicts)

Systematic ₹1 drift between the two sources. MRP is **not** affected — it
agrees on every row present in both sources.

| Workbook | Template | Designs affected                                                | SKUs |
| -------- | -------- | --------------------------------------------------------------- | ---- |
| 1398     | 1399     | A11, A19, A20, A21, A22, A24, A25, A26, A27, A45, A47, A50, A51 | 268  |
| 1499     | 1500     | A41, A42, A43, A57                                              | 20   |

**Status: UNRESOLVED.** The workbook value is _recommended_ as canonical
because it is the Ajooba-authored document, but the ₹1 difference is a
deliberate-looking manual edit that may be intentional in one source and
stale in the other. **Requires merchant confirmation.**

### 3.2 Size conflicts — 6 SKUs

Every one is a **transposition of two adjacent sizes within the same colour**.

| SKU             | Workbook `Size` | Template `UK/India Size` |
| --------------- | --------------- | ------------------------ |
| `AJ-A13-IVY-09` | 9               | **10**                   |
| `AJ-A13-IVY-10` | 10              | **9**                    |
| `AJ-A16-BRN-11` | 11              | **12**                   |
| `AJ-A16-BRN-12` | 12              | **11**                   |
| `AJ-A47-BRN-07` | 7               | **8**                    |
| `AJ-A47-BRN-08` | 8               | **7**                    |

**Evidence supporting the workbook:** in all 6 cases the **SKU suffix agrees
with the workbook**. The SKU is the merchant's own identifier and encodes the
size; the template rows are the mis-keyed ones. This is a strong signal, but
it is still a signal rather than a source of truth.

**Status: UNRESOLVED** — recommended resolution is workbook + SKU suffix, with
the correction logged per SKU. **Requires merchant confirmation.**

### 3.3 Colour conflicts — 65 SKUs

Two distinct sub-patterns:

**(a) Spelling — A15, 10 SKUs (`AJ-A15-CHK-06` … `-10`)**

| Workbook `Colour` | Template `Brand Color` |
| ----------------- | ---------------------- |
| `Chickoo`         | `Chiku`                |

`Chickoo` is a misspelling of **Chikoo/Chiku** (a real Indian textile colour
term). The platform preserves the workbook value verbatim and would need an
alias map so both spellings match one filter.

**(b) Compound colour — A22, A23, A24, A25, A26, A27, 55 SKUs**

| Workbook `Colour` | Template `Brand Color` |
| ----------------- | ---------------------- |
| `Brown`           | `Burgundy::Brown`      |
| `Brown`           | `Brown::Burgundy`      |

The `::` separator means **multiple colours for one variant**. The SKU token
is `BRN` and the workbook says `Brown`, but the template claims the variant is
_also_ Burgundy. This is genuinely ambiguous — `Brown::Burgundy` and
`Burgundy::Brown` are semantically identical but imply different primary
colours.

**Status: UNRESOLVED.** The data model stores both: `colour` (workbook) and
`marketplaceColours` (the full template string), so no information is lost and
the ambiguity stays visible rather than being silently collapsed.

### 3.4 Duplicate template rows — 13 SKUs

13 SKUs appear in **two different `.xls` templates**. The extractor keeps the
first template row and drops the duplicate's `euroSize`, `ukIndiaSize` and
`ean`. Those fields are **empty across the entire catalogue**, so nothing is
actually lost.

**But only 1 of the 13 affects the store.** Twelve name SKUs that are **not in
the workbook at all** — they exist only in the templates:

| Template-only duplicate SKUs        | Designs                                |
| ----------------------------------- | -------------------------------------- |
| `AJ-A2-OW-06` … `AJ-A2-OW-12` (7)   | A02                                    |
| `AJ-A6-BLK-06` … `AJ-A6-BLK-10` (5) | A06                                    |
| **`AJ-A41-TAN-10` (1)**             | **A41 — this one IS in the catalogue** |

This is the §7.8 coverage gap in the audit document showing up again: the
templates carry 82 SKUs the workbook does not. Twelve of them are additionally
duplicated across two templates.

**Status: one live conflict.** `AJ-A41-TAN-10` needs the same decision as the
price conflicts. The other 12 are template hygiene, not a platform problem.

### 3.5 Media gaps — 130 rows (not data disagreements)

These are missing photography, not contradictory values. They do not block an
import, but they do make the affected variants unsellable.

| Kind                            | Count | Designs                           |
| ------------------------------- | ----- | --------------------------------- |
| `colour-without-images`         | 127   | 16 designs                        |
| `untokened-images-multi-colour` | 2     | **A13, A44**                      |
| `missing-image-folder`          | 1     | **A17** — no folder exists at all |

> **Do not read 127 as "127 variants have no images."** Ten of those designs
> are **single-colour** designs (A01–A05, A07–A10, A12, A19) whose filenames
> simply carry no colour token (`A1 - 1.jpg`, `A5-3.jpg`, …). The images are
> not missing — the token is absent from the filename, and the import falls back
> to "all folder images belong to this design's only colour variant."
>
> `A13` and `A44` are a different case and _are_ real: both designs sell
> multiple colours and their folder filenames carry no token, so the extractor
> genuinely cannot tell which image belongs to which colour.
>
> **The genuinely missing photography is five designs:** `A14` (Black, Tan),
> `A17` (White — no folder at all), `A30` (Brown), `A48` (Beige), `A57`
> (Chickoo).

### 3.6 The genuinely missing identifier — A17

Design `A17` (9 SKUs, White, sizes 5–13) has **no image folder** in
`public/products/`. It is the only design of 55 with zero photography. It is
importable as data, but it has nothing to display.

**Status: UNRESOLVED** — requires either new photography or a decision to
hide the design in the storefront.

---

## 4. Verified conflict-free rows

This is what a dry run can import today **without touching an ambiguous value**.

| Metric                                       | Count      |
| -------------------------------------------- | ---------- |
| Designs in catalogue                         | 55         |
| **Designs fully conflict-free**              | **22**     |
| Designs partly conflicted                    | 30         |
| Designs blocked entirely                     | 3          |
| Variants (SKUs) total                        | 674        |
| **Variants verified conflict-free**          | **357**    |
| Variants carrying at least one data conflict | 317        |
| Images on fully-clean designs                | 228 of 685 |

### 4.1 Why 502 conflicts block only 317 variants

The 288 + 65 + 6 + 1 figures **overlap**. Most conflicted SKUs are hit by
more than one kind of disagreement, so adding the kinds double-counts:

| Combination of conflicts on one SKU                             | SKUs    |
| --------------------------------------------------------------- | ------- |
| `price-conflict` only                                           | 246     |
| `colour-conflict` **and** `price-conflict`                      | 39      |
| `colour-conflict` only                                          | 25      |
| `size-conflict` only                                            | 4       |
| `price-conflict` **and** `size-conflict`                        | 2       |
| `colour-conflict` + `duplicate-template-row` + `price-conflict` | 1       |
| **Total blocked**                                               | **317** |

39 of the 288 price-conflicted SKUs are _also_ colour-conflicted, so answering
the colour question alone would not unblock them — the price decision is needed
too. This is why the decisions in §7 must be answered together rather than one
at a time.

### 4.2 The dry run

The dry run performed on 22 October 2026 wrote **zero documents**:

```
runId          import-mvjevrbs
dryRun         true
mediaMode      skipped
designsRead    55        designsWritten    0
variantsRead   674       variantsWritten  0
imagesRead     685       imagesUploaded   0
conflicts      502       unresolved       0
```

`unresolved: 0` is the important number — **every one of the 674 rows
validated cleanly against the platform schema.** The conflicts are
source-disagreement, not malformed data.

---

## 5. Identifiers: `A01` vs `AJ-A1` vs `AJ-A01`

The user-visible report of three different codes for one product is **correct
and expected**. They are three different identifiers for three different
things. The confusion is real, but there is no data error to fix.

| Form     | Where it lives                              | Example                         | Zero-padded?        | Meaning                                                       |
| -------- | ------------------------------------------- | ------------------------------- | ------------------- | ------------------------------------------------------------- |
| `A01`    | Workbook `Article Number` / design code     | `A01`, `A33`, `A57`             | **Yes** (2 digits)  | The **design** — a shoe style, independent of colour and size |
| `AJ-A1`  | Image **folder** name in `public/products/` | `AJ-A1`, `AJ-A11`               | **No** (1–2 digits) | The **asset directory** for that design                       |
| `AJ-A01` | Workbook `Seller SKU Id`                    | `AJ-A01-OW-05`, `AJ-A11-BRN-08` | **Yes** (2 digits)  | The **sellable variant** — design + colour + size             |

**Root cause:** the folder names were created by hand or by an older tool that
did not zero-pad. The workbook uses a fixed-width numeric code. Joining the two
by string comparison fails for designs 1–9.

**Correction applied in the pipeline (safe, mechanical, no judgement):**

```
folderNameToDesignCode('AJ-A1')   -> 'A01'
folderNameToDesignCode('AJ-A10')  -> 'A10'
folderNameToDesignCode('Aj-A48')  -> 'A48'   // case-insensitive
```

The match is made on the **numeric** design number, then re-padded to 2
digits. This is verified to resolve all 54 folders with zero orphans and zero
ambiguity. **The folder names themselves are not renamed** — they are source
assets and stay byte-identical on disk.

**Where each identifier appears in the platform:**

| Identifier         | Stored on        | Field                    |
| ------------------ | ---------------- | ------------------------ |
| Design code        | `Product`        | `code` (`A01`)           |
| Asset folder       | `Product`        | `sourceFolder` (`AJ-A1`) |
| Variant identifier | `ProductVariant` | `sku` (`AJ-A01-OW-05`)   |
| Colour token       | `ProductVariant` | `colourToken` (`OW`)     |
| Human colour       | `ProductVariant` | `colour` (`Ivory`)       |

**One thing that must never be "corrected":** three different colour tokens —
`OW` (21 rows), `IVY` (68 rows), `IVR` (9 rows) — all mean **Ivory**. The
token is not a reversible encoding of the colour. Both are stored, separately.

---

## 6. Text encoding

**Finding: there is no encoding corruption in the source data.**

Verified: the workbook and all 674 SKUs are valid UTF-8. The em-dash characters
(`E2 80 94`) present in the source files decode correctly. The `?` characters
observed in earlier output were a **Windows PowerShell console rendering
artefact** — the PowerShell default ANSI codepage cannot render an em-dash and
substitutes `?` on display.

**No source file was re-encoded, rewritten or transcoded.** The pipeline reads
all text as UTF-8 and preserves every character verbatim.

---

## 7. What is needed to unblock the remaining 317 variants

| Decision                                  | Blocks    | Recommended answer                                                  |
| ----------------------------------------- | --------- | ------------------------------------------------------------------- |
| Price authority (workbook vs template)    | 288 SKUs  | Workbook, but confirm the ₹1 is not an intentional price            |
| Colour: `Chickoo`/`Chiku`                 | 10 SKUs   | Keep `Chickoo` as canonical, add `Chikoo`/`Chiku` as filter aliases |
| Colour: `Brown` vs `Burgundy::Brown`      | 55 SKUs   | Confirm whether these are dual-tone shoes or a data-entry error     |
| Size: adjacent transposition              | 6 SKUs    | Workbook + SKU suffix (they agree on all 6)                         |
| Duplicate template row on `AJ-A41-TAN-10` | 1 SKU     | Same ruling as the price question                                   |
| Missing photography (A14/A17/A30/A48/A57) | 5 designs | Commission photography, or mark those variants unavailable          |
| Design codes A52, A53                     | 2 codes   | Discontinued, or missing from the export? No placeholders created   |

> **Answering the price question is the big lever** — 288 of the 317 blocked
> variants carry a price conflict. The colour question adds 65 and the size
> question 6, but 46 of those overlap the price question.

Until these are answered, **317 variants stay out of the catalogue** and the
storefront shows 357 verified variants across 22 designs.

---

## 8. Safety record

| Check                                      | Result                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| Cloudinary uploads during investigation    | **0**                                                     |
| Images written to Cloudinary               | **0** (no credentials configured)                         |
| Production data modified                   | **None** — no production database exists or was contacted |
| Source workbooks/templates/images modified | **None** — opened read-only                               |
| Dry-run writes to MongoDB                  | **0 documents**                                           |
| Test suite target database                 | `ajooba_test_<worker>` — throwaway, in-memory, per-worker |
| Real databases touched by tests            | **None**                                                  |

### Note on local MongoDB

The local MongoDB at `127.0.0.1:27017` is **not dedicated to Ajooba**. It also
hosts `ecommerce` and `paint-visualizer` databases belonging to other projects.
The API only ever addresses `ajooba_development` (by explicit `MONGODB_DB`),
and the import guard refuses to run if the target database name contains
`prod`, `production` or `live`. See `docs/API_CONTRACT.md` §"Environments" for
the isolation guarantees.

The test suite is provably isolated: it connects only to a throwaway
in-memory server whose URI is verified byte-for-byte against the handshake
file published by the Vitest global setup.
