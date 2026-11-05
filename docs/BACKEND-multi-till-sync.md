# Multi-till sync: what the POS needs from the server

Status: answered; server items 1–2 live (2026-11-05). Till branch: `fix/multi-till-sync`.

## The problem

Several POS devices work on the same branch, sometimes with the same user signed in
on more than one device. Devices disagree with each other and with the website:
a table is occupied on one device and free on another, an order closed on one
device still shows open on another, orders appear late.

## What the till does today

- **Sync loop:** every ~60 s per device: `/bootstrap` (full), then `/pull {cursor}`, then
  `/push` (own orders only, max 25), then `/pull` again if something was acked.
  The till will move to every 15–20 s and keep syncing in the background (see Q9).
- **Push:** only orders this device created (UUID id). It sends them once they are
  placed (`placed`, `prepared`, `ready`, `awaiting_pickup`, `closed`, `completed`,
  `cancelled_client`). Drafts (`open`) are never sent.
- **Mark paid:** `POST/DELETE /orders/{id}/paid`. This is the only change a device can
  make to an order it did not create.
- **Pull, orders:** the till reads id, number, reference_no, branch_id, order_type,
  status, customer name/mobile/email, payment method, totals, created_at and `paid`.
  It ignores order deletes.
- **Pull, tables:** the till stores `is_available` exactly as sent. A device decides a
  table is busy if it has an active local order on it OR the server says
  `is_available = 0`.

## Questions (please answer each one)

1. **Echo.** Does `/pull` send a device its OWN pushed orders back? We understood
   "never back to the pusher". If the website or another device changes one of
   this device's orders, does this device receive that change?
2. **Order fields in `/pull`.** Please send on every order row: `table_id`,
   `covers`, order `notes`, delivery address, `created_by` user id, the device
   id that created it, `closed_at`. Can you add these? Today a device that
   receives another device's dine-in order cannot tell which table it is on.
3. **Tables.** How is `is_available` computed on the server? Do you emit a
   `tables` change in `/pull` every time it changes (order placed on a table,
   moved, closed, cancelled, released), from any device or the website?
4. **Cursor.**
   - Is the `/pull` cursor per device or per branch?
   - Is the `cursor` returned by `/bootstrap` a safe point to resume `/pull` from,
     so that no change before it is lost?
   - Is `/pull` paged? If so, what tells the till there is more (`has_more`)?
5. **Changing another device's order.** We need one endpoint that any device on
   the branch can use for any order of that branch (own, other device, website):
   - `POST /orders/{id}/status {status, approval?}` (includes close and cancel)
   - change payment method and customer mobile
   - The response should carry the order as the server now has it.
   - Which refusal codes would it return?
   Does something like this exist already, or can it be added?
6. **Seated tables before "Place order".** A cashier opens a dine-in on a table
   and adds items before placing. Other devices must see that table as taken.
   Proposal:
   - `POST /tables/{id}/hold {temp_id, covers}` and `DELETE /tables/{id}/hold`
   - A hold makes `is_available = 0` for everyone and is emitted in `/pull`.
   - A hold expires if the device goes silent (e.g. 30 min).
   - A clash answers `POS_TABLE_TAKEN` with who holds it.
   - Placing the order turns the hold into the order's table.
   Is this acceptable, or do you prefer another shape?
7. **Order deletes and voids.** Does the website ever delete an order? Should a
   till treat a deleted order as cancelled? Today a delete is ignored.
8. **Customers.** Is there a customer list the till should receive in `/pull`
   (edits made on the website), or are customers only ever part of an order?
9. **Load.** Each device will sync every 15–20 s instead of every 60 s.
   - Today every sync starts with a full `/bootstrap`. Is that needed every
     time, or can the till call `/bootstrap` once and then only `/pull`?
   - What rate limit applies per device?
10. **Instant updates.** Is there any realtime channel (websocket / Pusher /
    Reverb / SSE) the till could listen to for "something changed on your
    branch, pull now"? It would make devices update in about a second instead
    of 15–20 s.

## Server answers (2026-11-05) and agreed work

Summary of the reply:
- **Q1:** pushed orders go to the other tills, not back to the pusher. Later website or
  other-till changes do come back. Gaps: the customer-app cancel
  (front/OrderController.php:880) and the old admin API update/assign
  (Api/AdminController.php:242, :471) don't reach the feed.
- **Q2:** today only `table_name` and `source` are sent (`kitchen_note` only for
  web/partner orders). `table_id`, notes, address, user_id and external_source/id are
  stored and easy to add. `covers` only exists where the column exists. There is no
  `closed_at`.
- **Q3:** a table is busy when a dine-in order on it has status 1–3 (Table.php:52).
  Table changes are emitted on placing, moving, a status or type change, the bulk close,
  and admin edits. **Agreed: the till uses 1–3 too.**
- **Q4:**
  - The cursor is one shared number, and each till keeps its own position.
  - The `/bootstrap` cursor is safe to resume from.
  - `/pull` returns at most 5000 rows, with `has_more`.
  - Risk: a row committed late in a transaction can get an id below a cursor a till
    has already passed.
- **Q5:** no till endpoint exists. One can be added by reusing the portal's logic, with
  codes POS_ORDER_NOT_FOUND, POS_PUSH_ORDER_FINALIZED, POS_PUSH_CANCEL_NOT_PERMITTED,
  POS_PUSH_APPROVAL_INVALID and POS_PUSH_TABLE_INVALID.
- **Q6:** holds don't exist. The proposed design fits.
- **Q7:** admin delete is switched off. Driver or customer deletes remove orders
  silently. The till treats a delete as "remove".
- **Q8:** there is no customer feed (only order data plus `orders_seed`).
- **Q9:**
  - Bootstrap once, then only `/pull`. Re-bootstrapping loses other tills' dine-in
    orders, because they aren't in `orders_seed`.
  - **Rate limit: 60/min per IP, shared by all tills in a shop.**
- **Q10:** no realtime channel. It would be a separate project.

Server to-do, in order of impact:
1. A per-device rate limit for `/api/pos/*`, like the printing PCs have. The till won't
   sync faster than every 60 s until this is live.
2. Add `table_id`, `covers`, notes, address, `user_id` and external_source/id to order
   rows in `/pull` (and `closed_at` if added).
3. Send the customer-app cancel and the old admin-app status/assign changes through the
   change feed, including the table update.
4. Fix the late-commit cursor risk. For example, assign the feed id after commit, or
   let tills re-read a small overlap.
5. `POST /api/pos/orders/{id}/status` (plus payment method and mobile), usable by any
   till of the branch, with the refusal codes above.
6. Table holds (Q6).

## What the till will change on its side (in progress)

- Sync in the background even when the window is not focused, about every 15–20 s.
- Push close, release table, status changes and table changes right away.
- Store `table_id`, `covers` and the other order fields when the server sends
  them. Treat the server's status codes 0–3 and 7 as active, so another device's
  order shows on tables, the order strip and the kitchen screen.
- Never skip an incoming change that fails to apply. Retry it.
- Until Q5 exists: block close, cancel and status changes on orders this device
  did not create, with a clear message, instead of changing them only locally.
  (Waiting for the operator's decision.)

## Server status (2026-11-05, later)

1. Per-till rate limit: **live** on every restaurant site, trebianco.com and the dev
   copies, 240 requests a minute per till. The till now syncs every 15 s.
2. Extra order fields: **live** (table, notes, address, staff member, till).
   **Guest count and closing time are not there yet.** No live database has an orders
   column for guest count, so the server drops `covers` on push and other tills get it
   empty. Fix: one migration adding `covers` and `closed_at`.
3–6. Not started.

dev.trebianco.com runs the same server code as live Trebianco and is the place for the
two-till test.
