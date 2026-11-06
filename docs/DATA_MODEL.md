# Ajooba Footwear — Data Model

**Status:** initial schema (post-audit)
**Last updated:** 21 October 2026

Every field below is traceable to a real column in the source catalogue. Fields
that the source data does not contain are **not** modelled, except where
explicitly marked _(derived)_ or _(platform)_.

---

## 1. Source-of-truth map

| Model field                    | Source                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| `Product.code`                 | `A<NN>` segment of `Seller SKU Id`                                |
| `Product.title`                | `Product Title` column                                            |
| `Product.description`          | `Description` column                                              |
| `Product.subcategory`          | `Sub-category` column, verbatim                                   |
| `Product.brand`                | `Brand` column in the `.xls` templates (always `Ajooba Footwear`) |
| `Product.colours`              | distinct `Colour` column values across the design's variants      |
| `Product.images`               | files in `public/products/AJ-A<NN>/`                              |
| `Product.mrp` / `sellingPrice` | min across the design's variants                                  |
| `Variant.sku`                  | `Seller SKU Id` column                                            |
| `Variant.size`                 | `Size` column                                                     |
| `Variant.ukIndiaSize`          | `UK/India Size` column (`.xls`)                                   |
| `Variant.euroSize`             | `Euro Size` column (`.xls`)                                       |
| `Variant.colour`               | `Colour` column, verbatim                                         |
| `Variant.colourToken`          | colour segment of `Seller SKU Id`                                 |
| `Variant.mrp` / `sellingPrice` | `MRP` / `Your Selling Price` columns                              |
| `Variant.stock`                | `Stock` column (`.xls`) — **provisional, see D-5**                |
| `Variant.articleNumber`        | `Article Number` / `Group ID` column (`.xls`)                     |
| `Variant.ean`                  | `EAN/UPC` column (`.xls`) — **empty across the whole catalogue**  |

---

## 2. Entity relationships

```
Category (subcategorySlug)
   │
   │  1:N
   ▼
Product  ───────────►  ProductImage   (embedded, ordered)
   │  1:N
   ▼
Variant
```

- **Product** = one design. 55 documents.
- **Variant** = one SKU. 674 documents.
- **ProductImage** = embedded in the product.
- **User**, **Order**, **Cart**, **ReturnRequest**, **Coupon** — modelled in
  §7 as the commerce flows are built. Not yet implemented.

---

## 3. `products` collection

### 3.1 Schema

| Field                     | Type           | Required | Source / notes                                                                                |
| ------------------------- | -------------- | -------- | --------------------------------------------------------------------------------------------- |
| `_id`                     | ObjectId       | auto     |                                                                                               |
| `code`                    | String         | yes      | `A<NN>`. **Unique, indexed.** Stable business identifier.                                     |
| `slug`                    | String         | yes      | **Unique, indexed.** URL segment.                                                             |
| `title`                   | String         | yes      | `Product Title`.                                                                              |
| `description`             | String         | yes      | `Description`.                                                                                |
| `subcategory`             | String         | yes      | `Sub-category`, verbatim. **Indexed.**                                                        |
| `subcategorySlug`         | String         | yes      | Normalised. **Indexed.**                                                                      |
| `brand`                   | String         | yes      | Default `Ajooba Footwear`.                                                                    |
| `colours`                 | String[]       | yes      | Distinct `Colour` values.                                                                     |
| `images`                  | ProductImage[] | yes      | Embedded.                                                                                     |
| `mrp`                     | Number         | yes      | Minimum MRP across variants.                                                                  |
| `sellingPrice`            | Number         | yes      | Minimum selling price across variants.                                                        |
| `inStock`                 | Boolean        | yes      | True if any variant has stock. **Indexed.**                                                   |
| `marketplaceImageUrls`    | String[]       | no       | Flipkart CDN URLs from the `.xls` templates. Reference only — never served to the storefront. |
| `createdAt` / `updatedAt` | Date           | auto     | Mongoose `timestamps`.                                                                        |

### 3.2 Embedded `images[]`

| Field        | Type   | Notes                                                                         |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| `url`        | String | Path relative to `public/`, e.g. `/products/AJ-A11/A11-BLK-1.jpg`.            |
| `alt`        | String | Accessible description.                                                       |
| `position`   | Number | Zero-based display order.                                                     |
| `sourceFile` | String | The **original** filename, verbatim, including quirks like `A13--BLK-2..jpg`. |

> `sourceFile` exists so the original asset name is never lost, even after the
> pipeline normalises `url` for safe URL encoding.

### 3.3 Indexes

| Index                                    | Type     | Purpose                        |
| ---------------------------------------- | -------- | ------------------------------ |
| `{ code: 1 }`                            | unique   | Business-key lookup            |
| `{ slug: 1 }`                            | unique   | Route lookup                   |
| `{ subcategory: 1 }`                     | single   | Category filter                |
| `{ subcategorySlug: 1, inStock: 1 }`     | compound | Category + availability filter |
| `{ sellingPrice: 1 }`                    | single   | Price sort and range filter    |
| `{ title: 'text', description: 'text' }` | text     | Storefront search              |
| `{ inStock: 1 }`                         | single   | Availability filter            |

### 3.4 Sub-category normalisation

| `subcategory` (verbatim) | `subcategorySlug` | Rows |
| ------------------------ | ----------------- | ---- |
| `shoe`                   | `shoe`            | 325  |
| `Mojri / Jutti`          | `mojri-jutti`     | 267  |
| `sandal`                 | `sandal`          | 58   |
| `Chappal`                | `chappal`         | 24   |

The mapping is 1:1 and lossless. The raw value is kept so the storefront can
display exactly what the business wrote.

---

## 4. `variants` collection

| Field                     | Type                  | Required | Source / notes                                                                                                                                                                                                                          |
| ------------------------- | --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`                     | ObjectId              | auto     |                                                                                                                                                                                                                                         |
| `sku`                     | String                | yes      | `Seller SKU Id`. **Unique, indexed.**                                                                                                                                                                                                   |
| `productId`               | ObjectId → `products` | yes      | **Indexed.**                                                                                                                                                                                                                            |
| `productCode`             | String                | yes      | _(denormalised)_ the parent `Product.code`. **Indexed.** Backfilled 22 Oct 2026 — see `docs/BACKFILL_PRODUCTCODE_RESERVEDSTOCK.md` §1A.                                                                                                 |
| `articleNumber`           | String                | yes      | `Article Number` (`.xls`). **Indexed.**                                                                                                                                                                                                 |
| `size`                    | Number                | yes      | `Size`. UK/India, 5–13.                                                                                                                                                                                                                 |
| `ukIndiaSize`             | Number                | no       | `UK/India Size` (`.xls`).                                                                                                                                                                                                               |
| `euroSize`                | Number                | no       | `Euro Size` (`.xls`).                                                                                                                                                                                                                   |
| `colour`                  | String                | yes      | `Colour`, verbatim. **Indexed.**                                                                                                                                                                                                        |
| `colourToken`             | String                | yes      | SKU colour segment. **Indexed.**                                                                                                                                                                                                        |
| `mrp`                     | Number                | yes      | `MRP`.                                                                                                                                                                                                                                  |
| `sellingPrice`            | Number                | yes      | `Your Selling Price`.                                                                                                                                                                                                                   |
| `discountPercent`         | Number                | yes      | _(derived)_ `round((mrp - sellingPrice) / mrp * 100)`.                                                                                                                                                                                  |
| `stock`                   | Number                | yes      | `Stock` (`.xls`). Provisional — D-5. **Currently `0` for all 674 variants**, because the workbook has no stock column.                                                                                                                  |
| `reservedStock`           | Number                | yes      | Units held by an in-flight checkout. Backfilled to `0` on 22 Oct 2026 (the field was missing). Availability is `stock - reservedStock > 0`.                                                                                             |
| `photographyStatus`       | String                | no       | `verified` \| `pending-review`. `pending-review` **withholds the variant from sale** regardless of stock, because the storefront cannot show anything truthful for an unphotographed colourway. 35 variants currently `pending-review`. |
| `inStock`                 | Boolean               | yes      | _(derived)_ `stock > 0`. **Indexed.**                                                                                                                                                                                                   |
| `ean`                     | String                | no       | `EAN/UPC` (`.xls`). **Empty in the entire source catalogue.**                                                                                                                                                                           |
| `createdAt` / `updatedAt` | Date                  | auto     | Mongoose `timestamps`.                                                                                                                                                                                                                  |

#### Why `productCode` is denormalised, and how drift is detected

`variants.productCode` duplicates `products.code` so stock-ledger and order
queries never need to join the product collection.

**Invariance:** `variants.productCode === variants.articleNumber === parent products.code`.
Verified 22 Oct 2026 across all 674 variants: **0 mismatches, 0 orphans**, and
all 55 `articleNumber` groups map to exactly one parent code.

**Drift-detection rule.** A violation is any variant where
`productCode !== parentProduct.code`, or where `productCode !== articleNumber`.
The backfill quarantines rather than overwrites: an existing `productCode` is
never replaced, and a disagreement is reported in the dry-run's
`quarantinedSample` for manual reconciliation. `order.service.ts` treats
`productCode` as ledger-critical and refuses to write a stock movement for a
variant whose code cannot be resolved from either the variant or its parent.

### 4.1 Indexes

| Index                                  | Type     | Purpose                                            |
| -------------------------------------- | -------- | -------------------------------------------------- |
| `{ sku: 1 }`                           | unique   | Cart and order lookups                             |
| `{ productId: 1 }`                     | single   | Variant loading per product                        |
| `{ articleNumber: 1 }`                 | single   | Marketplace export grouping                        |
| `{ colour: 1 }`                        | single   | Colour filter                                      |
| `{ colourToken: 1 }`                   | single   | Token filter                                       |
| `{ inStock: 1 }`                       | single   | Availability filter                                |
| `{ productId: 1, colour: 1, size: 1 }` | compound | Variant resolution (colour + size)                 |
| `{ productCode: 1 }`                   | single   | Stock-ledger and inventory grouping by design code |

## 4A. `homepage_sections` collection

Homepage merchandising. **Added 22 Oct 2026.** A section stores _references_ to
records that already exist elsewhere; it never stores a copy of a product. That
is what keeps merchandising from drifting out of sync with the catalogue.

| Field                     | Type             | Notes                                                                                          |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `_id`                     | ObjectId         |                                                                                                |
| `type`                    | String           | One of the eight `HOMEPAGE_SECTION_TYPES`. **Indexed.**                                        |
| `position`                | Number           | Lower first. **Indexed.**                                                                      |
| `isVisible`               | Boolean          | **Indexed.**                                                                                   |
| `startsAt` / `endsAt`     | Date \| null     | Optional scheduling window. For a `deal`, this **is** the campaign window the countdown reads. |
| `config`                  | Mixed            | Type-specific configuration, already validated by `homepageSectionSchema` (Zod).               |
| `updatedBy`               | ObjectId \| null | The admin who saved it.                                                                        |
| `createdAt` / `updatedAt` | Date             | Mongoose `timestamps`.                                                                         |

| Index                           | Type     | Purpose                                           |
| ------------------------------- | -------- | ------------------------------------------------- |
| `{ isVisible: 1, position: 1 }` | compound | The storefront's query: visible sections in order |
| `{ type: 1 }`                   | single   | Type filtering                                    |
| `{ position: 1 }`               | single   | Ordering                                          |

**Why `config` is `Mixed`.** Its shape depends on `type`, and the authoritative
validation lives in the contracts package. Duplicating eight schemas in Mongoose
would create a second source of truth that could silently disagree with the
contract. The API validates every `config` with the Zod schema _before_ it is
stored, so a malformed section cannot reach the collection.

**Referential rules enforced on every write**

| Rule                                                                    | Failure mode    |
| ----------------------------------------------------------------------- | --------------- |
| Every `productIds` entry resolves to a real product                     | 409 `CONFLICT`  |
| A `spotlightProductId` resolves to a real product                       | 409 `CONFLICT`  |
| `categorySlug` / `categorySlugs` are among the four real sub-categories | 409 `CONFLICT`  |
| A `hero`'s `bannerId` resolves to a real banner                         | 404 `NOT_FOUND` |

Deleting a product that a section references therefore does not silently break
the homepage: the next save is refused and names the offending section, and the
read path reports the reference in `unresolvedProductIds` and hides the section.

### 4.2 Why `colour` and `colourToken` are both stored

`OW`, `IVY` and `IVR` **all map to Ivory** in the workbook but are different
tokens in the SKU:

| Token | Colour | Rows |
| ----- | ------ | ---- |
| `IVY` | Ivory  | 68   |
| `OW`  | Ivory  | 21   |
| `IVR` | Ivory  | 9    |

The token is **not** a reversible encoding of the colour, so neither field can
be derived from the other. Both are stored, and both are indexed.

---

## 5. Money representation

- Money is stored as **whole INR rupees** in a `Number`, matching the source
  workbooks exactly (which contain no paise).
- Rounding happens **once**, at import, on the derived `discountPercent`.
- No floating-point arithmetic is performed on money at the API boundary.

---

## 6. Image resolution rules

The importer maps a file to a variant as follows:

```
for each folder in public/products/:
    designCode  <- parse "AJ-A<NN>" from the folder name (case-insensitive)
    for each image file in the folder:
        token <- parse "<COLOUR>" from "A<NN>-<COLOUR>-<index>"
        if token is present:
            assign to the variant of (designCode, colour matching token)
        else:
            assign to the design's ONLY colour variant
```

The fallback in the second branch is required because **69 images across 12
single-colour designs** carry no colour token (`A1 - 1.jpg`, `A5-3.jpg`, …).

### 6.1 Known gaps the importer must report, not hide

| Design | Gap                                                           |
| ------ | ------------------------------------------------------------- |
| `A17`  | **No folder at all.** 9 variants, 0 images.                   |
| `A14`  | Catalogue sells Black and Tan; folder holds only BRN and WHT. |
| `A30`  | Catalogue sells Brown; folder holds BLK and TAN.              |
| `A48`  | Catalogue sells Beige; folder holds GRY and IVY.              |
| `A57`  | Catalogue sells Chickoo; folder holds BLK, BRN, OLV, TAN.     |

### 6.2 File-naming quirks preserved

| Original file                       | Handling                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `A1 - 1.jpg` … `A1 - 6.jpg`         | Spaces → URL-encoded; `sourceFile` keeps the original.                                                  |
| `A13--BLK-1.jpg` … `A13--BLK-6.jpg` | Doubled hyphen → parsed as colour `BLK`.                                                                |
| `A13--BLK-2..jpg`                   | Doubled extension → resolved as `.jpg`.                                                                 |
| `A10-7(1).jpg`                      | **Byte-identical** to `A10-7.jpg`. Excluded from the gallery as redundant; the file is **not deleted**. |
| `A44-BLK-3 (2).png`                 | Spaces + copy suffix → resolved as `.png`, excluded as redundant.                                       |
| `Aj-A48/`                           | Folder name case → design code `A48`; original folder name retained in the import report.               |

---

## 7. Commerce models (specified, not yet implemented)

Committed to now so the contracts and the admin UI can be designed against a
stable shape. No data exists for them yet, and the platform contains **no**
seeded rows for them.

### 7.1 `users`

| Field                    | Type                    | Notes                                 |
| ------------------------ | ----------------------- | ------------------------------------- |
| `_id`                    | ObjectId                |                                       |
| `email`                  | String                  | Unique, lowercased, trimmed, indexed. |
| `phone`                  | String                  | Indexed.                              |
| `passwordHash`           | String                  | bcrypt hash. **Never plaintext.**     |
| `firstName` / `lastName` | String                  |                                       |
| `role`                   | `'customer' \| 'admin'` | Indexed. Default `customer`.          |
| `addresses`              | Address[]               | Embedded.                             |
| `wishlist`               | ObjectId[] → `products` |                                       |
| `isActive`               | Boolean                 |                                       |
| `lastLoginAt`            | Date                    |                                       |

`Address`: `label`, `fullName`, `phone`, `line1`, `line2`, `city`, `state`,
`postalCode`, `country` (default `India`), `isDefault`.

### 7.2 `orders`

| Field             | Type               | Notes                                  |
| ----------------- | ------------------ | -------------------------------------- |
| `_id`             | ObjectId           |                                        |
| `orderNumber`     | String             | Unique, human-readable, indexed.       |
| `customerId`      | ObjectId → `users` | Indexed.                               |
| `items`           | OrderItem[]        | Embedded snapshot of the purchase.     |
| `subtotal`        | Number             | _(derived)_ sum of `lineTotal`.        |
| `shippingFee`     | Number             |                                        |
| `taxAmount`       | Number             |                                        |
| `discountAmount`  | Number             |                                        |
| `totalAmount`     | Number             |                                        |
| `currency`        | `'INR'`            |                                        |
| `status`          | OrderStatus        | Indexed.                               |
| `paymentStatus`   | PaymentStatus      | Indexed.                               |
| `shippingAddress` | Address            | Snapshot — addresses can change later. |
| `billingAddress`  | Address            |                                        |
| `paymentRef`      | String             | Razorpay reference.                    |
| `placedAt`        | Date               |                                        |
| `deliveredAt`     | Date               |                                        |

`OrderItem` snapshots the purchased state so a later price or catalogue change
cannot rewrite history: `productId`, `sku`, `title`, `imageUrl`, `colour`,
`size`, `unitPrice`, `quantity`, `lineTotal`.

### 7.3 Order state machine

```
placed ──▶ processing ──▶ shipped ──▶ completed
   │            │            │
   └── cancelled └── cancelled └── cancelled
```

`cancelled` and `completed` are terminal. Transitions are validated
server-side; the admin API rejects an invalid transition.

### 7.4 `returns`

| Field                        | Type                                                    | Notes                      |
| ---------------------------- | ------------------------------------------------------- | -------------------------- |
| `_id`                        | ObjectId                                                |                            |
| `returnNumber`               | String                                                  | Unique, indexed.           |
| `orderId`                    | ObjectId → `orders`                                     | Indexed.                   |
| `customerId`                 | ObjectId → `users`                                      | Indexed.                   |
| `reason`                     | String                                                  | Customer-selected reason.  |
| `status`                     | `'requested' \| 'approved' \| 'rejected' \| 'refunded'` | Indexed.                   |
| `refundAmount`               | Number                                                  |                            |
| `refundRef`                  | String                                                  | Payment-gateway reference. |
| `requestedAt` / `resolvedAt` | Date                                                    |                            |

### 7.5 `carts`

Stored server-side so a cart survives a device change.

| Field        | Type               | Notes                               |
| ------------ | ------------------ | ----------------------------------- |
| `_id`        | ObjectId           |                                     |
| `customerId` | ObjectId → `users` | Sparse, unique for signed-in users. |
| `sessionId`  | String             | Indexed, for guest carts.           |
| `items`      | CartItem[]         | `variantId`, `sku`, `quantity`.     |
| `couponCode` | String             | Optional.                           |

### 7.6 `coupons`

| Field                 | Type                      | Notes                           |
| --------------------- | ------------------------- | ------------------------------- |
| `_id`                 | ObjectId                  |                                 |
| `code`                | String                    | Unique, uppercased, indexed.    |
| `type`                | `'percentage' \| 'fixed'` |                                 |
| `value`               | Number                    | Percentage points or whole INR. |
| `minOrderAmount`      | Number                    |                                 |
| `maxDiscountAmount`   | Number                    | For percentage coupons.         |
| `startsAt` / `endsAt` | Date                      | Scheduling window.              |
| `usageLimit`          | Number                    |                                 |
| `usedCount`           | Number                    |                                 |
| `isActive`            | Boolean                   | Indexed.                        |

---

## 8. Modelling decisions and their reasons

| Decision                                                | Reason                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Product` and `Variant` are separate collections        | A design has 5–36 variants. Embedding them would break MongoDB's 16 MB document limit and make size/colour filtering a full-scan operation.                                                                                                                                |
| Images are embedded, not a separate collection          | Images are read and written with the product, never queried independently, and are bounded at ~28 per product.                                                                                                                                                             |
| `subcategory` **and** `subcategorySlug` are both stored | The raw value is what the business wrote; the slug is what routes. Keeping only one would either lose fidelity or break URLs.                                                                                                                                              |
| `colour` **and** `colourToken` are both stored          | Three tokens map to one colour. Neither is derivable from the other.                                                                                                                                                                                                       |
| `sourceFile` is stored alongside `url`                  | Preserves the original asset name, including its quirks, for auditability.                                                                                                                                                                                                 |
| `checksum` is stored on the embedded image              | It is the only thing that distinguishes "one photograph under two filenames" from "two photographs". Without it, a copied folder can populate two colour galleries with a single picture. Backfilled for all 685 images on 23 Oct 2026 — see `DEPLOYMENT_RUNBOOK.md` §0.2. |
| `marketplaceImageUrls` is stored but never served       | Flipkart CDN URLs expire and are a third party's infrastructure. Kept for reference during a future export.                                                                                                                                                                |
| `ean` is optional and empty                             | `EAN/UPC` is empty for all 674 variants. Modelling it as required would block the import.                                                                                                                                                                                  |
| `stock` is provisional                                  | The `.xls` `Stock` column holds 1–2 units — a listing artefact, not a warehouse count. See audit D-5.                                                                                                                                                                      |
| No `analytics` or `metrics` collection                  | Any dashboard figure must be computed from live order records. Storing pre-computed analytics would invite stale or fabricated numbers.                                                                                                                                    |

---

## 9. Data integrity rules

Enforced in the API layer and/or by MongoDB:

1. `products.code` and `products.slug` are unique.
2. `variants.sku` is unique.
3. A variant must reference an existing product.
4. `sellingPrice <= mrp` for every variant.
5. `discountPercent` is derived, never supplied by a client.
6. `stock >= 0` and `inStock === (stock > 0)`.
7. `size` must be one of 5–13 (UK/India).
8. `colour` must be one of the 12 observed values.
9. `subcategorySlug` must be one of the 4 canonical slugs.
10. Order items are immutable snapshots; editing a product never rewrites a
    past order.
11. **Nothing is hard-deleted.** Products archive (`status: 'archived'`),
    categories retire (`status: 'retired'`), variants go to `stock: 0,
inStock: false`. All three are referenced by order lines, the stock ledger
    or the audit log.
12. A category may not be its own ancestor, directly or transitively.
13. A category with products assigned cannot be retired until they are
    reassigned.
14. A new SKU is created at `stock: 0` and `photographyStatus: 'pending-review'`.
    `stock` is not an accepted field on create.
15. Stock may never be set below `reservedStock` (open carts), and every write
    must carry a reason plus the level the operator believed was on hand.
16. Two different colours may never display the same photograph bytes.
17. A colourway may not be marked `verified` unless a verified image carries
    that colour.

### 9.1 The single sellability predicate

```typescript
isSellable = photographyStatus !== 'pending-review' && inStock && stock - reservedStock > 0;
```

One formula, used by the storefront product page, the homepage resolver, the
cart, the wishlist and the checkout validator. There is no second definition, so
the homepage cannot advertise something checkout would refuse — and filling in
an admin form cannot make an unphotographed, unstocked variant purchasable.

---

## 10. Collections added for catalogue administration

Added to support G-1…G-6. All three are new collections; none replaced or
migrated an existing one.

### 10.1 `categories` — the canonical taxonomy (G-4)

| Field                         | Type                    | Notes                                                       |
| ----------------------------- | ----------------------- | ----------------------------------------------------------- |
| `slug`                        | string, unique, indexed | kebab-case URL segment and the collection's key             |
| `displayName`                 | string                  | human-facing label                                          |
| `description`                 | string                  |                                                             |
| `position`                    | number                  | lower first; renumbered contiguous on reorder               |
| `parentSlug`                  | string \| null          | optional parent; cycles rejected                            |
| `isVisible`                   | boolean                 | show in storefront navigation                               |
| `status`                      | `'active' \| 'retired'` | **retired, never hard-deleted**                             |
| `seoTitle` / `seoDescription` | string                  |                                                             |
| `sourceSubcategory`           | string                  | denormalised read copy, kept in step with `subcategorySlug` |

**One taxonomy, not two.** `Product.subcategorySlug` remains the foreign key.
The collection is the editable surface; the product field is the reference.

> The collection is currently **empty** in `ajooba_development`. Run
> `POST /v1/admin/catalog/categories/seed` once to populate it from the 55
> products' existing `subcategorySlug` values.

### 10.2 `image_reviews` — the human decision record (G-5)

| Field                                         | Type                                              | Notes                                            |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `imageId`                                     | string, unique                                    | **`<designCode>:<sourceFile>`**                  |
| `designCode` / `productId`                    | string / ObjectId                                 | the owning design                                |
| `sourceFile` / `url` / `checksum` / `storage` | string                                            | **original provenance, never rewritten**         |
| `status`                                      | `'pending' \| 'assigned' \| 'rejected'`           |                                                  |
| `assignedColour` / `assignedColourToken`      | string                                            | set only on assign                               |
| `autoReason`                                  | `'untokened' \| 'token-not-sold' \| 'unparsable'` | why the automated rule gave up                   |
| `proposedColour` / `proposedColourToken`      | string                                            | what it _suggested_, never applied automatically |
| `reviewReason`                                | string                                            | **mandatory, ≥10 chars**                         |
| `reviewedByEmail` / `reviewedAt`              | string / Date                                     | who decided, and when                            |

> The collection is **empty** in `ajooba_development`. Nothing here has been
> invented to fill it — an `image_reviews` row exists only once a human has
> decided something.

**`products.images[].colour` is the gallery source of truth; `image_reviews` is
the decision log.** They are deliberately separate, and the queue reads the
product document first and overlays any decision — so a review survives a
re-import, and an image coloured by `image-colour-migration.job.ts` (which
writes **no** review row) still appears in the right place. That distinction is
load-bearing: when the duplicate-checksum guard consulted only `image_reviews`,
it was inert for all 85 migration-coloured images. See
`API_CONTRACT_GAPS.md` §13.1 #6.

### 10.3 `import-plans` — the G-6 authorisation record

| Field                            | Type                                                               | Notes                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `planId`                         | string, unique                                                     |                                                                                                                   |
| `status`                         | `'dry-run' \| 'approved' \| 'applied' \| 'failed' \| 'superseded'` | only `dry-run` can be applied                                                                                     |
| `targetDatabase`                 | string                                                             | reported by the running connection, so the operator can confirm it                                                |
| `sourceFilename`                 | string                                                             | **provenance only — never used to build a path**                                                                  |
| `payloadChecksum`                | string                                                             | SHA-256; an apply must present the same value                                                                     |
| `stagedPath`                     | string                                                             | **server-derived** filename under `os.tmpdir()`; never client-supplied                                            |
| `payloadBytes`                   | number                                                             |                                                                                                                   |
| `counts`                         | object                                                             | `designsToCreate`, `designsToUpdate`, `variantsToCreate`, `variantsToUpdate`, `quarantine`, `reject`, `conflicts` |
| `findings`                       | array                                                              | per-row `{ disposition, kind, code?, sku?, rowIndex, parentIndex?, reason }`                                      |
| `requestedByEmail`               | string                                                             | who ran the dry run                                                                                               |
| `approvedByEmail` / `approvedAt` | string / Date                                                      | who authorised the apply — **kept separate so self-approval is visible**                                          |
| `appliedAt`                      | Date                                                               |                                                                                                                   |
| `result`                         | object                                                             | outcome counts after an apply                                                                                     |

> **Why findings carry `rowIndex` and not just a code.** A duplicate design code
> inside one payload produces two findings under the same code — one `create`
> and one `quarantine`. Keyed by identifier, the later silently overwrote the
> earlier and the apply skipped **both** rows, so a single bad row imported
> nothing. Keyed by position, the correct row is applied and only the bad one is
> skipped. See `docs/API_CONTRACT_GAPS.md` §13.

---

## 11. Fields added to existing collections

| Collection | Field                        | Notes                                                                                                                                                                                                            |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products` | `status`                     | `'draft' \| 'published' \| 'archived'`, indexed. Defaults to `published` so adding the field did not take the 55 live designs offline.                                                                           |
| `products` | `seoTitle`, `seoDescription` | optional overrides                                                                                                                                                                                               |
| `variants` | `photographyStatus`          | `'verified' \| 'pending-review'`. **Absent on 624 of 674 variants** written before the field existed; absent is treated as verified for back-compatibility, but those rows have no verified photograph recorded. |

### 11.1 Sellability

```
isSellable = photographyStatus !== 'pending-review'
          && inStock
          && (stock - reservedStock) > 0
```

This is computed server-side in one place and reused by the storefront, the
homepage cards and the admin views, so the three cannot disagree. **A variant
with stock and no verified photograph is still not sellable.**

### 11.2 Inventory invariants

- Absolute stock sets require `expectedCurrentStock`, which must match the
  stored level or the request is `409`.
- A set may not take `stock` below `reservedStock`.
- Every adjustment or set appends to `stock-movements`.

**No code path writes a stock quantity without a reason and a ledger entry.**
`POST /products/:code/variants` does not accept `stock` at all.
