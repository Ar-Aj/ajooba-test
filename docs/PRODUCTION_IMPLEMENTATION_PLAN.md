# Ajooba Footwear: production implementation plan

This plan is based on the current repository and the client quotation. It preserves the cream, ink, gold and claret identity, keeps catalogue prices unchanged, and treats the API as the authority for price, discount, stock, order status and payment state.

## Current position

The project is a mature commerce monorepo with real catalogue/admin APIs, authenticated customer accounts, server-side order pricing and inventory updates, Razorpay integration code, Resend templates, shipping/return services, admin operations and automated tests. Recent work connects checkout, account orders, returns, size exchanges, wishlist and saved addresses to API records; adds refund receipt gates, staff queues, contrast fixes and first-pass PDP/SEO improvements.

It is not live-order ready yet. No production provider credentials, domain, deployment, backup restore or real-device/performance evidence have been checked. `vercel.json` currently deploys storefront, admin and API as three Vercel services, while the requested provider plan says the API will run on Railway. That choice must be resolved before the Vercel config or environment plan can be final.

## Implementation sequence

| Phase                         | Status                                                              | Work and exit condition                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Commerce checkout          | **Application flow connected; staging proof open**                  | Signed-in checkout syncs cart lines to the API, uses API totals, creates a persisted order, starts Razorpay when configured and waits for server verification before showing payment success. COD follows store settings and the configured cap. Exit: staging Razorpay success/failure/cancel/retry, COD, webhook replay and stock movements reconcile without duplicates.                                       |
| 2. Customer account           | **Server-backed; token hardening open**                             | Order list/detail, returns, exchanges, wishlist and saved addresses read/write API records. Checkout can reuse a saved address by id. The cart stays on the device until checkout, where the API reconciles it. Exit: move customer tokens from `localStorage` to a reviewed httpOnly-cookie design and confirm account data is removed securely with the account.                  |
| 3. Returns and refunds        | **Request/review/refund code connected; physical operations open**  | Returns are limited to delivered orders in the 10-day window. Staff approve/reject, record receipt after inspection, then start or reconcile an actual Razorpay refund. The refund is complete only after provider confirmation. COD payouts and pickup/return labels are manual support work. Exit: verify online and COD cases, failed/pending webhooks, stock restoration and all customer notices in staging. |
| 4. Size exchange              | **Customer and staff workflow connected; logistics open**           | Request only another size of the same design/colour within 10 days and when stock is available. Approval holds replacement stock; staff record receipt, dispatch and completion. Price differences are blocked for support. Exit: exercise a full exchange with the real pickup and carrier process; reconcile returned-item inspection and stock.                                                                |
| 5. Storefront, mobile and SEO | **Local layout/contrast checks pass; device/field validation open** | Existing palette and prices are preserved. PDP keeps sticky mobile Add to cart / Buy now controls and policy-backed SVG confidence points. Text contrast meets WCAG AA by calculation; E2E checks 390px/1280px overflow with larger text and reduced motion. Sitemap, robots and product/breadcrumb structured data are present. Exit: real-device, screen-reader, image loading, Lighthouse and Search Console/rich-result reports. |
| 6. Hosting and providers      | **Not provisioned**                                                 | Decide Vercel/Railway topology; connect Atlas, Cloudinary, Razorpay, Resend and carrier credentials; configure domains, CORS, webhooks, sender verification, backups, alerts, restore and secret rotation. Exit: a production-like environment passes health, payment/refund, mail, delivery and backup/restore checks.                                                                                           |
| 7. Product data and launch    | **Owner validation required**                                       | Reconcile all live prices, variants, stock, colour-matched photography, size/material/origin facts, tax/shipping/return rules, support contacts and any historical brand story. Exit: owner signs off real data and policies, no unsupported claims or placeholders remain, security/accessibility/performance gates pass, and a controlled release is approved.                                                  |

## Recommended design direction

- Keep the current maximum shop width near 82rem (about 1,312px). The issue is using the side space with intention, not making every page wider. Add a small number of strong, real campaign/category banners and more breathing room around the product grid. Do not generate promotional art until the offer, dates and product set are approved.
- Keep the existing palette and typography. Improve button hierarchy, focus/hover/disabled states, sale-price/MRP/savings alignment, stock messages, size selection and mobile spacing as one consistent system. Every saving must remain calculated from catalogue values. No product price has been changed.
- Keep PDP promises tied to enforceable policy and actual inventory. Do not claim “Made in India,” material composition, delivery days, free shipping, pickup coverage or review counts without verified data and a matching operational capability.
- Defer an AI shopping assistant until product attributes and size charts are clean. A future fit helper should cite the approved chart and the shopper’s inputs; search/recommendations should query live catalogue and stock tools. It must not invent products, reviews, availability or delivery dates, and it needs a non-AI fallback, privacy notice and support escalation.

## Deployment topology to confirm

The checked-in Vercel config currently defines three services: `storefront` (`apps/storefront`), `admin` (`apps/admin`) and `api` (`apps/api`). Public paths are `/` to storefront, `/admin` to admin, and `/api` to API (with `/api/health` handled by the storefront health route). Storefront and admin declare bindings to `api` through `API_SERVICE_URL`.

The planned Railway API cannot receive a Vercel service binding. Recommended if Railway remains the selected API host: deploy only storefront/admin on Vercel, configure `NEXT_PUBLIC_API_URL` to the Railway HTTPS API origin, configure the admin server API origin, and make CORS, webhooks and custom domains agree. The Vercel `api` service and its bindings would then be removed, and `/api` may remain a proxy only if its routing is deliberately configured. Do not silently mix both arrangements.

## Non-negotiable commerce rules

1. Product and variant prices come from the catalogue; browser totals are never trusted. Existing prices remain unchanged in this work.
2. Only server verification/webhooks can confirm a Razorpay payment. Browser callbacks never mark an order paid on their own.
3. Returns, refunds and exchanges are separate processes. A return/refund requires inspection and provider confirmation; an exchange does not move money. Price-mismatched exchanges remain blocked until an explicit collection/refund flow exists.
4. Do not claim a refund, shipment, delivery or pickup completed until Razorpay, the carrier or an operator records that fact.
5. Missing production configuration must show an unavailable state. It must not create a local-only successful checkout or false confirmation.

## Launch inputs

- Confirm the API host, service names, public routes, domains and Vercel bindings.
- Create Atlas production access, least-privilege credentials, indexes, automated backups and a tested restore.
- Configure Razorpay test/live keys and webhook secret; Resend key and authenticated sender; Cloudinary account; carrier account, pickup address and tracking callbacks.
- Approve live product stock/prices/images, origin/material/size data, written policies, return windows, taxes, shipping amounts and customer-care contacts.
- Run staging end-to-end purchase, cancellation, return, refund and exchange workflows with operators. Then capture Lighthouse/Core Web Vitals, accessibility checks and mobile-device QA before phased launch.
