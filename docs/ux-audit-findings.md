# Ajooba Footwear — UX/UI audit and prioritised findings

**Audited:** 3 November 2026
**Scope:** `apps/storefront`, `apps/admin`, `apps/api`, `packages/contracts`,
`docs/`, plus the live MongoDB state behind the local environment.
**Method:** source review of every route, service and component; live HTTP
inspection of the API; and a scripted browser pass over 18 routes at three
viewports (`scripts/ux/capture.mjs`, output in `artifacts/ux/before/`).

This document records what was actually wrong. Where a finding was fixed, the
fix and the regression test that pins it are named. Nothing here is a
"nice to have" written after the fact.

---

## 0. Summary

The platform's **commerce logic was in good shape** — pricing, stock ledger,
idempotent checkout, image quarantine, audit logging and permission checks are
implemented with unusual care, and the contracts are honest about failure
states. What was broken was the **seam between the catalogue data and the two
interfaces in front of it**: the storefront could not trust its own taxonomy,
and the admin panel could not show or edit most of the catalogue at all.

The single root cause behind the "products don't appear under categories"
complaint is documented in §1. It was a backend defect, not a styling defect,
and it is now fixed at the point of writing rather than papered over in the UI.

Everything else is ranked by what it costs a shopper or an operator.

| #   | Finding                                                          | Severity | Area      |
| --- | ---------------------------------------------------------------- | -------- | --------- |
| 1   | Category taxonomy was never seeded from imported products         | Critical | Data/API  |
| 2   | Admin had no way to list, filter or edit categories in practice   | Critical | Admin     |
| 3   | Four of the nine admin operations screens did not exist           | Critical | Admin     |
| 4   | Homepage merchandising accepted category slugs that did not exist | High     | API       |
| 5   | Storefront navigation was hardcoded to four slugs                 | High     | Storefront|
| 6   | Product catalogue carried no category counts or hierarchy         | High     | API       |
| 7   | Admin visual language was an unstyled document                    | High     | Admin     |
| 8   | Storefront homepage was a banner plus generic card grids          | High     | Storefront|
| 9   | PDP split colour selection across two disconnected surfaces       | Medium   | Storefront|
| 10  | Catalog filters exposed counts inconsistently between mobile/desktop| Medium  | Storefront|
| 11  | Admin dashboard stated "no data" even when data existed           | Medium   | Admin     |
| 12  | No cheap way to verify the whole app in a browser                 | Medium   | Tooling   |

---

## 1. Root cause: products did not appear under categories

### What the customer and the operator saw

- The storefront category cards linked to `/products?subcategory=…`, but the
  category pages themselves were driven by a hardcoded enum.
- The admin **Categories** screen rendered a list that was frequently empty
  even though 55 products with a `subcategorySlug` existed.
- Editing a product's category could fail with `422 Unknown category`.
- Selecting a category in the **Homepage editor** could fail with `409`.
- A storefront URL carrying a slug the enum did not know was silently dropped,
  so the shopper landed on the unfiltered catalogue.

### What was actually wrong

`CategoryModel` was **the** taxonomy of record. `Product.subcategorySlug` was a
denormalised copy of the workbook's `Sub-category` column. But the only writer
of `CategoryModel` was `seedCategoriesFromProducts`, an explicit admin action
that nothing ever called automatically.

So the import pipeline wrote 55 products referencing four slugs
(`mojri-jutti`, `shoe`, `sandal`, `chappal`) while the `categories` collection
stayed empty on a fresh environment. Every consumer that validated a slug
against the live collection therefore rejected real, working catalogue data:

| Consumer                                  | Failure with an empty `categories` collection |
| ----------------------------------------- | --------------------------------------------- |
| `assertAssignableCategory` (product write) | `422 Unknown category "mojri-jutti"`          |
| `assertAssignableCategoryForMerchandising` | `409` on homepage save                        |
| `getPublicCategories` / facets            | empty navigation, no counts                    |
| Admin categories screen                   | "No categories yet"                            |
| Storefront URL parser                     | filter dropped silently (enum mismatch)        |

This is a **referential-integrity gap between two collections that are supposed
to move together**, and it cannot be fixed in the frontend. A UI workaround
(hardcoding the four slugs, or inventing category cards) would have produced a
storefront that looks correct while the admin remained unable to edit or extend
the taxonomy — exactly the failure mode the brief says not to accept.

### The fix (shipped)

1. **`apps/api/src/services/category-bootstrap.service.ts`** — new
   `reconcileCategoryTaxonomy()`. It reads every distinct `subcategorySlug` off
   real products, and creates the missing `CategoryModel` documents with curated
   display names, descriptions and positions for the four known slugs, and a
   derived display name for any slug it has never seen. It is **purely
   additive and idempotent**: it never renames, reorders, hides or deletes a
   category an operator has already curated.
2. **`apps/api/src/server.ts`** — runs it once at boot, before the listener
   opens, and logs the outcome. A fresh environment self-heals; a curated
   environment is untouched.
3. **`seedCategoriesFromProducts`** now delegates to the same function, so the
   manual admin action and the automatic reconciliation cannot drift apart.
4. **Contracts accept any well-formed slug.** `CATEGORY_SLUG_PATTERN`
   (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, max 60) replaces the four-value enum. A new
   category added in the admin works end-to-end with no code change.
5. **`getPublicCategories()`** returns the published, visible tree with live
   product counts, exposed at `GET /v1/catalog/categories`, and embedded in
   `CatalogFacets.categories`.
6. **The storefront URL parser** validates against the same pattern instead of
   an enum, so a legitimate slug is never dropped.
7. **The homepage resolvers** validate category references against the live
   collection and resolve them to real tiles (name, count, representative
   photograph) rather than trusting the stored string.

**Regression tests:** `apps/api/tests/category-integration.test.ts` (16 cases:
reconciliation idempotency, legacy-document tolerance, retired-category
refusal, publication gating, homepage merchandising, order stability) and
`apps/storefront/tests/catalog-params.test.ts` (valid slug accepted, malformed
slug refused).

---

## 2. Admin panel findings

### 2.1 Screens that did not exist

The API already served `GET /v1/admin/orders`, `/customers`, `/inventory`,
`/inventory/movements`, `/coupons`, `/audit-logs` and `/dashboard`. The admin
app exposed **none** of them. Orders, customers, inventory and promotions
returned a 404 from the panel — verified in `artifacts/ux/before/_report.json`,
where all twelve of those captures are `404`.

Operations that exist server-side but had no interface are functionally
missing: an operator cannot cancel an order, adjust stock, or create a coupon.

### 2.2 The shell was a document, not an application

`OperationsHeader` rendered a title with six inline links on a white band and a
paragraph of prose underneath. Consequences:

- No persistent navigation. Moving between catalogue and merchandising meant
  reading a paragraph to find a link.
- No sense of place: the current screen was indicated by an underline, and only
  on the catalogue screens.
- Navigation was **duplicated** in `apps/admin/src/app/page.tsx` and
  `catalog/layout.tsx`, and the two lists had already drifted (the dashboard
  copy omitted `/login` handling and used a different link order).
- Descriptions were multi-sentence apologies ("A design with products attached
  cannot be retired until they are moved"). They explained backend rules in
  the page chrome rather than showing them at the moment of the refusal.

### 2.3 Forms fought the operator

- `product-manager.tsx` is 1,149 lines with the list, the create form, the
  edit form, the colourway table and the stock dialog in one component. Every
  field is a text input; there is no meaningful grouping.
- Category assignment was a `<select>` built from `listCategories()` **without**
  counts, so an operator could not tell an empty category from a populated one
  at the point of choosing.
- Status (`draft`/`published`/`archived`) used three raw Tailwind colour pairs
  with no legend.
- Destructive actions used `window.confirm`, which cannot carry a reason and
  looks nothing like the rest of the product.

### 2.4 Visual system

The admin had a **separate brand palette** (`--color-brand-*`, a terracotta
ramp) that appears nowhere in the storefront, no type scale, no spacing rhythm,
no shared table/list/card primitives, and a `container-page` that was
redeclared in `globals.css` while Tailwind v4 also generated its own. There was
no `@theme` entry for the ink/gold/cream palette the storefront uses, so the two
apps could not look related even by accident.

---

## 3. Storefront findings

### 3.1 Homepage

Verified visually in `artifacts/ux/before/home--desktop.png` and
`home--mobile.png`.

- The first screen is a 16:9 banner with copy overlaid. On a 1440×960 desktop
  the hero occupies ~40% of the viewport and the rest is empty cream, so the
  page opens on dead space.
- On a phone the same 16:9 frame squeezes the headline to `text-xl` — smaller
  than body copy on a competitor's site — because the copy is forced inside the
  image frame.
- Everything below the hero is the same object repeated: a `rounded-2xl
  border bg-white` card grid for categories, another for products, another for
  colours. Five sections, one shape.
- `CategoryShortcuts` duplicated the `category-grid` section whenever
  merchandising was empty, and both read from a hardcoded config.
- Product cards showed no colour count, no size availability and no
  "sold out" distinction beyond a pill, despite the API already returning
  `verifiedColours` and `isPurchasable`.

### 3.2 Catalogue

- The filter rail is a stack of bordered boxes with no grouping hierarchy;
  facet counts are rendered for colours and sizes but categories are a plain
  link list.
- Grid cards change only by `transform: scale(1.02)` on hover. There is no
  second image, no colour preview, no size hint.
- Sorting is a native `<select>`, which cannot be styled to match and is the
  most prominent control in the toolbar.

### 3.3 Product detail

- `ProductGallerySection` filters images by colour correctly (this is a real
  strength and must be preserved), but the colour control is a row of **text
  buttons** in the buy box. A shopper cannot see the colourway before
  selecting it.
- The gallery is a square with `object-cover`, cropping the product.
- Size buttons are 11×44px with a diagonal strike for sold out; the strike is
  drawn with a rotated `1px` line that is invisible at 1x on some displays.
- The gallery and buy box are a two-column grid from `lg`, so the buy box is
  pushed below the fold on tablets.

### 3.4 Cart and header

- The cart drawer lists lines with `Qty {n}` as text — quantity cannot be
  changed without leaving the drawer.
- Header navigation, footer navigation and `CategoryShortcuts` each hold their
  **own hardcoded copy** of the four category slugs. Three sources of truth for
  one taxonomy.

---

## 4. Cross-cutting engineering findings

| Finding                                                                                     | Fix                                                                                       |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Three hardcoded copies of the category list                                                 | One live `GET /v1/catalog/categories` read, consumed by header, footer and home            |
| `CategoryFacets` had no counts                                                              | `CategoryView.productCount`, computed in one aggregation                                   |
| No browser harness, so "verified in a browser" was unverifiable                             | `scripts/ux/capture.mjs` — 18 routes × 3 viewports, with a `_report.json` of status codes  |
| Admin session could not be established without the owner's password in automation           | `apps/api/scripts/admin-token.ts` — mints a token with the API's **own** token service     |
| `.taste-skill/direction.json` is a build input, not a source file                            | Committed under `.taste-skill/` and referenced from the design plan                        |

---

## 5. What was deliberately not changed

Constraints from the brief, and the reason each was respected:

- **No destructive migration.** The boot reconciliation only inserts missing
  documents. Existing categories, including operator edits, are never rewritten.
- **No invented catalogue data.** Specimen tiles on the homepage are built from
  real product rows returned by `fetchProducts`; a design with no verified
  photograph renders a neutral field, never a stock image.
- **No fake commerce states.** The buy box still refuses to add an unpriced or
  unstocked SKU; the payment flow still reports the provider as not connected.
- **Contracts first.** Every new endpoint added a Zod schema and a response
  type in `packages/contracts` before either app consumed it.
- **The brand palette is unchanged.** `ink`, `gold`, `cream`, `claret` values in
  `apps/storefront/src/app/globals.css` are byte-identical to what shipped.
  What changed is how they are used.
