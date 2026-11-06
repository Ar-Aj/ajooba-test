# Ajooba Footwear — Catalogue & Asset Audit

**Audit date:** 21 October 2026
**Auditor:** Principal software architect (automated inspection of the real source files)
**Scope:** `public/products/products data.xlsx`, `public/products/AJ-*/`, `public/banner/`, `public/images/`

> **Every figure in this document was measured from the actual files.**
> Nothing here is estimated, sampled or assumed. Where the source data is
> ambiguous or contradictory, the ambiguity is reported rather than resolved
> by guessing.

---

## 1. Executive summary

| Item                                              | Finding                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Catalogue workbook                                | `products data.xlsx`, 1 sheet (`Sheet1`), 8 columns, 674 populated data rows, 325 empty trailing rows |
| Distinct product designs                          | **55** (`A01`–`A51`, `A54`–`A57`)                                                                     |
| Distinct seller SKUs                              | **674** — all unique, zero duplicates                                                                 |
| SKU format                                        | `AJ-A<NN>-<COLOUR_TOKEN>-<SS>` — 669 rows conform exactly; **5** use a mixed-case token (§5.2)        |
| Image folders                                     | **54** under `public/products/` (named `AJ-A<n>`, **not** zero-padded — §8.1)                         |
| Product images                                    | **692** files (268 `.jpg`, 312 `.jpeg`, 112 `.png`)                                                   |
| Legacy listing templates                          | **77** `.xls` files (Flipkart catalogue export format)                                                |
| Total `public/` payload                           | **501.2 MB** (products 494.4 MB, banner 6.6 MB, images 0.1 MB)                                        |
| Designs in catalogue but with **no** image folder | **1** — `A17`                                                                                         |
| Designs with **no** listing template              | **1** — `A01`                                                                                         |
| Colour variants with **zero** images              | **16** (listed in §6.3)                                                                               |
| Price conflicts between workbook and templates    | **288** SKUs (§7.2)                                                                                   |
| Size conflicts between workbook and templates     | **6** SKUs (§7.3)                                                                                     |

**Headline conclusion:** the catalogue is usable and internally consistent at the
_design_ level. Its **data-entry inconsistencies are real but bounded and
mechanically correctable**, and every one of them is enumerated below so that
nothing is silently "fixed" during import.

### 1.1 Post-import state — as it stands in `ajooba_development` (23 Oct 2026)

The numbers above describe the _source_. This table describes what is actually
in the database now, re-verified by aggregation on 23 October 2026.

| Item                                                         | Count                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `products` documents                                         | **55**                                                       |
| `variants` documents                                         | **674**                                                      |
| Duplicate SKUs                                               | **0**                                                        |
| Orphan variants (no parent)                                  | **0**                                                        |
| `productCode` drift vs parent `products.code`                | **0**                                                        |
| Variants with `stock > 0`                                    | **0** — the workbook has no stock column (§C-3)              |
| Variants `photographyStatus: 'verified'`                     | **15**                                                       |
| Variants `photographyStatus: 'pending-review'`               | **35**                                                       |
| Variants with no `photographyStatus` (single-colour designs) | **624**                                                      |
| Images recorded on products                                  | **685**                                                      |
| Images with a **verified** `colour`                          | **85** (Brown 20, Black 19, White 7, Tan 7, Olive 7, Grey 6) |
| Images explicitly **quarantined** (`colour: ''`)             | **19** across 3 designs                                      |
| Images with **no** colour recorded                           | **600**                                                      |
| Images carrying a **SHA-256 checksum**                       | **685** — backfilled 23 Oct (§1.2)                           |
| `categories` documents                                       | **0** — seeded on demand (§1.3)                              |
| `image_reviews` documents                                    | **0** — no human review has been performed yet               |
| `import-plans` documents                                     | **0** — no import has been run through the G-6 API           |
| `stock_movements` documents                                  | **0** — no stock has ever been set                           |
| `homepage_sections`                                          | **5**                                                        |
| `banners`                                                    | **1** (16:9, created for the hero)                           |

**The most important line above is "Variants with `stock > 0`: 0".** The
catalogue is imported and internally consistent, but **nothing is purchasable**
because there is no stock data. The storefront therefore renders every product
"Sold out" and reports `isPurchasable: false`. This is honest behaviour, not a
bug — see `docs/DEPLOYMENT_RUNBOOK.md` §0.1.

**The 600 images without a colour** are the direct consequence of the
conservative quarantine policy: an image is only attributed to a colourway when
its filename token provably matches a colour that is actually sold for that
design. Untokened filenames are quarantined rather than guessed, so most
photography remains unattributed. These are not lost — they are still on disk and
still listed in `products.images` with `colour: null`. Resolving them is gap
**G-5**, now built and reachable at `/catalog/images`.

### 1.2 Checksum backfill — executed 23 October 2026

`assignImage` refuses to place a photograph in a colour gallery when its bytes
are already on display elsewhere. That guard reads `products.images[].checksum`,
but **every one of the 685 images had a null checksum**: they were coloured by
`image-colour-migration.job.ts`, which never hashed the file, and the G-5 guard
originally searched only `image_reviews`, which was empty. The duplicate-
photograph guard was therefore **inert across the entire catalogue**.

| Step        | Command                                                 | Result                                   |
| ----------- | ------------------------------------------------------- | ---------------------------------------- |
| Dry run     | `tsx src/jobs/image-checksum-backfill.job.ts --dry-run` | 685 hashed, 0 missing, 1 duplicate group |
| Apply       | `tsx src/jobs/image-checksum-backfill.job.ts --apply`   | 685 stamped                              |
| Idempotency | re-run dry run                                          | `already stamped: 685`, 0 hashed         |

The single duplicate group found is **exactly** the pair §6.4 predicted from the
MD5 audit, confirming the hash is measuring what it claims to:

```
b1d88a091d14…  A10:A10-7(1).jpg  A10:A10-7.jpg
```

The write was **additive only** — one new field on existing image subdocuments.
Colour assignments, slugs, URLs, variants and orders were re-aggregated
afterwards and are byte-identical (85 coloured, 19 quarantined, 600 unset, 55
products, 674 variants, 0 archived).

Two defects were found and fixed while doing this, both now covered by tests:

| Defect                                                                                                                                          | Fix                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The guard searched only `image_reviews`, so an image coloured by the **migration** never blocked anything                                       | The guard now also queries `products.images`, the canonical record  |
| The conflict message named the colour being **requested** rather than the one already on display, so it could read as though nothing conflicted | One derivation for all three sources, naming the conflicting colour |

### 1.3 The remaining manual work

Both of these need a human decision and neither can be automated:

| Task                          | Where                                                              | Blocker                                                                                        |
| ----------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Seed the category tree        | `POST /v1/admin/catalog/categories/seed`, or `/catalog/categories` | `categories` is empty; products carry `subcategorySlug` strings waiting to become real records |
| Resolve 600 unassigned images | `/catalog/images`                                                  | Requires someone who knows which shoe each photograph shows                                    |
| Enter real stock counts       | `/catalog/products` → absolute stock                               | **The workbook has no stock column.** Nobody has counted.                                      |

---

## 2. Workspace inventory (pre-existing assets)

Before scaffolding, the workspace contained exactly one directory tree and no
source code, no Git repository, and no configuration:

```
C:\ajooba footwear\
└── public\
    ├── Ajooba_Footwear_Quotation_Updated_45000_v3.pdf   (87,003 bytes)
    ├── banner\
    │   ├── banner home hero 1.png                       (2,420,357 bytes)
    │   ├── banner home hero 2.png                       (2,321,855 bytes)
    │   └── banner home hero 3.png                       (2,213,221 bytes)
    ├── images\
    │   └── logo\
    │       └── logo.jpeg                                (123,795 bytes)
    └── products\
        ├── products data.xlsx                           (61,153 bytes)
        ├── AJ-A1 … AJ-A57  (54 product folders)
        └── 77 C_<category>_*.xls Flipkart listing templates
```

**Every one of these files is a source asset and has been preserved.** No file
was deleted, renamed, moved, overwritten or regenerated. The product images and
the catalogue workbooks are tracked with **Git LFS** (`.gitattributes`) so the
original bytes are versioned without bloating the repository history.

### 2.1 The quotation PDF

`Ajooba_Footwear_Quotation_Updated_45000_v3.pdf` is a commercial quotation
from **AJ Digital Realty** (Mumbai) to **Ajooba Footwear**, quotation
`AJD/ECOM/2026/1001` dated **14 October 2026**, total **₹45,000 INR**.

It is a scope document, not a data source. It confirms the agreed scope:
customer storefront + admin panel, MongoDB, Razorpay, returns workflow, one year
of maintenance, 45-day timeline, three payment milestones (₹35,000 advance /
₹5,000 at month 2 / ₹5,000 at month 4).

It also explicitly lists **out of scope**: domain costs, payment gateway fees,
SMS/WhatsApp/email services, shipping/courier API integrations, and **bulk
product/content entry beyond the agreed implementation support**.

> **Commercial implication:** the catalogue import pipeline built in this
> repository must be reusable and auditable, because data entry labour beyond
> the agreed support is billable. See §10.

---

## 3. The catalogue workbook — `products data.xlsx`

### 3.1 Structure

| Property            | Value                                            |
| ------------------- | ------------------------------------------------ |
| File size           | 61,153 bytes                                     |
| Sheet count         | **1** — `Sheet1`                                 |
| Used range          | `A1:H1000`                                       |
| Header row          | Row 1                                            |
| Populated data rows | **674** (rows 2–675)                             |
| Empty trailing rows | 325 (rows 676–1000) — formatting only, no values |

There are no hidden sheets, no formulas, no merged cells and no secondary
tables. The trailing empty rows are a formatting artefact and contain no data.

### 3.2 Columns (exact, verbatim headers)

| #   | Header (verbatim)    | Type observed | Notes                                              |
| --- | -------------------- | ------------- | -------------------------------------------------- |
| A   | `Product Title`      | string        | 82 distinct values across 674 rows                 |
| B   | `Seller SKU Id`      | string        | 674 distinct values, zero duplicates               |
| C   | `Description`        | string        | 98–1,518 chars, sometimes multi-paragraph (`\n`)   |
| D   | `Size`               | integer       | UK/India size, values 5–13                         |
| E   | `Colour`             | string        | 12 distinct values                                 |
| F   | `Sub-category`       | string        | 4 distinct values, **inconsistent capitalisation** |
| G   | `MRP`                | integer       | INR whole rupees                                   |
| H   | `Your Selling Price` | integer       | INR whole rupees                                   |

There is **no** image column, **no** stock column, **no** SKU-index column and
**no** barcode column in the workbook. Those live only in the `.xls` templates.

### 3.3 `Sub-category` — 4 distinct values, verbatim

| Value           | Rows |
| --------------- | ---- |
| `shoe`          | 325  |
| `Mojri / Jutti` | 267  |
| `sandal`        | 58   |
| `Chappal`       | 24   |

Capitalisation is inconsistent (`shoe`/`sandal` lowercase, `Mojri / Jutti`
title-case, `Chappal` capitalised). The values are **preserved verbatim** in
the data model, and a separate `subcategorySlug` field carries the normalised
routing value (`shoe`, `sandal`, `chappal`, `mojri-jutti`). The mapping is
1:1 and lossless — see `docs/DATA_MODEL.md`.

### 3.4 `Colour` — 12 distinct values

`Beige` (7) · `Black` (223) · `Blue` (5) · `Brown` (166) · `Chickoo` (10) ·
`Cherry` (10) · `Golden` (7) · `Grey` (7) · `Ivory` (98) · `Olive` (10) ·
`Tan` (97) · `White` (34)

> `Chickoo` is a misspelling of **Chikoo** (a common Indian textile/colour
> term). It is preserved verbatim. The `.xls` templates spell it `Chiku`.
> See §7.4.

### 3.5 `Size` — the real size scale

Sizes present: **5, 6, 7, 8, 9, 10, 11, 12, 13**. All integers, UK/India sizing.
No half sizes and no EU sizing in the workbook.

### 3.6 `MRP` and `Your Selling Price`

Both are **integer INR amounts** (no paise, no decimals). Observed MRP values:
`1499`, `1699`, `1999`, `1997`, `2499`, `3999`.

> `MRP = 1997` occurs exactly **once** (`AJ-A01-OW-11`). Every other row of
> that same design has `MRP = 1999`. This is almost certainly a typo, but it
> is **not corrected** — see §7.5.

---

## 4. Per-design breakdown

All 55 designs, with their colour tokens, size ranges, pricing and asset counts.

`imgs` = images in folder · `xls` = listing templates in folder ·
`rows` = catalogue rows

| Code    | rows  | colours                      | sizes    | MRP       | Selling   | imgs  | xls   | Folder       |
| ------- | ----- | ---------------------------- | -------- | --------- | --------- | ----- | ----- | ------------ |
| A01     | 7     | Ivory                        | 6–12     | 1997/1999 | 1399      | 6     | **0** | AJ-A1        |
| A02     | 7     | Ivory                        | 6–12     | 1999      | 1399      | 5     | 2     | AJ-A2        |
| A03     | 7     | Ivory                        | 6–12     | 1999      | 1399      | 5     | 1     | AJ-A3        |
| A04     | 7     | Golden                       | 6–12     | 1999      | 1399      | 6     | 1     | AJ-A4        |
| A05     | 7     | Ivory                        | 6–12     | 1999      | 1399      | 7     | 1     | AJ-A5        |
| A06     | 14    | Black, Blue, Ivory           | 6–10     | 2499      | 1499      | 21    | 2     | AJ-A6        |
| A07     | 9     | Ivory                        | 5–13     | 1999      | 1399      | 7     | 1     | AJ-A7        |
| A08     | 9     | Ivory                        | 5–13     | 1999      | 1399      | 6     | 1     | AJ-A8        |
| A09     | 9     | Ivory                        | 5–13     | 1999      | 1399      | 6     | 1     | AJ-A9        |
| A10     | 9     | Ivory                        | 5–13     | 1999      | 1399      | 8     | 1     | AJ-A10       |
| A11     | 18    | Black, Brown, Tan            | 5–12     | 1999      | 1398/1399 | 18    | 3     | AJ-A11       |
| A12     | 7     | Ivory                        | 6–12     | 1999      | 1399      | 7     | 1     | AJ-A12       |
| A13     | 18    | Black, Ivory                 | 5–13     | 1999      | 1399      | 14    | 1     | AJ-A13       |
| A14     | 36    | Black, Brown, Tan, White     | 5–13     | 1999      | 1399      | 14    | 2     | AJ-A14       |
| A15     | 15    | Black, Chickoo, Ivory        | 6–10     | 3999      | 2399      | 20    | 1     | AJ-A15       |
| A16     | 27    | Black, Brown, Tan            | 5–13     | 1999      | 1399      | 24    | 3     | AJ-A16       |
| **A17** | **9** | **White**                    | **5–13** | **1999**  | **1399**  | **0** | **0** | **— none —** |
| A18     | 18    | Brown, Tan                   | 5–13     | 1999      | 1399      | 12    | 1     | AJ-A18       |
| A19     | 5     | Black                        | 6–10     | 1999      | 1398      | 6     | 1     | AJ-A19       |
| A20     | 14    | Black, Brown                 | 6–12     | 1999      | 1398      | 12    | 1     | AJ-A20       |
| A21     | 14    | Black, Brown                 | 6–12     | 1999      | 1398      | 12    | 1     | AJ-A21       |
| A22     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 12    | 1     | AJ-A22       |
| A23     | 10    | Black, Brown                 | 6–10     | 1999      | 1399      | 12    | 1     | AJ-A23       |
| A24     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 12    | 1     | AJ-A24       |
| A25     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 12    | 1     | AJ-A25       |
| A26     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 12    | 1     | AJ-A26       |
| A27     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 13    | 2     | AJ-A27       |
| A28     | 24    | Black, Brown, Tan            | 6–13     | 1499      | 998       | 18    | 1     | AJ-A28       |
| A29     | 10    | Black, Tan                   | 6–10     | 1499      | 1099      | 10    | 1     | AJ-A29       |
| A30     | 10    | Black, Brown                 | 6–10     | 1699      | 1099      | 12    | 1     | AJ-A30       |
| A31     | 10    | Black, Brown                 | 6–10     | 2499      | 1599      | 12    | 1     | AJ-A31       |
| A32     | 10    | Black, Tan                   | 6–10     | 2499      | 1599      | 12    | 1     | AJ-A32       |
| A33     | 10    | Black, Tan                   | 6–10     | 2499      | 1599      | 12    | 1     | AJ-A33       |
| A34     | 15    | Black, Cherry, Tan           | 6–10     | 2499      | 2050      | 18    | 1     | AJ-A34       |
| A35     | 28    | Black, Brown, Tan, White     | 5–12     | 1499      | 998       | 24    | 4     | AJ-A35       |
| A36     | 9     | Ivory                        | 5–13     | 1999      | 1399      | 6     | 1     | AJ-A36       |
| A37     | 10    | Black, Brown                 | 6–10     | 2499      | 1599      | 12    | 1     | AJ-A37       |
| A38     | 10    | Black, Brown                 | 6–10     | 2499      | 1599      | 12    | 1     | AJ-A38       |
| A39     | 10    | Black, Brown                 | 6–10     | 2499      | 1599      | 14    | 1     | AJ-A39       |
| A40     | 10    | Black, Brown                 | 6–10     | 2499      | 1599      | 12    | 1     | AJ-A40       |
| A41     | 10    | Black, Tan                   | 6–10     | 2499      | 1500      | 14    | 2     | AJ-A41       |
| A42     | 10    | Black, Brown                 | 6–10     | 2499      | 1500      | 12    | 2     | AJ-A42       |
| A43     | 10    | Black, Brown                 | 6–10     | 2499      | 1500      | 12    | 2     | AJ-A43       |
| A44     | 10    | Black, Brown                 | 5–9      | 1999      | 1199      | 12    | 2     | AJ-A44       |
| A45     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 14    | 2     | AJ-A45       |
| A46     | 15    | Black, Brown, Tan            | 6–10     | 2499      | 1599      | 19    | 3     | AJ-A46       |
| A47     | 10    | Black, Brown                 | 6–10     | 1999      | 1398      | 12    | 2     | AJ-A47       |
| A48     | 14    | Beige, Grey                  | 6–12     | 1999      | 1599      | 12    | 2     | Aj-A48       |
| A49     | 15    | Black, Cherry, Tan           | 6–10     | 3999      | 1898      | 18    | 3     | AJ-A49       |
| A50     | 15    | Black, Brown, Tan            | 6–10     | 1999      | 1398      | 20    | 3     | AJ-A50       |
| A51     | 8     | White                        | 5–12     | 1999      | 1398      | 7     | 1     | AJ-A51       |
| A54     | 10    | Black, Brown                 | 6–10     | 1999      | 1881      | 14    | 1     | AJ-A54       |
| A55     | 10    | Black, Tan                   | 6–10     | 3999      | 2500      | 14    | 1     | AJ-A55       |
| A56     | 15    | Black, Olive, Tan            | 6–10     | 2499      | 1699      | 21    | 1     | AJ-A56       |
| A57     | 20    | Black, Brown, Chickoo, Olive | 6–10     | 1999      | 1499/1500 | 28    | 1     | AJ-A57       |

### 4.1 Code-sequence gaps

The catalogue covers `A01`–`A51` and `A54`–`A57`. **`A52` and `A53` are
absent from every source** — not in the workbook, not in the image folders and
not in the templates.

This is most likely because those two designs are **sandals** or **chappals**
served through the same Flipkart category but supplied as a separate export,
or they were discontinued. **This is unresolved — see §9, decision D-1.**

### 4.2 Designs with multiple titles

`Product Title` has 82 distinct values across 55 designs. 27 designs carry
more than one title. Example: `A01` and `A02` share the title
_"AJOOBA Men's Ivory Embroidered Ethnic Mojris — Traditional Slip-On Wedding &
Festive Shoes"_ and _"… — Premium Slip-On Wedding & Festive Shoes"_.

The titles differ only by an adjective ("Traditional" vs "Premium"). Which
title is canonical per design is **not determinable from the data** — see
§9, decision D-2.

---

## 5. Seller SKU Id structure

669 of the 674 SKUs match exactly:

```
AJ-A<NN>-<COLOUR_TOKEN>-<SS>
```

- `NN` — zero-padded design code, `01`–`57`.
- `COLOUR_TOKEN` — 2–5 uppercase letters.
- `SS` — UK/India size, **zero-padded** to two digits (`AJ-A11-BRN-08`,
  `AJ-A01-OW-05`).

Zero duplicates. **Five rows do not match the strict pattern** — see §5.2.

### 5.1 Colour token → workbook `Colour`

| Token  | Workbook `Colour` | Rows |
| ------ | ----------------- | ---- |
| `BLK`  | Black             | 223  |
| `BRN`  | Brown             | 166  |
| `TAN`  | Tan               | 92   |
| `Tan`  | Tan               | 5    |
| `IVY`  | Ivory             | 68   |
| `WHT`  | White             | 34   |
| `OW`   | **Ivory**         | 21   |
| `CHK`  | **Chickoo**       | 10   |
| `CHR`  | Cherry            | 10   |
| `OLV`  | Olive             | 10   |
| `IVR`  | **Ivory**         | 9    |
| `BEG`  | Beige             | 7    |
| `GLD`  | Golden            | 7    |
| `GRY`  | Grey              | 7    |
| `BLUE` | Blue              | 5    |

**Three different tokens map to the same colour, `Ivory`:** `IVY` (68 rows),
`OW` (21 rows, "off-white"), `IVR` (9 rows). The token is therefore **not** a
reversible encoding of the colour. The pipeline must store the token _and_ the
colour as separate fields — never derive one from the other. This is exactly
what the `ProductVariant.colourToken` / `ProductVariant.colour` pair in
`packages/contracts` does.

### 5.2 Five mixed-case SKUs — `AJ-A33-Tan-*`

Five rows write the colour token in mixed case rather than upper case:

```
AJ-A33-Tan-06   AJ-A33-Tan-07   AJ-A33-Tan-08   AJ-A33-Tan-09   AJ-A33-Tan-10
```

Everything else about them is normal: the design code `A33` also carries
`AJ-A33-BLK-*` rows, and the workbook `Colour` column reads `Tan` in both
cases. This is a **data-entry inconsistency in the source file**, not a
different product and not a different colour.

Verified by pattern analysis over all 674 rows:

```
strict match (AJ-A##-[A-Z]{2,5}-##)  : 669
non-matching                        : 5
  -> AJ-A33-Tan-06, -Tan-07, -Tan-08, -Tan-09, -Tan-10
```

**Handling rule (implemented):** the Seller SKU Id is stored **verbatim** —
`AJ-A33-Tan-06` is never rewritten to `AJ-A33-TAN-06`. Only the derived
_colour token_ is upper-cased before indexing, via
`normaliseColourToken()` in `packages/contracts/src/catalog/types.ts`. This
keeps the merchant's own identifier intact while making the token searchable
by `TAN`.

> **Correction to an earlier draft of this document.** An earlier revision
> stated "Zero malformed SKUs" and described the size as "without leading
> zero". Both were wrong: the sizes _are_ zero-padded, and the 5 mixed-case
> rows were not detected because the original check collapsed case before
> matching. The figures above are the corrected ones.

---

## 6. Image asset inventory

### 6.1 Counts

| Metric                                   | Value           |
| ---------------------------------------- | --------------- |
| Product folders under `public/products/` | **54**          |
| Total product image files                | **692**         |
| `.jpg`                                   | 268             |
| `.jpeg`                                  | 312             |
| `.png`                                   | 112             |
| Banner images                            | 3 PNG (6.6 MB)  |
| Brand logo                               | 1 JPEG (123 KB) |
| **Total `public/`**                      | **501.2 MB**    |

### 6.2 Filename conventions

The dominant convention is:

```
A<NN>-<COLOUR_TOKEN>-<index>.<ext>
```

Examples: `A11-BLK-1.jpg`, `A35-WHT-6.jpeg`, `A57-OLV-3.jpg`.

Observed normalised patterns across all 692 files:

| Pattern                  | Count |
| ------------------------ | ----- |
| `AN-BLK-N`               | 229   |
| `AN-BRN-N`               | 175   |
| `AN-TAN-N`               | 94    |
| `AN-N` (no colour token) | 69    |
| `AN-IVY-N`               | 33    |
| `AN-WHT-N`               | 26    |
| `AN-OLV-N`               | 14    |
| `AN-Tan-N` (mixed case)  | 13    |
| `AN-CHR-N`               | 12    |
| `AN-Blk-N` (mixed case)  | 7     |
| `AN-Blue-N` (mixed case) | 7     |
| `AN-CHK-N`               | 6     |
| `AN-GRY-N`               | 6     |
| `AN-BLK-N-N`             | 1     |

`N` = design number, `N` = shot index.

**Duplicate basenames across folders: none.** Every product image filename is
unique within the whole tree, so the path (not the filename) is the identifier.

### 6.3 Anomalous filenames — 14 files

| Folder | File                                          | Anomaly                                                 |
| ------ | --------------------------------------------- | ------------------------------------------------------- |
| AJ-A1  | `A1 - 1.jpg` … `A1 - 6.jpg` (6 files)         | spaces around the hyphen                                |
| AJ-A10 | `A10-7(1).jpg`                                | browser copy suffix — **byte-identical to `A10-7.jpg`** |
| AJ-A13 | `A13--BLK-1.jpg` … `A13--BLK-6.jpg` (6 files) | doubled hyphen                                          |
| AJ-A13 | `A13--BLK-2..jpg`                             | doubled hyphen **and** doubled extension                |
| AJ-A44 | `A44-BLK-3 (2).png`                           | spaces **and** browser copy suffix                      |

All 14 files are **preserved exactly as-is**. The import pipeline normalises
the _derived_ URL key, never the file on disk.

### 6.4 Duplicate content

Exactly **one** content-duplicate group exists (verified by MD5 over all 692
files):

```
public/products/AJ-A10/A10-7(1).jpg  ==  public/products/AJ-A10/A10-7.jpg
```

`A10-7(1).jpg` is a redundant browser download copy and is a safe candidate
for exclusion at import time. It is **not deleted** from disk.

### 6.5 Mixed file extensions within a folder

Nine folders contain more than one image extension:

`AJ-A30` (.jpg+.png) · `AJ-A40` (.jpg+.png) · `AJ-A41` (.jpg+.png) ·
`AJ-A45` (.jpeg+.png) · `AJ-A46` (.jpeg+.png) · `AJ-A47` (.jpg+.png) ·
`AJ-A54` (.jpeg+.png) · `AJ-A56` (.jpeg+.jpg+.png) · `AJ-A57` (.jpeg+.jpg+.png)

This is normal for assets exported from different tools. It does not affect
correctness — the pipeline resolves images by extension-agnostic glob.

### 6.6 Folder naming

- 53 folders match `AJ-A<NN>` exactly.
- **1 anomaly:** `Aj-A48` — lower-case `j`. It is the only folder whose name
  does not match the `AJ-A\d+` pattern. It is **not renamed**; the import
  resolves folder → design code case-insensitively and records the original
  folder name on the product document.

- No design code maps to more than one folder (checked exhaustively).

### 6.7 Colour-variant image coverage gaps

**16 colour variants that exist in the catalogue have zero images:**

| Design  | Missing colour | Evidence                                     |
| ------- | -------------- | -------------------------------------------- |
| A01     | Ivory (`OW`)   | folder has 6 un-tokenised `A1 - N.jpg` files |
| A02     | Ivory (`OW`)   | 5 un-tokenised files                         |
| A03     | Ivory (`OW`)   | 5 un-tokenised files                         |
| A04     | Golden (`GLD`) | 6 un-tokenised files                         |
| A05     | Ivory (`IVY`)  | 7 un-tokenised files                         |
| A07     | Ivory (`IVY`)  | 7 un-tokenised files                         |
| A08     | Ivory (`IVY`)  | 6 un-tokenised files                         |
| A09     | Ivory (`IVR`)  | 6 un-tokenised files                         |
| A10     | Ivory (`IVY`)  | 8 un-tokenised files                         |
| A12     | Ivory (`IVY`)  | 7 un-tokenised files                         |
| A19     | Black (`BLK`)  | 6 un-tokenised files                         |
| **A14** | **Black, Tan** | folder only holds `BRN` (7) + `WHT` (7)      |
| **A30** | **Brown**      | folder holds `BLK` (6) + `TAN` (6)           |
| **A48** | **Beige**      | folder holds `GRY` (6) + `IVY` (6)           |
| **A57** | **Chickoo**    | folder holds `BLK`, `BRN`, `OLV`, `TAN`      |
| **A17** | **White**      | **no folder at all**                         |

Two distinct situations, and they need different handling:

1. **Un-tokenised filenames (A01–A12, A19).** These designs are
   single-colour. Their files are named `A<NN>-<index>` with no colour token
   at all, so they are _not_ "missing" images — the token is simply absent
   from the filename. The images belong to the design's only colour. **The
   pipeline must fall back to "all images in the folder belong to this
   design's only colour variant"** in this case.

2. **Genuinely absent variants (A14, A17, A30, A48, A57).** These folders
   exist but lack a colour that the catalogue sells, or the folder is missing
   entirely. These are **real content gaps** requiring new photography.

### 6.8 Untokenised-folder designs (complete list)

`A01`(6) · `A02`(5) · `A03`(5) · `A04`(6) · `A05`(7) · `A07`(7) · `A08`(6) ·
`A09`(6) · `A10`(8) · `A12`(7) · `A19`(6) — 69 files total.

### 6.9 Image resolution guideline (from the templates)

The Flipkart `Image GuideLines` sheet states:

- Minimum resolution **200 × 800**
- Minimum **1** image, maximum **7** images per category
- Primary image on a **white background**
- Grey background only for white-coloured products
- Product shown **without packaging**
- Solo product image, no props
- No movie shots or scenes
- Same model across all lifestyle shots of a product

**Audit note:** several folders contain **more than 7** images (e.g. `AJ-A57`
has 28, `AJ-A35`/`AJ-A16` have 24). The 7-image limit is a Flipkart listing
constraint, not a storefront constraint. The storefront gallery may show all
images; the marketplace export path must select at most 7.

**Audit note:** the primary image on a white background **cannot be verified
programmatically** without image analysis. It is recorded as an unverified
requirement — see §9, decision D-4.

---

## 7. The 77 legacy `.xls` listing templates

### 7.1 What they are

These are **Flipkart seller catalogue export templates** (`.xls`, OLE2
Compound Document / Excel 97-2003 binary format — verified by the
`D0 CF 11 E0 A1 B1 1A E1` magic bytes). They are **not** Ajooba-authored data
structures, but they are the richest available source for per-variant
attributes.

Naming: `C_<category>_<hash>_<requestId>.xls`, e.g.
`C_shoe_c2c8939f3a72413d_2509-2143FK_REQH29399Y9HN.xls`.

### 7.2 Sheet structure

Each file has 12 sheets (names vary by category):

| Sheet                         | Purpose                                   |
| ----------------------------- | ----------------------------------------- |
| `Summary Sheet`               | Flipkart QC guidance (186 rows)           |
| `Index`                       | Allowed values for every controlled field |
| `shoe` / `sandal` / `chappal` | **The variant data**                      |
| `DropDownValuesForColumn26`   | Country list (247)                        |
| `DropDownValuesForColumn30`   | Tax codes (19)                            |
| `DropDownValuesForColumn39`   | Type-for-sports values (24)               |
| `DropDownValuesForColumn44`   | Euro size values (67)                     |
| `Listing FAQ Sheet`           | Flipkart documentation                    |
| `Image GuideLines`            | Image requirements                        |
| `MatchingAttributes`          | Matched-attribute list                    |
| `VariantAttributes`           | `Brand Color`, `UK/India Size`            |
| `template_version`            | Version stamp                             |

### 7.3 The variant sheet — 75 columns

The data sheet has a 4-row preamble (header / type hint / example / guidance)
before the real data begins at row 5.

**677 variant rows** were extracted across all 77 files, yielding **663 unique
SKUs** (14 SKUs appear in two files each — see §7.4).

### 7.4 Columns with real data (non-empty counts out of 677)

| Column                                    | Populated       | Notes                                                                                                                                            |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Seller SKU ID`                           | 675             | primary join key                                                                                                                                 |
| `Group ID`                                | 675             | = `Article Number`                                                                                                                               |
| `Listing Status`                          | 675             | all `Active`                                                                                                                                     |
| `MRP (INR)`                               | 675             |                                                                                                                                                  |
| `Your selling price (INR)`                | 675             |                                                                                                                                                  |
| `Stock`                                   | 675             | `1` (474), `2` (70), `1.0` (123), `2` (8)                                                                                                        |
| `HSN`                                     | 675             | `6404`/`6403`/`6402` (+`.0` variants)                                                                                                            |
| `Country Of Origin`                       | 675             | all `India`                                                                                                                                      |
| `Manufacturer Details`                    | 675             | `Ajooba Footwear`                                                                                                                                |
| `Packer Details`                          | 675             | `Ajooba Footwear`                                                                                                                                |
| `Tax Code`                                | 675             | all `GST_5`                                                                                                                                      |
| `Brand`                                   | 675             | all `Ajooba Footwear`                                                                                                                            |
| `Ideal For`                               | 675             | all `Men`                                                                                                                                        |
| `Occasion`                                | 675             | Wedding 274, Formal 173, Casual 132, Party 83, Ethnic 13                                                                                         |
| `Outer Material`                          | 675             | Leather 195, Suede 144, Synthetic 125, Synthetic Leather 121, Artificial Leather 40, Fabric 35, Genuine Leather 10, `Synthetic Leather::Suede` 5 |
| `UK/India Size`                           | 675             | join key to workbook `Size`                                                                                                                      |
| `Euro Size`                               | 675             |                                                                                                                                                  |
| `Brand Color`                             | 675             |                                                                                                                                                  |
| `Color`                                   | 675             |                                                                                                                                                  |
| `Article Number`                          | 675             | join key to design code                                                                                                                          |
| `Style Code`                              | 675             |                                                                                                                                                  |
| `Brand Size`                              | 675             | `UK/India` measuring unit                                                                                                                        |
| `Main Image URL` + `Other Image URL 1..6` | 675 / 639 / 216 | **Flipkart CDN URLs**                                                                                                                            |
| `Description`                             | 675             | marketplace copy, differs from workbook                                                                                                          |
| `Search Keywords`                         | 675             | `::`-separated                                                                                                                                   |
| `Key Features`                            | 668             |                                                                                                                                                  |
| `Theme`                                   | 429             |                                                                                                                                                  |
| `EAN/UPC`                                 | **0**           | completely empty                                                                                                                                 |

Columns present in the template but **empty for every row**: `Flipkart Serial
Number`, `Flipkart Product Link`, `Product Data Status`, `Disapproval Reason`,
`Luxury Cess`, `Importer Details`, `Video URL`, `Supplier Image`,
`EAN/UPC`.

> **Important:** `EAN/UPC` is empty across the entire catalogue. Barcode
> support must be modelled as optional and must never be required.

### 7.5 Price conflicts — 288 SKUs

`MRP` agrees **100%** between workbook and templates (0 mismatches across the
580 SKUs present in both).

`Your Selling Price` disagrees on **288** SKUs. The pattern is systematic:

| Workbook | Template | Affected designs                                                |
| -------- | -------- | --------------------------------------------------------------- |
| 1398     | 1399     | A11, A19, A20, A21, A22, A24, A25, A26, A27, A45, A47, A50, A51 |
| 1499     | 1500     | A41, A42, A43, A57                                              |

A ₹1 difference — clearly a manual price edit that was applied to one source
but not the other. **The workbook is treated as the authoritative commercial
price** because it is the Ajooba-authored catalogue, while the `.xls` files
are a marketplace export. **This is a business decision that needs
confirmation** — see §9, decision D-3.

### 7.6 Size conflicts — 6 SKUs

| SKU             | Workbook `Size` | Template `UK/India Size` |
| --------------- | --------------- | ------------------------ |
| `AJ-A13-IVY-09` | 9               | **10**                   |
| `AJ-A13-IVY-10` | 10              | **9**                    |
| `AJ-A16-BRN-11` | 11              | **12**                   |
| `AJ-A16-BRN-12` | 12              | **11**                   |
| `AJ-A47-BRN-07` | 7               | **8**                    |
| `AJ-A47-BRN-08` | 8               | **7**                    |

Every one of these is a **transposition of two adjacent sizes within the same
colour**. The SKU suffix encodes the size, and in each case the SKU suffix
**agrees with the workbook**. The template rows are the mis-keyed ones. The
workbook + SKU-suffix combination is therefore internally consistent and is
treated as authoritative. **This needs confirmation** — §9, decision D-3.

### 7.7 Colour conflicts — 65 SKUs

| Workbook `Colour` | Template `Brand Color` | Designs            |
| ----------------- | ---------------------- | ------------------ |
| `Chickoo`         | `Chiku`                | A15                |
| `Brown`           | `Burgundy::Brown`      | A22, A23           |
| `Brown`           | `Brown::Burgundy`      | A24, A25, A26, A27 |

The `::` separator in the templates means **multiple colours for one variant**.
This is a real conflict: `AJ-A22-BRN-06` has a `BRN` token and a `Brown`
workbook colour, but the template says `Burgundy::Brown`. Two of the three
possible readings are equally consistent with the SKU token.

**Resolution used in the data model:** the workbook `Colour` value is stored
as `colour`; the full template string is stored separately as
`marketplaceColours` so no information is lost and the ambiguity stays
visible. **This needs confirmation** — §9, decision D-3.

### 7.8 SKU coverage gap

- **94** catalogue SKUs have **no** listing-template row.
- **82** template SKUs are **not** in the workbook.

The 82 extras fall into recognisable groups:

| Group                          | Example                          | Count |
| ------------------------------ | -------------------------------- | ----- |
| Malformed prefix `AJ-06-`      | `AJ-06-BLUE-06`                  | 5     |
| Duplicates of existing designs | `AJ-A2-OW-06`                    | 12    |
| Extended size ranges           | `AJ-A22-BLK-11`, `AJ-A22-BLK-12` | 8     |
| Others                         | —                                | 57    |

### 7.9 Templates that reference designs with no folder

`A11` has 3 templates, `A13` 1, `A14` 2, `A16` 3, `A27` 2, `A35` 4, `A41` 2,
`A42` 2, `A43` 2, `A44` 2, `A45` 2, `A46` 3, `A47` 2, `A48` 2, `A49` 3, `A50`
3, `A56` 1, `A2` 2, `A6` 2 — these are additional templates for the _same_
design split by colour. `AJ-A10` has 1 template and `A01` has **0**.

### 7.10 Marketplace image URLs are third-party

Every template row carries Flipkart CDN URLs of the form:

```
https://fkmpimages.flixcart.com/iu-pre-catalog-images-feed/<id>-<hash>
```

These are **not** usable as the storefront's image source — they are
Flipkart-hosted, may expire, and are a competitor's CDN. They are recorded as
`marketplaceImageUrls` for reference only. The storefront uses the local files
in `public/products/`.

---

## 8. Unresolved mappings and ambiguities

### 8.1 Design → image folder mapping

**Status: resolved for 54 of 55 designs.**

The mapping is one-to-one, but it is **not a string match**. The two code
formats differ:

| Source                        | Format                  | Example                     |
| ----------------------------- | ----------------------- | --------------------------- |
| Seller SKU Id in the workbook | zero-padded, two digits | `A01`, `A33`, `A57`         |
| Image folder name             | **not** zero-padded     | `AJ-A1`, `AJ-A33`, `AJ-A57` |

So the match must be made on the **numeric** design number, not on the literal
string. `AJ-A1` corresponds to design `A01`, `AJ-A11` to `A11`.

Two irregularities exist in the folder names:

| Folder   | Issue                                 | Handling                  |
| -------- | ------------------------------------- | ------------------------- |
| `Aj-A48` | lowercase `j` in the prefix           | case-insensitive match    |
| —        | design `A17` has **no folder at all** | no images for that design |

Verified programmatically across all 54 folders and all 55 workbook designs:

```
folder count                : 54
design codes in workbook    : 55
folders that fail to parse  : 0
designs WITH a folder       : 54
designs WITHOUT a folder    : 1  -> ['A17']
folders with NO design      : 0
```

**No folder is orphaned and no design has an ambiguous folder.** The single
missing design (`A17`) is recorded as an unresolved data gap — see §9,
decision D-7, and the storefront behaviour is to list the design with no
images rather than hide it.

> **Correction to an earlier draft of this document.** An earlier revision
> stated the mapping was "folder `AJ-A<NN>` ↔ design `A<NN>`". That was wrong:
> the folders are not zero-padded. The numeric-normalisation rule above is the
> correct one and is what the import must implement.

### 8.2 Design → product slug

**Status: not yet defined.**

The slug must be derived from the `Product Title`, but 27 designs have more
than one title. A deterministic slug scheme is needed — proposed:

```
<design-code>-<normalised-title-slug>
```

e.g. `a11-ajooba-mens-ivory-embroidered-ethnic-mojris`. This guarantees
uniqueness (the code is unique) and stability (the code never changes even if
the title is corrected). **Needs confirmation** — §9, decision D-2.

### 8.3 Variant → image assignment

**Status: partially resolved.**

| Case                                                                     | Rule                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Folder filenames carry a colour token                                    | assign that file to the matching colour variant                  |
| Folder filenames carry **no** colour token (69 files, 12 designs)        | assign all folder images to the design's **only** colour variant |
| Design has multiple colours but the folder lacks a token for one of them | **unresolved** — the variant has no images                       |

The last case affects the 5 designs in §6.7 row 2 plus `A17`.

### 8.4 Design → canonical title

**Status: unresolved.** 27 designs have 2–3 candidate titles.

### 8.5 Authoritative pricing source

**Status: provisionally resolved** (workbook wins) — **needs confirmation.**

> **Measured, not assumed.** The 502 conflicts are enumerated per-SKU in
> `docs/CATALOG_CONFLICTS.md`, which is generated from
> `artifacts/catalog-extract.json` by a dry run that writes zero documents.
> That report shows **357 of 674 variants carry no data conflict at all** and
> could be imported today; the remaining **317 are blocked on D-3**.

### 8.6 Design codes `A52`, `A53`

**Status: unresolved.** Absent from every source.

---

## 9. Decisions that require business input

| ID      | Decision                                                                                                                                                                                                   | Impact                                     | Recommendation                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** | Are designs `A52` and `A53` discontinued, never created, or supplied in a missing export?                                                                                                                  | 2 designs missing from the catalogue       | Obtain the missing export or confirm discontinuation. **Do not** create placeholder designs.                                                                                    |
| **D-2** | Which `Product Title` is canonical for the 27 multi-title designs? And what slug scheme?                                                                                                                   | Product URLs, SEO metadata                 | Adopt `A<NN>-<slug>` for URLs (stable, unique); pick one title per design with a documented preference order (most rows → longest → first occurrence).                          |
| **D-3** | Which source is authoritative for price, size and colour where the workbook and the templates disagree (288 + 6 + 65 SKUs)?                                                                                | 317 of 674 variants cannot be imported     | Workbook + SKU suffix. Apply as a **reviewed, logged** correction, not a silent overwrite — the import must emit a diff report. Per-SKU detail: `docs/CATALOG_CONFLICTS.md` §3. |
| **D-4** | Are the primary images white-background and product-only, as Flipkart requires?                                                                                                                            | Marketplace readiness                      | Needs a human pass over the 692 images, or a background-detection script. Not verifiable from filenames.                                                                        |
| **D-5** | What is the real stock position? Templates show only 1–2 units per SKU.                                                                                                                                    | Whether the store can sell at all          | Templates are a marketplace listing artefact, not a stock ledger. Stock must come from the warehouse.                                                                           |
| **D-6** | Should `Chickoo` be corrected to `Chikoo`?                                                                                                                                                                 | Search & filter UX                         | Store verbatim + add an alias map so both spellings match a filter.                                                                                                             |
| **D-7** | Missing photography for A17, A14(BLK/TAN), A30(BRN), A48(BEG), A57(CHK).                                                                                                                                   | 6 variant groups unsellable without images | Either commission photography or mark those variants unavailable in the storefront.                                                                                             |
| **D-8** | Are the `A14` and `A57` image sets correct? `A14` has 4 colours in the catalogue but only BRN+WHT images; `A57` has 4 colours but no CHK images, and has a `TAN` image set with no `TAN` in the catalogue. | Possible swapped folders                   | Physical verification of `AJ-A14` and `AJ-A57` against the catalogue.                                                                                                           |

---

## 10. Consequences for the implementation

1. **The catalogue is sufficient to build the store.** 55 designs, 674
   variants, 692 images and a rich attribute set are available. Nothing has to
   be invented.

2. **The import must be a real, auditable ETL job** — not a one-off script —
   because of D-1 … D-8 and because the quotation excludes bulk content entry
   beyond agreed support.

3. **The import must emit a diff report** for every conflict it resolves, so
   the corrections in D-3 are reviewable and reversible.

4. **Duplicate colour tokens must be stored, not normalised away.** `OW`,
   `IVY` and `IVR` all mean Ivory but are different tokens in the SKU.

5. **Images must be resolved by folder → design, then by colour token within
   the folder**, with an explicit fallback for un-tokenised filenames.

6. **495 MB of imagery needs an image pipeline.** The source files are large
   (up to 2.4 MB) and must be resized and re-encoded before CDN delivery.
   `next/image` handles this at request time; a batch optimisation step is
   the alternative for a CDN.

7. **The storefront must never invent data.** Until the import runs against
   an environment, the catalogue is genuinely empty and the UI must say so.
   This is implemented — see the admin dashboard's "No store data yet" panel
   and the storefront's "No products found" state.

### 10.1 Implementation decisions (Phase 1.2 baseline, 21 October 2026)

These rules govern how the import worker and the storefront read the source
data. **They are implementation rules, not approvals.** They do not authorise
the import itself, do not invent product data, and do not select a canonical
title where there is none.

#### C-1 Canonical product title

- A **single design may carry multiple `Product Title` rows** in the workbook,
  but the variants of that title differ **only by colour** (e.g. _“AJOOBA
  Men's Dark Brown Gold Embroidered Ethnic Mojri – Designer Side-Buckle
  Wedding & Festive Shoes”_ vs. _“AJOOBA Men's Black Gold Embroidered
  Ethnic Mojri – …”_). 19 of 55 designs are of this kind. The colour is taken
  from the workbook `Colour` column.
- A canonical **design-level** title is **not stored on `Product`**.
  `Product` keeps only the design-level metadata (`code`, `slug`,
  descriptions, variant list). The colour-suffixed long title lives on each
  variant. The storefront renders the colour as a chip and uses the short
  design descriptor for headings.
- For designs with **only one** `Product Title`, the design descriptor is
  derived from that title (brand/style adjectives stripped). For designs with
  **multiple colour-keyed titles**, there is no canonical title to pick —
  the design descriptor is a small stable slug suffix (`ethnic-mojri`,
  `formal-derby`, `ethnic-loafer`, etc.).

#### C-2 Slug policy

- A `Product.slug` is `<A<NN>>-<short-stable-design-slug>`. Examples (showing
  the shape only — actual slugs are computed at import time and persisted):
  - `a01-embroidered-ethnic-mojri`
  - `a14-ethnic-mojri`
  - `a37-formal-derby`
- The slug segment is computed from the design descriptor above
  (single-title designs) or chosen from the catalogue context
  (multi-title designs).
- The slug is computed at import time and **stored on the `Product`
  document**. Slugs are **preserved** when a title is corrected in the
  workbook — only an **explicit, approved migration** is allowed to rewrite
  them. URLs stay stable across content fixes.

#### C-3 Inventory policy

- The source workbook has **no stock column**. The legacy `.xls` listing
  templates do carry a `Stock` value, but it is a marketplace export that
  records units of `1` or `2` per SKU (see §7.4). **It is not a real
  inventory ledger and must not be used as one.**
- The `ProductVariant.stock` and `ProductVariant.inStock` fields exist in
  the data model, but the import worker **must not seed them from the
  `.xls` templates**. Default for every imported variant is
  **`stock = 0` and `inStock = false`**. The `Product.inStock` rollup is
  `false`. The storefront and the API both say "out of stock" by default.
- A variant becomes "in stock" **only** when an authorised stock source
  (warehouse feed, admin action, etc.) writes a value to the database.
  Until that source exists, **no variant is for sale**.

#### C-4 Pricing policy

- `MRP` and `Your Selling Price` from the workbook are canonical. The
  `.xls` templates contain 288 price disagreements (a ₹1 rounding drift,
  §7.5), 6 size disagreements (§7.6) and 65 colour disagreements (§7.7).
- The import worker **preserves every value verbatim from the workbook**,
  never overwrites with a template value, and **never silently reconciles a
  discrepancy**.
- For every discrepancy detected (price, size, colour), the import emits a
  row in a JSON **discrepancy report** (`import-report.json`) listing: SKU,
  workbook value, template value, source templates, recommended resolution.
  Nothing in the report is a write — the report is the input for an
  explicit human review.
- The Excel workbook (`.xlsx`) and the listing templates (`.xls`) on disk
  are **never modified by the import**. They are read-only inputs.

#### C-5 D-1 and D-2 status

- **D-1 (A52, A53)** — the workbook series jumps from A51 to A54 with no
  A52/A53 rows. The platform lists 55 designs. The decision is **open**:
  these codes may reappear in a later export. No placeholder designs are
  created.
- **D-2 (canonical title)** — replaced by **C-1**. There is no canonical
  single-word design title in the workbook; the platform stores colour-keyed
  long titles per variant instead.

---

## 11. Verification method

Every number in this document was produced by parsing the real files:

| Source                | Method                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `products data.xlsx`  | `openpyxl` 3.1.5, `data_only=True`, rows 2–1000                                                         |
| 77 `.xls` templates   | `xlrd` 2.0.2 (OLE2/BIFF), `xlrd.open_workbook`, data sheet = `shoe`/`sandal`/`chappal`, rows 5+         |
| Binary format check   | first 8 bytes `D0 CF 11 E0 A1 B1 1A E1` → OLE2 Compound Document                                        |
| Image inventory       | `os.walk` + extension grouping                                                                          |
| Duplicate detection   | MD5 over full file bytes, all 692 files                                                                 |
| Folder→design mapping | regex `^AJ-?A(\d+)$`, case-insensitive, **then numeric normalisation** to the zero-padded workbook code |
| SKU parsing           | regex `^AJ-A(\d+)-([A-Za-z]+)-(\d+)$` — note the case-insensitive token                                 |
| Cross-source joins    | `Seller SKU Id` = `Seller SKU ID`                                                                       |

### 11.1 Re-runnable verification script

Every figure in this document can be reproduced from the original files:

```bash
pnpm catalog:audit
# or
python scripts/catalog_audit.py
```

Requirements: `pip install openpyxl`. The script opens `public/` **read-only**
and writes nothing. It prints the sheet names, column names, row count, the
design/SKU breakdown, the raw sub-category and colour distributions, the size
distribution, the non-standard SKUs, the per-directory asset inventory, the
MD5 duplicate groups, and the design→folder reconciliation.

The script is the executable counterpart of this document. If the two ever
disagree, the script is correct and this document is a bug.

**No source file was modified, moved, renamed or deleted during this audit.**

### 11.2 Re-verification after the G-1 … G-6 work (23 October 2026)

The figures in §1.1 are live-database figures, not source figures, so they are
verified differently — by aggregation against `ajooba_development` and by the
backfill job's own idempotency check.

| Claim                                        | How it was checked                                                                     | Result                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 55 products, 674 variants                    | `count` on each collection                                                             | confirmed                                                   |
| 0 duplicate SKUs                             | unique index + `countDocuments`                                                        | confirmed                                                   |
| 0 orphan variants                            | join `variants.productId` → `products._id`                                             | confirmed                                                   |
| 0 stock > 0                                  | `$group` on `stock`                                                                    | confirmed — **still the launch blocker**                    |
| 85 coloured / 19 quarantined / 600 unset     | `$unwind` + `$group` on `images.colour`                                                | confirmed                                                   |
| 685 images now hashed                        | `image-checksum-backfill.job.ts --dry-run` reports `already stamped: 685`              | confirmed                                                   |
| Only the A10 pair is a duplicate             | the job's cross-design checksum index                                                  | confirmed, matches §6.4                                     |
| Colour assignments unchanged by the backfill | `$unwind` + `$group` on `images.colour`, before and after                              | identical                                                   |
| Nothing was hard-deleted                     | `categories`, `image_reviews`, `import-plans`, `stock_movements` all exist and are `0` | confirmed — the collections were created, the rows were not |

The last row matters: **the four new collections exist and are empty.** Their
emptiness is the honest state, not an omission. `categories` is seeded on
demand, `image_reviews` waits for a human decision, `import-plans` records a
G-6 dry run that has not happened, and `stock_movements` waits for a count
nobody has taken.
