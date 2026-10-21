# Ajooba Footwear — Data Model

**Status:** initial schema (post-audit)
**Last updated:** 21 October 2026

Every field below is traceable to a real column in the source catalogue. Fields
that the source data does not contain are **not** modelled, except where
explicitly marked *(derived)* or *(platform)*.

---

## 1. Source-of-truth map

| Model field | Source |
| --- | --- |
| `Product.code` | `A<NN>` segment of `Seller SKU Id` |
| `Product.title` | `Product Title` column |
| `Product.description` | `Description` column |
| `Product.subcategory` | `Sub-category` column, verbatim |
| `Product.brand` | `Brand` column in the `.xls` templates (always `Ajooba Footwear`) |
| `Product.colours` | distinct `Colour` column values across the design's variants |
| `Product.images` | files in `public/products/AJ-A<NN>/` |
| `Product.mrp` / `sellingPrice` | min across the design's variants |
| `Variant.sku` | `Seller SKU Id` column |
| `Variant.size` | `Size` column |
| `Variant.ukIndiaSize` | `UK/India Size` column (`.xls`) |
| `Variant.euroSize` | `Euro Size` column (`.xls`) |
| `Variant.colour` | `Colour` column, verbatim |
| `Variant.colourToken` | colour segment of `Seller SKU Id` |
| `Variant.mrp` / `sellingPrice` | `MRP` / `Your Selling Price` columns |
| `Variant.stock` | `Stock` column (`.xls`) — **provisional, see D-5** |
| `Variant.articleNumber` | `Article Number` / `Group ID` column (`.xls`) |
| `Variant.ean` | `EAN/UPC` column (`.xls`) — **empty across the whole catalogue** |

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

| Field | Type | Required | Source / notes |
| --- | --- | --- | --- |
| `_id` | ObjectId | auto | |
| `code` | String | yes | `A<NN>`. **Unique, indexed.** Stable business identifier. |
| `slug` | String | yes | **Unique, indexed.** URL segment. |
| `title` | String | yes | `Product Title`. |
| `description` | String | yes | `Description`. |
| `subcategory` | String | yes | `Sub-category`, verbatim. **Indexed.** |
| `subcategorySlug` | String | yes | Normalised. **Indexed.** |
| `brand` | String | yes | Default `Ajooba Footwear`. |
| `colours` | String[] | yes | Distinct `Colour` values. |
| `images` | ProductImage[] | yes | Embedded. |
| `mrp` | Number | yes | Minimum MRP across variants. |
| `sellingPrice` | Number | yes | Minimum selling price across variants. |
| `inStock` | Boolean | yes | True if any variant has stock. **Indexed.** |
| `marketplaceImageUrls` | String[] | no | Flipkart CDN URLs from the `.xls` templates. Reference only — never served to the storefront. |
| `createdAt` / `updatedAt` | Date | auto | Mongoose `timestamps`. |

### 3.2 Embedded `images[]`

| Field | Type | Notes |
| --- | --- | --- |
| `url` | String | Path relative to `public/`, e.g. `/products/AJ-A11/A11-BLK-1.jpg`. |
| `alt` | String | Accessible description. |
| `position` | Number | Zero-based display order. |
| `sourceFile` | String | The **original** filename, verbatim, including quirks like `A13--BLK-2..jpg`. |

> `sourceFile` exists so the original asset name is never lost, even after the
> pipeline normalises `url` for safe URL encoding.

### 3.3 Indexes

| Index | Type | Purpose |
| --- | --- | --- |
| `{ code: 1 }` | unique | Business-key lookup |
| `{ slug: 1 }` | unique | Route lookup |
| `{ subcategory: 1 }` | single | Category filter |
| `{ subcategorySlug: 1, inStock: 1 }` | compound | Category + availability filter |
| `{ sellingPrice: 1 }` | single | Price sort and range filter |
| `{ title: 'text', description: 'text' }` | text | Storefront search |
| `{ inStock: 1 }` | single | Availability filter |

### 3.4 Sub-category normalisation

| `subcategory` (verbatim) | `subcategorySlug` | Rows |
| --- | --- | --- |
| `shoe` | `shoe` | 325 |
| `Mojri / Jutti` | `mojri-jutti` | 267 |
| `sandal` | `sandal` | 58 |
| `Chappal` | `chappal` | 24 |

The mapping is 1:1 and lossless. The raw value is kept so the storefront can
display exactly what the business wrote.

---

## 4. `variants` collection

| Field | Type | Required | Source / notes |
| --- | --- | --- | --- |
| `_id` | ObjectId | auto | |
| `sku` | String | yes | `Seller SKU Id`. **Unique, indexed.** |
| `productId` | ObjectId → `products` | yes | **Indexed.** |
| `articleNumber` | String | yes | `Article Number` (`.xls`). **Indexed.** |
| `size` | Number | yes | `Size`. UK/India, 5–13. |
| `ukIndiaSize` | Number | no | `UK/India Size` (`.xls`). |
| `euroSize` | Number | no | `Euro Size` (`.xls`). |
| `colour` | String | yes | `Colour`, verbatim. **Indexed.** |
| `colourToken` | String | yes | SKU colour segment. **Indexed.** |
| `mrp` | Number | yes | `MRP`. |
| `sellingPrice` | Number | yes | `Your Selling Price`. |
| `discountPercent` | Number | yes | *(derived)* `round((mrp - sellingPrice) / mrp * 100)`. |
| `stock` | Number | yes | `Stock` (`.xls`). Provisional — D-5. |
| `inStock` | Boolean | yes | *(derived)* `stock > 0`. **Indexed.** |
| `ean` | String | no | `EAN/UPC` (`.xls`). **Empty in the entire source catalogue.** |
| `createdAt` / `updatedAt` | Date | auto | Mongoose `timestamps`. |

### 4.1 Indexes

| Index | Type | Purpose |
| --- | --- | --- |
| `{ sku: 1 }` | unique | Cart and order lookups |
| `{ productId: 1 }` | single | Variant loading per product |
| `{ articleNumber: 1 }` | single | Marketplace export grouping |
| `{ colour: 1 }` | single | Colour filter |
| `{ colourToken: 1 }` | single | Token filter |
| `{ inStock: 1 }` | single | Availability filter |
| `{ productId: 1, colour: 1, size: 1 }` | compound | Variant resolution (colour + size) |

### 4.2 Why `colour` and `colourToken` are both stored

`OW`, `IVY` and `IVR` **all map to Ivory** in the workbook but are different
tokens in the SKU:

| Token | Colour | Rows |
| --- | --- | --- |
| `IVY` | Ivory | 68 |
| `OW` | Ivory | 21 |
| `IVR` | Ivory | 9 |

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

| Design | Gap |
| --- | --- |
| `A17` | **No folder at all.** 9 variants, 0 images. |
| `A14` | Catalogue sells Black and Tan; folder holds only BRN and WHT. |
| `A30` | Catalogue sells Brown; folder holds BLK and TAN. |
| `A48` | Catalogue sells Beige; folder holds GRY and IVY. |
| `A57` | Catalogue sells Chickoo; folder holds BLK, BRN, OLV, TAN. |

### 6.2 File-naming quirks preserved

| Original file | Handling |
| --- | --- |
| `A1 - 1.jpg` … `A1 - 6.jpg` | Spaces → URL-encoded; `sourceFile` keeps the original. |
| `A13--BLK-1.jpg` … `A13--BLK-6.jpg` | Doubled hyphen → parsed as colour `BLK`. |
| `A13--BLK-2..jpg` | Doubled extension → resolved as `.jpg`. |
| `A10-7(1).jpg` | **Byte-identical** to `A10-7.jpg`. Excluded from the gallery as redundant; the file is **not deleted**. |
| `A44-BLK-3 (2).png` | Spaces + copy suffix → resolved as `.png`, excluded as redundant. |
| `Aj-A48/` | Folder name case → design code `A48`; original folder name retained in the import report. |

---

## 7. Commerce models (specified, not yet implemented)

Committed to now so the contracts and the admin UI can be designed against a
stable shape. No data exists for them yet, and the platform contains **no**
seeded rows for them.

### 7.1 `users`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `email` | String | Unique, lowercased, trimmed, indexed. |
| `phone` | String | Indexed. |
| `passwordHash` | String | bcrypt hash. **Never plaintext.** |
| `firstName` / `lastName` | String | |
| `role` | `'customer' \| 'admin'` | Indexed. Default `customer`. |
| `addresses` | Address[] | Embedded. |
| `wishlist` | ObjectId[] → `products` | |
| `isActive` | Boolean | |
| `lastLoginAt` | Date | |

`Address`: `label`, `fullName`, `phone`, `line1`, `line2`, `city`, `state`,
`postalCode`, `country` (default `India`), `isDefault`.

### 7.2 `orders`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `orderNumber` | String | Unique, human-readable, indexed. |
| `customerId` | ObjectId → `users` | Indexed. |
| `items` | OrderItem[] | Embedded snapshot of the purchase. |
| `subtotal` | Number | *(derived)* sum of `lineTotal`. |
| `shippingFee` | Number | |
| `taxAmount` | Number | |
| `discountAmount` | Number | |
| `totalAmount` | Number | |
| `currency` | `'INR'` | |
| `status` | OrderStatus | Indexed. |
| `paymentStatus` | PaymentStatus | Indexed. |
| `shippingAddress` | Address | Snapshot — addresses can change later. |
| `billingAddress` | Address | |
| `paymentRef` | String | Razorpay reference. |
| `placedAt` | Date | |
| `deliveredAt` | Date | |

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

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `returnNumber` | String | Unique, indexed. |
| `orderId` | ObjectId → `orders` | Indexed. |
| `customerId` | ObjectId → `users` | Indexed. |
| `reason` | String | Customer-selected reason. |
| `status` | `'requested' \| 'approved' \| 'rejected' \| 'refunded'` | Indexed. |
| `refundAmount` | Number | |
| `refundRef` | String | Payment-gateway reference. |
| `requestedAt` / `resolvedAt` | Date | |

### 7.5 `carts`

Stored server-side so a cart survives a device change.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `customerId` | ObjectId → `users` | Sparse, unique for signed-in users. |
| `sessionId` | String | Indexed, for guest carts. |
| `items` | CartItem[] | `variantId`, `sku`, `quantity`. |
| `couponCode` | String | Optional. |

### 7.6 `coupons`

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `code` | String | Unique, uppercased, indexed. |
| `type` | `'percentage' \| 'fixed'` | |
| `value` | Number | Percentage points or whole INR. |
| `minOrderAmount` | Number | |
| `maxDiscountAmount` | Number | For percentage coupons. |
| `startsAt` / `endsAt` | Date | Scheduling window. |
| `usageLimit` | Number | |
| `usedCount` | Number | |
| `isActive` | Boolean | Indexed. |

---

## 8. Modelling decisions and their reasons

| Decision | Reason |
| --- | --- |
| `Product` and `Variant` are separate collections | A design has 5–36 variants. Embedding them would break MongoDB's 16 MB document limit and make size/colour filtering a full-scan operation. |
| Images are embedded, not a separate collection | Images are read and written with the product, never queried independently, and are bounded at ~28 per product. |
| `subcategory` **and** `subcategorySlug` are both stored | The raw value is what the business wrote; the slug is what routes. Keeping only one would either lose fidelity or break URLs. |
| `colour` **and** `colourToken` are both stored | Three tokens map to one colour. Neither is derivable from the other. |
| `sourceFile` is stored alongside `url` | Preserves the original asset name, including its quirks, for auditability. |
| `marketplaceImageUrls` is stored but never served | Flipkart CDN URLs expire and are a third party's infrastructure. Kept for reference during a future export. |
| `ean` is optional and empty | `EAN/UPC` is empty for all 674 variants. Modelling it as required would block the import. |
| `stock` is provisional | The `.xls` `Stock` column holds 1–2 units — a listing artefact, not a warehouse count. See audit D-5. |
| No `analytics` or `metrics` collection | Any dashboard figure must be computed from live order records. Storing pre-computed analytics would invite stale or fabricated numbers. |

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
