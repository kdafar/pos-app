import path from 'node:path';
import { app } from 'electron';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

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
  `);

  // Phase 2: ensure columns exist on legacy installs (safe ALTER TABLE order matters)
  ensureColumn('items', 'branch_id INTEGER', 'branch_id');
  ensureColumn('items', 'type TEXT', 'type');
  ensureColumn('items', 'image TEXT', 'image');
  ensureColumn('items', 'has_variations INTEGER DEFAULT 0', 'has_variations');
  ensureColumn('items', 'size TEXT', 'size');
  ensureColumn('items', 'has_addons INTEGER DEFAULT 0', 'has_addons');

  ensureColumn('payment_methods', 'updated_at TEXT', 'updated_at');

  ensureColumn('tables', 'updated_at TEXT', 'updated_at');

  ensureColumn('states', 'updated_at TEXT', 'updated_at');
  ensureColumn('cities', 'updated_at TEXT', 'updated_at');
  ensureColumn('blocks', 'updated_at TEXT', 'updated_at');
  ensureColumn('app_settings', 'updated_at TEXT', 'updated_at');
  ensureColumn('pos_users', 'mobile TEXT', 'mobile');
  ensureColumn('promos', 'max_discount REAL', 'max_discount');

  ensureColumn('orders', 'status_code INTEGER', 'status_code');
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
  ensureColumn('orders', 'table_id TEXT', 'table_id');
  ensureColumn('orders', 'covers INTEGER', 'covers');
  ensureColumn('orders', 'delivery_fee REAL DEFAULT 0', 'delivery_fee');

  ensureColumn('orders', 'printed_at INTEGER', 'printed_at'); // ms since epoch
  ensureColumn('orders', 'is_locked INTEGER DEFAULT 0', 'is_locked');
  ensureColumn('orders', 'user_id INTEGER', 'user_id'); // who completed/printed

  // ---- image cache fields on items
  ensureColumn('items', 'image_local TEXT', 'image_local'); // absolute local path
  ensureColumn('items', 'image_etag TEXT', 'image_etag'); // optional: server ETag
  ensureColumn('items', 'image_mtime INTEGER', 'image_mtime');

  ensureColumn('orders', 'created_by_user_id TEXT', 'created_by_user_id');
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
