# FastSpring integration

FluxRadar sells one-time audits (Basic $55, Complete $120). Paid access is granted
by exactly one path: a **signed FastSpring webhook** processed on the server. The
browser can start a checkout and ask whether a payment was confirmed — it can
never assert that one happened.

This document lists the exact environment variables, the FastSpring app settings
they correspond to, and what still has to come from the FastSpring account owner.
Nothing here contains a real credential, product path or store name.

---

## 1. How the flow works

```
browser                    FluxRadar API                     FastSpring
   │  POST /billing/checkout-session   │
   │──────────────────────────────────>│
   │                                   │ 1. verify session + profile ownership
   │                                   │ 2. validate plan and crawl scope
   │                                   │ 3. INSERT CheckoutSession
   │                                   │    (accountId, siteProfileId, plan,
   │                                   │     scope, AI consent, productPath,
   │                                   │     liveMode, reference "frcs_…")
   │                                   │  POST /sessions (Basic auth)
   │                                   │─────────────────────────────────────>│
   │                                   │  { id, currency, subtotal, expires }
   │                                   │<─────────────────────────────────────│
   │  201 { reference, sessionId,      │ 4. store the provider quote
   │        checkoutUrl, mode }        │
   │<──────────────────────────────────│
   │  fastspring.builder.push({ checkout: sessionId })   (popup, in an iframe) │
   │─────────────────────────────────────────────────────────────────────────>│
   │                                   │  POST /webhooks/fastspring           │
   │                                   │  X-FS-Signature: base64(HMAC-SHA256) │
   │                                   │<─────────────────────────────────────│
   │                                   │ 5. verify raw-body HMAC
   │                                   │ 6. per event: dedup on event id,
   │                                   │    match mode, resolve reference,
   │                                   │    validate product/amount/currency
   │                                   │ 7. Purchase → Entitlement (30 d)
   │                                   │    → Scan (Pending) → Job
   │  GET /billing/checkout-session/:ref│
   │──────────────────────────────────>│
   │  { status, scanId }               │
   │<──────────────────────────────────│
```

### How the buyer checks out (`v2`, the popup)

The buyer pays in a FastSpring-hosted iframe rendered over the FluxRadar page. The
browser never opens a hosted checkout page of its own:

1. `GET /billing/checkout-config` returns `popup: { storefront }` — the public
   `data-storefront` of the popup checkout, validated at boot
   (`billing/fastspring/popup-storefront.ts`).
2. `apps/web/src/fastspring-sbl.ts` injects FastSpring's Store Builder Library
   (`https://sbl.onfastspring.com/sbl/<version>/fastspring-builder.min.js`, pinned)
   with that storefront and three `data-*` callbacks.
3. It then calls `fastspring.builder.push({ checkout: <sessionId> })`. This is the
   documented bridge from the server-side Sessions API to the checkout — "Pass a
   session ID from the `/sessions` API to skip building a new session entirely"
   (developer.fastspring.com — Session Objects) — so the cart, the product, the
   quantity and the order tag carrying our reference all stay server-issued and
   the browser cannot compose an order of its own.
4. `data-popup-closed` and `data-popup-webhook-received` only make the UI poll
   sooner. **Neither grants anything**: the scan still appears solely because the
   signed `order.completed` webhook created it.

No FastSpring credential exists in the browser. The API username, password and
webhook secret never leave the server; the storefront is the single FastSpring
value served to the browser, and it is public by nature — every site that sells
through FastSpring ships it in a script tag.

If the library cannot be loaded (an ad blocker, an extension, a CSP that was
never widened, a domain that is not whitelisted in the FastSpring app), the buyer
is **told** so and offered the hosted checkout page as a link they click
themselves. It is never opened for them: silently substituting a different
checkout surface for the one that failed hides the fault and moves the buyer to a
page they did not ask for.

`FASTSPRING_SESSION_API=v1` keeps the older behaviour — the provider-hosted
storefront opened in a new tab — because a v1 deployment has no popup checkout to
open.

**The checkout reference is the only thing that round-trips through FastSpring.**
Account id, site profile id, plan, crawl scope and AI consent live in our own
`CheckoutSession` row and are re-read from the database when the order arrives, so
a manipulated browser or a foreign order cannot bind a payment to another
account's profile.

### Security properties

| Property | Where it is enforced |
| --- | --- |
| Raw-body HMAC-SHA256, base64, timing-safe compare | `billing/fastspring/signature.ts` |
| One event id processed once (`@@unique([provider, providerEventId])`) | `billing/fastspring/webhook-handler.ts` |
| One order grants one purchase (`@@unique([provider, providerTransactionId])`) | `prisma/schema.prisma` |
| One checkout reference grants access once (compare-and-set on `status`) | `webhook-handler.ts` |
| Product path must match the session, and the order must be worth the plan's server-side USD price — the provider quote is never the price authority | `billing/fastspring/order-amount.ts` |
| A discounted order is measured on what is left after the discount, never on the pre-discount `subtotal` | `billing/fastspring/order-amount.ts` |
| A Sessions v2 response that is not `READY_FOR_CHECKOUT`, carries warnings, or dropped the product or the order tag yields no buyer URL | `billing/fastspring/client.ts` |
| A grant that fails after the checkout was claimed rolls the claim back — no session is ever `completed` without its purchase | `billing/fastspring/webhook-handler.ts` |
| The buyer-facing status carries a closed reason code, never the internal reason | `billing/checkout-status-reason.ts` |
| Live mode cannot be switched on before the store is confirmed | `FASTSPRING_STORE_VERIFIED`, `billing/fastspring/config.ts` |
| A full return suspends the entitlement, and partial returns suspend it once they add up to the charge | `billing/fastspring/refund-events.ts`, `billing/fastspring/refund-amounts.ts` |
| A refund stored while its order was being granted is still applied, and a pile of refunds for orders that never arrived cannot delay it | `billing/fastspring/pending-refund-reconciliation.ts` |
| A chargeback is never relabelled as a plain refund by a later return | `billing/fastspring/refund-events.ts` |
| A cross-currency return the payload states no usable rate for suspends rather than being under-counted | `billing/fastspring/refund-amounts.ts` |
| A test-mode order never grants access on a live deployment | `expectLive` check; an event with no `live` flag is resolved from the session it names, never assumed to be test mode |
| Redelivered, delayed and out-of-order events are safe | dedup + monotonic status writes |
| Credentials never appear in a response, an error or a log | `billing/fastspring/client.ts` |

### HTTP responses the webhook returns

| Situation | Status | Effect |
| --- | --- | --- |
| Bad or missing `X-FS-Signature` | 400 | nothing stored, FastSpring will retry |
| Body is not JSON / not an events envelope | 400 | nothing stored |
| Provider not configured | 503 | nothing stored |
| Valid batch | 200 | each event reported with its own outcome |
| Valid batch containing a refund/chargeback whose order has not arrived | 202 | stored, replayed when the order lands |

Per-event outcomes: `processed`, `deduplicated`, `ignored` (unsupported event type
or the other mode), `rejected` (actionable event whose payload failed validation),
`unlinked` (refund/chargeback whose order is unknown *yet*). Once the delivery
itself is readable, every per-event outcome answers 2xx on purpose — FastSpring
retries non-2xx, and no retry can fix a tampered amount or a foreign order. The
non-2xx answers in the table above are all failures of the delivery as a whole
(bad signature, unparsable body, provider not configured), which a redelivery
could genuinely find fixed.

**`unlinked` is not "dropped".** FastSpring guarantees no delivery order, so a
`return.created` or `chargeback.created` can legitimately arrive before the
`order.completed` that creates the purchase. Answering 2xx and forgetting it
would leave a refunded buyer with a readable report, and answering non-2xx would
only make FastSpring retry into the same missing order. Instead the event is
stored with outcome `unlinked`, the delivery answers **202**, and
`billing/fastspring/pending-refunds.ts` replays it from its own recorded payload
inside the transaction that later grants the purchase — so access is never live
between the grant and the suspension. Such an order.completed reports
`processed` with the replay in its reason and releases **no** scan to the queue:
the purchase is recorded, the entitlement is suspended, nothing runs. A pending
event whose order never arrives simply stays `unlinked` and visible.

**The grant is not the only moment that replays.** A return whose own transaction
started before the purchase existed and committed after the grant read the pending
rows is invisible to both sides — it finds no purchase to lock and stays
`unlinked`, the grant finds no row to replay — and the money is then back while
the report stays readable. So every `order.completed` replays, the granting one
and a later redelivery of the same order alike (the redelivery reports
`deduplicated` with the applied event in its reason and releases no scan), and
`billing/fastspring/pending-refund-reconciliation.ts` sweeps whatever neither
reached. Repeating a replay is safe — a return is counted once per purchase by its
own `ProviderRefund` line, the purchase and the entitlement only ever move
forward, and an applied row is no longer `unlinked`.

#### What the sweep actually does

Every five minutes (`PENDING_REFUND_SWEEP_INTERVAL_MS`) one pass runs. It is not
"apply every applicable pending row"; it is bounded, and the bound is worth
stating exactly:

* **Selection.** One SQL statement asks for the `unlinked` FastSpring webhook
  events, **oldest delivery first**, whose `providerTransactionId` already has a
  FastSpring `Purchase` — the match is an `EXISTS` subquery evaluated *before* the
  `LIMIT`, not a filter applied to a batch that was already taken. That ordering
  matters: a refund whose order never arrives (a foreign order, an order rejected
  on its amount) stays `unlinked` for the whole 30-day retention window, so those
  rows are the *oldest* pending rows there are. Taking the oldest N rows first and
  only then asking which have a purchase let them fill every pass — a
  head-of-line block that delayed a real refund until the orphans aged out. They
  now cost one index probe each and are skipped.
* **Bound.** `PENDING_REFUND_SWEEP_BATCH_LIMIT` (500) rows *the pass can act on*.
  Each distinct order in that batch is replayed in its own transaction, and a
  replay applies **all** of that order's pending rows, so one order with three
  stored returns is one transaction. What does not fit is taken by the next pass;
  `batchLimitReached` says the batch was filled — which is how a backlog shows up,
  though an exactly-full pass sets it too.
* **Access path.** Index
  `WebhookEvent(provider, outcome, processedAt)`, added by migration
  `20260906210000_pending_refund_sweep_index`. Without it the five-minute question
  is a sequential scan of every webhook delivery ever received — a table that
  grows with sales volume while the pending rows the sweep is looking for do not.
* **Failure.** One order that cannot be replayed (lock timeout, a purchase
  deleted mid-pass, a stored body this release cannot re-read) is counted and
  skipped; the row stays `unlinked` and the next pass tries again. The sweep
  itself never rejects — a background reconciliation must not take down the boot
  path or the timer.

**SLA.** A stranded refund is applied within **one sweep interval plus one pass**
— under six minutes — as long as fewer than 500 applicable rows are waiting.
Beyond that the backlog drains at 500 rows per five minutes; `matchedOrderCount`
and `batchLimitReached` in the log are what say whether that is happening. The
*fast* path is unaffected by any of this: FastSpring redelivers `order.completed`
far sooner than five minutes, and every redelivery replays the pending rows too.

**Observability.** Each pass logs `pending refund sweep completed` at `info` with:

| Field | Means |
| --- | --- |
| `pendingRowCount` | every pending refund/chargeback row there is, applicable or not — the backlog, including orphans |
| `matchedOrderCount` | distinct orders this pass replayed against |
| `appliedEventCount` | stored events that actually moved a purchase. **Non-zero means the delivery path missed a refund** — that is the line to alert on |
| `failedOrderCount` | orders whose replay threw; they stay pending |
| `batchLimitReached` | the pass filled its batch, so applicable rows may still be waiting for the next one |

A quiet pass logs the same line with zeroes, so "the sweep never ran" and "the
sweep found nothing" do not look the same afterwards. A failed pass logs
`pending refund sweep failed` at `error`.

**Limits, stated plainly.**

* A refund the sweep applies arrives **after** the scan was queued and announced,
  so the entitlement is suspended but the scan may already have run. That is the
  difference between the sweep and the grant-path replay, which suspends before
  anything is released.
* A high `pendingRowCount` with `matchedOrderCount: 0` is not the sweep falling
  behind — it is a pile of refunds for orders that were never granted. Those are
  purged by the unbound-event retention rule after 30 days (§7).
* The selection walks pending rows, not the whole table, but it does walk **all**
  of them for one provider when few of them match. That set is bounded by the
  30-day retention window and by how rare an out-of-order refund is; it is not
  bounded by sales volume.
* The sweep only ever moves a purchase forward. It cannot undo a suspension, and
  it is not a repair tool for a purchase an operator restored by hand.

---

## 2. Environment variables

All of them are read by the API only. Leave **every** `FASTSPRING_*` variable
empty to keep paid checkout switched off — the API still boots and the UI shows a
setup state. Setting **some** of them is a fatal configuration error: the API
refuses to start in production and the checkout endpoints answer `503`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `FASTSPRING_MODE` | yes | `test` or `live`. Decides which `live` flag an incoming event must carry. |
| `FASTSPRING_API_USERNAME` | yes | Basic-auth username from **Developer Tools → APIs → API Credentials**. |
| `FASTSPRING_API_PASSWORD` | yes | Basic-auth password from the same screen (shown once at creation). |
| `FASTSPRING_WEBHOOK_SECRET` | yes | The HMAC key set on the webhook in the FastSpring app. |
| `FASTSPRING_PRODUCT_PATH_BASIC` | yes | Product path of the one-time Basic audit product. |
| `FASTSPRING_PRODUCT_PATH_COMPLETE` | yes | Product path of the one-time Complete audit product. |
| `FASTSPRING_STORE_VERIFIED` | **yes for `live`** | Must be the literal `verified`. Nothing else unlocks live mode — see §3. |
| `FASTSPRING_CURRENCY_POLICY` | no (default `strict`) | `strict` = only the quoted currency is accepted; `localized` = FastSpring may charge the buyer in their own currency. See §4. |
| `FASTSPRING_SESSION_API` | no (default `v1`) | `v1` = `POST /sessions`; `v2` = `POST /v2/checkouts/{path}/sessions`. |
| `FASTSPRING_STOREFRONT_URL` | yes for `v1` | Storefront origin, e.g. `https://<store>.onfastspring.com`. Buyer URL becomes `<origin>/session/<id>`. |
| `FASTSPRING_CHECKOUT_PATH` | yes for `v2` | The FastSpring checkout path, `{storeId}/{checkoutId}` (e.g. `examplestore/popup-checkout`). The slash is a real URL path separator — `…/v2/checkouts/examplestore/popup-checkout/sessions` — so a leading, trailing or doubled slash is refused at boot. |
| `FASTSPRING_POPUP_STOREFRONT` | **yes for `v2`** | The popup checkout the browser opens, exactly as printed in **Checkouts → Popup Checkouts → Place on your Website** (the `data-storefront` value): `{store}.onfastspring.com/{checkout}`, no `https://`. It must match `FASTSPRING_MODE` — the `.test.` host for `test`, the plain host for `live` — and it is the one FastSpring value deliberately served to the browser, by `GET /billing/checkout-config`. See §5. |
| `FASTSPRING_API_BASE_URL` | no (default `https://api.fastspring.com`) | Override only for tests. |
| `FASTSPRING_SESSION_EXPIRATION_DAYS` | no (default `1`) | v1 only; 1–7 days of buyer-link validity. Sent as the Sessions v1 `expiration` field, which FastSpring documents on *Sessions v1 → Session expiration* ("Sessions are valid for 24 hours by default. To extend this window, pass an `expiration` value of up to 7 days.") although that page's OpenAPI schema omits it. Our own `CheckoutSession.expiresAt` never depends on FastSpring honouring it: the row is written with this deadline and only overwritten by the `expires` FastSpring reports back. |

Legacy, unrelated to FastSpring:

| Variable | Meaning |
| --- | --- |
| `PADDLE_WEBHOOK_SECRET` | MockPaddle development flow only. `/webhooks/paddle` is **not mounted** in production and `/billing/dev-checkout` refuses paid scans there. This release no longer requires it — but **keep it in the production env file** until the previous release is retired: that release still reads it at startup, so removing it would make an automatic rollback crash-loop. The deploy workflow's rollback probe fails the deploy if it is missing. |
| `FLUXRADAR_INTERNAL_FREE_EMAILS` | Exact comma-separated allowlist that may run Basic/Complete without paying. Those scans deliberately create **no** Purchase or Entitlement. |

---

## 3. Test vs live

**Live mode is gated.** `FASTSPRING_MODE=live` is rejected — the API refuses to
boot in production and the checkout endpoints answer `503` — unless
`FASTSPRING_STORE_VERIFIED=verified` is also set. That variable is an operator
statement that the two preconditions which live inside the FastSpring app, and
cannot be checked from this code, have actually been checked:

1. `order.completed` really carries the `fluxradarCheckoutRef` order tag or item
   attribute for this store (one test order settles it — read the stored
   `WebhookEvent.rawBody`);
2. the storefront's currency behaviour matches `FASTSPRING_CURRENCY_POLICY` (§4).

Until both are confirmed, live mode stays off. This is deliberate: every failure
mode it prevents costs a real buyer real money.

* `FASTSPRING_MODE=test` accepts only events with `live: false` and rejects live
  orders; `FASTSPRING_MODE=live` does the reverse. A mismatched event is stored
  and answered 2xx with outcome `ignored` — it never grants access.
* An event that carries **no** `live` flag at all is not assumed to be test-mode.
  Its mode comes from the `CheckoutSession` it names, which records the mode it
  was opened in. Collapsing an absent flag to `false` would make a live
  deployment silently ignore an order the buyer had already paid for.
* The `CheckoutSession` row records the mode it was opened in, so a session
  created before a mode switch cannot be completed by an order from the other
  mode.
* FastSpring test mode also uses a different storefront host (usually
  `https://<store>.test.onfastspring.com`), so `FASTSPRING_STOREFRONT_URL` and
  `FASTSPRING_POPUP_STOREFRONT` have to change together with `FASTSPRING_MODE`.
  For the popup storefront this is enforced rather than merely documented: the
  API refuses to boot on a mismatch, because a session created in one mode can
  never be paid on the other mode's storefront and the buyer would face a
  checkout that cannot complete.
* The UI shows "Payment provider is in test mode — no real charge is made."
  whenever `mode` is `test`.

---

## 4. What must be configured inside the FastSpring app

1. **Two one-time products**, one per paid plan, priced $55 and $120 USD.
   Note their *product paths* — those go into
   `FASTSPRING_PRODUCT_PATH_BASIC` / `FASTSPRING_PRODUCT_PATH_COMPLETE`.

   For both products, keep **coupons, discounts and promotions off**, and
   configure **no upsells, cross-sells or add-on products** on the checkout.
   FluxRadar sells one fixed-price scan per order and grants access against the
   §18 tariff, so a discounted order is refused unless what is left after the
   discount still covers the plan price (see *Amounts* below) — the buyer would
   be charged and get nothing. An upsell puts a second line item in the order,
   which makes the order's tax unattributable to our line and costs the same
   buyer the tax-inclusive part of the amount check. Neither is a code
   limitation that can be lifted from here: both are store settings, and the
   code fails closed around them rather than guessing.
2. **API credentials** — Developer Tools → APIs → API Credentials → Create.
   The password is displayed only once.
3. **A webhook** pointing at:

   ```text
   https://fluxradar.net/api/webhooks/fastspring
   ```

   with these events enabled:

   * `order.completed`  → grants the purchase, entitlement and scan
   * `return.created`   → marks the purchase refunded
   * `chargeback.created` → marks the purchase disputed and suspends the entitlement

   Set an HMAC secret on the webhook and put the same value in
   `FASTSPRING_WEBHOOK_SECRET`.
4. **Order tags must reach the webhook.** FluxRadar writes the checkout reference
   as the order tag `fluxradarCheckoutRef` *and* as an item attribute of the same
   name. At least one of the two must be present in `order.completed`, otherwise
   the order is rejected with `order carries no FluxRadar checkout reference`.
   Enabling **Webhook Expansion** is supported but not required.
5. **Storefront / checkout surface.** For `FASTSPRING_SESSION_API=v1` a classic
   web storefront must exist so `<storefront>/session/<id>` resolves. For `v2` a
   **popup checkout** must exist (Checkouts → Popup Checkouts), because v2 is the
   popup flow — see §5 below.
6. **Whitelist the FluxRadar origins on the popup checkout** (`v2` only). Click the
   **No whitelisted websites** badge on the popup checkout and add every origin the
   checkout is opened from, `https://fluxradar.net` included. FastSpring allows up
   to 20 minutes for the change to apply, and until it does the popup simply
   refuses to load on our page. Nothing in this repository can detect it: the
   buyer sees "the FastSpring checkout could not be loaded" and FastSpring's own
   refusal appears in the browser console.
7. **At least one product on the popup checkout.** FastSpring requires it for the
   checkout to load at all, even though every session we open names its own
   product path — add the Basic and Complete products under **Products**.

### Currency — read this before going live

FastSpring is the merchant of record and localises prices. On a classic
storefront the buyer can change their country, and therefore the currency, on the
checkout page — long after the session was created server-side. Which of the two
policies below is correct is a property of **your store**, and getting it wrong
costs a buyer real money, which is why `FASTSPRING_STORE_VERIFIED` exists.

`FASTSPRING_CURRENCY_POLICY=strict` (default)

: The order's currency must equal the quote FastSpring returned when the session
  was created (`quotedCurrency`, falling back to USD when the API returned no
  quote), and the amount must be consistent with that quote on the order's own
  tax basis (see *Tax* below). Anything else is **rejected**: no scan, the
  `CheckoutSession` is marked `rejected`, the buyer is told the payment could not
  be matched, and the charge has to be refunded by hand. Use this only when the
  storefront genuinely cannot charge another currency (single-currency
  storefront, or country/currency selection disabled).

`FASTSPRING_CURRENCY_POLICY=localized`

: A different currency is accepted. The order is still bound to our own
  `CheckoutSession`, to one catalogue product path and to a single-use reference,
  so the price is never attacker-controlled — the buyer cannot change what
  FastSpring charges for our product. The amount is then checked as far as it can
  be:

  * when FastSpring reports a USD payout (`payoutCurrency` = `USD` plus
    `totalInPayoutCurrency` for the charged figure and `subtotalInPayoutCurrency`
    for the one before tax), the charged figure is compared with the plan's USD
    price and an order worth less than 60% of it is rejected —
    a band wide enough for FX and rounding, narrow enough to catch a mispriced
    catalogue entry;
  * when no USD figure is reported, the scan is granted and the event records
    `amount not verified against the … plan price` in `WebhookEvent.outcomeReason`
    and in `CheckoutSession.statusReason`, for reconciliation.

  `Purchase.amountUsd` always holds the USD figure the refund policy works in, and
  `Purchase.settledAmount` / `settledCurrency` hold what the buyer was charged.

### Amounts — the four figures the order actually states

`order.completed` describes the money on four documented fields, per order and
per item (developer.fastspring.com — *Successful Orders*):

| Field | Documented as |
| --- | --- |
| `subtotal` | "Subtotal before discounts and tax" |
| `discount` | "Total discount applied" |
| `tax` | "Tax amount" |
| `total` | "Total order amount" |

so `total = subtotal - discount + tax`, and the two figures that describe the
payment are **`netPaid = subtotal - discount`** (paid, tax excluded) and
**`charged = total`** (paid, tax included). `billing/fastspring/order-amount.ts`
states which of the two every comparison uses.

**`subtotal` is not what anyone paid.** It is stated *before discounts*, so a
50%-off coupon leaves it at $55 while the card is charged $27.50. Treating it as
the payment — or reconstructing the charge as `max(subtotal, total)` — sells a
$55 plan for $27.50 *and* records a $55 purchase, so the buyer's later full
refund of $27.50 is measured as 50% of the purchase, reads as partial, and never
suspends the entitlement. The deduction is therefore read, not assumed away:

* from `discount`, order-level and item-level, whichever is larger;
* and, for a store that fills neither, from the order's own arithmetic —
  whatever `subtotal + tax - total` shows that the tax does not explain. A
  payload with no `tax` field can only understate that difference, so a missing
  field never invents a discount that is not there.

**Tax is a store-level setting no webhook field states**, and both modes have to
keep working:

| Store pricing mode | Buyer pays | `order.completed` reports |
| --- | --- | --- |
| Gross (tax-inclusive) | the catalogue price, VAT already inside | `total` = 55.00, `tax` = 5.30, `subtotal` = 49.70 |
| Net (tax-exclusive) | the catalogue price **plus** tax | `subtotal` = 55.00, `tax` = 5.50, `total` = 60.50 |

Comparing a tax-free session quote with a gross-mode `subtotal` would refuse an
order the buyer paid in full — the buyer is charged and gets nothing. So:

* **quote vs order** — the quote must lie inside the order's own
  `[netPaid, list + tax]` band. For an undiscounted, untaxed order the band is a
  single point, so this is the exact match it has always been; a second unit or a
  charge for a different product still falls outside it in either pricing mode.
  A discount widens the band downwards, because the quote *is* the list price the
  discount came off — whether the remainder is still worth the plan is decided
  against the tariff, below, not against the catalogue.
* **order vs plan price** — an order that covers the tariff **before tax** is
  worth the plan in either mode. An order that only reaches the tariff once tax
  is counted is worth the plan **only if nothing was discounted off it**: in a
  net-priced store the tax is added *after* the deduction, so a large enough VAT
  would otherwise lift a heavily discounted order back over the tariff while the
  seller was paid far less. Below the floor (to the cent in USD, or below 60%
  after conversion) the order is rejected.
* **a discounted order that cannot be expressed in USD is rejected**, not granted
  as "unverified". Granting is what "unverified" means, and a discounted order
  nobody can measure is exactly where a real shortfall hides.
* **catalogue mismatch** — measured on `netPaid`, so a net-priced store is not
  reported as "priced above the tariff" on every single order.

`Purchase.amountUsd` holds what the buyer was charged, in USD;
`Purchase.settledAmount` / `settledCurrency` hold the same figure in the buyer's
currency when that is not USD. Sessions v2 quotes are stored from the cart's
`withoutTaxNetTotal` when FastSpring reports one, because plain `netTotal`
"includes or excludes taxes based on the value of `taxIncluded`".

This is the code's guarantee, not a substitute for the store settings in §4:
coupons, discounts and promotions should be **off** for these two products. The
check exists because a setting can be changed in the FastSpring console after
this repository was reviewed.

### Returns — the charge comes back in instalments

`return.created` states only its own amount, and FastSpring can return one order
in several of them. Deciding on the event in hand therefore never suspends
anything: two $27.50 returns against a $55 order are 50% of the charge each,
neither reaches the full-refund ratio, and the buyer keeps a report whose money is
entirely back. So the decision is taken on **everything returned so far**:

* every return is stored as its own `ProviderRefund` line, keyed on the FastSpring
  **return id** — `@@unique([purchaseId, providerRefundId])`, inserted with
  `ON CONFLICT DO NOTHING`, so the same return redelivered under a new webhook
  event id adds nothing and never overwrites what the first delivery recorded;
* the lines are summed on the purchase's **charged basis** —
  `settledAmount` when FastSpring localised the currency, `amountUsd` otherwise —
  and the entitlement is suspended once the sum covers 99% of it;
* `RefundRecord` stays the §18 aggregate (one per purchase) and now states the
  cumulative figure rather than the last instalment.

A return the payload does not let us measure is counted as the **whole charge**,
and the line records why: a return with no amount at all, a return quoted in a
currency the purchase was not charged in with no USD figure to convert it, or a
purchase with no usable charged amount. Over-counting suspends a report an
operator can restore; under-counting leaves a buyer reading a report that was paid
for with money already returned. A return that carries no return id of its own is
keyed on the delivery instead — the one case a redelivery can double-count, which
errs the same way and says so in `ProviderRefund.reason`.

**The only exchange rate is the store's, and it only exists in USD.** Nothing in
this repository fetches FX rates, deliberately: a rate read at refund time is not
the rate the charge settled at, and a wrong one silently moves the suspend
decision. The one rate the payload states is FastSpring's own USD payout figure
for the order against the same order's charged figure — and FastSpring states it
only when the store is **paid out in USD**
(`CONVERTIBLE_PAYOUT_CURRENCY` in `billing/fastspring/refund-amounts.ts`). So:

| The return is quoted in | And the store is paid out in | Result |
| --- | --- | --- |
| the charged currency | anything | measured directly |
| no currency at all | anything | read as the charged currency, and the line says so |
| another currency | USD, with `totalReturnInPayoutCurrency` | converted through the order's own USD figure |
| another currency | anything else | **counted as the whole charge** |

The last row is a supported-store policy, not a gap to be closed by guessing:
`totalReturnInPayoutCurrency` is stated *in the payout currency*, so a store
settling in EUR reports a EUR figure that reading it as USD would misprice by a
double-digit percentage. A non-USD-payout store therefore has to expect
cross-currency returns to suspend the whole entitlement — which is why the store's
payout currency is one of the things `FASTSPRING_STORE_VERIFIED` asserts (§5
item 11).

**The full-refund threshold is a policy constant, not a tuning knob.**
`FULL_REFUND_RATIO` is 0.99 and is not read from the environment. It is not 1.0
because FastSpring rounds the localised charge and the localised refund
independently and this arithmetic rounds the sum to cents, so an exact equality
test would leave a genuinely full refund a cent short and hand the buyer a
readable report. One percent of the smallest plan is 55c — above any rounding this
can produce, below any partial refund a seller would issue. Widening it would
start suspending real partial refunds; narrowing it would start missing full ones,
which is the direction that costs money.

**A chargeback outranks a return.** `Purchase.status` moves `paid -> Refunded` and
`paid -> Disputed` by compare-and-set from `paid` only, so whichever end state is
written first stays. A return that FastSpring reports once a dispute is already
recorded — a seller refunding to settle it is the ordinary case — must not
relabel the purchase `Refunded` and erase the chargeback, which carries a fee and
counts against the merchant account. Nothing about the money is lost by that: the
return still writes its `ProviderRefund` line, still updates the `RefundRecord`
aggregate, still suspends the entitlement, and its own `WebhookEvent` row records
the delivery — the outcome reason says in as many words that the purchase stays
`Disputed`. Only the one label an operator reads first keeps naming the stronger
fact.

### A Sessions v2 201 is not yet a usable checkout

The v2 Sessions API answers **201** for a session it could not fill, for inputs it
decided to ignore, and for a checkout that is already concluded — and says so in
the body rather than in the HTTP status
(developer.fastspring.com — *Sessions → Create session*):

| Field | What it can say |
| --- | --- |
| `status` | `OPEN` · `EXPIRED` · `CANCELLED` · `PENDING_ORDER` · `COMPLETED` · `FAILED` |
| `checkoutStatus` | `READY_FOR_CHECKOUT` · `PRODUCTS_REQUIRED` · `CONCLUDED` (a list) |
| `warnings[]` | "non-fatal errors or ignored input values": `INVALID_PROMO_CODE`, `INVALID_COUNTRY`, `CHECKOUT_NOT_LIVE`, `INVALID_TAX_ID`, `INVALID_BUYER_IP`, `INVALID_LOCALE`, `INVALID_POSTAL_CODE` |
| `cart.lineItems[].productPath`, `orderTags` | what FastSpring actually kept of the request |

`billing/fastspring/client.ts` refuses to return a checkout URL when the session
is not in `OPEN`, when `checkoutStatus` says anything other than
`READY_FOR_CHECKOUT`, when any warning is attached, when the cart does not hold
the product path we asked for, or when the `fluxradarCheckoutRef` order tag did
not come back unchanged. Each check applies only to a field FastSpring actually
stated, so a response that says nothing about itself is still taken at the value
of the URL it returned.

The last two are the expensive ones. Everything this client sends is
server-issued and required, so an "ignored input value" is never cosmetic —
`CHECKOUT_NOT_LIVE` means the buyer would pay in the wrong mode — and a session
that dropped the order tag would take the buyer's money and produce an order this
API cannot link to an account, a profile or a plan. The buyer gets the generic
"paid checkout is temporarily unavailable"; which check failed goes to the log,
and the `CheckoutSession` row is closed as `rejected` /
`provider_unavailable` exactly like any other provider failure.

### The price is ours, not the catalogue's

The quote FastSpring returns for a session (`quotedAmount` / `quotedCurrency`) is
the **catalogue** price. It is recorded and used to bind the order to the checkout
we opened, but it is never allowed to decide what a plan costs: a product entry
mispriced at $5 — by mistake or by someone with access to the store — produces a
$5 quote, a $5 charge and a quote-versus-charge comparison that matches perfectly.
`billing/fastspring/order-amount.ts` therefore measures every order against
`planPriceUsd(plan)` (§18 tariff matrix, `packages/contracts`), taking the lower of
the current tariff and the price the session was opened at so a price rise between
checkout and payment cannot refuse a buyer who paid what they were quoted.

The policy is deliberately asymmetric, because the two failure directions are not
comparable — an underpaid order that is honoured hands out a paid plan for
nothing, while an order refused after the card was charged leaves a real charge
with nothing to show for it:

| The order is worth | Outcome |
| --- | --- |
| less than the plan price (to the cent in USD, or below 60% of it after conversion) | **rejected**, in both currency policies |
| the plan price | granted |
| more than the plan price | granted, and the mismatch is recorded on the event and the session — the catalogue disagrees with the tariff and an operator has to see it |
| a figure no part of the payload expresses in USD | granted, and recorded as not verified against the plan price — **unless the order was discounted**, which is rejected |
| the plan price only after a discount was deducted from a higher list price | granted, and the discount is recorded on the event and the session |
| less than the plan price after a discount, whatever the tax then adds back | **rejected** |

In both policies the product path must match, the reference must be ours and
unused, and the mode must match. Every rejection reason is in
`WebhookEvent.outcomeReason` and in the stored `rawBody`.

### What the buyer sees

`GET /billing/checkout-session/:ref` answers with a `reasonCode`, never with
`CheckoutSession.statusReason`. The stored reason is written for us — it quotes
order amounts, product paths and the validation vocabulary of the webhook handler
— and putting it in a browser response describes the checks to anyone holding a
reference while telling the buyer nothing they can act on. The codes are
`checkout_expired`, `provider_unavailable` and `payment_not_verified`
(`billing/checkout-status-reason.ts`); the UI turns each into a localised sentence,
and an unknown code shows only the generic rejection copy. The raw reason stays in
the database, on the session and on the `WebhookEvent`, for support.

---

## 5. Values still needed from the FastSpring account owner

Nothing below is guessed anywhere in the code or in `.env.example`:

1. Store id / storefront origin — the exact `https://<store>.onfastspring.com`
   (and its test-mode host) for `FASTSPRING_STOREFRONT_URL`, **or**, for the v2
   Sessions API, both the checkout path for `FASTSPRING_CHECKOUT_PATH` and the
   popup `data-storefront` for `FASTSPRING_POPUP_STOREFRONT` (Checkouts → Popup
   Checkouts → Place on your Website), in the mode being deployed.
1b. Confirmation that the FluxRadar origins are **whitelisted** on that popup
   checkout (§4 item 6). Until they are, the popup does not load at all, and no
   code here can tell that apart from a blocked script.
2. The two product paths created for Basic and Complete.
3. API credential username and password.
4. The webhook HMAC secret.
5. Confirmation of which mode to run first (`test` is strongly recommended until
   an end-to-end test order has produced a scan).
6. Confirmation that order tags are returned on `order.completed` for this store
   (a single test order settles it — check the stored `WebhookEvent.rawBody`).
7. Confirmation of the store's currency configuration — see the currency note in
   §4 — and therefore which `FASTSPRING_CURRENCY_POLICY` to use.
8. Confirmation that **coupons, discounts and promotions are off** for the two
   products, and that the checkout has **no upsells or cross-sells** (§4 item 1).
9. Confirmation of the product **tax category** on both products, so FastSpring
   taxes a digital service rather than falling back to a default that does not
   apply. Nothing in this repository can read it; it only shows up as the `tax`
   figure on real orders.
10. A **sandbox smoke test** in `FASTSPRING_MODE=test`: open a checkout from the
    app, pay the test order, and confirm the webhook produced a `Purchase`, an
    `Entitlement` and a `Scan` — then issue a full return from the FastSpring
    console and confirm the entitlement is suspended.
11. Confirmation of the store's **payout currency**. If it is not USD, a return
    quoted in a currency the buyer was not charged in cannot be converted at all
    and is counted as the whole charge — the entitlement is suspended on a partial
    refund. See the returns note in §4. Nothing in this repository can read the
    payout currency; it only appears as `payoutCurrency` on real orders.

**Items 6, 7 and 11 are the live-mode gate.** They cannot be verified from this
repository, so `FASTSPRING_MODE=live` fails closed until whoever checked them sets
`FASTSPRING_STORE_VERIFIED=verified`. Nothing in the code can be substituted for
that check, and this integration is therefore **not** finished until the account
owner has performed it.

---

## 6. Local verification without a FastSpring account

The whole surface is covered by self-contained tests — no credentials, no
network, no real payment:

```sh
cd apps/api
NODE_ENV=test npx vitest run src/billing/fastspring
```

* `fastspring-001-signature` — base64 HMAC, timing-safe compare, tampered body
* `fastspring-002-config` — not configured / partial / invalid mode, no secret leaks
* `fastspring-003-webhook` — multi-event delivery, duplicate event, `order.completed`,
  `return.created`, `chargeback.created`, invalid metadata/product/amount/currency,
  mode mismatch, reference reuse
* `fastspring-004-checkout-http` — auth, foreign profile, scope limit, missing
  config, provider error, and the end-to-end "no scan until the webhook lands"
* `fastspring-005-events` — webhook expansion, envelope parsing, v2 Sessions API
* `fastspring-006-currency-and-modes` — localised currency granted and recorded,
  unverifiable amount flagged, under-priced order refused (including one that
  matches a mispriced catalogue quote exactly), over-priced order granted and
  recorded, strict policy, an event with no `live` flag, full vs partial return,
  refund currency conversion
* `fastspring-008-claim-atomicity` — a grant that fails after the claim leaves no
  `completed` session behind, the rejected delivery is still recorded and
  deduplicated, and the buyer-facing status answers with a reason code
* `fastspring-009-tax-modes` — gross- and net-priced stores, a localised
  tax-inclusive order, and a catalogue price above the tariff
* `fastspring-012-discounted-orders` — a half-price coupon, a 100% coupon, a
  discount that tax alone would hide, a discount that still covers the tariff, a
  discounted order with no USD figure, tax-only and full returns, and every place
  the payload can state the deduction (order, item, neither)
* `fastspring-014-cumulative-partial-refunds` — two partial returns that add up to
  the charge, the same return redelivered under a new event id, a tax-only return
  plus a partial one that leaves access in place, a single full return, a
  chargeback after a partial return, a full return **after** a chargeback and
  partial returns that complete after one (both leave the purchase `Disputed`,
  access suspended and the money fully recorded), a return added to a backfilled
  legacy refund line, two partial returns delivered before their order, and a
  return that states no return id
* `fastspring-015-pending-refund-reconciliation` — a refund the grant transaction
  could not see (return and chargeback), applied once however often the sweep
  runs, a swept partial return that leaves access in place, a pending refund whose
  order still has no purchase, a same-id purchase belonging to another provider, a
  stored payload that cannot be replayed, healing by redelivery of the order, the
  batch limit, and an applicable refund sitting behind a pile of older orphaned
  ones (the head-of-line case)
* `fastspring-016-return-payload-fail-closed` — a return that states no amount, one
  that states no currency (partial and full), one in a currency that cannot be
  converted, the convertible counterpart, a payout figure in a currency that is
  not the one convertible, the full-refund ratio boundary, and an unusable charged
  basis
* `fastspring-013-session-fail-closed` — `READY_FOR_CHECKOUT` accepted;
  `PRODUCTS_REQUIRED`, `CONCLUDED`, a non-`OPEN` lifecycle state, a warning, a
  cart without our product, a dropped or altered order tag and a missing URL all
  refused before a buyer link exists
* `billing-007-migration-rollback-safety` — no migration the previous release
  could not survive, and the legacy/provider id columns stay in sync both ways

Frontend: `cd apps/web && npx vitest run src/Checkout.test.tsx`.

---

## 7. Data model

`Purchase`, `WebhookEvent` and `RefundRecord` used to store MockPaddle-only ids in
`paddle*` columns. Migration `20260906180000_fastspring_provider_neutral_billing`
is the **expand phase** of an expand/contract change: it *adds* provider-neutral
columns beside the legacy ones, backfills them, and adds a `provider`
discriminator defaulted to `'paddle'`. Nothing is renamed or dropped.

| Legacy column (kept) | Added beside it |
| --- | --- |
| `Purchase.paddleTransactionId` (unique) | `Purchase.provider` + `providerTransactionId`, unique **together**, plus `settledAmount` / `settledCurrency` |
| `WebhookEvent.paddleEventId` (unique) | `WebhookEvent.provider` + `providerEventId`, unique **together** |
| `WebhookEvent.paddleTransactionId` | `WebhookEvent.providerTransactionId` |
| `RefundRecord.paddle{TransactionId,EventId,Signature}` | `RefundRecord.provider` + `provider{TransactionId,EventId,Signature}` |

Because uniqueness is on the *pair*, a FastSpring id can never be mistaken for a
legacy MockPaddle id. `WebhookEvent` also gained `outcome` / `outcomeReason` so a
rejected or ignored delivery is auditable.

Each of the three tables carries a `BEFORE INSERT OR UPDATE` trigger that mirrors
the legacy and provider-neutral id columns into each other. Migration
`20260906190000_fastspring_trigger_update_sync` replaces the three trigger bodies
so an UPDATE mirrors as well: the original functions filled each pair with
`COALESCE`, which is right on INSERT and a no-op on UPDATE, where both columns
already hold a value — a write to one side then left the other reading the old id.
The rule now is "whichever side the statement changed wins, and the
provider-neutral column wins a tie". That is what makes the
rollout reversible: a row written by the new release is fully readable by the
previous one, and a row written by the previous release is fully readable by the
new one. Application code never touches the `paddle*` columns.

The new `CheckoutSession` table holds the server-side binding described in §1. Its
`accountId` and `siteProfileId` foreign keys are `ON DELETE CASCADE`, not Prisma's
`RESTRICT` default: the previous release does not know this table, so after a
rollback its account deletion would delete `SiteProfile`/`Account` with sessions
still pointing at them and fail on the foreign key, leaving an account that asked
to be erased undeletable. The current release still deletes the sessions
explicitly. `purchaseId` is `ON DELETE SET NULL`, so removing a purchase never
takes the paid record's history with it. Because the profile cascade would
otherwise drop a binding the webhook still needs, `DELETE /profiles/:id` refuses
with `PROFILE_HAS_OPEN_CHECKOUT` while an **open** session exists — see the
lifecycle below for what keeps a session open.

The new `ProviderRefund` table (migration
`20260906200000_cumulative_provider_refunds`) holds one row per refund the
provider reported against a purchase, so several partial returns add up instead of
overwriting each other — see *Returns* in §4 for the rule it implements. It is
additive: the previous release does not know it, its `purchaseId` foreign key is
therefore `ON DELETE CASCADE` for the same reason `CheckoutSession`'s is, and the
migration backfills a line from every FastSpring `RefundRecord` already marked
`paid` so a return delivered after the deploy adds to what came back before it.
A `ProviderRefund` line is buyer data — it names what was returned to a named
buyer — so `DELETE /account` removes the lines explicitly, before the purchase
they hang off; the cascade is the rollback safety net, not the mechanism.

> **Operational note — legacy refund history cannot be reconstructed.** The
> backfill writes **one** line per FastSpring `RefundRecord`, because that is all
> the old data holds: `RefundRecord` is a single row per purchase and the
> pre-cumulative handler *overwrote* it on every return. A purchase that was
> refunded in instalments before this deploy therefore kept only the **last**
> instalment, and the backfilled line restores that figure — not the sum. No query
> over the remaining data can tell an overwritten history from a single refund, so
> the missing lines are deliberately **not** invented: doing so would be inventing
> money movements. The exposure is bounded and specific:
>
> * it can only affect purchases that were **already partially refunded before the
>   deploy** — a purchase with no refund, or one refunded once, is exact;
> * such a purchase can read as partially refunded when more (or all) of the
>   charge is actually back, so its entitlement may not be suspended;
> * a return delivered *after* the deploy still adds to whatever was backfilled,
>   so the situation only ever improves.
>
> The reconciliation is manual and one-off: list `RefundRecord` rows with
> `provider = 'fastspring'` and `status = 'paid'` that existed before the deploy,
> compare each against the order's refunds in the FastSpring console, and suspend
> by hand the entitlements whose charge is fully back. `ProviderRefund.reason` on
> a backfilled line names the migration, so those lines stay identifiable
> afterwards. This is recorded in `schema.prisma` on the `ProviderRefund` model
> and asserted, in the part that *is* knowable, by
> `fastspring-014-cumulative-partial-refunds`.

Migration `20260906210000_pending_refund_sweep_index` adds the composite index
`WebhookEvent(provider, outcome, processedAt)` the pending-refund sweep runs on
(§1). It is additive and creates nothing the previous release reads.

### Checkout session lifecycle

The row is written **before** FastSpring is called, so a closed tab, a provider
timeout or a 5xx all leave a `created` session behind. Three rules keep such a
row from becoming a permanent blocker, without ever putting a paid entitlement at
risk:

- **Every session carries a deadline.** `expiresAt` is set at creation from
  `FASTSPRING_SESSION_EXPIRATION_DAYS` and overwritten with FastSpring's own
  session expiry when the provider reports one. A row that somehow carries none
  (created before this rule, or a process that died mid-request) falls back to
  `CHECKOUT_SESSION_FALLBACK_TTL_DAYS` (7) after `createdAt`.
- **Only a session that can still be paid blocks anything.** `DELETE
  /profiles/:id` counts sessions matching `openCheckoutSessionWhere` — `created`
  **and** before the deadline. An abandoned checkout therefore stops blocking the
  profile on its own.
- **A provider failure closes the session immediately.** If the Sessions API call
  throws, no checkout was ever opened, so the row is marked `rejected` with
  `checkout could not be opened with the payment provider` before the error is
  returned to the buyer. A provider outage cannot accumulate open checkouts.

`expireAbandonedCheckoutSessions`, part of the hourly retention sweep, then
relabels sessions still `created` `CHECKOUT_ABANDON_GRACE_DAYS` (7) past their
deadline as `rejected` / `checkout expired before a payment arrived`. That is a
relabel, never a delete, and the webhook's compare-and-set
(`claimableCheckoutSessionWhere`) still accepts a session closed that way as long
as it produced no purchase — so an order that lands late still grants exactly one
scan, and housekeeping can never swallow a real charge. Sessions that already
have a `purchaseId` are never touched.

### Retention of webhook payloads

A stored `WebhookEvent` keeps the raw delivery body, which carries buyer details
(name, email, billing address) that FastSpring includes in the payload. Two rules
apply:

- **Bound events** — those carrying an `accountId`, those with outcome
  `processed`, and those whose `providerTransactionId` names a `Purchase` that
  still exists — are part of the billing audit trail and the refund path. They are
  kept and removed with their account by `DELETE /account` (`deleteAccountData`).
- **Unbound events** — `rejected`, `ignored`, `unlinked` or `deduplicated`
  deliveries that no account deletion can reach — are purged by age instead:
  `purgeUnboundWebhookEvents` deletes them **30 days**
  (`UNBOUND_WEBHOOK_EVENT_RETENTION_DAYS`) after `processedAt`, as part of the
  hourly retention sweep. FastSpring stops redelivering a webhook long before that,
  so the row is no longer needed for idempotency; and a payload re-sent afterwards
  would simply be rejected again to the same effect.

The purge criterion is deliberately the exact complement of `deleteAccountData`,
**not** "has no order id". A rejected, ignored or unlinked delivery routinely
records the order id it quoted (a foreign order, a refund that arrived before its
purchase, an order whose amount failed validation); that id matches no purchase of
ours, so no account deletion will ever reach the row. Requiring
`providerTransactionId = NULL` kept exactly those buyer payloads forever.

> **Deploy note.** Every migration in this release is additive and backward
> compatible, so an automatic rollback to the previous release is safe — the
> deploy workflow proves it by booting the previous image against the migrated
> schema before switching traffic. The **contract phase** (dropping the `paddle*` columns, their indexes
> and the triggers) must ship as a separate migration in a later release, once no
> container of the previous release can be started again. See
> `docs/DEPLOYMENT.md`.
