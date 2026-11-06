# Provider contract notes — captured 23 Oct 2026 from official docs

Every field, endpoint and header below was read from the provider's own
documentation during this task. Nothing here is inferred from memory or
guessed. Where a document could not be retrieved, that is stated explicitly.

---

## Razorpay

Source: `https://razorpay.com/docs/...` (docs revision 30 April 2026, per
`https://razorpay.com/docs/llms.txt`).

### 1. Create order (server side)

`POST https://api.razorpay.com/v1/orders`, HTTP Basic auth with
`key_id:key_secret`.

Request fields (documented as mandatory/optional):

| Field             | Required | Notes                                                          |
| ----------------- | -------- | -------------------------------------------------------------- |
| `amount`          | yes      | **integer, smallest currency unit** (paise). ₹500.00 → `50000` |
| `currency`        | yes      | 3 chars                                                        |
| `receipt`         | no       | our order number, max 40 chars                                 |
| `notes`           | no       | max 15 key/value pairs, 256 chars each                         |
| `partial_payment` | no       | boolean                                                        |

Response: `id` (`order_...`), `entity`, `amount`, `amount_paid`, `amount_due`,
`currency`, `receipt`, `status`, `attempts`, `notes`, `created_at`.

### 2. Client-safe Checkout options

Only `key` (publishable key id), `amount`, `currency`, `name`, `order_id`,
`prefill`, `notes`, `theme` are safe to expose to the browser. The key
**secret** must never appear client-side.

### 3. Signature verification (mandatory)

`generated_signature = hmac_sha256(order_id + "|" + razorpay_payment_id, key_secret)`

The `order_id` used in the HMAC must be the one **from our own server**, not
the `razorpay_order_id` echoed back by the browser. Compare with a
constant-time comparison.

### 4. Webhooks

- Signature header: `X-Razorpay-Signature`.
- `expected = hmac('sha256', raw_webhook_body, webhook_secret)`.
- **The body passed to the HMAC must be the raw request body.** The docs state
  explicitly: _"Do not parse or cast the webhook request body."_
- Duplicate detection header: `x-razorpay-event-id`, unique per event.
- Events may arrive **out of order** — the documented example is
  `payment.authorized` then `payment.captured`, which "may not be followed at
  all times". The handler must not assume ordering.
- If the webhook secret is rotated, retries of old events still carry the
  **old** secret.
- Razorpay's retry guidance: transient failures should return a non-2xx so
  the event is retried.

#### 4a. Payload shape — verified 23 Oct 2026, and it is easy to get wrong

Read from `https://razorpay.com/docs/build/llm-docs/webhooks/payments.md`,
`.../webhooks/refunds.md` and `.../webhooks/all.md`. A payment event looks
like this:

```json
{
  "entity": "event",
  "account_id": "acc_...",
  "event": "payment.captured",
  "contains": ["payment"],
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_...",
        "entity": "payment",
        "amount": 100,
        "currency": "INR",
        "status": "captured",
        "order_id": "order_...",
        "captured": true,
        "method": "upi"
      }
    }
  },
  "created_at": 1567674606
}
```

Two details carry all the weight, and both were wrong in this codebase
before 23 Oct 2026:

1. **The envelope's `entity` is `"event"`, not `"payment"`.**
2. **The payment fields live at `payload.payment.entity.*`** — one level
   _deeper_ than `payload.payment.*`.

A schema pinned to `entity === 'payment'` and reading `payload.payment.id`
rejects a genuine capture. The handler acknowledges unrecognised events with
HTTP 200 (so the provider does not retry forever), so the failure was silent:
money captured, order never settled. The webhook schema now accepts the
documented nesting and both flatter variants.

Refund events (`refund.created` / `.processed` / `.failed`) follow the same
convention with the refund entity at `payload.refund.entity`, naming the
payment it reverses via `payment_id`, and `contains: ["refund", "payment"]`.

#### 4b. Event catalogue

From `https://razorpay.com/docs/build/llm-docs/webhooks/all.md`. The events
this integration acts on:

| Event                                 | Handling                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `payment.authorized`                  | Recorded, no state change — awaiting capture.                                |
| `payment.captured`                    | Marks the order paid, after an amount reconciliation.                        |
| `payment.failed`                      | Marks the payment failed and releases stock.                                 |
| `refund.created` / `refund.processed` | Reconciled from the refund record, not trusted from the event body.          |
| `refund.failed`                       | Rolls back the **refund** only. It must never touch the payment — see below. |

Everything else in the catalogue (`subscription.*`, `payout.*`,
`transfer.*`, `settlement.*`, `qr_code.*`, `virtual_account.*`,
`payment_link.*`, `invoice.*`, `payment.dispute.*`) is out of scope; the
handler records them as unrecognised rather than guessing.

> **`refund.failed` is not a payment failure.** These two events used to share
> a code path, which meant a refund the provider could not process flipped the
> _payment_ to `failed` and released the order's stock — for a customer who
> had already paid and still had their goods. They are now separate: a failed
> refund reopens the return and restores the refundable balance, and leaves
> the payment, the order and the stock alone.

### 5. Refunds

`POST /v1/payments/:id/refund`

- Refunds are possible for `captured` payments **only**.
- `amount` — optional; in smallest unit. Omit for a full refund.
- `speed` — optional, `normal` (default, 5–7 working days) or `instant`.
- `receipt`, `notes` — optional.
- **Idempotency**: header `X-Refund-Idempotency`, min 10 chars,
  `[A-Za-z0-9-_]`. A retry with the same key and a **different body** is
  rejected. A request arriving while the original is in flight returns
  **409 Conflict** — safe to retry.
- Response: `id` (`rfnd_...`), `amount`, `payment_id`, `status`
  (`processed`/`pending`/`failed`), `speed_requested`, `speed_processed`.
- A payment only becomes `refunded` when the **entire** amount is refunded;
  partial refunds leave it `captured`.

---

## Resend

Source: `https://resend.com/docs/send-with-nodejs.md`,
`https://resend.com/docs/add-a-domain.md`,
`https://resend.com/docs/dashboard/domains/introduction.md`.

### Sending

```ts
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send({
  from: 'Ajooba <onboarding@resend.dev>',
  to: ['delivered@resend.dev'],
  subject: 'Hello',
  html: '<strong>Hi</strong>',
  idempotencyKey: 'welcome-user/123456789',
});
```

- The SDK returns `{ data, error }`; **it does not throw** on a provider
  error. A caller that only uses `try/catch` will silently "succeed".
- `data.id` is the message id.
- **Idempotency**: `idempotencyKey`, unique per API request, expires after
  24 hours, max 256 chars, recommended pattern `<event-type>/<entity-id>`.
- Rate limit: 10 requests/second/team → HTTP `429`.
- `tags`: name and value max 256 chars, ASCII only.

### The REST contract this codebase actually uses

`apps/api/src/services/resend.service.ts` talks to the API directly rather
than through the SDK, for the same reason as the other two providers: the
contract is small and a hand-rolled client keeps the dependency surface
minimal while still following the documented request shape exactly.

```
POST https://api.resend.com/emails
Authorization: Bearer re_xxxxxxxxx
Content-Type: application/json
Idempotency-Key: <optional, <=256 chars, expires after 24h>

200 { "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }
4xx/5xx { "statusCode": 422, "message": "...", "name": "validation_error" }
```

Request fields sent by this implementation: `from`, `to` (array), `subject`,
`html`, `text`, `reply_to`, `tags: [{ name, value }]`.

Three deliberate choices, each of which prevents a specific failure:

1. **The response is checked with `res.ok`, not with `try/catch`.** The SDK
   does not throw; a provider rejection would otherwise be recorded as a
   successful send.
2. **A 2xx with no `id` is treated as a failure.** A message id is the only
   proof that a message exists; without it the outbox would record `sent`
   for something that may not have been transmitted.
3. **Retryability is decided by status.** `429` (the documented 10/second
   rate limit) and `5xx` are worth retrying; a `4xx` means the request
   itself is wrong and will fail identically however often it is sent.

### Domain verification

- A verified domain is **required** before sending from your own address.
- A **subdomain** is recommended over the root domain (e.g.
  `notifications.example.com`).
- Region choice, optional custom Return-Path subdomain (default
  `send.example.com`).
- DNS: copy the **DKIM (TXT) and SPF (TXT or MX / CNAME)** records exactly as
  generated. If a CNAME is shown, do **not** enable proxying (e.g. the
  Cloudflare orange cloud) or verification cannot complete.
- Verification usually completes within ~15 minutes, but DNS propagation may
  take up to **72 hours**.
- Add a **DMARC** record after verification.
- Click/open tracking should stay **disabled for transactional mail**.

---

## Shiprocket

Sources: the official Postman workspace
(`https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace`),
which mirrors the Shiprocket API docs, and
`https://apidocs.shiprocket.in/` via mirror.

> **Retrieval note:** `docs.shiprocket.in` and `apidocs.shiprocket.in` were
> **not reachable** from the build environment (SSL/TLS handshake failure,
> HTTP 500, and a 503 from the API host). The contract below was taken from
> Shiprocket's official Postman workspace and help documentation. It is
> marked accordingly in the runbook and must be re-verified against the live
> dashboard before go-live.

### Authentication

- `POST https://apiv2.shiprocket.in/v1/external/auth/login` with
  `{ "email": "...", "password": "..." }`.
- Every other call sends `Authorization: Bearer <token>`.
- **Token validity is 10 days** → the adapter must refresh it automatically
  and handle `401` by re-authenticating exactly once.
- `POST /v1/external/auth/logout` invalidates the token.

### Create a custom (adhoc) order

`POST /v1/external/orders/create/adhoc`

Required fields (from the documented table):

`order_id` (≤50 chars), `order_date` (`yyyy-mm-dd`, time optional),
`pickup_location` (must already exist in the account), `billing_customer_name`,
`billing_address`, `billing_city`, `billing_pincode`, `billing_state`,
`billing_country`, `billing_email`, `billing_phone`,
`shipping_is_billing` (boolean), `order_items[]`, `payment_method`
(`COD` | `Prepaid`), `sub_total`, `length`, `breadth`, `height`, `weight`.

Notes:

- If `shipping_is_billing` is `false`, the `shipping_*` fields become required.
- `sub_total` is **not** computed by Shiprocket — we must send the correct
  value.
- `order_id` must be unique; reusing a **cancelled** order's id is rejected
  (documented to return 422).
- Dimensions must each be **> 0.5 cm** and weight **> 0 kg**.
- `order_items[]`: `name`, `sku`, `units`, `selling_price` (integer rupees,
  inclusive of GST), optional `discount`, `tax`, `hsn`.

Response body: `{ order_id, shipment_id, status, status_code,
onboarding_completed_now, awb_code, courier_company_id, courier_name }`.

> **The dimensions this codebase sends are package dimensions, not shoe
> dimensions.** `SHIPPING_PACKAGE` in `apps/api/src/services/shipping.service.ts`
> is a single constant — `30 × 20 × 12 cm`, `0.8 kg` — used for every
> parcel. That is a **documented minimum-plus estimate**, not a measurement
> of the actual box, and the comment in the code says so. It is recorded in
> one place deliberately, so changing it is an explicit act rather than a
> scattered edit. It comfortably clears the documented `> 0.5 cm` /
> `> 0 kg` floors, and it is what the courier charges on.

### Serviceability

`GET /v1/external/courier/serviceability`

Params: `pickup_postcode` and `delivery_postcode` (both required),
`is_return` (1/0), and **either** `order_id` **or** `cod` + `weight`.
Optional: `length`, `breadth`, `height`, `declared_value`, `mode`, `qc_check`.
Returns serviceable couriers with rates and ids.

### AWB, label, pickup, tracking

| Purpose          | Endpoint                                        | Body / notes                                                                              |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Assign AWB       | `POST /v1/external/courier/assign/awb`          | `{ shipment_id, courier_id }`                                                             |
| Generate label   | `POST /v1/external/courier/generate/label`      | `{ shipment_id: [...] }` — **array**; AWB must already be assigned. Response: `label_url` |
| Request pickup   | `POST /v1/external/courier/generate/pickup`     | `{ shipment_id }`                                                                         |
| Track by AWB     | `GET /v1/external/courier/track/awb/{awb_code}` | no body                                                                                   |
| Get order        | `GET /v1/external/orders/{order_id}`            | —                                                                                         |
| Pickup locations | `GET /v1/external/pickup`                       | —                                                                                         |

### The three response shapes this codebase has to survive

The provider's envelope is **not uniform**, and assuming one shape is how a
shipment ends up "created" with no waybill. `apps/api/src/services/shiprocket.service.ts`
therefore unwraps all three, and the corresponding tests in
`apps/api/tests/shipping.test.ts` pin each one.

| Endpoint                | Documented shape                                             | Where the payload actually sits       |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `auth/login`            | `{ success, data: { token } }`                                | Also seen at the **top level**         |
| `orders/create/adhoc`   | `{ order_id, shipment_id, status, ... }`                      | Sometimes under `data`                |
| `courier/assign/awb`    | `{ awb_assign_status, response: { data: { awb_code } } }`     | **Three levels deep**                  |
| `courier/generate/label`| `{ label_url, label_created, not_created }`                   | **Top level**, not under `data`       |

Two of these are worth calling out, because both fail *silently* if handled
naively:

- **The AWB endpoint returns HTTP 200 even when the assignment failed.** The
  failure is signalled by `awb_assign_status: 0` with an
  `awb_assign_error` string, not by the status code. Treating any 200 as a
  success left shipments with no waybill while telling the operator they
  had one. The adapter now checks `awb_assign_status` explicitly, and also
  rejects a 200 that carries no `awb_code`.
- **The label endpoint puts `label_url` at the top level**, not under
  `data`. The generic unwrapping handles all three shapes, so the label URL
  is found wherever the provider put it.

### Cancellation

`POST /v1/external/orders/cancel` with `{ order_id, cancel_reason }`.

### Tracking webhook

Configured in **Settings → API → Webhooks** in the dashboard.

- `POST` to the callback URL, `Content-Type: application/json`.
- Optional security token is sent as the **`x-api-key`** header.
- The endpoint must return **only** HTTP `200`.
- The callback URL must **not** contain** `shiprocket`, `kartrocket`, `sr`
  or `kr`** anywhere in the URL.

> **Re-verified 25 Oct 2026** against
> `https://apidocs.shiprocket.in/` (Webhooks section) and the official
> Postman workspace
> (`https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/documentation/qu05zax/shiprocket-api`),
> which carry the same text verbatim.
>
> This rule is load-bearing. The platform's original tracking path was
> `/webhooks/shiprocket`, which contains the forbidden substring `shiprocket`
> — so the provider would have **rejected the callback URL** and tracking
> updates would never have arrived, with no error anywhere in our own logs.
> The canonical path is now **`/webhooks/carrier/track`**, which contains
> none of the four forbidden substrings. The old path is kept only as a
> legacy alias for an environment that was already configured.
>
> The rule is pinned by a test
> (`apps/api/tests/shipping.test.ts` → *the canonical path contains none of
> the substrings Shiprocket forbids*), so a future refactor cannot quietly
> reintroduce a path the provider will not call.
- Sample payload fields: `awb`, `courier_name`, `current_status`,
  `current_status_id`, `shipment_status`, `shipment_status_id`,
  `current_timestamp`, `order_id`, `sr_order_id`, `awb_assigned_date`,
  `pickup_scheduled_date`, `etd`, and a `scans[]` array of
  `{ date, status, activity, location, sr-status, sr-status-label }`.

### Documented status codes

`200`/`202` ok · `400` bad request · `401` auth · `404` not found ·
`405` wrong method · `422` unprocessable · `429` rate limited ·
`5xx` server error.
