# Verification results

**Verified:** 3 November 2026
**Scope:** `packages/contracts`, `apps/api`, `apps/storefront`, `apps/admin`,
and the browser suite in `tests/e2e`.
**Companions:** `docs/ux-audit-findings.md` (what was wrong),
`docs/design-build-plan.md` (what was built and why),
`docs/creative-prompts.md` (imagery that is deliberately absent).

This document records what was actually run, on this machine, and what it
returned. Where something could not be verified, it says so instead of
claiming it.

---

## 1. Summary

| Gate                     | Command                             | Result                                              |
| ------------------------ | ----------------------------------- | --------------------------------------------------- |
| Formatting               | `pnpm format:check`                 | **Pass** — 4 packages, 0 unformatted files          |
| Lint                     | `pnpm -r lint`                      | **Pass** — 4 packages, `--max-warnings 0`, 0 errors |
| Typecheck                | `pnpm -r typecheck`                 | **Pass** — 4 packages, 0 errors                     |
| Unit + integration tests | `pnpm -r test`                      | **Pass** — 511 tests across 28 files                |
| Production builds        | `pnpm -r build`                     | **Pass** — contracts, API, storefront, admin        |
| Browser end-to-end       | `pnpm test:e2e`                     | **Pass** — 22 tests, real stack, Chromium           |
| Environment inventory    | `pnpm env:check`                    | **Pass** — 18 checks, 0 failed                      |
| Visual capture           | `node scripts/ux/capture.mjs after` | **Pass** — 54 frames, 0 failed routes               |

**Test totals, by package:**

| Package              | Files  | Tests   |
| -------------------- | ------ | ------- |
| `packages/contracts` | 3      | 41      |
| `apps/api`           | 16     | 380     |
| `apps/admin`         | 3      | 29      |
| `apps/storefront`    | 6      | 61      |
| **Total**            | **28** | **511** |

Plus 22 Playwright tests that are not counted in the 511 — they drive the real
API, a throwaway MongoDB and production builds of both front ends, and they are
the only tests that prove the _whole_ thing works together.

---

## 2. What the browser suite actually proves

`pnpm test:e2e` boots a complete isolated stack (`tests/e2e/global-setup.ts`):
a throwaway `mongodb-memory-server`, the real Express API, a **production
build** of the storefront, a second storefront instance pointed at a dead API
port, and a production build of the admin panel. Nothing is mocked. No request
is intercepted.

The assertions worth naming:

| Property                                                  | Test                                                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sign-in is enforced **server-side**, not hidden in the UI | An unauthenticated `GET /homepage` redirects to `/login`; the API itself returns **401** for an unauthenticated admin read |
| The session token never reaches JavaScript                | `document.cookie` and `localStorage` are both inspected after sign-in; neither contains `ajooba_admin_token`               |
| The session cookie is `httpOnly` and `SameSite=Strict`    | Cookie attributes are read from the browser context                                                                        |
| A failed sign-in leaves no session behind                 | The cookie jar is inspected after a wrong password                                                                         |
| The admin proxy refuses path traversal                    | `?path=../../../../v1/admin/users` returns **400**                                                                         |
| The admin proxy refuses unauthenticated calls             | Returns **401**                                                                                                            |
| The storefront never shows another colourway's photograph | Selecting Black yields exactly one image source, and the quarantined Brown file appears nowhere                            |
| A colour with unverified photography is **not sellable**  | The swatch says "not on sale yet", the size is listed but unavailable, and no "Add to cart" exists                         |
| A missing design returns a real 404                       | `/products/this-design-does-not-exist` → **404**                                                                           |
| An API outage is reported honestly                        | The dead-API storefront says it cannot reach the catalogue, shows no product, and keeps its brand furniture                |

### Two failures found and fixed during this verification

Both were real defects in the assertion surface, not flakes, and both were
fixed at the source rather than by loosening the test.

**1. The admin sidebar's accessible name was on the wrong element.**
`aria-label="Admin navigation"` sat on the `<aside>`, which carries the
`complementary` role — so the name labelled a landmark that is not a navigation
landmark. A screen-reader user navigating by landmark could not reach the menu
by that name, and `getByRole('navigation', …)` correctly found nothing. The
label now sits on the `<nav>` in both the desktop and the drawer instance
(`apps/admin/src/components/layout/admin-shell.tsx`).

**2. The storefront homepage test asserted against a page shape that no longer
exists.** It expected a "Shop by category" heading on `/`, which was true of the
old banner-and-card-grid homepage. The rebuilt homepage opens on the specimen
hero, built from the newest published designs rather than from merchandising —
so with no sections configured, there is no category grid to find. The test now
asserts the property that actually matters: the hero shows the **real seeded
design**, and **every** `a[href^="/products/"]` on the page resolves to that one
real design. That is a stronger anti-fabrication assertion than the old
`toHaveCount(0)`, which would have passed on an empty page.

Neither fix touched commerce logic.

---

## 3. Visual verification

Captured with `scripts/ux/capture.mjs` at three viewports — **desktop**
1440 × 960, **tablet** 834 × 1112, **mobile** 390 × 844 — at `deviceScaleFactor:
2`, against the running dev servers.

| Phase                  | Frames | Routes that failed |
| ---------------------- | ------ | ------------------ |
| `artifacts/ux/before/` | 54     | **12** (all 404)   |
| `artifacts/ux/after/`  | 54     | **0**              |

The 12 failures before are the point of the whole exercise: **Orders, Customers,
Inventory and Promotions did not exist** at any viewport. Every other route
returned 200 and rendered _something_ — which is exactly why the before/after
comparison had to be captured rather than described.

### What the frames show

**Storefront.** Before: a banner carousel over generic product cards, with
category links driven by a hardcoded enum. After: the specimen hero — one
design at full size on a flat field, an index of five names that swaps it on
hover, pointer, focus and arrow keys, with the price and colourway count beside
the object. The catalogue, PDP, search, cart and login screens share one type
scale, one 2px radius, and one rule set (no shadow, no border on a resting
surface; separation is space and a change of ground).

**Admin.** Before: an unstyled document — plain tables, browser-default inputs,
and four screens that returned 404. After: a dark ink sidebar with grouped
navigation and a live status strip; a dashboard that states its own time window
(`7d` / `30d` / `90d`) and reads every figure from
`GET /v1/admin/dashboard`; orders with filters and a detail view that offers only
legal status transitions; inventory as a SKU ledger with a stock-adjustment
dialog that carries an `Idempotency-Key`; promotions with a live coupon preview.
Four previously missing screens now exist and are reachable from the sidebar.

Every admin number on screen comes from the API. Where there is no data, the
panel says so — the dashboard renders "No orders yet" rather than a flat line at
zero, and `apps/admin/tests/dashboard.test.tsx` asserts that the source contains
no literal rupee amount.

### Frames worth opening

| Frame                           | What to look at                                                             |
| ------------------------------- | --------------------------------------------------------------------------- |
| `after/home--desktop.png`       | The hero: statement, index, and one specimen at full size                   |
| `before/home--desktop.png`      | The same route before — banner plus card grid                               |
| `after/catalog--desktop.png`    | Filter rail with live counts, specimen grid, colour counts as text not dots |
| `after/pdp--desktop.png`        | Gallery driven by the selected colourway; sizes as a matrix                 |
| `after/dashboard--desktop.png`  | Live metrics, sparkline, status proportion bar, best sellers                |
| `before/dashboard--desktop.png` | The same screen before                                                      |
| `after/inventory--desktop.png`  | SKU ledger and the movement history                                         |
| `after/promotions--desktop.png` | Coupon board with the live preview panel                                    |
| `before/orders--desktop.png`    | A 404 — the screen did not exist                                            |
| `after/orders--desktop.png`     | The screen that replaced it                                                 |

---

## 4. Regression tests added for each fixed defect

Every finding in `docs/ux-audit-findings.md` that was a _defect_ rather than a
taste decision has a test pinning it. The ones that matter most:

| Defect                                                            | Test file                                      |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| Category taxonomy was never seeded from imported products         | `apps/api/tests/category-integration.test.ts`  |
| Homepage merchandising accepted category slugs that did not exist | `apps/api/tests/homepage.test.ts`              |
| The admin catalogue endpoints had no coverage of the RBAC matrix  | `apps/api/tests/authorization.test.ts`         |
| The catalogue import could double-apply a plan                    | `apps/api/tests/catalog-import.test.ts`        |
| Index definitions could drift from the models                     | `apps/api/tests/indexes.test.ts`               |
| Every route the app claims to serve is actually mounted           | `apps/api/tests/route-index.test.ts`           |
| The dashboard could show invented numbers                         | `apps/admin/tests/dashboard.test.tsx`          |
| The admin proxy could be walked out of its prefix                 | `apps/admin/tests/proxy-path.test.ts`          |
| Catalogue filter params could round-trip incorrectly              | `apps/storefront/tests/catalog-params.test.ts` |
| Empty states could render fake content                            | `apps/storefront/tests/empty-states.test.tsx`  |

---

## 5. Things that were checked and found already correct

Not everything was broken. These were inspected and left alone, because
rewriting working correctness logic is how regressions get introduced:

- **Pricing** (`pricing.service.ts`, `catalog.service.ts`) — per-SKU pricing,
  coupon stacking rules and rounding.
- **Inventory ledger** (`inventory.service.ts`, `stock.service.ts`) —
  reservation/commit/release, and the expected-level guard on a manual
  adjustment.
- **Checkout** (`checkout.routes.ts`, `order.service.ts`) — server-authoritative
  amounts, idempotency keys, duplicate-confirmation handling.
- **Payments** (`razorpay.service.ts`, `payment.service.ts`,
  `webhook.routes.ts`) — raw-body signature verification, `x-razorpay-event-id`
  duplicate protection, out-of-order event handling, and the rule that a late
  failure event cannot overwrite a captured payment.
- **Auth** (`auth.service.ts`, `token.service.ts`, `password.service.ts`) —
  refresh-token rotation, password-reset token single-use semantics.
- **Contracts** (`packages/contracts`) — extended, never narrowed.

The storefront's `ProductGallery`, `ProductBuyBox`, `cart-store`,
`wishlist-store` and `commerce-context` were also left untouched: they encode
the per-SKU pricing, quarantined-image and duplicate-add rules that the
redesign must not regress. They were restyled through shared tokens rather than
rewritten.

---

## 6. Formatting: a real finding, and the root cause

`pnpm format:check` failed on first run across all four packages — 208 files.
The cause was **not** sloppy code. It was line endings:

- `.prettierrc.json` sets `endOfLine: "lf"`.
- `.gitattributes` sets `* text=auto eol=lf`, with a comment explaining that
  without it a Windows checkout produces CRLF working-tree files that Prettier
  then flags.
- The working tree nonetheless held **CRLF** in 208 files, so a clean clone on
  Windows would fail `format:check` while CI on Linux passed — the exact failure
  the gitattributes rule exists to prevent, arriving through files written
  before the rule landed.

Resolved by running Prettier's writer once across all four packages, which
normalised the files to LF. `format:check` now passes cleanly. **The
`.gitattributes` rule was correct and was not changed** — the fix was to make
the working tree obey it.

The diagnosis was confirmed rather than assumed: two files with byte-identical
content apart from their line endings were submitted to the same `prettier
--check` — the LF copy passed, the CRLF copy was rejected. That isolates line
endings as the sole cause and rules out a config or content problem.

Two other typecheck/lint defects were found and fixed in the same pass, both in
`apps/api/scripts/`:

- `admin-token.ts` read `env.MONGODB_DB` (optional) and passed it to a
  `RegExp.test()` call expecting `string`. It now falls back to `MONGODB_URI`,
  which is what actually names the database when `MONGODB_DB` is unset — so the
  development-database guard evaluates the value that is really in force.
- `diag-admin.ts` interpolated a Mongo `ObjectId` into a template literal,
  which `@typescript-eslint/restrict-template-expressions` refuses. Wrapped in
  `String()`.

---

## 7. What is **not** verified

Stated plainly, because the distinction between "code-complete", "locally
tested" and "verified in production" is the one that matters most here.

| Item                                          | State                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Razorpay live payments**                    | **Not verified.** No credentials exist in this environment. Signature verification, webhook handling, duplicate protection and the state machine are covered by unit and integration tests against mocked provider responses — not by a real payment. |
| **Resend transactional email**                | **Not verified.** No API key. Templates and the send path are unit-tested; no email has been sent.                                                                                                                                                    |
| **Shiprocket shipping**                       | **Not verified.** No credentials. Booking, label generation and tracking webhooks are untested against the provider.                                                                                                                                  |
| **Production catalogue state**                | **Not verified.** All browser testing ran against synthetic `E2E …` fixtures in a throwaway database. The real catalogue was read but not driven through the UI in this pass.                                                                         |
| **Staging or production deployment**          | **Not verified.** No deployed origin was inspected.                                                                                                                                                                                                   |
| **The video and craft imagery**               | **Absent by design.** No moving picture and no workshop photography ships. `docs/creative-prompts.md` is the brief that closes the gap; the site currently renders type on a tint in those slots rather than a stock image.                           |
| **Lighthouse / Core Web Vitals in the field** | **Not measured.** The performance budget in `docs/design-build-plan.md` is a design constraint that was built to, not a field measurement.                                                                                                            |

`node scripts/readiness-check.mjs <origin>` is the gate that turns the first
four rows into verified facts once a staging environment and credentials exist.
It is read-only: it never sends a payment, refund, shipment or email.

---

## 8. How to reproduce

```bash
pnpm install
pnpm --filter @ajooba/contracts build     # tests import the built contracts

pnpm format:check
pnpm -r lint
pnpm -r typecheck
pnpm -r test

# Two Next.js builds in parallel race on next-env.d.ts on Windows.
# Build them individually to avoid a spurious lock error:
pnpm --filter @ajooba/storefront build
pnpm --filter @ajooba/admin build
pnpm --filter @ajooba/api build

pnpm test:e2e        # boots its own throwaway stack; needs no dev servers
pnpm env:check
```

Visual capture needs the dev servers running:

```bash
pnpm dev
# then, in a second shell:
node scripts/ux/capture.mjs after
```

The admin frames need a session. Either export `ADMIN_EMAIL` / `ADMIN_PASSWORD`,
or mint a short-lived token with
`pnpm --filter @ajooba/api exec tsx scripts/admin-token.ts artifacts/ux/.token`
— which is read-only, copies the account's real role and permissions, and
refuses to run against a database whose name does not look like development.
