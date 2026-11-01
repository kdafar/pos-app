# Backend: table moves, floors, and table order

For the Laravel developer who owns `/api/pos/*`. The POS app (Windows and
Android) already sends what is described below or will read it as soon as it
arrives — nothing on the till side needs to ship first.

## 0. Send the table number

Every table reaches the till with no `number` field (or with `number` null), so
all tables arrive as number 0. The till now falls back to the digits in the
label, but that breaks as soon as a label has no number in it ("Terrace",
"VIP") or two numbers ("Floor 2 Table 5").

**Needed:**

- Every table row in `/bootstrap` and `/pull` carries `number` as an integer
  (the field the web admin calls the table number). It must be set on every
  table; make it required in the web admin form, unique per branch.
- Backfill existing tables: set `number` from the label digits where it is
  empty, and list any table that has no digits so the shop can number it.

**Check:** `GET /api/pos/bootstrap` → every item in `tables` has a non-zero
`number`.

## 1. Moving an order to another table must update the server

**Today:** a cashier can move a dine-in order to a different table on the till.
From the next app version, the till re-sends the whole order through
`POST /api/pos/push` after a move, with the new `order.table_id`, even when the
order was already pushed before.

**Needed:**

- When `/push` receives an order the server already has, apply a changed
  `table_id` instead of ignoring it (check whether the current upsert skips
  existing orders or skips this field).
- Validate the new table belongs to the same branch; refuse with a stable
  `code` (like the other `/api/pos` refusals) if not.
- Keep table occupancy right on the server:
  - old table → available, **unless** another active order is still on it;
  - new table → occupied.
- When an order reaches a final status (done / cancelled), free its table under
  the same rule.
- The corrected `is_available` must go out in `/pull` changes and `/bootstrap`,
  because the till overwrites its local flag from those feeds on every sync.
  A stale `is_available = 0` shows a table as busy on every till.

**Check:** move a placed order from table 3 to table 5 on the till → the web
admin shows the order on table 5, table 3 free, table 5 busy.

## 2. Floors (sections) for tables

The restaurant has two floors with their own tables. Tables currently carry only
`id, branch_id, label, number, capacity, is_available`.

**Needed:**

- New model `table_sections`: `id`, `branch_id`, `name_en`, `name_ar`,
  `sort_order`, `is_active`, `updated_at`.
- On `tables`: `section_id` (nullable — tables without a section keep working)
  and `sort_order`.
- Web admin: create, rename, reorder and deactivate sections; assign each table
  to a section; reorder tables within a section.
- Sync:
  - `/bootstrap`: add `table_sections: [...]`, and include `section_id` and
    `sort_order` on every table.
  - `/pull`: deliver section changes and table changes (including a table moved
    to another section) the same way tables are delivered now, and deletes the
    same way other deletes are delivered.

Example table row:

```json
{ "id": "12", "branch_id": 3, "label": "T5", "number": 5, "capacity": 4,
  "is_available": 1, "section_id": "2", "sort_order": 50,
  "updated_at": "2026-11-01T10:00:00Z" }
```

Example section row:

```json
{ "id": "2", "branch_id": 3, "name_en": "First floor", "name_ar": "الطابق الأول",
  "sort_order": 20, "is_active": 1, "updated_at": "2026-11-01T10:00:00Z" }
```

The till will show one tab per section, in `sort_order`, with tables in their
own `sort_order` inside it.

## 3. Sales report PDF on an 80mm printer (web)

The web sales report downloads as an A4 PDF. Printed on the shop's 80mm thermal
printer (POS-80) the browser shrinks it onto a 80 × 3276 mm roll page — three
"sheets" of unreadable paper. Either:

- add a "receipt printer" version of the report: an HTML page with
  `@page { size: 80mm auto; margin: 0 }` and a single-column layout, or
- label the PDF as A4-only so managers print it on a normal printer.

The POS app already prints its own closing report on the roll; this item is only
about the web report.

## 4. Follow-up (2026-11-01): re-push must update lines on open orders

Your reply says `/push` writes lines only when the server has none. That breaks
dine-in: a table is placed (pushed with its first round), then orders more. The
till re-pushes the whole order with all lines and the new total. The server
takes the new `order_total` but keeps the first round's lines, so on the web
the order's items no longer add up to its total, and every item report, the
kitchen view on the web and stock consumption miss the extra rounds.

**What the till sends:** every push carries the complete current `lines[]`.
Each line has a stable local `id` (UUID) that never changes for the life of
the line, plus its `qty`, prices, variation, add-ons and notes.

**Needed, for orders that are not yet done/cancelled:**

- Treat `lines[]` on a re-push as the full current list, keyed by the line `id`:
  insert new ids, update changed ones, delete ids that are no longer sent.
- Also apply on re-push: `covers`, customer name / phone / address, notes and
  `order_type` (a dine-in turned into pickup sends it).
- Recalculate from those lines as you do on first push, so the lines and
  `order_total` always agree.
- A done or cancelled order keeps refusing with `POS_PUSH_ORDER_FINALIZED`.

**Check:** place a dine-in order with 2 items, add 1 more, place again → the
web shows 3 lines and a total equal to their sum.

## Please reply with

- Whether `/push` currently ignores changes to an existing order (and which
  fields), so we know what else a re-push will not update.
- The final field names if they differ from the above.
