import path from 'node:path';
import { app } from 'electron';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { deleteSecret } from './secureStore';

const requiredb = createRequire(import.meta.url);
const Database = requiredb('better-sqlite3') as typeof import('better-sqlite3');
const dbPath = path.join(app.getPath('userData'), 'pos.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- helpers ----------
function hasColumn(table: string, name: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    return rows.some((r) => r.name === name);
  } catch {
    return false;
  }
}
function ensureColumn(table: string, columnDef: string, colName: string) {
  if (!hasColumn(table, colName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}
function createIndexIfColumnsExist(sql: string, table: string, cols: string[]) {
  const ok = cols.every((c) => hasColumn(table, c));
  if (ok) db.exec(sql);
}

export function wipeLocalPosDb() {
  try {
    db.close();
  } catch {
    // ignore close errors
  }

  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {
    // ignore delete errors
  }
}

export function migrate() {
  // Phase 1: create base tables (no fragile indexes yet)
  db.exec(`
    -- key/value & cursors
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Catalog: categories / subcategories
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT,
      name_ar TEXT,
      position INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT,
      name_ar TEXT,
      position INTEGER DEFAULT 0,
      visible INTEGER DEFAULT 1,
      updated_at TEXT
    );

    -- Items (start minimal; we'll add columns with ensureColumn)
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      subcategory_id TEXT,
      name TEXT,
      name_ar TEXT,
      barcode TEXT,
      price REAL DEFAULT 0,
      is_outofstock INTEGER DEFAULT 0,
      updated_at TEXT
    );

    -- Variations (new)
    CREATE TABLE IF NOT EXISTS variations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      name TEXT,
      name_ar TEXT,
      price REAL,
      sale_price REAL,
      updated_at TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    -- Addon groups & addons
    CREATE TABLE IF NOT EXISTS addon_groups (
      id TEXT PRIMARY KEY,
      name TEXT,
      name_ar TEXT,
      is_required INTEGER DEFAULT 0,
      max_select INTEGER,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS addons (
      id TEXT PRIMARY KEY,
      group_id TEXT,
      name TEXT,
      name_ar TEXT,
      price REAL DEFAULT 0,
      updated_at TEXT
    );

    -- Item ↔ Addon group mapping (new)
    CREATE TABLE IF NOT EXISTS item_addon_groups (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      is_required INTEGER DEFAULT 0,
      max_select INTEGER,
      updated_at TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES addon_groups(id) ON DELETE CASCADE
    );

    -- Promocodes
    CREATE TABLE IF NOT EXISTS promos (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE,
      type TEXT,
      value REAL,
      min_total REAL DEFAULT 0,
      max_discount REAL,
      start_at TEXT,
      end_at TEXT,
      active INTEGER DEFAULT 1,
      updated_at TEXT
    );

    -- Promo item exclusions (new)
    CREATE TABLE IF NOT EXISTS promo_item_exclusions (
      promo_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      UNIQUE (promo_id, item_id)
    );

    -- Payment methods
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      name_en TEXT,
      name_ar TEXT,
      legacy_code TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT
    );

    -- Geo: states / cities / blocks
    CREATE TABLE IF NOT EXISTS states (
      id TEXT PRIMARY KEY,
      name TEXT,
      name_ar TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      state_id TEXT,
      name TEXT,
      name_ar TEXT,
      min_order REAL DEFAULT 0,
      delivery_fee REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      city_id TEXT,
      name TEXT,
      name_ar TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );

    -- Dine-in tables
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      branch_id INTEGER,
      label TEXT,
      number INTEGER,
      capacity INTEGER,
      is_available INTEGER DEFAULT 1,
      updated_at TEXT
    );

    -- App settings
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    
    -- Orders
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      number TEXT UNIQUE,
      device_id TEXT,
      branch_id INTEGER,
      order_type INTEGER DEFAULT 2,          -- 1=delivery, 2=pickup, 3=dine-in
      status TEXT DEFAULT 'draft',           -- draft, open, closed, completed, cancelled
      status_code INTEGER,

      -- Customer
      full_name TEXT,
      mobile TEXT,
      email TEXT,

      -- Address
      state_id TEXT,
      city_id TEXT,
      block_id TEXT,
      block TEXT,
      address_type TEXT,
      address TEXT,
      building TEXT,
      floor TEXT,
      house_no TEXT,
      landmark TEXT,
      delivery_date TEXT,
      table_id TEXT,

      -- Payment
      payment_method_id TEXT,
      payment_method_slug TEXT,
      payment_type INTEGER,
      promocode TEXT,

      -- Totals
      subtotal REAL DEFAULT 0,
      tax_total REAL DEFAULT 0,
      discount_total REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      discount_pr REAL DEFAULT 0,
      delivery_fee REAL DEFAULT 0,
      grand_total REAL DEFAULT 0,

      -- Notes
      note TEXT,

      -- Timestamps
      opened_at INTEGER,
      closed_at INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at INTEGER,
      synced_at INTEGER
    );

    -- Order lines
    CREATE TABLE IF NOT EXISTS order_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      item_id TEXT,

      -- snapshot
      name TEXT,
      name_ar TEXT,

      -- pricing
      unit_price REAL DEFAULT 0,
      qty REAL DEFAULT 1,
      tax_amount REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      line_total REAL DEFAULT 0,

      -- variations/addons
      variation_id TEXT,
      variation TEXT,
      variation_price REAL,
      addons_id TEXT,
      addons_name TEXT,
      addons_price TEXT,
      addons_qty TEXT,

      -- notes
      notes TEXT,

      temp_line_id TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    -- Active orders (tab management)
    CREATE TABLE IF NOT EXISTS active_orders (
      order_id TEXT PRIMARY KEY,
      tab_position INTEGER DEFAULT 0,
      last_accessed INTEGER,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pos_users (
      id            INTEGER PRIMARY KEY,
      name          TEXT,
      username      TEXT,
      email         TEXT,
      role          TEXT,            -- 'admin' | 'kitchen' | 'branch'
      password_hash TEXT,            -- Laravel bcrypt from backend
      is_active     INTEGER DEFAULT 1,
      branch_id     INTEGER,
      updated_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS time (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,          -- 'Sunday', 'Monday', ...
      open_time TEXT NOT NULL,    -- e.g. '9:00am'
      close_time TEXT NOT NULL,   -- e.g. '1:00am'
      always_close INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pos_action_log (
      id TEXT PRIMARY KEY,
      order_id TEXT NULL,
      user_id TEXT NULL,
      action TEXT NOT NULL,          -- create|add_line|set_qty|remove_line|promo_apply|complete|print|lock|unlock|paylink_create|paylink_status|wipe
      meta_json TEXT NULL,           -- JSON blob
      created_at INTEGER             -- ms epoch
    );
    CREATE INDEX IF NOT EXISTS idx_actionlog_order ON pos_action_log(order_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_actionlog_action ON pos_action_log(action, created_at);

    -- Order lines that reached the change feed before their header did.
    --
    -- order_lines has a FOREIGN KEY to orders(id) and foreign_keys is ON, so an
    -- orphan line throws. The whole pull page applies inside ONE transaction
    -- that also writes the cursor, so that throw rolls the page back INCLUDING
    -- the cursor — the next pull refetches the same poisoned page and throws
    -- again, forever. A header and its lines get separate change-log ids and
    -- are not guaranteed to land in the same page, so this is routine, not an
    -- edge case. Park unparented lines here (no FK) and drain them when the
    -- header arrives.
    -- Permissions are granted to a ROLE, and every user holding that role
    -- inherits them. The per-user table this replaces made it possible to
    -- grant a permission to one operator and have another with the same job
    -- silently lack it — which is exactly how it was mis-set in the field.
    CREATE TABLE IF NOT EXISTS pos_role_permissions (
      role       TEXT NOT NULL,
      permission TEXT NOT NULL,
      allowed    INTEGER NOT NULL CHECK (allowed IN (0, 1)),
      updated_by INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (role, permission)
    );

    CREATE TABLE IF NOT EXISTS order_lines_pending (
      id          TEXT PRIMARY KEY,
      order_id    TEXT NOT NULL,
      payload     TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lines_pending_order
      ON order_lines_pending(order_id);

    -- Feed changes that failed to apply; retried at the start of each pull.
    CREATE TABLE IF NOT EXISTS sync_failed_changes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      payload    TEXT NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Per-user permission overrides are retired: permissions live on the role.
  // Renamed rather than dropped so hand-entered settings stay recoverable —
  // nothing reads this table any more.
  try {
    const tableExists = (name: string) =>
      !!db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
        .get(name);

    if (tableExists('pos_user_permissions')) {
      if (!tableExists('pos_user_permissions_retired')) {
        db.exec(
          'ALTER TABLE pos_user_permissions RENAME TO pos_user_permissions_retired'
        );
        console.log('[db] retired pos_user_permissions; permissions are per-role now');
      } else {
        // Builds before the per-role switch recreated pos_user_permissions on
        // every boot, moments after this migration had renamed it away. The
        // retired copy holds the real grants; this one is that empty recreate,
        // so drop it — otherwise the rename fails and logs on every boot from
        // here on. If it somehow holds rows, park it under the next free
        // suffix rather than throw hand-entered settings away.
        const { c = 0 } = db
          .prepare('SELECT COUNT(*) AS c FROM pos_user_permissions')
          .get() as { c?: number };
        if (c === 0) {
          db.exec('DROP TABLE pos_user_permissions');
          console.log('[db] dropped empty leftover pos_user_permissions');
        } else {
          let n = 2;
          while (tableExists(`pos_user_permissions_retired_${n}`)) n++;
          const parked = `pos_user_permissions_retired_${n}`;
          db.exec(`ALTER TABLE pos_user_permissions RENAME TO ${parked}`);
          console.log('[db] retired pos_user_permissions', { as: parked, rows: c });
        }
      }
    }
  } catch (e) {
    console.error('[db] could not retire pos_user_permissions', e);
  }

  // Phase 2: ensure columns exist on legacy installs (safe ALTER TABLE order matters)
  ensureColumn('items', 'branch_id INTEGER', 'branch_id');
  ensureColumn('items', 'type TEXT', 'type');
  ensureColumn('items', 'image TEXT', 'image');
  ensureColumn('items', 'has_variations INTEGER DEFAULT 0', 'has_variations');
  ensureColumn('items', 'size TEXT', 'size');
  ensureColumn('items', 'has_addons INTEGER DEFAULT 0', 'has_addons');

  ensureColumn('payment_methods', 'updated_at TEXT', 'updated_at');
  ensureColumn('payment_methods', 'is_online INTEGER DEFAULT 0', 'is_online');
  ensureColumn(
    'payment_methods',
    'supports_payment_link INTEGER DEFAULT 0',
    'supports_payment_link'
  );

  ensureColumn('tables', 'updated_at TEXT', 'updated_at');

  ensureColumn('states', 'updated_at TEXT', 'updated_at');
  ensureColumn('cities', 'updated_at TEXT', 'updated_at');
  ensureColumn('blocks', 'updated_at TEXT', 'updated_at');
  ensureColumn('app_settings', 'updated_at TEXT', 'updated_at');
  ensureColumn('pos_users', 'mobile TEXT', 'mobile');
  ensureColumn('promos', 'max_discount REAL', 'max_discount');

  ensureColumn('orders', 'status_code INTEGER', 'status_code');
  ensureColumn('orders', 'push_legacy INTEGER DEFAULT 0', 'push_legacy');
  ensureColumn('orders', 'server_id TEXT', 'server_id');
  ensureColumn('orders', 'reference_no TEXT', 'reference_no');
  ensureColumn('orders', 'email TEXT', 'email');
  ensureColumn('orders', 'state_id TEXT', 'state_id');
  ensureColumn('orders', 'city_id TEXT', 'city_id');
  ensureColumn('orders', 'block_id TEXT', 'block_id');
  ensureColumn('orders', 'block TEXT', 'block');
  ensureColumn('orders', 'address_type TEXT', 'address_type');
  ensureColumn('orders', 'building TEXT', 'building');
  ensureColumn('orders', 'floor TEXT', 'floor');
  ensureColumn('orders', 'house_no TEXT', 'house_no');
  ensureColumn('orders', 'landmark TEXT', 'landmark');
  ensureColumn('orders', 'delivery_date TEXT', 'delivery_date');
  ensureColumn('orders', 'payment_type INTEGER', 'payment_type');
  ensureColumn('orders', 'promocode TEXT', 'promocode');
  ensureColumn('orders', 'discount_amount REAL DEFAULT 0', 'discount_amount');
  ensureColumn('orders', 'discount_pr REAL DEFAULT 0', 'discount_pr');
  ensureColumn(
    'orders',
    'void_delivery_fee INTEGER DEFAULT 0',
    'void_delivery_fee'
  );
  // What the customer handed over on a cash sale, and what was handed back.
  //
  // Both NULL on the overwhelming majority of orders, and that is the point:
  // NULL means "nobody recorded a tender", which must print differently from
  // a recorded 0. No DEFAULT for the same reason.
  //
  // change_due is the server's own figure, kept only so a reprint of a pulled
  // order can show what the original slip said. The till derives change from
  // amount_tendered when it has it — one rounding rule, applied in one place.
  ensureColumn('orders', 'amount_tendered REAL', 'amount_tendered');
  ensureColumn('orders', 'change_due REAL', 'change_due');
  // Set when a cashier types the delivery charge in by hand. Without this we
  // cannot tell a hand-entered fee from one derived from the city, so a recalc
  // either clobbers the cashier's number or freezes a stale city fee forever.
  ensureColumn(
    'orders',
    'delivery_fee_manual INTEGER DEFAULT 0',
    'delivery_fee_manual'
  );
  ensureColumn('orders', 'table_id TEXT', 'table_id');
  ensureColumn('orders', 'covers INTEGER', 'covers');
  // The server's nightly job closed it, with no accounting entry.
  ensureColumn('orders', 'auto_closed INTEGER', 'auto_closed');

  // Floors. The server calls them table_sections; a table with no section_id
  // still works and is shown under "All".
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_sections (
      id TEXT PRIMARY KEY,
      branch_id INTEGER,
      name_en TEXT,
      name_ar TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );
  `);
  ensureColumn('tables', 'section_id TEXT', 'section_id');
  ensureColumn('tables', 'sort_order INTEGER DEFAULT 0', 'sort_order');
  ensureColumn('tables', 'label_ar TEXT', 'label_ar');
  // Table holds: a draft on another till. held_by is the server's object as JSON.
  ensureColumn('tables', 'held INTEGER', 'held');
  ensureColumn('tables', 'held_by TEXT', 'held_by');
  // Split payment: one row per part (cash + one other method). An order with
  // no rows here was paid one way. Not named order_payments: an old report
  // fallback reads a table by that name.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_payment_parts (
      order_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      method_slug TEXT NOT NULL,
      amount REAL NOT NULL,
      amount_tendered REAL,
      PRIMARY KEY (order_id, idx)
    )
  `);
  // The table this till holds for its own draft, and when it last said so.
  ensureColumn('orders', 'hold_table_id TEXT', 'hold_table_id');
  ensureColumn('orders', 'hold_at INTEGER', 'hold_at');

  // Manager approval. The server sends the bcrypt hash of a manager's 6-digit
  // approval code; the till checks a typed or scanned code against it offline.
  ensureColumn('pos_users', 'approval_code_hash TEXT', 'approval_code_hash');
  ensureColumn('pos_users', 'approval_code_set INTEGER DEFAULT 0', 'approval_code_set');
  // One row per approved action, sent with the order as approvals[] until the
  // server has it (idempotent by id, so re-sending is harmless).
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_approvals (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      action TEXT NOT NULL,
      line_id TEXT,
      table_id TEXT,
      qty_before REAL,
      qty_after REAL,
      requested_by INTEGER,
      approved_by INTEGER,
      approved_at TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_approvals_order ON order_approvals(order_id);
  `);
  // A code from /push notices[] about this order — today only
  // POS_PUSH_TABLE_INVALID: the server kept the order on its old table. Shown
  // on the order until the cashier picks a table again.
  ensureColumn('orders', 'push_notice TEXT', 'push_notice');

  // Mark order paid (contract: Mark order paid). The server's `paid` object,
  // stored as it arrives on pull / orders_seed / GET /orders/{id} / the two
  // paid endpoints. paid_status NULL means the server has never sent one —
  // keep today's inferred badge. NOT `paid_at`: see shared/paid.ts.
  ensureColumn('orders', 'paid_status TEXT', 'paid_status'); // paid | unpaid | NULL
  ensureColumn('orders', 'paid_how TEXT', 'paid_how'); // gateway | by_hand
  ensureColumn('orders', 'paid_time TEXT', 'paid_time'); // ISO
  ensureColumn('orders', 'paid_by_id INTEGER', 'paid_by_id');
  ensureColumn('orders', 'paid_by_name TEXT', 'paid_by_name');
  ensureColumn('orders', 'paid_amount REAL', 'paid_amount');
  ensureColumn('orders', 'paid_method_id TEXT', 'paid_method_id');
  // Names resolved when the mark is stored, so a list badge can print
  // "Paid · KNET · Sara" without a lookup per row.
  ensureColumn('orders', 'paid_method_name TEXT', 'paid_method_name');
  ensureColumn('orders', 'paid_method_name_ar TEXT', 'paid_method_name_ar');
  ensureColumn('orders', 'paid_link_open INTEGER DEFAULT 0', 'paid_link_open');
  ensureColumn('orders', 'paid_reference TEXT', 'paid_reference'); // KNET slip reference
  // Till-side only: 'mark' | 'undo' while an action waits in the outbox, and
  // the code of the last action the server refused in the background, shown
  // on the order until the cashier dismisses it.
  ensureColumn('orders', 'paid_pending TEXT', 'paid_pending');
  ensureColumn('orders', 'paid_refusal TEXT', 'paid_refusal');
  // One row per tap. action_id is the server's idempotency key, so a row is
  // resent unchanged until it gets a 200 or a 4xx, and never re-created.
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_paid_actions (
      action_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      refusal_code TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_order_paid_actions_queue
      ON order_paid_actions(state, created_at);
  `);

  // Business days (contract: BUSINESS-DAY-WIRE-CONTRACT). The server decides
  // every window; these keep its answers for an offline till, and queue
  // End day until the server has it (idempotent by action_id).
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_days (
      date TEXT PRIMARY KEY,
      from_ms INTEGER NOT NULL,
      to_ms INTEGER NOT NULL,
      open_ms INTEGER,
      close_ms INTEGER,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS day_close_actions (
      action_id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      refusal_code TEXT,
      created_at INTEGER NOT NULL,
      finished_at INTEGER
    );
  `);
  ensureColumn('orders', 'delivery_fee REAL DEFAULT 0', 'delivery_fee');

  ensureColumn('orders', 'printed_at INTEGER', 'printed_at'); // ms since epoch
  ensureColumn('orders', 'is_locked INTEGER DEFAULT 0', 'is_locked');
  ensureColumn('orders', 'user_id INTEGER', 'user_id'); // who completed/printed

  // ---- image cache fields on items
  ensureColumn('items', 'image_local TEXT', 'image_local'); // absolute local path
  ensureColumn('items', 'image_etag TEXT', 'image_etag'); // optional: server ETag
  ensureColumn('items', 'image_mtime INTEGER', 'image_mtime');

  ensureColumn('orders', 'created_by_user_id TEXT', 'created_by_user_id');
  // Origin of an order another till / the website sent us over /pull.
  ensureColumn('orders', 'external_source TEXT', 'external_source');
  ensureColumn('orders', 'external_id TEXT', 'external_id');
  ensureColumn('orders', 'completed_by_user_id TEXT', 'completed_by_user_id');
  ensureColumn('orders', 'printed_by_user_id TEXT', 'printed_by_user_id');

  ensureColumn('orders', 'payment_link_url TEXT', 'payment_link_url');
  ensureColumn('orders', 'payment_link_status TEXT', 'payment_link_status'); // pending|paid|expired|failed
  ensureColumn('orders', 'payment_verified_at INTEGER', 'payment_verified_at');
  ensureColumn(
    'orders',
    'payment_link_verified_at INTEGER',
    'payment_link_verified_at'
  );

  ensureColumn('order_lines', 'variation_id TEXT', 'variation_id');
  ensureColumn('order_lines', 'variation TEXT', 'variation');
  ensureColumn('order_lines', 'variation_price REAL', 'variation_price');
  ensureColumn('order_lines', 'addons_id TEXT', 'addons_id');
  ensureColumn('order_lines', 'addons_name TEXT', 'addons_name');
  ensureColumn('order_lines', 'addons_price TEXT', 'addons_price');
  ensureColumn('order_lines', 'addons_qty TEXT', 'addons_qty');
  ensureColumn('order_lines', 'notes TEXT', 'notes'); // safe even if already exists
  ensureColumn('order_lines', 'updated_at INTEGER', 'updated_at');
  ensureColumn('order_lines', 'is_locked INTEGER DEFAULT 0', 'is_locked');
  // Once: lines pulled onto other tills' orders before 0.7.2 were stored
  // unlocked, and an unlocked line on another till's order now means "added
  // here, not sent yet". Left unlocked they would be sent again as new items.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    const done = db.prepare(`SELECT value FROM meta WHERE key = 'migr.lock_pulled_lines'`).get();
    if (!done) {
      db.exec(
        `UPDATE order_lines SET is_locked = 1
          WHERE order_id NOT GLOB '*[^0-9]*' AND order_id <> ''`
      );
      db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migr.lock_pulled_lines', '1')`).run();
    }
  } catch (e) {
    console.error('[db] locking pulled lines failed', e);
  }

  // Phase 3: indexes (only after columns are present)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_subcats_cat ON subcategories(category_id, position);
    CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
    CREATE INDEX IF NOT EXISTS idx_variations_item ON variations(item_id);
    CREATE INDEX IF NOT EXISTS idx_states_active ON states(is_active);
    CREATE INDEX IF NOT EXISTS idx_cities_active ON cities(is_active);
    CREATE INDEX IF NOT EXISTS idx_blocks_city ON blocks(city_id);
    CREATE INDEX IF NOT EXISTS idx_tables_branch ON tables(branch_id, is_available, number);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_opened_at ON orders(opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_mobile ON orders(mobile);
    CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_pos_users_email ON pos_users(lower(email));
    CREATE INDEX IF NOT EXISTS idx_orders_outbox ON orders(status, synced_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_addons_group ON addons(group_id);
    CREATE INDEX IF NOT EXISTS idx_item_addon_groups_item ON item_addon_groups(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_addon_groups_group ON item_addon_groups(group_id);
  `);

  // Column-dependent index on items(type) — guard it
  createIndexIfColumnsExist(
    `CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)`,
    'items',
    ['type']
  );

  // Helpful unique/covering indexes
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_exclusions ON promo_item_exclusions(promo_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_orders_print_flags ON orders(is_locked, printed_at);
    CREATE INDEX IF NOT EXISTS idx_orders_paylink     ON orders(payment_link_status, payment_verified_at);
  `);

  db.exec(`
    INSERT OR IGNORE INTO meta(key, value) VALUES('pos.locked', '0');
    INSERT OR IGNORE INTO meta(key, value) VALUES('security.kill_after_days', '14');
  `);
}

/**
 * One-time repair of rows damaged by two now-fixed sync bugs:
 *
 *  1. Server orders were pulled back down under their server id, colliding on
 *     `number`, so the dedupe trigger renamed the LOCAL row to
 *     'L-<number>-<hex>' and both rows showed in Recent Orders.
 *  2. The numeric server status was written straight into `status`, so the
 *     column held "2.0" alongside 'open'/'closed'.
 */
export function repairOrderSyncDamage() {
  if (getMeta('repair.order_sync_v1') === 'done') return;

  try {
    // 1) Numeric statuses -> keep the code in status_code, label the status.
    const numeric = db
      .prepare(
        `SELECT id, status FROM orders
          WHERE status GLOB '[0-9]*' AND status NOT GLOB '*[a-zA-Z]*'`
      )
      .all() as Array<{ id: string; status: string }>;

    const fixStatus = db.prepare(
      `UPDATE orders SET status = ?, status_code = ? WHERE id = ?`
    );
    for (const row of numeric) {
      const code = Math.trunc(Number(row.status));
      if (!Number.isFinite(code)) continue;
      fixStatus.run(`status ${code}`, code, row.id);
    }

    // 2) Un-mangle 'L-<number>-<hex>' where the collision is gone. If the
    //    original number is now free, the local row reclaims it; if a server
    //    row still holds it, the local row is the authoritative one, so drop
    //    the *server* seed copy (it carries no lines) and restore ours.
    const mangled = db
      .prepare(`SELECT id, number FROM orders WHERE number LIKE 'L-%-%'`)
      .all() as Array<{ id: string; number: string }>;

    for (const row of mangled) {
      const original = row.number.replace(/^L-/, '').replace(/-[0-9a-f]{6}$/i, '');
      if (!original || original === row.number) continue;

      const holder = db
        .prepare(`SELECT id FROM orders WHERE number = ? AND id <> ?`)
        .get(original, row.id) as { id: string } | undefined;

      if (holder) {
        const lines = db
          .prepare(`SELECT COUNT(*) AS c FROM order_lines WHERE order_id = ?`)
          .get(holder.id) as { c?: number };
        // Only remove the duplicate if it is an empty server seed row.
        if (Number(lines?.c ?? 0) > 0) continue;
        db.prepare(`DELETE FROM orders WHERE id = ?`).run(holder.id);
      }

      db.prepare(`UPDATE orders SET number = ? WHERE id = ?`).run(
        original,
        row.id
      );
      console.log('[repair] restored order number', {
        from: row.number,
        to: original,
      });
    }

    setMeta('repair.order_sync_v1', 'done');
    console.log('[repair] order sync damage repaired', {
      numericStatuses: numeric.length,
      mangledNumbers: mangled.length,
    });
  } catch (e) {
    console.error('[repair] order sync repair failed:', e);
  }
}

/**
 * One-time guard for the temp_id cut-over.
 *
 * Before we sent `temp_id`, the server ignored our `id` and minted its own
 * ULID for every push — so orders pushed then are stored under a key neither
 * side can map back. The backend is explicit: do NOT replay that outbox, since
 * a re-push creates a duplicate of a real sale rather than matching it.
 *
 * Anything queued at the moment of upgrade is therefore flagged and excluded
 * from the automatic push. The count is logged and kept in meta so it can be
 * reconciled against the server ledger deliberately, rather than silently
 * resent or silently dropped.
 */
export function guardLegacyOutbox() {
  if (getMeta('repair.temp_id_cutover') === 'done') return;

  try {
    const rows = db
      .prepare(
        `SELECT o.id, o.number, o.grand_total
           FROM orders o
          WHERE (o.synced_at IS NULL OR o.synced_at = 0)
            AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)`
      )
      .all() as Array<{ id: string; number: string; grand_total: number }>;

    if (rows.length) {
      const stmt = db.prepare(`UPDATE orders SET push_legacy = 1 WHERE id = ?`);
      const tx = db.transaction(() => rows.forEach((r) => stmt.run(r.id)));
      tx();
      console.warn(
        `[repair] ${rows.length} pre-temp_id order(s) held back from push — ` +
          `reconcile against the server ledger before releasing them.`,
        rows.map((r) => r.number)
      );
      setMeta('outbox.legacy_held', String(rows.length));
      setMeta('outbox.legacy_numbers', JSON.stringify(rows.map((r) => r.number)));
    } else {
      setMeta('outbox.legacy_held', '0');
    }

    setMeta('repair.temp_id_cutover', 'done');
  } catch (e) {
    console.error('[repair] legacy outbox guard failed:', e);
  }
}

/**
 * One-time repair for dine-in orders finished with "Close & Release" before it
 * re-pushed. That path marked them completed locally but left them stamped as
 * synced, so the server kept them open and their tables busy, and every sync
 * turned those tables red again. It also never set closed_at, which keeps
 * them off the closing report.
 *
 * Re-queued by temp_id; the backend matches the order and its lines by id, so
 * this closes the existing server order rather than duplicating it.
 */
export function repairUnsentReleasedTables() {
  if (getMeta('repair.release_table_repush_v1') === 'done') return;

  try {
    const hasClosedAt = hasColumn('orders', 'closed_at');
    const hasCompletedAt = hasColumn('orders', 'completed_at');
    const tx = db.transaction(() => {
      const closed = hasClosedAt
        ? db
            .prepare(
              `UPDATE orders
                  SET closed_at = ${hasCompletedAt ? 'COALESCE(completed_at, updated_at)' : 'updated_at'}
                WHERE order_type = 3 AND status = 'completed' AND closed_at IS NULL`
            )
            .run().changes
        : 0;
      // synced_at is in seconds, updated_at in milliseconds. A completed order
      // changed after its last push never told the server it was finished.
      const requeued = db
        .prepare(
          `UPDATE orders SET synced_at = NULL
            WHERE order_type = 3 AND status = 'completed'
              AND COALESCE(push_legacy, 0) = 0
              AND synced_at IS NOT NULL AND synced_at > 0
              AND updated_at > synced_at * 1000 + 1000`
        )
        .run().changes;
      return { closed, requeued };
    });
    const result = tx();
    setMeta('repair.release_table_repush_v1', 'done');
    console.log('[repair] released dine-in orders re-queued for push', result);
  } catch (e) {
    console.error('[repair] release-table repush repair failed:', e);
  }
}

export function getMeta(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(key) as any;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string | null) {
  if (value === null) {
    db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  } else {
    db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  }
}

export function nowMs() {
  return Date.now();
}

export function isPosLocked(): boolean {
  const v = getMeta('pos.locked');
  return v === '1' || v === 1 || v === true || v === 'true';
}

/** Meta keys that together make the device "paired" and signed in. */
const PAIRING_META_KEYS = [
  'server.base_url',
  'server.device_id',
  'device_id',
  'device_token',
  'branch.id',
  'branch_id',
  'branch.name',
  'auth.user_id',
  'auth.session_id',
  'tmp.device_name',
  'tmp.branch_id',
  'pos.current_user_id',
  'pos.current_user_json',
];

/**
 * Sign out and forget the pairing, without touching the app process.
 * The renderer's AuthedGate sees `paired: false` on its next status poll and
 * routes to the Pair screen.
 */
export function clearAuthAndPairing(reason: string) {
  try {
    db.prepare(
      `UPDATE auth_sessions SET ended_at = ? WHERE ended_at IS NULL`
    ).run(Date.now());
  } catch {
    // auth_sessions may not exist yet on a very first boot
  }

  for (const key of PAIRING_META_KEYS) setMeta(key, '');

  // device_token normally lives in keytar, not meta
  void Promise.resolve(deleteSecret('device_token')).catch((err) =>
    console.error('[pos] Failed clearing device token:', err)
  );

  setMeta('pos.unpaired_reason', reason);
  setMeta('pos.unpaired_at', String(Date.now()));
  console.log('[pos] Device unpaired locally. reason=', reason);
}

export type PosLockOutcome =
  | { action: 'none' }
  | { action: 'locked'; reason: 'server_locked' | 'offline_too_long' }
  | { action: 'unpaired'; reason: 'device_revoked' };

/**
 * Evaluate the device lock state.
 *
 * A lock is REVERSIBLE and must never destroy data. Per the backend contract
 * (docs/BACKEND-QUESTIONS.md §6.4), HTTP 423 comes from either an admin
 * pressing Lock, or the staleness killswitch firing on a till that was simply
 * switched off over a holiday. Both are cleared by an admin pressing Unlock,
 * and the same token then resumes — so the local catalog and, critically, the
 * unsynced outbox must survive. Wiping there destroys real revenue.
 *
 * Only an explicitly revoked device (HTTP 401 "Device revoked", `is_active`
 * false) is permanent, and that path is handled by markDeviceRevoked().
 */
export function enforcePosLockKillSwitch(): PosLockOutcome {
  if (isPosLocked()) {
    console.log('[pos] Device is LOCKED — halting sync, keeping all local data.');
    return { action: 'locked', reason: 'server_locked' };
  }

  // Local staleness mirror of the server killswitch. Same rule: lock the till,
  // never wipe it — the server will confirm on the next successful contact.
  const killDays = Number(getMeta('security.kill_after_days') || 0);
  const lastOnlineAt = Math.max(
    Number(getMeta('sync.last_at') || 0),
    Number(getMeta('bootstrap.last_at') || 0)
  );

  if (killDays > 0 && lastOnlineAt > 0) {
    const offlineMs = Date.now() - lastOnlineAt;
    if (offlineMs > killDays * 24 * 60 * 60 * 1000) {
      console.log('[pos] Offline too long → locking till (data preserved).', {
        lastOnlineAt,
        offlineMs,
        maxDays: killDays,
      });
      setMeta('pos.locked', '1');
      setMeta('pos.lock_reason', 'offline_too_long');
      return { action: 'locked', reason: 'offline_too_long' };
    }
  }

  return { action: 'none' };
}

/**
 * HTTP 401 "Device revoked" — the kill command from the back office, and the
 * only permanent state. The till is unpaired and its restaurant data deleted,
 * so a removed machine keeps neither the menu, the staff logins nor the sales.
 * Unsent orders are written to a backup file first (see backupUnsentOrders),
 * since a revoked token can no longer deliver them.
 *
 * A lock (423) is not this: it is reversible and never reaches here.
 */
export function markDeviceRevoked(): PosLockOutcome {
  console.warn('[pos] Device REVOKED by server → unpairing and clearing data.');
  // Data first, so the backup can still name the device it came from.
  clearRestaurantData('device_revoked');
  clearAuthAndPairing('device_revoked');
  return { action: 'unpaired', reason: 'device_revoked' };
}

/**
 * Locks this function is allowed to lift. Every caller reaches here off the
 * server's `device.locked_at` being null, which speaks only for the device —
 * so a lock the device state knows nothing about must not be cleared by it.
 *
 * 'branch_removed' is exactly that case: the device row is alive and
 * unlocked, but the branch it sells for was deleted upstream. Letting the
 * device check clear it would unlock the till on the very next sync tick and
 * put it straight back to selling for a shop that no longer exists. It is
 * lifted by the /pull feed instead, when the branch reappears.
 */
const DEVICE_OWNED_LOCK_REASONS = ['', 'server_locked', 'offline_too_long'];

/** Cleared by an admin unlock, confirmed on the next successful sync. */
export function clearPosLock() {
  const reason = String(getMeta('pos.lock_reason') ?? '');
  if (isPosLocked() && !DEVICE_OWNED_LOCK_REASONS.includes(reason)) {
    console.log('[pos] Lock held — not device-owned.', { reason });
    return;
  }

  if (getMeta('pos.locked') === '1') {
    console.log('[pos] Lock cleared by server.');
  }
  setMeta('pos.locked', '0');
  setMeta('pos.lock_reason', '');
  setMeta('pos.locked_at', '');
}

/**
 * Which restaurant the rows in this database belong to: server + branch.
 *
 * Kept apart from the pairing keys on purpose — unpairing forgets how to talk
 * to the server but leaves the data, so this is the only way the next pairing
 * can tell "same shop again" from "this PC now belongs to someone else".
 */
const DATA_OWNER_KEY = 'pos.data_owner';

export function dataOwnerFor(
  baseUrl: string,
  branchId: string | number | null | undefined
): string {
  const base = String(baseUrl ?? '').trim().toLowerCase().replace(/\/+$/, '');
  return `${base}|${String(branchId ?? '').trim()}`;
}

export function getDataOwner(): string {
  return String(getMeta(DATA_OWNER_KEY) ?? '');
}

export function setDataOwner(owner: string) {
  setMeta(DATA_OWNER_KEY, owner);
}

/**
 * Stamp the owner on a till that is paired but predates the key, so a later
 * unpair still knows whose data it is holding.
 */
export function backfillDataOwner() {
  if (getDataOwner()) return;
  const base = getMeta('server.base_url') || '';
  const branch = getMeta('branch_id') || getMeta('branch.id') || '';
  if (base && branch) setDataOwner(dataOwnerFor(base, branch));
}

/**
 * Tables that hold one restaurant's data. Children before parents, so the
 * deletes never trip a foreign key.
 */
const RESTAURANT_TABLES = [
  // A queued mark names another restaurant's server order id; sent to the
  // next shop's server it would mark the wrong order paid.
  'order_paid_actions',
  // Another branch's days; End day queued for the previous shop's server.
  'business_days',
  'day_close_actions',
  'order_lines_pending',
  'sync_failed_changes',
  'order_lines',
  'active_orders',
  'orders',
  'promo_item_exclusions',
  'item_addon_groups',
  'addons',
  'addon_groups',
  'variations',
  'items',
  'subcategories',
  'categories',
  'promos',
  'payment_methods',
  'tables',
  'blocks',
  'cities',
  'states',
  'auth_sessions',
  'pos_users',
  'pos_role_permissions',
];

/**
 * Forget the previous restaurant before this PC starts selling for another.
 *
 * Without this the old catalog and staff stayed behind after an unpair: the
 * new bootstrap collided with them on UNIQUE columns (payment method slugs,
 * promo codes) and rolled back, and an old user sharing an email with a new
 * one answered the login first. app_settings is deliberately kept — printers
 * and drawer setup belong to the machine, and bootstrap refreshes the rest.
 */
export function clearRestaurantData(reason: string) {
  backupUnsentOrders(reason);

  const present = new Set(
    (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
  );

  db.transaction(() => {
    for (const table of RESTAURANT_TABLES) {
      if (present.has(table)) db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare(
      `DELETE FROM sync_state WHERE key IN ('cursor', 'permissions.source', 'paid.supported')`
    ).run();
    for (const key of [
      'branch.profile',
      'outbox.legacy_held',
      'outbox.legacy_numbers',
      'sync.last_at',
      'bootstrap.last_at',
      'pos.locked',
      'pos.lock_reason',
      'pos.locked_at',
    ]) {
      setMeta(key, '');
    }
  })();

  // Nothing left to own. The next pairing starts clean whichever shop it is.
  setDataOwner('');
  console.warn('[pos] Local restaurant data cleared. reason=', reason);
}

/**
 * SQL for "this till rang the order up": a local sale has a UUID id, a server
 * order (web, partner, or another till's sale arriving over /pull) has the
 * server's integer id. Same rule as isOwnOrder() in paidMarks.ts.
 *
 * Only own orders belong in the outbox. A pulled order never gets synced_at
 * stamped, and its status label can be 'ready' (server code 3), which is also
 * a pushable local status, so without this every other till's ready order
 * would be pushed back up under its server id and counted as unsent here.
 */
export function ownOrderSql(alias: string): string {
  return `${alias}.id GLOB '*[^0-9]*'`;
}

/**
 * Write every order the server never acknowledged to a file before a wipe.
 *
 * A wipe can be ordered from the back office or ticked by someone at the
 * counter who did not notice the pending count. Either way the sales are real
 * money; a JSON file in the app's data folder is what lets support recover
 * them instead of reconstructing a day's takings from memory.
 */
function backupUnsentOrders(reason: string) {
  try {
    const orders = db
      .prepare(
        `SELECT * FROM orders o
          WHERE (o.synced_at IS NULL OR o.synced_at = 0)
            AND ${ownOrderSql('o')}
            AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)`
      )
      .all() as Array<{ id: string }>;
    if (!orders.length) return;

    const lines = db.prepare(`SELECT * FROM order_lines WHERE order_id = ?`);
    const dir = path.join(app.getPath('userData'), 'unsent-backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `unsent-orders-${Date.now()}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          reason,
          saved_at: new Date().toISOString(),
          owner: getDataOwner(),
          device_id: getMeta('device_id'),
          orders: orders.map((o) => ({ ...o, lines: lines.all(o.id) })),
        },
        null,
        2
      )
    );
    console.warn(`[pos] ${orders.length} unsent order(s) saved to ${file}`);
  } catch (e) {
    // A failed backup must not stop a revoke from taking effect.
    console.error('[pos] unsent order backup failed:', e);
  }
}

/** Orders the server has not received yet, as the push counts them. */
export function countUnsentOrders(): number {
  return Number(
    db
      .prepare(
        `SELECT COUNT(*) FROM orders o
          WHERE (o.synced_at IS NULL OR o.synced_at = 0)
            AND COALESCE(o.push_legacy, 0) = 0
            AND ${ownOrderSql('o')}
            AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)`
      )
      .pluck()
      .get() ?? 0
  );
}

export function getCurrentUserId(): string | null {
  // set this in your login flow: setMeta('pos.current_user_id', user.id)
  return (getMeta('pos.current_user_id') as string) || null;
}

export function logPosAction(
  action: string,
  orderId?: string | null,
  meta: any = {}
): void {
  const userId = getCurrentUserId();
  const stmt = db.prepare(`
    INSERT INTO pos_action_log (id, order_id, user_id, action, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    crypto.randomUUID(),
    orderId ?? null,
    userId ?? null,
    action,
    meta ? JSON.stringify(meta) : null,
    nowMs()
  );
}

// Simple transaction helper (better-sqlite3)
export function withTxn<T>(fn: () => T): T {
  const txn = db.transaction(fn);
  return txn();
}

// Convenience fetcher
export function getOrderById(orderId: string) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
}

export function getSetting(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as any;
  return row?.value ?? null;
}

export default db;
