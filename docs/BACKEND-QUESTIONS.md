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

## Contact

Answers can go straight back in this document — inline under each question is
fine. Anything marked BLOCKER unblocks work already in progress.
