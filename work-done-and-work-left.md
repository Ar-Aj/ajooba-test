# Ajooba Footwear — Work Completed & Production Readiness Roadmap

> **Document Type:** Project Handoff & Launch Readiness Status  
> **Workspace Root:** `C:\ajooba footwear`  
> **Last Updated:** 8 November 2026  
> **Current Code-Only Readiness Rating:** **~7.0 / 10** (Full local automated test suite passes; production credentials & live provider verification pending)

---

## 1. Project Constraints & Immutable Guardrails

All architectural choices and code changes have adhered strictly to the following constraints:

1. **Zero Price Alterations:** Under no circumstances have any catalogue prices (`mrp`, `sellingPrice` across database seeds, schemas, importers, APIs, or UI) been altered or fabricated.
2. **Topology / Vercel Lock:** [`vercel.json`](vercel.json) has not been modified without explicit user approval. Resolving the 3-service Vercel topology vs. the intended Railway Express API deployment remains an open decision.
3. **Visual Brand Identity:** Preserved the cream/ink/gold/claret aesthetic, the ~82rem (`1312px`) `.container-page` layout width, the product detail page (PDP) mobile sticky **Add to cart** / **Buy now** bar, and the 3 SVG confidence points.
4. **Honesty & Anti-Fabrication Mandate:** No simulated orders, fake phone numbers (`+91 80000 12345`), placeholder support emails (`support@ajooba.in`), or unverified marketing assertions ("since 1986", "hand-finished", universal free shipping) are presented as live facts to shoppers.
5. **No Broken Backend Logic:** All database models, validation contracts, authorization gates, and transaction flows have been maintained and extended without breaking business logic.

---

## 2. Comprehensive Work Completed

### A. Navigation, Branding & Homepage Architecture

- **Navbar Home Navigation & Logo:**
  - Added direct **Home** navigation link in both desktop and mobile header views.
  - Positioned the transparent brand logo (`public/images/logo/logo-nobg.png`) beside the "AJOOBA" wordmark in [`apps/storefront/src/components/brand/logo.tsx`](apps/storefront/src/components/brand/logo.tsx) and [`header.tsx`](apps/storefront/src/components/layout/header.tsx).
- **Rich Product Information Display:**
  - Enhanced [`apps/storefront/src/features/home/components/shop-tile.tsx`](apps/storefront/src/features/home/components/shop-tile.tsx) and [`specimen-tile.tsx`](apps/storefront/src/features/home/components/specimen-tile.tsx) to display calculated savings (`Save ₹X · Y% off`), live SKU identifiers, interactive colour swatches that update product imagery, and available UK shoe sizes.
  - Out-of-stock sizes are visibly struck through with diagonal cut indicators (`CardDiagonalCut`).
- **Ajooba's Mehbooba · Multi-Shade Buying Studio:**
  - Replaced the static "The Ajooba Edit" section with [`Ajooba3DShowcase`](apps/storefront/src/features/home/components/ajooba-3d-showcase.tsx).
  - Implemented touch-to-zoom / hover-zoom inspection, split-view comparisons, and a 3D colour deck. Removed the legacy turntable rotation per user instruction.
  - Linked the section to admin merchandising controls allowing spotlight selection of multi-shade models.
- **Dynamic Merchandising Sections:**
  - Created [`SizeAvailabilitySection`](apps/storefront/src/features/home/components/availability-sections.tsx) ("Shop by your UK size") allowing customers to filter live stock by shoe size.
  - Created [`SavingsAvailabilitySection`](apps/storefront/src/features/home/components/availability-sections.tsx) ("Pairs by price and savings") featuring biggest price reductions, pairs under ₹1,499, and multi-shade editions.
  - Enabled mobile touch horizontal scroll snapping (`snap-x snap-mandatory overflow-x-auto`) transitioning to responsive multi-column grids on desktop.

### B. Customer Account Persistence (Addresses & Wishlist)

- **API Contracts & Endpoints:**
  - Added `addressInputSchema` and `addressUpdateSchema` to [`packages/contracts/src/auth/schemas.ts`](packages/contracts/src/auth/schemas.ts).
  - Built dedicated, customer-authenticated CRUD router [`apps/api/src/routes/addresses.routes.ts`](apps/api/src/routes/addresses.routes.ts) (`GET`, `POST`, `PATCH`, `DELETE /v1/addresses`) enforcing singular `isDefault` status, ObjectId validation, and customer data isolation.
  - Updated [`apps/api/src/routes/wishlist.routes.ts`](apps/api/src/routes/wishlist.routes.ts) to normalize product `id` mapping and preserve customer item ordering.
  - Registered `/addresses` and `/exchanges` in `/health` route indexes and route parity integration tests.
- **Storefront Client Synchronization:**
  - Upgraded [`apps/storefront/src/lib/address-store.ts`](apps/storefront/src/lib/address-store.ts) and [`wishlist-store.ts`](apps/storefront/src/lib/wishlist-store.ts) to synchronize with `/v1/addresses` and `/v1/wishlist` for authenticated customer sessions, falling back gracefully to device storage when unauthenticated or offline.
  - Integrated remote persistence into [`commerce-context.tsx`](apps/storefront/src/lib/commerce-context.tsx), [`product-buy-box.tsx`](apps/storefront/src/features/catalog/components/product-buy-box.tsx), [`wishlist-client.tsx`](apps/storefront/src/features/account/components/wishlist-client.tsx), [`address-book-client.tsx`](apps/storefront/src/features/account/components/address-book-client.tsx), and [`header.tsx`](apps/storefront/src/components/layout/header.tsx).
  - Configured sign-out to clear remote caches (`wishlistStore.clear()`, `addressStore.clear()`) while preserving the customer's active device cart.

### C. Checkout Hardening & Policy Safeguards

- Connected [`checkout-client.tsx`](apps/storefront/src/features/checkout/components/checkout-client.tsx) to auto-populate the default saved delivery address.
- Updated checkout to pass `shippingAddressId` for unchanged saved addresses, and persist newly entered addresses via `addressStore.saveRemote(...)`.
- Enforced Cash On Delivery (COD) limit: orders exceeding ₹10,000 disable the COD radio option, auto-switch to online payment (Razorpay) if configured, and block submission with clear feedback.
- Guarded free shipping copy so thresholds are displayed only when store settings configure a non-zero threshold (`freeShippingThreshold > 0`).

### D. UI/UX Refinement, Accessibility (a11y) & Contrast

- **WCAG AA Contrast Compliance:**
  - Deepened color tokens in [`apps/storefront/src/app/globals.css`](apps/storefront/src/app/globals.css) (`--color-ink-400: #645a4d`, `--color-ink-500: #50473d`, `--color-gold-700: #785822`, `--color-gold-800: #63481c`) and [`apps/admin/src/app/globals.css`](apps/admin/src/app/globals.css) (`--color-ink-400: #536079`, `--color-ink-500: #3d4a63`, etc.) achieving >= 4.5:1 contrast against all light backgrounds (`white`, `cream-50`, `field-a` through `field-e`).
  - Increased footer copyright and microcopy opacity to `cream-50/60` (contrast ratio 6.81:1 on `#181512`).
- **Responsive Layout & Zoom Support:**
  - Added CSS rule `html.text-lg { font-size: 112.5%; }` ensuring the accessibility text enlargement control scales typography cleanly.
  - Resolved an 8px mobile horizontal overflow under `html.text-lg` at 390px viewport by tightening mobile navbar padding, icon buttons (`p-2 sm:p-2.5`), and logo sizing (`h-8 w-8 sm:h-9 sm:w-9`) without altering desktop layout.
  - Resolved duplicate product title tags on specimen tiles and sanitized query parameters on contact pages.

### E. Vercel Deployment & Catalogue Availability Resolution (Nov 9, 2026)

- **Root Cause Analysis of Products Not Appearing on Vercel:**
  1. _Uncommitted Working Tree:_ The GitHub remote repository was frozen at commit `ab0317a` (Nov 6) while 100+ files and 20+ feature additions were unstaged locally.
  2. _Excluded Catalogue Data in `.gitignore`:_ `artifacts/catalog-extract.json` (the 55 products with full variants, pricing, and descriptions) and `artifacts/homepage.json` were ignored by `.gitignore` under `artifacts/`, preventing catalogue data from reaching Git/Vercel.
  3. _Unconnected Remote Database / Cold Start Failure:_ Without a running local MongoDB on Vercel, server-side data fetches (`fetchCatalogueIndex()` and `fetchHomepage()`) threw unhandled errors or received empty payloads, rendering 0 products.
  4. _Asset Isolation in Monorepo Root:_ Product images resided in root `public/products/`, whereas Next.js storefront deployments only serve static assets from `apps/storefront/public/`.
  5. _Express Service Entrypoint:_ `apps/api/src/server.ts` lacked a default export for Vercel's Express service runner and called `process.exit(1)` on startup when MongoDB was absent.
- **Implemented Fixes:**
  - **Git Ignore Calibration:** Updated [`.gitignore`](.gitignore) to explicitly unignore `!artifacts/catalog-extract.json` and `!artifacts/homepage.json`, while ignoring generated build sync targets (`apps/storefront/public/products/`).
  - **Storefront Fallback Catalogue Engine:** Created [`apps/storefront/src/lib/fallback-catalog.ts`](apps/storefront/src/lib/fallback-catalog.ts) and bundled authoritative seed records into `apps/storefront/src/data/catalog.json` and `homepage.json`.
  - **Resilient Storefront Data Layer:** Updated [`apps/storefront/src/lib/api.ts`](apps/storefront/src/lib/api.ts) with `hasApi()` separation:
    - In standalone mode (`!API_INTERNAL_URL` on Vercel), `fetchProducts()`, `fetchProductBySlug()`, `fetchCategories()`, `fetchCatalogFacets()`, `fetchCatalogueIndex()`, and `fetchHomepage()` seamlessly serve the full 55-product catalogue, all 674 variants, pricing, photography, categories, facets, and homepage merchandising sections.
    - When `API_INTERNAL_URL` is configured, it connects to the live API and respects server-side outage / empty responses honestly.
  - **Automated Asset Sync Pipeline:** Added [`scripts/sync-storefront-assets.mjs`](scripts/sync-storefront-assets.mjs) hooked into `pnpm build` (`apps/storefront/package.json`) to link/sync `public/products` into `apps/storefront/public/products` during local builds and Vercel deployments.
  - **Vercel Express Service Compatibility:** Updated [`apps/api/src/server.ts`](apps/api/src/server.ts) to export `app` as default (`export default defaultApp;`) and defer database connections gracefully in Vercel serverless environments.
  - **Test Rigor & Stability:** Fixed Playwright E2E alert selector in [`tests/e2e/admin.spec.ts`](tests/e2e/admin.spec.ts) avoiding Next.js route announcer collision.
  - **Verified Quality Gates:** 100% of checks passed (`pnpm typecheck`, `pnpm -r lint`, `pnpm format:check`, `pnpm test` 578/578 passed, `pnpm build`, `pnpm test:e2e` 24/24 passed, `pnpm env:check` 18/18 checks passed).

---

## 3. Automated Verification Status (All Passing)

Verification ran locally across the entire monorepo after all final code modifications:

| Verification Suite           | Command                                 | Result               | Notes                                                                                                                                        |
| :--------------------------- | :-------------------------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contracts Build**          | `pnpm --filter @ajooba/contracts build` | **PASSED**           | Clean TypeScript compilation                                                                                                                 |
| **Typecheck**                | `pnpm typecheck`                        | **PASSED**           | Zero errors across all 4 packages                                                                                                            |
| **Linter**                   | `pnpm -r lint`                          | **PASSED**           | Zero errors and zero warnings (`--max-warnings 0`)                                                                                           |
| **Code Formatting**          | `pnpm format:check`                     | **PASSED**           | Prettier style validated across all projects                                                                                                 |
| **Unit & Integration Tests** | `pnpm test`                             | **578 / 578 PASSED** | `@ajooba/contracts` (48), `@ajooba/admin` (29), `@ajooba/storefront` (66), `@ajooba/api` (435)                                               |
| **Production Build**         | `pnpm build`                            | **PASSED**           | Next.js Turbopack production build succeeded for both Storefront and Admin; API TS build succeeded                                           |
| **End-to-End (E2E)**         | `pnpm test:e2e`                         | **24 / 24 PASSED**   | Boots throwaway MongoDB, API, Storefront, and Admin; validates catalogue, buy flow, resilience, 390px/1280px overflow, and cross-device sync |
| **Environment Inventory**    | `pnpm env:check`                        | **18 / 18 PASSED**   | Environment schemas, documentation, and `.env.example` templates match                                                                       |

---

## 4. Current Readiness Assessment (7.0 / 10)

| Evaluation Dimension         |    Score     | Confidence | Status Summary                                                                                                                                                                  |
| :--------------------------- | :----------: | :--------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI & Shopping UX**         | **7.5 / 10** |   Medium   | Cohesive cream/gold palette, sticky mobile PDP actions, clear MRP/savings display, account-synced wishlist & addresses. Physical mobile device testing remains open.            |
| **Commerce Correctness**     | **7.5 / 10** |   Medium   | Server-authoritative pricing, inventory holds, Razorpay verification, return receipt gates, size exchanges, and COD ceilings working in API and UI. Live staging proof pending. |
| **Security**                 | **7.0 / 10** | Medium-low | Strong RBAC authorization, scoped customer routes, audit logging, and input validation. Tokens in `localStorage` require migration to httpOnly cookies before scale.            |
| **SEO & Discoverability**    | **7.0 / 10** | Medium-low | Structured JSON-LD (Product & Breadcrumb), dynamic sitemaps, robots.txt, and canonical URLs configured. Live domain indexing and search console integration pending.            |
| **Accessibility (a11y)**     | **6.5 / 10** |    Low     | Computed WCAG AA contrast compliance, larger-text scaling, and mobile viewport overflow tests pass. Screen-reader walkthrough and axe auditing still required.                  |
| **Performance**              | **6.0 / 10** |    Low     | Lazy loading and responsive containers in place. Request-time rendering, image compression, and Core Web Vitals require production measurement.                                 |
| **Operations & Deploy**      | **4.5 / 10** |    High    | Deployment topology conflicts (Vercel vs. Railway) unresolved. Production Atlas, Razorpay live keys, and Resend domains not yet provisioned.                                    |
| **Catalogue & Policy Trust** | **5.0 / 10** |    Low     | Prices are genuine and locked. Live inventory counts, physical warehouse addresses, support contacts, and return logistics require final business sign-off.                     |

---

## 5. Work Remaining (Launch Blockers & Open Items)

### Priority P0: Mandatory Prior to Accepting Real Customer Orders

1. **Hosting Topology & Domain Finalization:**
   - **Decision:** Current [`vercel.json`](vercel.json) configures 3 Vercel services (`storefront`, `admin`, `api`). The client plan specifies running the Express API on Railway Hobby.
   - **Action:** Obtain user confirmation. If Railway is used, remove API service bindings from `vercel.json`, configure `NEXT_PUBLIC_API_URL` to the Railway HTTPS domain, set admin server API origins, and configure CORS/webhooks consistently.
2. **Production Provider Accounts & Secrets:**
   - Provision production MongoDB Atlas cluster with least-privilege credentials and automated backup schedules.
   - Configure Razorpay live key ID, secret, and webhook signing secret.
   - Configure Resend production API key and verify DNS records (SPF, DKIM, DMARC) for the sender domain.
   - Configure Cloudinary production account for CDN image transformation and delivery.
   - Connect logistics/shipping carrier (e.g., Shiprocket) with pickup address and tracking callbacks.
3. **Staging Order Lifecycle Verification:**
   - Execute an end-to-end test order in staging: card payment, captured webhook, email delivery, warehouse dispatch status, customer return request, staff return receipt inspection, and automated Razorpay refund reconciliation.
   - Validate COD order handling, cancellation, and manual COD refund workflows.
4. **Catalogue & Policy Sign-Off:**
   - Review stock counts, colour-to-photography mapping, and product descriptions with the business owner.
   - Confirm official support phone and email in admin store settings (default placeholders in `store-settings.service.ts` remain suppressed in UI until configured).
   - Sign off on legal policies: Terms of Use, Privacy Policy, Shipping SLA, and Returns/Exchanges Policy.

### Priority P1: Complete Prior to Scaling / Broad Marketing

1. **Customer Token Storage Hardening:**
   - Migrate customer authentication tokens from browser `localStorage` to an httpOnly cookie / BFF (Backend-for-Frontend) architecture to eliminate token theft risks via script injection.
2. **Production Performance & Core Web Vitals:**
   - Run Lighthouse audits on real mobile hardware for Home, Collection, PDP, Cart, and Checkout.
   - Implement responsive image transforms (WebP/AVIF formats and responsive `srcset` via CDN).
3. **Accessibility Auditing:**
   - Run automated axe-core accessibility scans across all unique page templates.
   - Conduct manual screen-reader (NVDA/VoiceOver) testing on checkout, form validation, and return request dialogs.
4. **Logistics & Exception Handling Documentation:**
   - Document internal standard operating procedures (SOPs) for manual COD refund payouts and price-mismatched exchange adjustments.

### Priority P2: Post-Launch Polish & Merchandising

1. **Curated Promotional Banners:** Design and place high-resolution campaign banners in designated whitespace once promotions are scheduled.
2. **AI Fit & Styling Assistant:** Integrate an AI shopping guide strictly grounded in verified size charts, material specifications, and real-time inventory, with human support escalation.
3. **Search Console & Analytics Monitoring:** Review Google Search Console rich-result validation, indexing status, payment drop-off rates, and exchange analytics.

---

## 6. Repository Working Tree Status

- **Uncommitted Modifications:** All updates to contracts, API routers, storefront components, CSS tokens, documentation, and E2E tests are preserved unstaged in the local working directory.
- **Git Commit / Push:** No commits or external pushes have been executed. All existing codebase logic and prices remain intact and safe.
