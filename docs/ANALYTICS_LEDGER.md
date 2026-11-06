# The interaction ledger

How the shop records what shoppers touch, why it is built this way, and what the
admin panel can answer from it.

This document describes code that exists. Every claim below is implemented in
the repository at the path named beside it.

---

## 1. What is recorded

An **interaction event** is one row in `activity_events`, written by
`apps/api/src/models/activity-event.model.ts`. Rows come in three kinds:

| Kind             | Written by                                | Example                                    |
| ---------------- | ----------------------------------------- | ------------------------------------------ |
| Page view        | `PageViewTracker` on a product/category   | `product_view` for one design              |
| Tap              | any instrumented control                  | `interaction · add-to-cart · pdp-buy-box`  |
| Commerce outcome | checkout, order, return endpoints         | `order_completed`, `return_requested`      |

A tap carries two closed-vocabulary fields — `surface` (where on the shop) and
`action` (which control). Both are `z.enum`s in
`packages/contracts/src/analytics/types.ts`, so an unknown value is rejected at
the API boundary rather than becoming a report row that never groups with
anything else.

### Why a closed vocabulary

Free-text action names drift within a week: `add_to_cart`, `addToCart`,
`add-cart`. A report whose rows do not group is worse than no report, because it
looks like data. Adding a control therefore means adding a member to
`INTERACTION_ACTIONS`, which is a TypeScript error at every call site until the
control is wired.

### What is deliberately absent

- no IP address
- no user-agent string (only a coarse device *class*: phone / tablet / laptop)
- no scroll depth, no keystroke log, no session replay
- no page-view recording from the server — see §3

---

## 2. Identity: three ids, none of them personal

| Id         | Store             | Lifetime        | Purpose                              |
| ---------- | ----------------- | --------------- | ------------------------------------ |
| visitor    | `localStorage`    | until cleared   | a returning shopper is one shopper    |
| session    | `sessionStorage`  | until tab close | the denominator of every funnel rate  |
| customer   | derived from JWT  | token lifetime  | `cxs@gmail.com`, never from the body  |

`apps/storefront/src/lib/track.ts` owns the first two.
`apps/storefront/src/lib/customer-session.ts` owns the third.

**The customer id is never sent in a request body.** The API reads it from the
verified access token (`optionalAuth` in `apps/api/src/middleware/auth.ts`) and
from nowhere else. A shopper editing the JSON cannot attribute their browsing to
another person — the worst they can do is send no token, and then the event is
anonymous, which is the correct outcome.

The storefront's tracker attaches that token on every flush, read at flush time
rather than captured at page load, so events recorded after a mid-session sign-in
are identified even though earlier ones were not.

---

## 3. Why page views are recorded client-side only

Product and category pages are server components. A server render can happen
for a crawler, for a Next.js prefetch, or twice for one visitor, and counting any
of those would inflate every view by a factor nobody can reproduce.

`PageViewTracker` is a client component, deduplicated on the page's identity, so
it fires once per real visit in a browser.

---

## 4. Consent is a gate, not a footnote

The banner (`apps/storefront/src/components/pwa/consent-banner.tsx`) writes
`ajooba-consent` and nothing is sent unless it equals `all`.

- Choosing **Necessary only** calls `forgetVisitor()`, which drops the queue,
  clears the timers, and removes both ids. It *undoes* rather than pauses.
- `flush()` re-checks consent every time. A queue that exists when consent is
  withdrawn is emptied, not retained "just in case".

---

## 5. Delivery: one batch, not one request per tap

A shopper taps a colour, a size and add-to-cart inside four seconds. Three
requests would burn three rate-limit slots and lose the third on navigation.

Events collect in a bounded queue (25, matching
`recordEventBatchSchema.events.max(25)`) and leave in a single `keepalive` POST:

- on a 4-second idle timer,
- on `visibilitychange → hidden`,
- on `pagehide` (the one event that fires reliably on iOS Safari),
- immediately when the queue fills.

A failed batch is retried once after 15 seconds and then dropped. Tracking never
throws, never blocks a click, and never surfaces an error to a shopper.

---

## 6. What the reports compute, and the rules they obey

`apps/api/src/services/insights.service.ts` aggregates at request time. There is
no rollup collection and no nightly job: a rollup is a second copy of the truth,
and the moment the two disagree nobody can say which is right.

### A tap is any event carrying an `action`

This is the load-bearing definition, and it was wrong once. Counting only the
generic `interaction` event made the add-to-cart button **invisible** in every
"taps" figure and every share, because that control is recorded under its own
event name. The report now counts:

- `taps` — any event with a non-null `action`
- `addToCart` — `add_to_cart` **or** `action: 'add-to-cart'`
- `wishlistAdds` — `wishlist_added` **or** `action: 'wishlist-toggle'`

### The funnel counts sessions, not events

The `funnel` block is computed separately from `totals`, and it has to be.
`totals.visitors` counts sessions while `totals.productViews` and
`totals.addToCart` count events, so reading one as the drop-off from the other
produced a funnel that reported a rise from "browsed" to "opened a design" and
then a fabricated collapse into the cart. Four page reads by one shopper is one
shopper.

Every step is therefore a conditional `$addToSet` on the session id
(`browsed`, `viewedDesign`, `addedToCart`, `startedCheckout`, `ordered`), which
makes later steps subsets of earlier ones by construction. The steps are still
not a strict cohort — a shopper can add to cart in one visit and open a design in
another — so a step means "sessions that did X", not "the ones who survived".

### The add-to-cart rate is over sessions, not views

A shopper who reloads five times is one shopper. Dividing adds by views would
score them at 20% off a single cart action and rank that design above one that
genuinely converted. The denominator is distinct sessions that viewed the
product.

### Distinct visitors are counted per group, not summed

`$addToSet` on the session id gives each group its true count. Adding per-product
visitor counts would report one shopper who looked at four products as four
shoppers — the most common way a product report lies.

### An empty collection produces a report of zeros

Not an error, and not a fabricated demo. A shop nobody has visited yet shows
zeros, and the screen says so in words.

### The store view and the category view are one computation

The category filter is a query parameter on the same aggregation, not a second
implementation. Two implementations would eventually disagree about whether a tap
on a product card is a grid tap or a product tap, and an operator comparing them
would have no way to know which was right.

---

## 7. The admin screens

| Screen                        | Answers                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `/insights`                   | where attention goes store-wide, and where it stops      |
| `/insights?category=<slug>`   | the same report scoped to one category                   |
| `/insights/customers`         | which signed-in customers are shopping, ranked           |
| `/insights/customers/<id>`    | what one person actually touched, design by design       |

All four require `analytics:read` on the API and hide their navigation row when
the operator lacks it. The hidden row is courtesy; the API check is the
authority.

`/insights/customers/<id>` distinguishes two absences:

- **no account and no events** → `404`, so a stale link says so
- **no account but events exist** → `200`, because those visits happened and
  discarding them loses real history

---

## 8. What this enablement does *not* change

The interaction ledger is additive. It does not:

- alter the cart, checkout, pricing, inventory or order lifecycle,
- write to any commerce collection,
- gate any storefront feature behind tracking,
- require a shop to opt in to record events (only the shopper's consent gates it).

The only commerce-adjacent change is that `/v1/auth/*` is now used by the
storefront's sign-in form. That surface already existed and is unchanged; the
form simply calls it, and falls back to a device-local account with a visible
warning when the API cannot be reached.

---

## 9. Verifying it

```bash
pnpm --filter @ajooba/api test -- analytics      # 19 tests
pnpm --filter @ajooba/api test                   # full suite, 399 tests
```

`apps/api/tests/analytics.test.ts` asserts the rules that matter, not the
screens:

- an anonymous batch is accepted and stored one row per event,
- a token's customer is attached,
- a `customerId` in the body is ignored,
- an action outside the taxonomy is rejected with `VALIDATION_FAILED`,
- a query string is stripped from a recorded path,
- customers and `support` are refused the report,
- an empty collection yields zeros and a dense 30-day trend,
- taps group by surface and action, and the shares sum to 1,
- a page view is not counted as a tap on its surface,
- the funnel counts sessions, so no step exceeds the one before it,
- the category filter narrows products,
- the visitor list contains identified customers only,
- a visitor profile returns their products, actions and recent events,
- an unknown id is `404`, a malformed id is `422`.
