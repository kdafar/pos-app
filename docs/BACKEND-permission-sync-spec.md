# Backend task: publish POS role permissions to the tills

## Context

The POS app has a **Role permissions** screen ("Grant access by job role"). Until now that screen wrote only to the till's own local SQLite table — it never reached the server and never reached any other till. A shop that set a permission on one till believed it applied to the whole estate. It did not.

The POS client has now been changed to be **pull-only and server-authoritative**: it will accept role permissions from the backend, apply them on every till, and turn its own local editor read-only once the backend starts sending them.

Nothing happens until you implement the payloads below. The client shipped in v0.4.17 and stays inert until the server sends the key.

---

## 1. Data model

One row per (role, permission) grant.

```
role_permissions
  id           bigint pk
  role         string      -- lowercase, e.g. 'pos', 'manager', 'kitchen'
  permission   string      -- one of the canonical slugs below
  allowed      boolean
  updated_by   bigint null -- user id who last changed it
  updated_at   timestamp
  unique (role, permission)
```

### Canonical permission slugs

These are compiled into the POS. Send **exactly** these strings; anything else is ignored by the client.

```
orders.create         orders.view_own       orders.view_all
orders.kitchen_view   orders.edit_unpaid    orders.change_status
orders.cancel         orders.reopen         orders.refund
orders.print
reports.view          reports.export
catalog.manage        payments.manage
locations.manage      tables.manage
settings.manage       updates.manage
users.permissions
```

### Roles

Whatever `pos_users.role` values you already issue. The POS knows these six by name and has built-in defaults for them (§5). Any other role name works fine, it just has no built-in default.

```
admin  manager  accountant  pos  branch  kitchen
```

---

## 2. GET /api/pos/bootstrap — add a `role_permissions` collection

Add the key alongside the existing `users`, `settings`, `items`. The client reads `data.role_permissions`, `catalog.role_permissions`, or `catalog.pos_role_permissions` — any one of the three, pick whichever fits your payload.

```json
{
  "catalog": {
    "items": [],
    "settings": [],
    "role_permissions": [
      { "role": "pos",     "permission": "orders.create",   "allowed": true, "updated_by": 4, "updated_at": 1756200000000 },
      { "role": "pos",     "permission": "orders.print",    "allowed": true, "updated_by": 4, "updated_at": 1756200000000 },
      { "role": "pos",     "permission": "reports.view",    "allowed": true, "updated_by": 4, "updated_at": 1756200000000 },
      { "role": "kitchen", "permission": "orders.view_all", "allowed": true, "updated_by": 4, "updated_at": 1756200000000 }
    ]
  }
}
```

**`updated_at` must be epoch milliseconds** (integer), not an ISO string. The client does `Number(updated_at)` and falls back to "now" on a non-number, which makes every row look freshly changed.

`updated_by` may be `null`.

---

## 3. The three rules that matter

These are the ones that will bite. Please read them.

### 3.1 Send the COMPLETE list for a role, not just the changes

For any role you publish, send **every permission that role should have**, each with `allowed: true`. The client replaces that role's permissions wholesale with what you sent.

Do **not** send only the deltas from the POS defaults. The client used to work that way for locally-edited permissions and deliberately no longer does for server-sent ones. If you send only the additions, the role keeps its built-in defaults *plus* your additions — and a permission you meant to revoke **will not be revoked**. That failure is silent and it fails open.

- Role should have 5 permissions → send 5 rows, all `allowed: true`.
- To revoke one → send the other 4. **Omission is revocation.**
- To give a role nothing at all → send its rows with `allowed: false`.

You may omit `allowed: false` rows entirely; only `allowed: true` rows are read. They are accepted if you prefer to keep them for auditability.

### 3.2 Absent key and empty array mean different things

| Payload | Client behaviour |
|---|---|
| key **not present** | Server does not manage permissions. Till keeps its local table; local editor stays writable. |
| key present, **empty array** `[]` | Server manages permissions and has no overrides. Local table is **wiped**, all roles fall back to POS built-in defaults, local editor goes read-only. |
| key present with rows | Rows applied; local editor goes read-only. |

So **do not ship `"role_permissions": []` as a placeholder** while you are still building this. It is a live instruction that wipes every shop's settings and locks their editor. Ship the key only once it is populated.

### 3.3 It is one-way — do not accept writes from the till

The POS will never push permissions to you; `POST /api/pos/push` carries orders only. Once you send the key, the POS editor refuses local edits, so the back office becomes the only place these can be changed. **The admin UI to edit them is part of this task.**

---

## 4. POST /api/pos/pull — change feed (optional but recommended)

Without this, a permission change reaches a till only on its next `/bootstrap`. With it, it arrives on the next pull (usually seconds).

Emit change-log entries with `table` set to `role_permissions`:

```json
{
  "changes": [
    {
      "table": "role_permissions",
      "op": "upsert",
      "pk": 91,
      "data": {
        "role": "pos",
        "permission": "reports.view",
        "allowed": true,
        "updated_by": 4,
        "updated_at": 1756200000000
      }
    },
    {
      "table": "role_permissions",
      "op": "delete",
      "pk": 92,
      "data": { "role": "pos", "permission": "orders.refund" }
    }
  ]
}
```

**A `delete` MUST carry `role` and `permission` inside `data`.** The row is keyed on that pair, not on a scalar id, so a delete with only `pk` cannot be resolved — the client logs a warning and skips it rather than guessing, because deleting the wrong permission fails open.

`op` accepts `delete`; anything else is treated as an upsert. The client also accepts `role_permission` and `pos_role_permissions` as table names.

---

## 5. POS built-in defaults (FYI)

These apply to any role you do **not** publish rows for. Worth seeding your admin UI from, so the back office starts where the tills already are.

| Role | Permissions |
|---|---|
| `admin` | all 19 |
| `manager` | all except `users.permissions` |
| `accountant` | `orders.view_all`, `reports.view`, `reports.export` |
| `pos` | `orders.create`, `orders.view_own`, `orders.edit_unpaid`, `orders.cancel`, `tables.manage` |
| `branch` | same as `pos` |
| `kitchen` | `orders.view_all`, `orders.kitchen_view`, `orders.change_status` |

Note that `pos` and `branch` have **no** `orders.print` and **no** `reports.view` by default. If shops expect cashiers to print receipts or open the closing report, you must publish those explicitly.

Separately: roles named `admin`, `owner`, `manager`, `super_admin`, `superadmin` are treated as admin-tier by the POS for order locks and cross-operator visibility. That is independent of this permission list and is not configurable from the server.

---

## 6. Acceptance checklist

- [ ] `GET /api/pos/bootstrap` returns `role_permissions` with complete per-role lists
- [ ] `updated_at` is epoch **milliseconds**, integer
- [ ] Revoking a permission in the back office drops the row (or flips `allowed` to false), and the role's remaining permissions are still sent in full
- [ ] `POST /api/pos/pull` emits `role_permissions` changes, and deletes carry `role` + `permission` in `data`
- [ ] The key is NOT shipped to production until it is populated (§3.2)
- [ ] Back-office admin UI exists to edit these, since the POS editor becomes read-only

---

## 7. How to verify against a real till

1. Point a POS at staging, run a sync.
2. On the till open **Role permissions**. It should read *"Permissions are managed in the back office and apply to every till"* and the toggles should be read-only.
3. Change a permission in the back office, re-sync, confirm it changed on the till.
4. Check the till's main-process log for `[sync] role permissions applied from server { rows: N }`.
5. Confirm a second till on the same account picks up the same change. That is the whole point of the task.
