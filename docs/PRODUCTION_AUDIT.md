# Ajooba Footwear production audit

**Review date:** 7 November 2026 (updated 8 November 2026)  
**Scope:** source repository, service boundaries, application flows, configuration and automated checks. This is a code audit, not a live-site, load-test, SEO-console, penetration-test or real-device certification. The repository has not been deployed to a production domain during this review.

## Scores at a glance

| Area                       |     Rating | Confidence | Short assessment                                                                                                                                                                                                                             |
| -------------------------- | ---------: | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI and shopping UX         | **7.5/10** | Medium     | Strong brand base, clear price treatment, working mobile sticky product actions, account-synced wishlist and address book, and checkout that reuses saved addresses. Real-device and service-recovery review is still needed.               |
| Performance                | **6.0/10** | Low        | Responsive layout and lazy image usage exist, but request-time rendering, plain image elements and the interactive home showcase need measurement and optimization. No Lighthouse or field Core Web Vitals data exists.                      |
| SEO                        | **7.0/10** | Medium-low | Product metadata, canonical URLs, product/breadcrumb JSON-LD, sitemap and robots rules are present. Search-engine verification, index coverage, rich-result checks and image/content validation are not.                                     |
| Commerce correctness       | **7.5/10** | Medium     | Server-priced checkout, payment verification, return eligibility, provider-confirmed refunds, same-design size exchanges and saved-address checkout are real API flows. External payment, courier and COD refund operations need staging proof. |
| Accessibility              | **6.5/10** | Low        | Text-colour tokens raised to WCAG AA contrast on every light ground; larger-text mode works; E2E checks no horizontal overflow at 390px/1280px with larger text and reduced motion, plus Escape closing the mobile menu. No screen-reader or axe audit yet. |
| Security                   | **7.0/10** | Medium-low | API authorization, scoped customer records (including new address routes), validated inputs and environment schemas are in place. Customer bearer/refresh tokens in `localStorage` remain an XSS exposure; no independent security review was run. |
| Operations and launch      | **4.0/10** | High       | The code contains health, audit and provider integrations, but production topology and credentials are unresolved. No live deployment, backup restore, alerts or rollback drill has been demonstrated.                                       |
| Catalogue and policy trust | **5.0/10** | Low        | Prices are sourced from catalogue data and untouched in this work. Live stock, images, origin/material details, product copy and historical brand claims still need owner verification.                                                      |

**Code-only readiness: about 7.0/10.** This rating covers the application and launch system together. It is not a live-store score. The project is not at 9/10 and is not ready to accept production orders. The main limits are operational evidence and verified business data, then measured performance/accessibility — not missing visual features.

## Findings by area

### UI and shopping UX — 7.5/10

**Working well:** the cream/ink/gold/claret system is consistent; list/detail prices use catalogue values and struck-through MRP; the PDP already has mobile sticky Add to cart and Buy now controls; size choice is explicit; and this review added policy-backed exchange/return confidence points without changing prices or asserting unverified country of origin.

**Remaining:** review the product, cart, checkout, account, returns and exchange journeys on real iOS/Android devices at narrow and zoomed text sizes. Test validation errors, unavailable stock, API outage, expired session, payment cancel/retry, COD and duplicate taps. Wishlist and saved addresses are now stored on the customer account; the cart stays on the device until checkout, where the API reconciles it. Review marketing claims against signed-off policy and product data.

**Design direction:** keep the current approximately 82rem / 1,312px content width. Add useful editorial/category/campaign material in empty side space and use fewer, stronger homepage banners. Keep the current palette. Improve sale price/MRP/savings hierarchy, button states and product information spacing as a shared system. Do not generate a discount campaign until the offer and eligible products are real.

### Performance — 6.0/10, low confidence

**Source risks:** the storefront root forces request-time rendering to support runtime Vercel service bindings and fetches shared taxonomy there; many catalogue, hero, account and order images use plain `<img>` elements; the homepage includes a large client-side interactive showcase. These may increase server work, image bytes and JavaScript on mobile. This is a risk assessment from source, not measured latency.

**No evidence yet:** no production URL, Lighthouse run, WebPageTest trace, Core Web Vitals field data, bundle analysis, slow-network/mobile CPU run or Cloudinary delivery configuration was available. Do not describe this score as a measured page-speed result.

**Next:** settle the API host, then measure representative home, collection, PDP, cart and checkout routes on mobile. Add responsive modern image delivery with width/quality limits, reserve dimensions to prevent layout shift, defer below-fold images, inspect the showcase bundle/interaction cost, and cache public catalogue reads where freshness rules allow. Set performance budgets from measured baselines and verify at least one field-data period after launch.

### SEO — 7.0/10, medium-low confidence

**Present:** public pages and product pages have metadata/canonicals; product pages emit Product and BreadcrumbList JSON-LD; a generated sitemap includes public routes and catalogue products; robots rules exclude account, cart and checkout surfaces.

**Gaps:** no verified production domain or Search Console/Bing Webmaster property, submitted sitemap, crawl report or rich-result validation. Catalogue descriptions, image alt text, variant availability and product attribute completeness need a business-data review. The global description previously claimed free shipping across India without evidence that this is universally true; it has been made neutral. About-page statements such as “since 1986,” a specific workshop location and craft history need documentary/business-owner confirmation before they are promoted as factual. Structured data must be rechecked against the exact live offer/availability returned by the API.

**Next:** verify domain ownership, submit the sitemap, inspect indexing/canonical coverage, validate Product/Breadcrumb markup, check mobile snippets and image discovery, and add Search Console monitoring. Keep account and transaction pages out of the index.

### Commerce correctness — 7.5/10

**Present:** checkout reads authoritative API prices/totals and creates persisted orders; paid status follows server verification; COD follows store configuration and the configured ceiling. Return requests enforce ownership, delivered status, quantity and the 10-day window. Refund state can only become complete after provider confirmation; returns now require staff receipt/inspection first. Same-design/colour size exchanges verify order eligibility and stock, hold replacement inventory on approval and block unsupported price differences. Customer and staff pages use real return/exchange records.

**Operational limits:** no live Razorpay or webhook replay test was possible. Shipping labels, pickup and tracking are not connected to a carrier. COD refund payout requires support/manual handling. An exchange with a price mismatch has no payment-collection/refund flow and is stopped deliberately. A return's physical condition and carrier receipt still require staff process evidence.

**Added in this pass:** `/v1/addresses` (list, create, update, delete, single default, per-customer isolation) and a normalized `id` on `/v1/wishlist`. The storefront address book, wishlist and checkout use these routes when signed in; checkout sends `shippingAddressId` for an unchanged saved address. Checkout also blocks cash on delivery above ₹10,000 and only shows a free-shipping line when a threshold is configured.

### Accessibility — 6.5/10, low confidence

**Done:** storefront and admin text-colour tokens were darkened so body/secondary text passes WCAG AA (≥4.5:1) on every light ground (calculated, not measured with a tool on device). The larger-text toggle now scales the root font. An E2E test checks seven key routes for horizontal overflow at 390px and 1280px with larger text and reduced motion on; it found and fixed an 8px mobile header overflow. The mobile menu closes with Escape.

**Remaining:** run axe (or similar) on core templates; manually test checkout and account flows with keyboard and a screen reader; verify focus order, dialog focus trapping, form error association, status announcements for cart/payment/refund, and 200% zoom on real devices.

### Security — 7.0/10, medium-low confidence

**Present:** customer-owned order/return routes check identity server-side, admin operations check permissions, request schemas validate input, payment secrets remain server-side, production environment shape is checked, and administrative changes write audit records.

**Risk:** customer access and refresh tokens are kept in `localStorage`, so any script injection on the storefront can read them. Plan an httpOnly-cookie/BFF migration with explicit CSRF/CORS design before scaling. Also perform an external dependency/security review, inspect response security headers/CSP, confirm production secret separation/rotation, test rate limits and recovery, and verify access to logs/backups. No penetration test or production-header inspection is claimed here.

### Operations, data and rollout — 4–5/10

The Vercel file currently defines three public services by route (`storefront`, `admin`, `api`) with `storefront` and `admin` bound to `api` through `API_SERVICE_URL`. The intended purchase list says Railway for the API. Those are conflicting architectures. Confirm one before changing the deployment file or buying services.

No production MongoDB Atlas, Cloudinary, Razorpay, Resend, mail domain, courier credentials, live domain, alerting destination, backup/restore record or release rollback was supplied. A local environment-variable inventory passing is not proof that production values are correct. Current product prices were not changed; current live stock, product origin/material facts, policy promises and business-story claims remain owner sign-off items.

## Priority work

### P0 — required before any live order

1. Confirm hosting topology and domains. Recommended based on the stated plan: Vercel for storefront/admin and Railway for the Express API, with the Railway HTTPS origin wired into both apps. If choosing this, remove Vercel API service bindings and configure public API/proxy paths, CORS, auth callback and Razorpay webhook URLs consistently. Or keep all three Vercel services and do not provision Railway for the API.
2. Configure production Atlas, Razorpay, Resend, Cloudinary and the chosen carrier. Verify production secrets, payment/refund webhooks, sender DNS, image delivery, CORS, rate limits and health checks in staging.
3. Validate catalogue stock, product/variant photo-colour mapping, shipping/tax/return policies, contact details, product origin/material claims and About-page history with the owner. Do not adjust product prices as part of this work.
4. Prove a complete staging order lifecycle: online payment success/failure/cancel/retry, COD, fulfillment/tracking, customer mail, return, staff inspection, refund pending/processed/failed, size exchange, stock movements and duplicate webhook handling.
5. Configure automated backups and demonstrate a restore; set alert ownership, log retention, incident contacts and a tested rollback.

### P1 — close before broad launch

1. Replace customer token storage with a reviewed httpOnly session pattern; verify CSP and security headers.
2. Measure and improve mobile image delivery, homepage JavaScript and request-time rendering; establish performance budgets from Lighthouse/field evidence.
3. Complete screen-reader/axe accessibility checks and real-device UX for product selection, checkout and post-purchase support.
4. Document the manual COD refund and exchange price-difference support workflow until automation exists.

### P2 — growth and polish

1. Add owner-approved campaign/category banners and merchandising in current whitespace.
2. Add grounded AI fit/search help after verified size, material, origin and stock data are complete; provide citations to catalog fields and a human support fallback.
3. Review Search Console, conversion funnels, failed payments, exchange demand and Core Web Vitals after sufficient real traffic.

## Verification notes

Local verification on 8 November 2026 (Windows, after the final code edits):

- `pnpm typecheck` and `pnpm -r lint`: pass.
- `pnpm test`: 578 passed — contracts 48, admin 29, storefront 66, API 435.
- `pnpm build`: API, admin and storefront build (Next.js Turbopack).
- `pnpm test:e2e`: 24/24 passed against a throwaway MongoDB, the real API and production builds of storefront and admin.
- `pnpm env:check`: 18/18 checks.

These are local checks. They do not replace live-provider, live-database, screen-reader, load, Lighthouse or field-performance evidence.
