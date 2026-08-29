Implement server-side role permission sync for the POS tills.

## Background

Our Electron POS app has a "Role permissions" screen that grants access by job role. Until now it wrote only to each till's own local SQLite table — it never reached this server and never reached any other till. Shops set a permission on one till and assumed it applied to their whole estate. It did not.

The POS client (v0.4.17) has already been changed to be pull-only and server-authoritative. It will accept role permissions from us, apply them on every till, and turn its own local editor read-only as soon as we start sending them. The client is shipped and inert until we send the key. Your job is the server half.

This is one-way: the POS never pushes permissions to us. `POST /api/pos/push` carries orders only. Once we send the key, the back office is the ONLY place these can be changed — so the admin UI is part of this task, not a follow-up.

## What to build

**1. Migration + model** — table `role_permissions`:

```
id           bigint pk
role         string       -- lowercase: 'pos', 'manager', 'kitchen', ...
permission   string       -- one of the 19 slugs below
allowed      boolean
updated_by   bigint null  -- user id who last changed it
updated_at   timestamp
unique (role, permission)
```

**2. `GET /api/pos/bootstrap`** — add a `role_permissions` collection to the payload, next to the existing `users` / `settings` / `items`. The client reads `data.role_permissions`, `catalog.role_permissions` or `catalog.pos_role_permissions`; pick whichever fits our payload shape.

```json
"role_permissions": [
  { "role": "pos", "permission": "orders.create", "allowed": true, "updated_by": 4, "updated_at": 1756200000000 },
  { "role": "pos", "permission": "orders.print",  "allowed": true, "updated_by": 4, "updated_at": 1756200000000 }
]
```

`updated_at` MUST be epoch milliseconds as an integer, not an ISO string — the client does `Number(updated_at)` and silently falls back to "now" on anything else, making every row look freshly changed. `updated_by` may be null.

**3. `POST /api/pos/pull`** — emit change-log entries so changes land in seconds instead of waiting for the next bootstrap:

```json
{ "table": "role_permissions", "op": "upsert", "pk": 91,
  "data": { "role": "pos", "permission": "reports.view", "allowed": true, "updated_by": 4, "updated_at": 1756200000000 } }

{ "table": "role_permissions", "op": "delete", "pk": 92,
  "data": { "role": "pos", "permission": "orders.refund" } }
```

A `delete` MUST carry `role` and `permission` inside `data`. The row is keyed on that pair, not on a scalar id, so a delete with only `pk` cannot be resolved — the client logs a warning and skips it rather than guess, because deleting the wrong permission fails open. `op` accepts `delete`; anything else is treated as an upsert.

**4. Back-office admin UI** to edit these per role, seeded from the POS defaults table below.

## Three rules that will bite you

These each fail silently, so please get them right.

**Send the COMPLETE list for a role, never just the changes.** For any role you publish, send every permission that role should have, each with `allowed: true`. The client replaces that role's permissions wholesale. Do NOT send only the deltas from the POS defaults — if you do, the role keeps its built-in defaults PLUS your additions, and a permission you meant to revoke will not be revoked. Omission is revocation: to revoke one of five, send the other four. To give a role nothing, send its rows with `allowed: false`. You may omit `allowed: false` rows entirely; only `allowed: true` rows are read.

**Absent key and empty array mean different things.** No key at all = "server does not manage permissions", and the till keeps its local table with its editor writable. An empty array `[]` = "server manages permissions and there are no overrides", which WIPES the local table on every till and locks their editor. So do not ship `"role_permissions": []` as a placeholder while building — that is a live instruction, not a no-op. Ship the key only once it is populated.

**Do not accept permission writes from the till.** One-way only.

## Canonical permission slugs

Send exactly these strings. Anything else is ignored by the client.

```
orders.create      orders.view_own     orders.view_all
orders.kitchen_view  orders.edit_unpaid  orders.change_status
orders.cancel      orders.reopen       orders.refund
orders.print
reports.view       reports.export
catalog.manage     payments.manage
locations.manage   tables.manage
settings.manage    updates.manage
users.permissions
```

## POS built-in defaults

These apply to any role we do NOT publish rows for. Seed the admin UI from them so the back office starts where the tills already are.

| Role | Permissions |
|---|---|
| `admin` | all 19 |
| `manager` | all except `users.permissions` |
| `accountant` | `orders.view_all`, `reports.view`, `reports.export` |
| `pos` | `orders.create`, `orders.view_own`, `orders.edit_unpaid`, `orders.cancel`, `tables.manage` |
| `branch` | same as `pos` |
| `kitchen` | `orders.view_all`, `orders.kitchen_view`, `orders.change_status` |

Note `pos` and `branch` have NO `orders.print` and NO `reports.view` by default. If shops expect cashiers to print receipts or open the closing report, we must publish those explicitly.

Separately, roles named `admin`, `owner`, `manager`, `super_admin`, `superadmin` are treated as admin-tier by the POS for order locks and cross-operator visibility. That is independent of this list and is not configurable from here — do not try to model it.

## Done when

- `GET /api/pos/bootstrap` returns `role_permissions` with complete per-role lists
- `updated_at` is epoch milliseconds, integer
- Revoking in the back office drops the row (or sets `allowed` false) and the role's remaining permissions are still sent in full
- `POST /api/pos/pull` emits `role_permissions` changes; deletes carry `role` + `permission` in `data`
- Admin UI exists to edit them
- The key is not deployed to production until populated
- Verified on two real tills on one account: change a permission in the back office, re-sync, confirm BOTH tills change. That is the entire point of the task.

On a till you can confirm it landed by opening Role permissions — it should read "Permissions are managed in the back office and apply to every till" with read-only toggles — and by checking the main-process log for `[sync] role permissions applied from server { rows: N }`.
