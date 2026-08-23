# POS ↔ Backend: open questions

Everything the Windows POS client needs from the Laravel backend in order to
finish three in-flight fixes. Grouped so it can be answered in one pass.

**Blockers** (POS is shipping a placeholder until answered): §1, §2
**Needed for the next feature:** §3 (Arabic)
**Confirmations only:** §4–§6

---

## 1. Order status codes — BLOCKER

The API sends `status` as a **number** (we have observed `1`, `2`, `4`). The POS
uses strings internally (`open`, `placed`, `prepared`, `closed`, `cancelled`).
We currently render unknown codes literally as `status 2`, because guessing
would show a cashier a confidently wrong state.

1.1 Full list of order status codes and meanings. Please include every value,
not just the common ones:

| code | name | meaning | terminal? |
|------|------|---------|-----------|
| 1 | ? | ? | ? |
| 2 | ? | ? | ? |
| 4 | ? | ? | ? |
| … | | | |

1.2 Which codes are **terminal** (order is finished, must not be edited)?

1.3 Is `status` ever returned as a **string** instead of a number, on any
endpoint? If the two differ per endpoint, say which is which.

1.4 The POS lifecycle is now: `open` → `placed` (paid, still on the till) →
`closed` (cleared). **Which status code should the POS send when pushing a
`placed` order, and which for a `closed` order?**

1.5 Is there a separate `status_code` vs `status` distinction on your side, or
is `status` the only field?

---

## 2. Order identity & duplicate prevention — BLOCKER

**The bug we hit:** the POS created order `POS-8ZH5Q7ZS` (local id
`1f9325ad-…`, a UUID) and pushed it. The order came back in the recent-orders
feed under the **server** id `69`. Nothing linked the two, so the POS inserted a
second row and ended up showing the same order twice.

2.1 When the POS pushes an order, **does the response return the server-assigned
id**? If so, what is the exact field path?

2.2 Is there a field on the order where the POS can store its **own local id**
(a client reference / idempotency key), which the server stores and echoes back
on every subsequent read? If not — can one be added? This is the clean fix.
Suggested: `pos_order_id` (string, unique per branch).

2.3 Does the recent-orders feed **include orders this device pushed**? Is there
a way to exclude them (e.g. filter by `device_id`)?

2.4 Is `number` unique **globally**, or only **per branch**? The POS currently
has a UNIQUE index on `number` — if two branches can generate the same number,
that index is wrong and we need to change it.

2.5 Is pushing the same order twice **idempotent** on your side, or does it
create a duplicate? (e.g. if the POS retries after a network timeout that
actually succeeded)

---

## 3. Arabic / localisation

The POS must display Arabic across every screen — catalog, order lines,
receipts. We need to know exactly what the backend provides.

3.1 **Which entities carry Arabic fields, and what is the exact field name?**
Please confirm or correct:

| entity | English field | Arabic field | always present? |
|---|---|---|---|
| categories | `name` | `name_ar` | ? |
| subcategories | `name` | `name_ar` | ? |
| items | `name` | `name_ar` | ? |
| variations | `name` | `name_ar` | ? |
| addon groups | `name` | `name_ar` | ? |
| addons | `name` | `name_ar` | ? |
| payment methods | ? | ? | ? |
| states / cities / blocks | `name` | `name_ar` | ? |
| promos | ? | ? | ? |
| order types | ? | ? | ? |
| **order statuses** | ? | ? | ? |

3.2 Are Arabic fields ever **null or empty string**? What should the POS fall
back to — the English name, or hide the field?

3.3 Is there a **language parameter** (e.g. `?lang=ar`) that returns localised
values in the primary field, or does the API always return both columns? We
prefer **both columns always**, so the POS can switch language offline.

3.4 Do you have Arabic labels for things the POS generates itself — order type
(Delivery / Pickup / Dine-in), order status, payment method names? If not, the
POS will ship its own translations; confirm that is acceptable.

3.5 **Receipts:** are there any server-side receipt templates, or does the POS
own the full layout? If the POS owns it, confirm the expected Arabic receipt
rules — RTL line order, whether item names print Arabic-only or bilingual, and
number formatting (Arabic-Indic ٠١٢٣ vs Latin 0123).

3.6 Currency: confirm the code (KWD), the number of decimal places the POS
should display and round to (we currently use **3**), and whether the server
ever sends prices as strings.

---

## 4. Timestamps

We are receiving order timestamps that parse to `1970-01-01`, i.e. the format
is not what the POS expects.

4.1 What is the exact format of `created_at` / `updated_at` in the orders feed —
ISO 8601 string, Unix seconds, or Unix milliseconds?

4.2 What **timezone** are they in — UTC or Asia/Kuwait? Are they consistent
across every endpoint?

4.3 Same questions for `updated_at` on catalog entities, since the POS uses it
as the sync cursor.

---

## 5. Catalog: variations & add-ons

The POS just shipped variation support. Confirming the contract:

5.1 `variations`: what is the difference between `price` and `sale_price`? The
POS currently charges `sale_price` when it is greater than 0, otherwise `price`,
otherwise the parent item's price. **Is that correct?**

5.2 Can a variation have **both** `price` and `sale_price` null? If so, what
should be charged?

5.3 Are `items.has_variations` / `items.has_addons` authoritative? The POS
currently ignores them and derives the flags from whether variation/addon rows
actually exist, because the flags and the data disagreed. Should we trust them?

5.4 Addon groups: we use `is_required` and `max_select`. Is there a
**`min_select`**? Can `max_select` be null/0 meaning unlimited?

5.5 Can an add-on be ordered in **quantity greater than 1** (e.g. 2× cheese)?
The POS now supports this — confirm the server accepts a per-addon qty and how
it expects that in the push payload.

---

## 6. Sync mechanics

6.1 Please list the endpoints the POS uses, with method and purpose —
pairing, bootstrap, incremental pull, order push.

6.2 The incremental pull uses a **cursor**. Is it a timestamp or an opaque
token? What happens if the POS sends a cursor that is too old?

6.3 Is there a **page size limit** on bootstrap? The POS currently pulls the
whole catalog in one request. At what item count does that become a problem?

6.4 What does the server return on **HTTP 423** (device locked)? The POS treats
this as "wipe local data and unpair" — confirm that is the intent.

6.5 Is there a **max payload size** for the order push, and should the POS batch
(it currently pushes 20 orders at a time)?

---

## 7. API error contract — ANSWERED, one item outstanding

Your catalogue landed and is implemented. This section is now the reply.

### 7.0 Where it lives on our side

| file | what it is |
|---|---|
| `src/shared/errorCatalog.ts` | the merged catalogue — **source of truth**, typechecked |
| `docs/pos-errors.json` | generated from it, for diffing against yours |
| `docs/pos-app-error-inventory.json` | **the inventory you asked for** — our 44 app-only codes |
| `scripts/export-errors.mjs` | regenerates both (`node scripts/export-errors.mjs`) |

95 codes total: your 50 plus one catch-all for an unrecognised 422, and 44 that
are ours. Your codes, severities and Arabic wording are used verbatim — the
`resources/lang/ar` copy is now what a cashier reads on the till, so the three
apps say the same thing.

### 7.1 Yes — please send the code. →

**Yes, we will use it.** Adding `"code": "POS_PUSH_ORDER_FINALIZED"` to every
error body is the one change we still want.

It is already wired: `classifyServerError()` in `src/shared/errors.ts` checks
`response.data.code` **first**, and a recognised code wins outright over
everything below it. Until it arrives we disambiguate on your English
`message`, which is the brittleness you described — today three different 401s
are told apart by `contains('revoked')` and `contains('invalid token')`, and two
423s by `contains('killswitch')`. Those matches break the day anyone rewords a
string, and a cashier gets the wrong sentence rather than a visibly wrong one.

Ship it additively whenever suits; nothing on our side needs to change to
receive it, and the `contains()` branches become dead code we delete.

### 7.2 What we implemented from your reply

- **Severity drives the component.** `blocker` → centred modal, dimmed backdrop,
  explicit dismissal. `toast` → bottom-centre card, auto-dismiss. `inline` →
  message under the control, with the control in a red border. `info` → quiet.
- **`valid:false` on HTTP 200** is branched on the field, not the status —
  `promoRejectionCode()`.
- **409 "already in progress"** is `info`, not an error; the caller polls
  `/payments/status` rather than asking for a second link.
- **423 stops the sync loop** and does not retry.
- **429** reads `Retry-After` into `{retry_after}`.
- **Offline is not an error.** `POS_NET_OFFLINE` is `info`, never a red dialog.
- **Validation runs in the app first.** Every rule in your table is checked
  while the ticket is built, tied to the field it belongs to, so the cashier
  fixes it before Place Order is live. The main process still enforces all of
  them — the form is UX, not authorization.

### 7.3 The outbox rule — already correct, confirmed

`applyPushResult()` in `src/main/utils/orderNumbers.ts` clears **only** the
`temp_id`s present in `ack`; `retryable: true` stays queued under the same
`temp_id`; `retryable: false` is marked permanent and stops replaying;
`references[temp_id]` is stored and printed. No change needed — flagging it here
so you know it is not an open risk.

### 7.4 Still open

7.4.1 **Retry safety per endpoint.** We now show a "Try again" button wherever
`retry: true`. `/push` is safe (idempotent on `device_id:temp_id`). Confirm the
same for `/promos/validate`, `/payments/link` and `/payments/status`, or tell us
which must not be retried.

7.4.2 **`Accept-Language: ar`.** Do 422 validation messages come back localised
if we send it? If they do, `POS_SERVER_REJECTED` can show the server's own
sentence directly instead of falling back to English.

7.4.3 **Correlation id.** Is there a request id in the response (header or body)
we can put behind the "technical details" disclosure? It turns a support call
from "it says something went wrong" into one lookup.

7.4.4 **Codes we raise that you may want to own.** Three in
`pos-app-error-inventory.json` look like rules that should really live server-
side: `POS_VAL_ITEM_NO_PRICE`, `POS_VAL_ADDON_GROUP_MAX` and
`POS_VAL_DELIVERY_FEE_TOO_LARGE`. We enforce them locally today. Say if you want
them.

---

## Contact

Answers can go straight back in this document — inline under each question is
fine. Anything marked BLOCKER unblocks work already in progress.
