# Ajooba Footwear — design and build plan

**Status:** milestones M0–M6 complete · M7 verification recorded in
`docs/verification-results.md`
**Direction:** the specimen catalogue (`specimen-catalogue`), dealt from
`design-taste-frontend` and recorded in `.taste-skill/direction.json`

---

## 1. The idea

> On this page, **a hand-finished shoe photographed on a plain field** becomes
> **a specimen in a field guide** — one object, alone, at a consistent scale,
> named plainly, with one fact beside it.

That sentence is the whole storefront concept, and it is not available to a
generic footwear retailer. Ajooba's catalogue is 55 designs across four
categories, each photographed on a neutral background by the workshop. Most
competitors have to invent that isolation with a cut-out; Ajooba's photography
already is it. The format flatters ordinary objects because it treats each one
as worth looking at, and it replaces the card grid — the same `rounded-2xl
border bg-white` rectangle five times — with something that has a point of view.

The test in the direction sheet: swap in the nearest competitor's name. If the
idea still works, it is the category's idea, not Ajooba's. It does not survive
the swap: a marketplace with 40,000 SKUs cannot show every product alone at a
consistent scale; it is exactly the advantage of a 55-design house.

**The one live thing a visitor can do:** compare two colourways of the same
design at full size without leaving the page — `ProductGallerySection` owns the
colour, and the gallery plus the specimen strip now respond to it together.

---

## 2. What the direction changed, and what it did not

The brief requires keeping the brand identity. The direction sheet says "keep
the palette, keep the type" — the drawn direction and the brief agree, so
nothing was overridden. Two deliberate deviations, both recorded here rather
than silently made:

| Direction said                                 | Built instead                                       | Why                                                                                     |
| ---------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hero: a full-bleed wall of 112px specimen tiles | Hero: one specimen at 60–75% of the viewport, one statement, one action | A wall needs 40+ photographed objects. We have 55 designs but only verified colour imagery for a subset; a wall would show repeated photographs and read as filler. |
| Section 2: a dark "schedule" band with a travelling object | Light band, numerals removed, sticky specimen column | The dark band would have been a second near-black section directly under a near-black footer CTA. Contrast is spent in one place. |

Everything else follows the sheet: the specimen tile (flat field, one centred
object, no border, 8–12px gaps), the index-with-preview motion, the printed
guest-list proof card, and the closing split where the object returns.

---

## 3. Design system

### 3.1 Palette — unchanged values, new discipline

`apps/storefront/src/app/globals.css` keeps every hue it shipped with:

```
ink     900 #0b1424   800 #121a2e   600 #2e3953   500 #475571   300 #9aa5bd   100 #e6eaf2
gold    600 #b38938   500 #c9a24a   400 #cd9f45   300 #dcb867   200 #ead196
cream  50 #fdfaf2   100 #faf4e3   200 #f3e9cb
claret 600 #9c1b3a   700 #7e1530
```

What changed is the **role** each one plays:

- `cream-50` is the page ground everywhere. No white cards on a cream page.
- `ink-900` is text and the one dark surface per screen.
- `gold-500` is an **accent**, never a fill for a large area except the single
  primary action on a screen.
- `claret-600` is reserved for destructive and out-of-stock. It is not decorative.

Resting surfaces have **no shadow and no border**. Separation is achieved with
space and a change of ground. A `1px` `ink-100` rule is allowed only inside a
table, a form field or a data strip.

### 3.2 Type

Two faces, five size steps, no exceptions.

| Step  | Face / weight                       | Used for                                  |
| ----- | ----------------------------------- | ----------------------------------------- |
| `xs`  | Inter 500, 12px, +0.14em caps       | labels, table headers, footnote           |
| `sm`  | Inter 400, 14px                     | card facts, captions, form help           |
| `md`  | Inter 400, 16px / 1.55              | body copy, all long-form text             |
| `lg`  | Cormorant 500, clamp(20px,2.4vw,26px)| section headings, product names in an index |
| `xl`  | Cormorant 500, clamp(30px,4.4vw,52px)| the h1 on any screen, closing statements  |

Numerals are tabular everywhere a number is compared: prices, counts, sizes,
stock, metrics. `font-variant-numeric: tabular-nums` is applied via a utility,
not per component.

### 3.3 Motion

One signature move, everything else quiet:

- **Index with preview** (homepage specimen index): pointing at a name in the
  left column swaps the specimen and the disc colour in 240ms, and marks the
  chosen row. On touch, each row carries its own thumbnail inline instead.
- Section entrance: 12px rise plus opacity, 380ms, staggered 60ms, fired once by
  `IntersectionObserver`.
- Control feedback: 120ms background/border change; `active` translates 1px.
- **One moving picture** where an honest clip exists. None exists today, so none
  is faked — the creative-prompt library ships the brief for one instead.

`prefers-reduced-motion` and the existing in-app "reduce motion" toggle both
collapse every duration to 0.01ms. No motion is required to understand content.

### 3.4 Layout

- Page margins: `1rem` < 768px, `1.5rem` < 1024px, `2rem` above. One container.
- 12-column grid above 1024px, 6 below.
- One corner radius per element class: `0` for specimen tiles and the hero, `2px`
  for inputs and buttons, `999px` for pills only.
- Mobile-first: every screen is designed at 390px first, then widened.

---

## 4. Milestones

### M0 — Foundation (design tokens, tooling)

- Rewrite `globals.css` with the five type steps, tabular numerals, the
  `specimen` and `index` utilities, and entrance-motion classes.
- `scripts/ux/capture.mjs` + `apps/api/scripts/admin-token.ts` so every later
  milestone can be verified in a browser without the owner's password.
- Capture `artifacts/ux/before/`.

### M1 — Taxonomy (backend, blocking)

Detailed in `docs/ux-audit-findings.md` §1. Boot reconciliation, dynamic slug
contract, `GET /v1/catalog/categories`, published gate on all public reads,
homepage merchandising against live categories. 16 regression tests.

### M2 — Storefront shell

Live category navigation in the header (desktop rail + mobile sheet), the footer,
and the cart drawer with real quantity controls. Removes all three hardcoded
copies of the taxonomy.

### M3 — Storefront homepage

Specimen hero → bendable category index → new arrivals in a specimen grid →
featured edit with a spotlight → collection rail → colour shop → proof band →
story → closing split.

Every section reads resolved data from the API. A section with nothing
configured renders an honest empty message, never sample products.

### M4 — Storefront catalogue and PDP

- Catalogue: specimen grid with a second-image hover preview, colour dots from
  `verifiedColours`, a real sort control, and a filter rail grouped by
  category/colour/size/price with live counts.
- PDP: full-bleed specimen gallery with a colourway strip that shows the actual
  photography, a size matrix that reads as a matrix, a sticky buy box on
  desktop, and an honest "no photography yet" state preserved.

### M5 — Admin shell and dashboard

Sidebar shell with grouped navigation, a live status strip, and a dashboard
built from `GET /v1/admin/dashboard`: revenue, orders, AOV, units, a dense daily
sparkline, an order-status breakdown, and top designs by units. Every figure is
live; an empty database says so explicitly rather than showing a cheerful zero
chart.

### M6 — Admin operations screens

Orders (list, filter, detail, status transition with a reason), customers,
inventory (SKU list, stock set with expected-level guard, movement ledger),
promotions (coupons CRUD with a live preview), plus redesigned products,
categories, image review, imports and the homepage editor.

### M7 — Verification

Typecheck, lint, format, unit and integration tests, production builds, and a
full browser pass at three viewports. Recorded in
`docs/verification-results.md`, with frames in `artifacts/ux/after/`.

---

## 5. Interaction inventory (the micro-decisions)

| Surface             | Interaction                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| Header category rail | Hover moves a gold 1px underline in from the left in 120ms; the active route keeps it at full width |
| Mobile nav sheet     | Categories first, each with its live product count; account links below a rule |
| Specimen index       | Pointer over a name swaps the specimen; keyboard `↑`/`↓` does the same; touch shows the thumbnail inline |
| Product card         | Hover swaps to the second verified image if one exists, and lifts the name to `ink-900` from `ink-700`; no scale, no shadow |
| Colourway strip      | Each swatch is the real photograph of that colour, 64px, with a gold rule under the selected one |
| Size matrix          | 5-up on mobile, 9-up from `sm`; sold-out sizes keep full contrast with a struck label, not a faded button |
| Add to cart          | Disabled until a size is chosen, with the reason as the button label ("Select a size") — never a silently dead button |
| Quantity            | Stepper in the drawer, so a shopper never leaves to change quantity          |
| Filter chip         | Removing a chip pushes a new URL in a transition so the grid dims rather than flashing |
| Admin table row     | Whole row is the link; the chevron appears on hover only                     |
| Admin destructive   | A dialog, never `window.confirm`, and it requires a typed reason where the API requires one |

---

## 6. What was reused rather than rebuilt

- `ProductGallery`, `ProductBuyBox` colour/filter logic, `cart-store`,
  `wishlist-store` and `commerce-context`: **untouched**. They encode rules
  (per-SKU pricing, quarantined images, duplicate-add protection) that the
  redesign must not regress.
- `catalog-params.ts` routing helpers, `api.ts` typed failure model,
  `catalog.service.ts` query builder, `order.service.ts`, `inventory.service.ts`,
  `pricing.service.ts`: untouched.
- Admin `product-manager`, `category-manager`, `image-review-queue`,
  `import-control`, `homepage-editor`: **kept, restyled, and re-shelled**. Their
  server calls, optimistic-concurrency versions and refusal handling are the
  product of a lot of correctness work and were not rewritten.
- `packages/contracts`: extended, never narrowed.

---

## 7. Accessibility commitments

- Every interactive element is a real `button`, `a`, or a `label`-bound input.
- Colour contrast: body `ink-700` on `cream-50` is 8.9:1; the lowest text pair
  used anywhere is `ink-500` on `cream-50` at 5.1:1. Gold is never used for body
  text — only for rules, fills with `ink-900` text (7.4:1), and large display.
- Sold-out and unavailable states are conveyed by text, not by opacity alone.
- Focus is always visible: a 2px gold ring with a 2px offset, on every control,
  in every app.
- Live regions: the catalogue result count, the toast host, and the cart subtotal
  are `aria-live="polite"`.
- The decorative specimen fields are `aria-hidden`; the objects carry real alt
  text from the catalogue.

---

## 8. Performance budget

| Metric                                  | Budget   | Approach |
| --------------------------------------- | -------- | -------- |
| Storefront homepage JS (First Load)     | < 140 kB | Server components; only the index, rail and gallery are client |
| Largest Contentful Paint (product page) | < 2.0s   | Hero specimen `priority` + `fetchPriority=high`; everything else lazy |
| Catalogue image weight                  | ≤ 90 kB  | `sizes` per breakpoint, `loading=lazy` below the fold |
| Layout shift                            | < 0.02   | Every image has explicit `width`/`height`; no late-injected fonts |
| Reduced motion                          | honoured | All durations collapse under both the OS query and the in-app toggle |
