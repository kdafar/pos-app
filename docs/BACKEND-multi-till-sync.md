# Multi-till sync: what the POS needs from the server

Status: questions open (2026-11-05). Till branch: `fix/multi-till-sync`.

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
