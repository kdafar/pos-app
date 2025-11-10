import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';
import { readOrCreateMachineId } from './machineId';

import { registerAppImgProtocol } from './protocols';
import type { Database as BetterSqliteDB } from 'better-sqlite3'

// DB + meta
import db, { getMeta, migrate, setMeta } from './db';
import { saveSecret, loadSecret } from './secureStore';
import { registerOperationalReportHandlers } from './handlers/reports_operational';
// Sync core
import { bootstrap, configureApi, pairDevice, pullChanges, pushOutbox } from './sync';
import { registerAuthHandlers } from './handlers/auth';

// Optional socket server (kept from your file)
import { createSocketServer } from './socket';

process.env.APP_ROOT = path.join(__dirname, '../..');

async function boot() {
  try {
    migrate();
    console.log('[db] migrate done');
  } catch (e) {
    console.error('[db] migrate failed', e);
  }
}

app.whenReady().then(boot);

// --- FIX: Register protocols BEFORE the app 'ready' event ---
// This resolves the "registerSchemesAsSecure should be run before app:ready" error.
registerAppImgProtocol();
registerOperationalReportHandlers();
async function createWindow() {
  migrate();

  if (getMeta('pos.mode') == null) setMeta('pos.mode', 'live')
  if (getMeta('sync.disabled') == null) setMeta('sync.disabled', '0')

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'), // ← .js in build
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    await win.loadURL(devUrl)
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.once('ready-to-show', () => win.show())
}

// ---- lightweight store wrapper for handlers ----
const store = {
  get: (k: string) => getMeta(k),
  set: (k: string, v: any) => setMeta(k, v),
  delete: (k: string) => setMeta(k, null), // your setMeta treats null as “unset”
};

/* ========== Settings helpers (unified) ========== */
function readSettingRaw(key: string): string | null {
  // 1) Try app_settings
  const fromApp = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).pluck().get(key);
  if (fromApp !== undefined && fromApp !== null) return String(fromApp);

  // 2) Fallbacks: meta (direct) then meta with settings.* prefix
  const direct = getMeta(key);
  if (direct !== undefined && direct !== null) return String(direct);

  const prefixed = getMeta(`settings.${key}`);
  return prefixed !== undefined && prefixed !== null ? String(prefixed) : null;
}
function readSettingBool(key: string, fallback = false): boolean {
  const v = (readSettingRaw(key) ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || (v === '' ? fallback : false);
}
function readSettingNumber(key:string, fallback = 0): number {
  const n = Number(readSettingRaw(key));
  return Number.isFinite(n) ? n : fallback;
}


// ----- order number helpers (unique, device-scoped) -----
type NumberStyle = 'short' | 'mini';
function getOrderNumberStyle(): NumberStyle {
  const raw = (readSettingRaw('orders.number_style') ?? 'short').toString().toLowerCase();
  return raw === 'mini' ? 'mini' : 'short';
}

function getOrderNumberPrefix(): string {
  const p = (readSettingRaw('orders.number_prefix') ?? 'POS').toString().trim();
  return p || 'POS';
}

function randBase36(len: number): string {
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2).toUpperCase();
  return s.slice(0, len);
}

function deviceSuffix(): string {
  const d = getMeta('device_id') || 'LOCAL';
  return String(d).slice(-4).toUpperCase();
}

function genCandidateNumber(): string {
  const style = getOrderNumberStyle();        // 'short' | 'mini'
  const prefix = getOrderNumberPrefix();        // default 'POS'
  const dev = deviceSuffix();                  // last 4 of device id

  if (style === 'mini') {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    
    // --- FIX: Original code (return `${prefix}-${ymd}${dev.slice(0, 2)}`;)
    // --- caused collisions for devices with the same 2-char prefix on the same day.
    // --- Adding 2 random chars to prevent this.
    const rand = randBase36(2);
    // Example: POS-20251109-QH-AB (where QH is dev, AB is random)
    return `${prefix}-${ymd}${dev.slice(0, 2)}${rand}`;
  }

  // Default 'short' – Example: POS-QHHC3NTK
  const rand = randBase36(4);
  return `${prefix}-${dev}${rand}`;
}

function allocUniqueOrderNumber(): string {
  for (let i = 0; i < 6; i++) {
    const n = genCandidateNumber();
    const exists = db.prepare('SELECT 1 FROM orders WHERE number = ? LIMIT 1').get(n);
    if (!exists) return n;
  }
  // ultra-rare fallback: add a high-res counter
  const n = `POS-${Date.now()}-${process.hrtime.bigint().toString().slice(-6)}-${deviceSuffix()}`;
  return n;
}

/** Before bootstrap, fix any duplicate local numbers to avoid UNIQUE(number) crashes */
function normalizeDuplicateOrderNumbers(): void {
  try {
    const dups = db.prepare(`
      SELECT number FROM orders
      GROUP BY number HAVING COUNT(*) > 1
    `).all() as Array<{ number: string }>;

    for (const { number } of dups) {
      const rows = db.prepare(`
        SELECT id FROM orders WHERE number = ? ORDER BY created_at ASC, rowid ASC
      `).all(number) as Array<{ id: string }>;
      // keep the first row as-is, re-number the rest
      for (let i = 1; i < rows.length; i++) {
        const newNum = allocUniqueOrderNumber();
        db.prepare(`UPDATE orders SET number = ? WHERE id = ?`).run(newNum, rows[i].id);
      }
    }
  } catch { /* no-op */ }
}

app.on('ready', () => {
  migrate();

  if (getMeta('pos.mode') == null) setMeta('pos.mode', 'live');
  if (getMeta('sync.disabled') == null) setMeta('sync.disabled', '0');
  if (getMeta('pos.locked') == null) setMeta('pos.locked', '0');
  if (getMeta('security.kill_after_days') == null) setMeta('security.kill_after_days', '14');

  // Fix existing duplicates first
  normalizeDuplicateOrderNumbers();
  // Then install dedupe guards
  ensureOrderNumberDedupeTriggers();

  createWindow();
  createSocketServer();
  startAutoSyncLoop();
  // --- REMOVED: Moved this call to before the 'ready' event ---
  // registerAppImgProtocol();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ======================================================================
    Helpers
    ====================================================================== */

const nowMs = () => Date.now();

function ensureOrderNumberDedupeTriggers() {
  try {
    // This (unusual) trigger pattern "kicks" existing rows off a number
    // to allow the new insert to claim it.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tr_orders_num_dedupe_ins
      BEFORE INSERT ON orders
      WHEN EXISTS (
        SELECT 1 FROM orders WHERE number = NEW.number AND id <> NEW.id
      )
      BEGIN
        UPDATE orders
        SET number = 'L-' || NEW.number || '-' || LOWER(HEX(RANDOMBLOB(3)))
        WHERE number = NEW.number AND id <> NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS tr_orders_num_dedupe_upd
      BEFORE UPDATE OF number ON orders
      WHEN NEW.number IS NOT NULL AND EXISTS (
        SELECT 1 FROM orders WHERE number = NEW.number AND id <> NEW.id
      )
      BEGIN
        UPDATE orders
        SET number = 'L-' || NEW.number || '-' || LOWER(HEX(RANDOMBLOB(3)))
        WHERE number = NEW.number AND id <> NEW.id;
      END;
    `);

    // Hard guard (will succeed after normalizeDuplicateOrderNumbers)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique ON orders(number)`);
  } catch (e: any) {
    console.warn('ensureOrderNumberDedupeTriggers failed:', e?.message);
  }
}

function hasColumn(table: string, column: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some(c => c.name === column);
  } catch { return false; }
}

function getOrderRow(orderId: string) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
}

function getOrderCityId(order: any): string | null {
  // Prefer persisted city_id on the order; otherwise fall back to cart meta (useful for open orders)
  const cid = order?.city_id ?? null;
  if (cid != null && cid !== '') return String(cid);
  const metaCid = getMeta('cart.city_id');
  return metaCid ? String(metaCid) : null;
}

function getDeliveryFeeForCity(cityId: string | null): number {
  if (!cityId) return 0;
  const row = db.prepare(`SELECT delivery_fee FROM cities WHERE id = ?`).get(cityId) as any;
  const fee = Number(row?.delivery_fee ?? 0);
  return Number.isFinite(fee) ? fee : 0;
}

type PromoRow = {
  id: string; code: string; type: 'percent'|'amount';
  value: number; min_total?: number|null; max_discount?: number|null;
  start_at?: string|null; end_at?: string|null; active?: number|null;
};

function resolvePromoByCode(code: string | null): PromoRow | null {
  if (!code) return null;
  const row = db.prepare(`
    SELECT id, code, type, value, min_total, max_discount, start_at, end_at, active
    FROM promos
    WHERE UPPER(code) = UPPER(?) AND active = 1
    LIMIT 1
  `).get(code) as PromoRow | undefined;

  if (!row) return null;

  // Date window check (tolerant of nulls)
  const now = Date.now();
  const startsOk = !row.start_at || (new Date(row.start_at).getTime() <= now);
  const endsOk   = !row.end_at   || (new Date(row.end_at).getTime()   >= now);
  return (startsOk && endsOk) ? row : null;
}

function computePromoDiscount(subtotal: number, promo: PromoRow | null): number {
  if (!promo) return 0;

  const minTotal   = Number(promo.min_total ?? 0);
  if (subtotal < minTotal) return 0;

  let discount = 0;
  if (promo.type === 'percent') {
    discount = subtotal * (Number(promo.value || 0) / 100);
  } else {
    discount = Number(promo.value || 0);
  }

  const cap = Number(promo.max_discount ?? 0);
  if (Number.isFinite(cap) && cap > 0) discount = Math.min(discount, cap);

  // clamp and round to 3 decimals for KWD-like currencies
  discount = Math.max(0, Math.min(discount, subtotal));
  return +discount.toFixed(3);
}

function computeDeliveryFee(order: any): number {
  // Only for delivery orders (order_type === 1)
  if (Number(order?.order_type) !== 1) return 0;

  // --- MODIFIED: Make this logic more robust ---
  // 1. Check for a persisted flag on the order itself.
  // This prevents completed orders from changing fee status later.
  if (Number(order?.void_delivery_fee) === 1) return 0;

  // 2. Fallback to 'cart' meta (for live cart/open order context)
  // This is the original behavior, now as a fallback.
  const voidFeeMeta = (getMeta('cart.void_delivery_fee') || '') === '1';
  if (voidFeeMeta) return 0;
  // --- End of modification ---

  const cityId = getOrderCityId(order);
  return getDeliveryFeeForCity(cityId);
}

/** Multiple orders tabs helper (best effort; table may not exist on old DBs) */
function safeAddToActiveOrders(orderId: string) {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO active_orders(order_id, tab_position, last_accessed)
      VALUES(?, COALESCE((SELECT COALESCE(MAX(tab_position), -1)+1 FROM active_orders), 0), ?)
    `).run(orderId, nowMs());
  } catch { /* ignore if table missing */ }
}

/** Build a server-friendly order payload including lines. */
function buildOrderPayload(orderId: string) {
  const o = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  if (!o) return null;
  const lines = db.prepare(`
    SELECT id, order_id, item_id, name, name_ar, qty, unit_price, tax_amount, line_total,
           variation_id, variation, variation_price, addons_id, addons_name, addons_price, addons_qty, notes
    FROM order_lines WHERE order_id = ?
    ORDER BY rowid ASC
  `).all(orderId);

  // Generic, POS-controller friendly envelope (fields are descriptive & stable)
  return {
    id: o.id,
    number: o.number,
    device_id: o.device_id,
    branch_id: o.branch_id,
    status: o.status,
    order_type: o.order_type,       // 1=delivery, 2=pickup, 3=dine-in
    customer: {
      full_name: o.full_name,
      mobile: o.mobile,
      email: o.email,
    },
    address: {
      state_id: o.state_id,
      city_id: o.city_id,
      block_id: o.block_id,
      block: o.block,
      address_type: o.address_type,
      address: o.address,
      building: o.building,
      floor: o.floor,
      house_no: o.house_no,
      landmark: o.landmark,
      table_id: o.table_id,      // dine-in
      delivery_date: o.delivery_date,
    },
    payment: {
      method_id: o.payment_method_id,
      method_slug: o.payment_method_slug,
      type: o.payment_type,
      promocode: o.promocode,
    },
    totals: {
      subtotal: o.subtotal,
      tax_total: o.tax_total,
      discount_total: o.discount_total,
      delivery_fee: o.delivery_fee,
      grand_total: o.grand_total,
      discount_amount: o.discount_amount,
      discount_pr: o.discount_pr,
    },
    timestamps: {
      opened_at: o.opened_at,
      closed_at: o.closed_at,
      created_at: o.created_at,
      updated_at: o.updated_at,
    },
    lines,
  };
}

/** Collect unsynced completed orders (synced_at IS NULL/0) */
function collectUnsyncedOrders(limit = 20) {
  const rows = db.prepare(`
    SELECT id
    FROM orders
    WHERE status = 'completed' AND (synced_at IS NULL OR synced_at = 0)
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as Array<{ id: string }>;

  const payloads: any[] = [];
  for (const r of rows) {
    const p = buildOrderPayload(r.id);
    if (p) payloads.push(p);
  }
  return payloads;
}

/** Mark a batch of orders as synced (best effort). */
function markOrdersSynced(orderIds: string[]) {
  if (!orderIds.length) return;
  const now = nowMs();
  const stmt = db.prepare(`UPDATE orders SET synced_at = ? WHERE id = ?`);
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) stmt.run(now, id);
  });
  tx(orderIds);
}

/** Recalc totals whenever needed */
function recalcOrderTotals(orderId: string) {
  const sums = db.prepare(`
    SELECT COALESCE(SUM(line_total), 0) AS subtotal
    FROM order_lines
    WHERE order_id = ?
  `).get(orderId) as { subtotal: number };

  const order = getOrderRow(orderId);
  const subtotal = Number(sums?.subtotal || 0);

  // Promo applies to SUBTOTAL ONLY (not delivery fee)
  const promo = resolvePromoByCode(order?.promocode ?? null);
  const discount_total = computePromoDiscount(subtotal, promo);

  // Delivery fee comes from order city if it's a delivery order
  const delivery_fee = computeDeliveryFee(order);

  // (Tax is 0 for now; add here later if you introduce settings.tax_rate_pr)
  const tax_total = 0;

  const grand_total = +(subtotal - discount_total + delivery_fee).toFixed(3);

  db.prepare(`
    UPDATE orders
    SET subtotal = ?, tax_total = ?, discount_total = ?, delivery_fee = ?, grand_total = ?
    WHERE id = ?
  `).run(subtotal, tax_total, discount_total, delivery_fee, grand_total, orderId);

  return { subtotal, tax_total, discount_total, delivery_fee, grand_total };
}


/* ======================================================================
    IPC: KV + Settings
    ====================================================================== */

ipcMain.handle('store:set', async (_e, key: string, value: string) => {
  if (key === 'device_token') return saveSecret('device_token', value);
  setMeta(key, value);
});
ipcMain.handle('store:get', async (_e, key: string) => {
  if (key === 'device_token') return loadSecret('device_token');
  return getMeta(key) ?? null;
});

ipcMain.handle('settings:get', async (_e, key: string) => readSettingRaw(key));
ipcMain.handle('settings:getBool', async (_e, key: string, fallback = false) => readSettingBool(key, fallback));
ipcMain.handle('settings:getNumber', async (_e, key: string, fallback = 0) => readSettingNumber(key, fallback));

// Handler for 'settings:all'
const getAllSettings = async () => {
  return db.prepare(`SELECT key, value FROM app_settings ORDER BY key ASC`).all();
};
ipcMain.handle('settings:all', getAllSettings);

// --- ADDED: Handler for 'settings:getAll' (aliases 'settings:all') ---
ipcMain.handle('settings:getAll', getAllSettings);

// --- ADDED: Handler for 'settings:getPosUser' ---
ipcMain.handle('settings:getPosUser', async () => {
    // V_TODO: Return actual user data if/when available
    // For now, returning device/branch context
    return {
        name: readSettingRaw('pos.user_name') ?? 'POS User',
        id: readSettingRaw('pos.user_id') ?? null,
        deviceId: getMeta('device_id') ?? null,
        branchName: getMeta('branch.name') ?? null,
        branchId: Number(getMeta('branch_id') ?? 0),
    };
});

const qGetOrder = db.prepare(`
    SELECT o.*
    FROM orders o
    WHERE o.id = ?
    LIMIT 1
  `)

// ---
// --- FIX: This was the source of the crash.
// --- The `tables` table likely has `label` and `number` columns, not `name`.
// --- This is based on the `tables:list` handler later in this file.
// ---
  const qTableName = db.prepare(`SELECT COALESCE(label, 'Table '||number) AS name FROM tables WHERE id = ? LIMIT 1`)

// ---
// --- FIX: This was also crashing for the same reason.
// --- Changed `t.name` to `COALESCE(t.label, 'Table '||t.number) AS name`.
// ---
  const qListTables = db.prepare(`
    SELECT t.id, COALESCE(t.label, 'Table '||t.number) AS name, t.capacity AS seats,
      CASE
        WHEN EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status IN ('open','hold')) THEN 'occupied'
        ELSE 'available'
      END AS status
    FROM tables t
    ORDER BY name COLLATE NOCASE
  `)


function getCurrentUserId(services: Services): number | null {
  const id = services.store.get('auth.user_id')
  return id != null ? Number(id) : null
}

type Services = {
  store: { get(k: string): any; set(k: string, v: any): void; delete(k: string): void }
}

function now() { return Date.now() }

function logAction(db: BetterSqliteDB, orderId: string, action: string, payload: any, userId: number | null) {
  db.prepare(
    `INSERT INTO pos_action_log (order_id, action, payload, performed_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, action, JSON.stringify(payload ?? null), userId, now())
}

  ipcMain.handle('orders:markPrinted', (_e, orderId: string) => {
    const userId = getCurrentUserId(services)
    const order = qGetOrder.get(orderId) as any
    if (!order) throw new Error('Order not found')

    const tx = db.transaction(() => {
      db.prepare(`UPDATE orders SET printed_at=?, printed_by_user_id=?, is_locked=1, updated_at=? WHERE id=?`)
        .run(now(), userId, now(), orderId)
      logAction(db, orderId, 'orders:markPrinted', {}, userId)
    })
    tx()

    return { ok: true }
  })

  ipcMain.handle('orders:paymentLink:set', (_e, orderId: string, url: string) => {
    const userId = getCurrentUserId(services)
    const order = qGetOrder.get(orderId) as any
    if (!order) throw new Error('Order not found')

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET payment_link_url=?, payment_link_status=?, payment_link_verified_at=NULL, updated_at=?
        WHERE id=?
      `).run(url, 'pending', now(), orderId)
      logAction(db, orderId, 'orders:paymentLink:set', { url }, userId)
    })
    tx()

    return { ok: true, url }
  })

    ipcMain.handle('orders:paymentLink:status', (_e, orderId: string, status: string) => {
    const userId = getCurrentUserId(services)
    const order = qGetOrder.get(orderId) as any
    if (!order) throw new Error('Order not found')

    const isPaid = ['paid', 'captured', 'success'].includes((status || '').toLowerCase())
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET payment_link_status=?, payment_link_verified_at=?, updated_at=?
        WHERE id=?
      `).run(status, isPaid ? now() : null, now(), orderId)
      logAction(db, orderId, 'orders:paymentLink:status', { status }, userId)
    })
    tx()

    return { ok: true }
  })
/* ======================================================================
    IPC: Sync configure / pair / status / run / pull / push
    ====================================================================== */

ipcMain.handle('sync:configure', async (_e, baseUrl: string) => {
  const device_id = getMeta('device_id') ?? '';
  const branch_id = Number(getMeta('branch_id') ?? 0);
  const token = await loadSecret('device_token');
  if (!device_id || !token) throw new Error('Not paired');

  setMeta('server.base_url', baseUrl);
  configureApi(baseUrl, { id: device_id, branch_id }, token);
});

ipcMain.handle('sync:pair', async (_e, baseUrl: string, pairCode: string, branchId: string, deviceName: string) => {
  const mid = await readOrCreateMachineId();
  setMeta('machine_id', mid);
  return pairDevice(baseUrl, pairCode, branchId, deviceName, mid);
});

ipcMain.handle('sync:bootstrap', async (_e, baseUrl?: string) => {
  ensureOrderNumberDedupeTriggers();
  const url = baseUrl || getMeta('server.base_url') || '';
  if (!url) throw new Error('Missing base URL');

  const payload = await bootstrap(url);

  // persist branch meta if present
  if (payload?.branch?.id) setMeta('branch_id', String(payload.branch.id));
  if (payload?.branch?.name) setMeta('branch.name', String(payload.branch.name));

  // ⬇️ upsert staff users from backend
  const users = payload?.catalog?.users || [];
  if (Array.isArray(users) && users.length) {
    const upsert = db.prepare(`
      INSERT INTO pos_users (id, name, username, email, role, password_hash, is_active, branch_id, updated_at)
      VALUES (@id, @name, NULL, @email, @role, @password_hash, @is_active, @branch_id, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        email=excluded.email,
        role=excluded.role,
        password_hash=excluded.password_hash,
        is_active=excluded.is_active,
        branch_id=excluded.branch_id,
        updated_at=excluded.updated_at
    `);
    const tx = db.transaction((list: any[]) => { for (const u of list) upsert.run(u); });
    tx(users);
  }

  return payload; // keep your renderer expectations
});

// --- ADDED: Handler for 'sync:run' ---
// This manually triggers the full auto-sync logic (pull + push)
ipcMain.handle('sync:run', async () => {
  console.log('[Sync] Manual sync:run triggered');

  if ((getMeta('pos.mode') || 'live') !== 'live') {
    throw new Error('Offline mode: Sync disabled');
  }

  const base = getMeta('server.base_url') || '';
  const device_id = getMeta('device_id') || '';
  const branch_id = Number(getMeta('branch_id') || 0);
  const token = await loadSecret('device_token');
  if (!base || !device_id || !token) {
    throw new Error('Not configured for sync (missing URL, device ID, or token)');
  }

  ensureOrderNumberDedupeTriggers(); 
  normalizeDuplicateOrderNumbers(); 
  // Make sure axios is configured
  configureApi(base, { id: device_id, branch_id }, token);

  // ← NEW: run bootstrap once if not done (or cursor is 0)
  const cursorRow = db.prepare('SELECT value FROM sync_state WHERE key=?')
                      .pluck().get('cursor') as string | undefined;
  const cursor = Number(cursorRow ?? 0);
  const bootDone = getMeta('bootstrap.done') === '1';

  if (!bootDone || cursor === 0) {
    console.log('[Sync] First-time bootstrap…');
    await bootstrap(base);                      // seeds items/categories/users/etc.
    setMeta('bootstrap.done', '1');
  }

  // Then incremental
  await pullChanges();

  // Optional: push completed orders
  let pushedCount = 0;
  const pending = (db.prepare(`SELECT COUNT(*) FROM orders WHERE status='completed' AND (synced_at IS NULL OR synced_at=0)`).pluck().get() as number) || 0;
  if (pending > 0) {
    const batch = collectUnsyncedOrders(25);
    if (batch.length) {
      const envelope = { client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      await pushOutbox(envelope, { orders: batch });
      markOrdersSynced(batch.map(o => o.id));
      pushedCount = batch.length;
    }
  }

  setMeta('sync.last_at', String(Date.now()));
  console.log(`[Sync] Manual sync:run complete. Pushed: ${pushedCount}`);
  return { ok: true, pulled: true, pushed: pushedCount };
});

ipcMain.handle('sync:pull', async () => {
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');
  return pullChanges();
});

ipcMain.handle('sync:push', async (_e, envelope, batch) => {
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');
  return pushOutbox(envelope, batch);
});

ipcMain.handle('app:ensureBootstrap', async () => {
  const itemsCount = (db.prepare('SELECT COUNT(*) FROM items').pluck().get() as number) || 0;
  if (itemsCount > 0) return { bootstrapped: false, itemsCount };

  const base = getMeta('server.base_url');
  if (!base) return { bootstrapped: false, itemsCount: 0, error: 'No server.base_url set' };

  await bootstrap(base);
  const after = (db.prepare('SELECT COUNT(*) FROM items').pluck().get() as number) || 0;
  return { bootstrapped: true, itemsCount: after };
});

/** Online/offline mode & status (for your topbar switch + sync btn) */
ipcMain.handle('sync:setMode', async (_e, mode: 'live' | 'offline') => {
  setMeta('pos.mode', mode);
  return { ok: true, mode };
});

ipcMain.handle('sync:status', async () => {
  const mode = getMeta('pos.mode') || 'live';
  const last_sync_at = Number(getMeta('sync.last_at') || 0);
  const base_url = getMeta('server.base_url') || '';
  const deviceId = getMeta('device_id');
  let token = deviceId ? await loadSecret('device_token') : null;
  if (deviceId && !token) {
    await new Promise(r => setTimeout(r, 100));
    token = await loadSecret('device_token');
  }
  const paired = !!(deviceId && token);
  const cursor = paired ? (Number(db.prepare('SELECT value FROM sync_state WHERE key = ?').pluck().get('cursor') || 0)) : 0;
  const branch_name = getMeta('branch.name') || '';
  const branch_id = Number(getMeta('branch_id') || 0);
  const unsynced = (db.prepare(`SELECT COUNT(*) FROM orders WHERE status='completed' AND (synced_at IS NULL OR synced_at=0)`).pluck().get() as number) || 0;
  return { mode, last_sync_at, base_url, cursor, paired, token_present: !!token, device_id: deviceId || null, branch_name, branch_id, unsynced };
});

ipcMain.handle('dev:dumpPosUsers', () => {
  return db.prepare(`
    SELECT id, name, email, username, role, is_active, branch_id
    FROM pos_users
    ORDER BY name
    LIMIT 50
  `).all();
});

/* ======================================================================
    IPC: Catalog / Geo / Tables (unchanged)
    ====================================================================== */

ipcMain.handle('catalog:search', async (_e, q: string) => {
  const stmt = db.prepare(`
    SELECT id, name, name_ar, barcode, price, is_outofstock
    FROM items
    WHERE name LIKE ? OR name_ar LIKE ? OR barcode = ?
    LIMIT 50
  `);
  return stmt.all(`%${q}%`, `%${q}%`, q);
});

ipcMain.handle('catalog:listCategories', async () => {
  return db.prepare(`
    SELECT id, name, name_ar, position, visible, updated_at
    FROM categories
    ORDER BY position ASC, name COLLATE NOCASE ASC
  `).all();
});

ipcMain.handle('catalog:listItems', async (_e, filter: { q?: string | null; categoryId?: string | null; subcategoryId?: string | null } | null = null) => {
  const where: string[] = [];
  const params: any[] = [];
  if (filter?.q) {
    where.push(`(name LIKE ? OR name_ar LIKE ? OR barcode = ?)`);
    const q = filter.q.trim();
    params.push(`%${q}%`, `%${q}%`, q);
  }
  if (filter?.categoryId) { where.push(`category_id = ?`); params.push(filter.categoryId); }
  if (filter?.subcategoryId) { where.push(`subcategory_id = ?`); params.push(filter.subcategoryId); }

  const sql = `
    SELECT id, name, name_ar, barcode, price, is_outofstock, updated_at, category_id, subcategory_id
    FROM items
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY name COLLATE NOCASE ASC
    LIMIT 500
  `;
  return db.prepare(sql).all(...params);
});

ipcMain.handle('catalog:listSubcategories', async (_e, categoryId: string | null = null) => {
  if (categoryId) {
    return db.prepare(`
      SELECT id, category_id, name, name_ar, position, visible, updated_at
      FROM subcategories
      WHERE category_id = ?
      ORDER BY position ASC, name COLLATE NOCASE ASC
    `).all(categoryId);
  }
  return db.prepare(`
    SELECT id, category_id, name, name_ar, position, visible, updated_at
    FROM subcategories
    ORDER BY category_id ASC, position ASC, name COLLATE NOCASE ASC
  `).all();
});

// --- ADDED: Handler for 'catalog:listPromos' ---
ipcMain.handle('catalog:listPromos', async () => {
  try {
    const now = nowMs();
    return db.prepare(`
      SELECT id, code, type, value, min_total, max_discount, start_at, end_at
      FROM promos
      WHERE active = 1
        AND (start_at IS NULL OR start_at <= ?)
        AND (end_at   IS NULL OR end_at   >   ?)
      ORDER BY code ASC
    `).all(now, now);
  } catch (e: any) {
    console.error('Failed to list promos:', e.message);
    return [];
  }
});
// --- ADDED: Handler for 'catalog:listAddonGroups' ---
ipcMain.handle('catalog:listAddonGroups', async (_e, filter: { itemId?: string } | null = null) => {
    try {
        // V_FIXED: Use correct columns and join key from db.ts
        if (filter?.itemId) {
            // Get groups for a specific item
            return db.prepare(`
                SELECT ag.id, ag.name, ag.name_ar, iag.is_required, iag.max_select
                FROM addon_groups ag
                JOIN item_addon_groups iag ON iag.group_id = ag.id
                WHERE iag.item_id = ?
                ORDER BY ag.name ASC
            `).all(filter.itemId);
        }
        // Get all groups (e.g., for a manager)
        // V_FIXED: Use correct columns (no selection_type or position)
        return db.prepare(`
            SELECT id, name, name_ar, is_required, max_select
            FROM addon_groups
            ORDER BY name ASC
        `).all();
    } catch (e) {
        console.error('Failed to list addon groups, tables might be missing:', e.message);
        return [];
    }
});

// --- ADDED: Handler for 'catalog:listAddons' ---
ipcMain.handle('catalog:listAddons', async (_e, filter: { groupId?: string } | null = null) => {
    try {
        // V_FIXED: Use correct column 'group_id' (not addon_group_id)
        if (filter?.groupId) {
            return db.prepare(`
                SELECT id, group_id, name, name_ar, price
                FROM addons
                WHERE group_id = ?
                ORDER BY name ASC
            `).all(filter.groupId);
        }
        // V_FIXED: Use correct column 'group_id' and no 'position'
        return db.prepare(`
            SELECT id, group_id, name, name_ar, price
            FROM addons
            ORDER BY group_id ASC, name ASC
        `).all();
    } catch (e) {
        console.error('Failed to list addons, table might be missing:', e.message);
        return [];
    }
});


ipcMain.handle('payments:listMethods', async () => {
  return db.prepare(`
    SELECT id, slug, name_en, name_ar, legacy_code
    FROM payment_methods
    WHERE is_active = 1
    ORDER BY sort_order ASC, name_en COLLATE NOCASE ASC
  `).all();
});

ipcMain.handle('geo:listStates', async () => {
  return db.prepare(`
    SELECT id, name, name_ar
    FROM states
    WHERE is_active = 1
    ORDER BY name_ar COLLATE NOCASE ASC
  `).all();
});

ipcMain.handle('geo:listCities', async (_e, stateId?: string | null) => {
  if (stateId) {
    return db.prepare(`
      SELECT id, name, name_ar, min_order, delivery_fee
      FROM cities
      WHERE is_active = 1 AND state_id = ?
      ORDER BY name_ar COLLATE NOCASE ASC
    `).all(stateId);
  }
  return db.prepare(`
    SELECT id, name, name_ar, min_order, delivery_fee
    FROM cities
    WHERE is_active = 1
    ORDER BY name_ar COLLATE NOCASE ASC
  `).all();
});

ipcMain.handle('geo:listBlocks', async (_e, cityId: string) => {
  return db.prepare(`
    SELECT id, name, name_ar
    FROM blocks
    WHERE city_id = ? AND is_active = 1
    ORDER BY name_ar COLLATE NOCASE ASC
  `).all(cityId);
});

ipcMain.handle('geo:getCity', async (_e, cityId: string) => {
  return db.prepare(`
    SELECT id, name, name_ar, min_order, delivery_fee
    FROM cities WHERE id = ?
  `).get(cityId);
});

ipcMain.handle('tables:list', async () => {
  const branchId = Number(getMeta('branch_id') || 0);
  const rows = db.prepare(`
    SELECT id, COALESCE(label, 'Table '||number) AS name, capacity, is_available
    FROM tables
    WHERE (branch_id = ? OR ? = 0)
    ORDER BY number ASC, name COLLATE NOCASE ASC
  `).all(branchId, branchId) as any[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    seats: Number(r.capacity) || 0,
    status: Number(r.is_available) === 1 ? 'available' : 'occupied',
  }));
});



/* ======================================================================
    IPC: Orders (fast multi-order flow) + Cart
    ====================================================================== */

ipcMain.handle('orders:listOpen', async () => {
  return db.prepare(`
    SELECT id, number, status, order_type, subtotal, grand_total, opened_at
    FROM orders
    WHERE status IS NULL OR status = 'open'
    ORDER BY opened_at DESC
    LIMIT 50
  `).all();
});

ipcMain.handle('orders:listActive', async () => {
  return db.prepare(`
    SELECT id, number, status, order_type, subtotal, grand_total, opened_at
    FROM orders
    WHERE status IS NULL OR status = 'open'
    ORDER BY opened_at DESC
    LIMIT 50
  `).all();
});

ipcMain.handle('orders:listPrepared', async () => {
  return db.prepare(`
    SELECT id, number, status, subtotal, grand_total, opened_at
    FROM orders
    WHERE status = 'prepared'
    ORDER BY opened_at DESC
    LIMIT 50
  `).all();
});

ipcMain.handle('orders:start', async () => {
  const deviceId = getMeta('device_id');
  const branchId = Number(getMeta('branch_id') ?? 0);
  if (!deviceId) throw new Error('Device not paired');

  const id = crypto.randomUUID();
  const number = allocUniqueOrderNumber();
  const now = Date.now();

  db.prepare(`
    INSERT INTO orders (id, number, device_id, branch_id, status, subtotal, tax_total, discount_total, grand_total, opened_at)
    VALUES (?, ?, ?, ?, 'open', 0, 0, 0, 0, ?)
  `).run(id, number, deviceId, branchId, now);

  safeAddToActiveOrders(id);
  return { id, number, device_id: deviceId, branch_id: branchId, opened_at: now, status: 'open' };
});

ipcMain.handle('orders:setType', async (_e, orderId: string, type: 1 | 2 | 3) => {
  db.prepare(`UPDATE orders SET order_type = ? WHERE id = ?`).run(type, orderId);
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, order };
});

ipcMain.handle('orders:get', async (_e, orderId: string) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  const lines = db.prepare(`
    SELECT id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id
    FROM order_lines WHERE order_id = ?
    ORDER BY rowid ASC
  `).all(orderId);

  if (order?.table_id) {
    const tn = db.prepare(`SELECT COALESCE(label, 'Table '||number) AS name FROM tables WHERE id = ?`).get(order.table_id) as any;
    order.table_name = tn?.name ?? null;
  }

  return { order, lines };
});

ipcMain.handle('orders:addLine', async (_e, orderId: string, itemId: string, qty = 1) => {
  const item = db.prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`).get(itemId) as any;
  if (!item) throw new Error('Item not found');

  const row = db.prepare(`
    SELECT id, qty, unit_price FROM order_lines
    WHERE order_id = ? AND item_id = ? AND variation_id IS NULL AND addons_id IS NULL
  `).get(orderId, itemId) as any;

  if (row) {
    const newQty = Number(row.qty || 0) + Number(qty || 0);
    if (newQty <= 0) {
      db.prepare(`DELETE FROM order_lines WHERE id = ?`).run(row.id);
    } else {
      const newTotal = +(newQty * Number(row.unit_price || 0)).toFixed(3);
      db.prepare(`UPDATE order_lines SET qty = ?, line_total = ? WHERE id = ?`).run(newQty, newTotal, row.id);
    }
  } else if (qty > 0) {
    const id = crypto.randomUUID();
    const unit = Number(item.price || 0);
    db.prepare(`
      INSERT INTO order_lines (id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id, name_ar)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
    `).run(id, orderId, item.id, item.name, qty, unit, +(qty * unit).toFixed(3), item.name_ar ?? null);
  }
  const totals = recalcOrderTotals(orderId);
  const refreshed = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(orderId);
  return { totals, lines: refreshed };
});

ipcMain.handle('orders:setLineQty', async (_e, lineId: string, qty: number) => {
  const row = db.prepare(`SELECT order_id, unit_price FROM order_lines WHERE id = ?`).get(lineId) as any;
  if (!row) throw new Error('Line not found');
  const q = Math.max(0, Number(qty || 0));
  if (q === 0) {
    db.prepare(`DELETE FROM order_lines WHERE id = ?`).run(lineId);
  } else {
    const total = +(q * Number(row.unit_price || 0)).toFixed(3);
    db.prepare(`UPDATE order_lines SET qty = ?, line_total = ? WHERE id = ?`).run(q, total, lineId);
  }
  const totals = recalcOrderTotals(row.order_id);
  const refreshed = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(row.order_id);
  return { ok: true, totals, lines: refreshed };
});

// Accept either (orderId, lineId) OR (lineId)
ipcMain.handle('orders:removeLine', async (_e, a: string, b?: string) => {
  let orderId: string | null = null;
  let lineId: string;

  if (b) { orderId = a; lineId = b; }
  else { lineId = a; const r = db.prepare(`SELECT order_id FROM order_lines WHERE id = ?`).get(lineId) as any; orderId = r?.order_id ?? null; }

  const info = db.prepare(`DELETE FROM order_lines WHERE id = ?`).run(lineId);
  let totals = null, lines = null;
  if (orderId) {
    totals = recalcOrderTotals(orderId);
    lines = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(orderId);
  }
  return { ok: info.changes > 0, totals, lines };
});

ipcMain.handle('orders:removeLineByItem', async (_e, orderId: string, itemId: string) => {
  db.prepare(`DELETE FROM order_lines WHERE order_id = ? AND item_id = ?`).run(orderId, itemId);
  const totals = recalcOrderTotals(orderId);
  const lines = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(orderId);
  return { ok: true, totals, lines };
});


ipcMain.handle('orders:removePromo', async (_e, orderId: string) => {
  db.prepare(`UPDATE orders SET promocode = NULL WHERE id = ?`).run(orderId);
  const totals = recalcOrderTotals(orderId);
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, order, totals };
});


// --- ADDED: Handler for 'orders:applyPromo' ---
ipcMain.handle('orders:applyPromo', async (_e, orderId: string, promoCode: string | null) => {
  const code = promoCode ? promoCode.trim().toUpperCase() : null;
  db.prepare(`UPDATE orders SET promocode = ? WHERE id = ?`).run(code, orderId);

  const totals = recalcOrderTotals(orderId);   // <— ensures delivery + promo interplay is live
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, order, totals };
});


ipcMain.handle('orders:close', async (_e, orderId: string) => {
  const now = Date.now();
  recalcOrderTotals(orderId);
  db.prepare(`UPDATE orders SET status = 'closed', closed_at = ? WHERE id = ?`).run(now, orderId);
  return { ok: true, closed_at: now };
});

ipcMain.handle('orders:reopen', async (_e, orderId: string) => {
  db.prepare(`UPDATE orders SET status = 'open', closed_at = NULL WHERE id = ?`).run(orderId);
  safeAddToActiveOrders(orderId);
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, order };
});

ipcMain.handle('orders:cancel', async (_e, orderId: string) => {
  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(orderId);
  return { ok: true };
});

/* ---------------- Cart (unchanged, relies on your cart table) --------------- */

function parseNumList(input: any): number[] {
  if (input == null) return [];
  if (typeof input === 'number') return [input];
  const s = String(input).trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map(n => Number(n) || 0);
    const n = Number(j);
    return Number.isFinite(n) ? [n] : [];
  } catch {
    return s.split(',').map(x => Number(x.trim()) || 0);
  }
}
function addonsUnitTotal(addons_price: any, addons_qty: any): number {
  const prices = parseNumList(addons_price);
  const qtys = parseNumList(addons_qty);
  if (!prices.length) return 0;
  if (!qtys.length) return prices.reduce((a, b) => a + (Number(b) || 0), 0);
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    const p = Number(prices[i]) || 0;
    const q = Number(qtys[i] ?? 1) || 1;
    sum += p * q;
  }
  return sum;
}
function baseUnitPrice(row: any): number {
  const varP = Number(row.variation_price);
  const price = Number(row.price);
  const unit = Number.isFinite(varP) && varP > 0 ? varP : (Number(price) || 0);
  const addons = addonsUnitTotal(row.addons_price, row.addons_qty);
  return unit + addons;
}
function calcLineTotal(row: any): number {
  const unit = baseUnitPrice(row);
  const qty = Number(row.qty) || 0;
  return +(unit * qty).toFixed(3);
}
function cartTotals() {
  const rows = db.prepare(`SELECT * FROM cart`).all() as any[];
  const subtotal = rows.reduce((s, r) => s + calcLineTotal(r), 0);
  const discount_total = 0; // Note: Promos are not applied to cart, only to orders
  const orderType = Number(getMeta('cart.order_type') || 0);
  let delivery_fee = 0;
  if (orderType === 1) {
    const cityId = getMeta('cart.city_id');
    if (cityId) {
      const city = db.prepare(`SELECT delivery_fee FROM cities WHERE id = ?`).get(cityId) as any;
      if (city && Number.isFinite(Number(city.delivery_fee))) delivery_fee = Number(city.delivery_fee);
    }
    if (getMeta('cart.void_delivery_fee') === '1') delivery_fee = 0;
  }
  const grand_total = +(subtotal - discount_total + delivery_fee).toFixed(3);
  return { subtotal, discount_total, delivery_fee, grand_total };
}

ipcMain.handle('cart:list', async () => {
  const rows = db.prepare(`SELECT * FROM cart ORDER BY created_at ASC, rowid ASC`).all();
  return { rows, totals: cartTotals() };
});
ipcMain.handle('cart:clear', async () => {
  db.prepare(`DELETE FROM cart`).run();
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:add', async (_e, payload: any) => {
  const now = nowMs();
  const sid = getMeta('device_id') || 'local';
  const q = Number(payload.qty ?? 1) || 1;

  const keyItem = String(payload.item_id);
  const keyVar = payload.variation_id ? String(payload.variation_id) : null;
  const keyAdds = payload.addons_id ? String(payload.addons_id) : null;

  const existing = db.prepare(`
    SELECT * FROM cart
    WHERE item_id = ? AND IFNULL(variation_id,'') = IFNULL(?, '') AND IFNULL(addons_id,'') = IFNULL(?, '')
    LIMIT 1
  `).get(keyItem, keyVar, keyAdds) as any;

  if (existing) {
    const newQty = (Number(existing.qty) || 0) + q;
    db.prepare(`UPDATE cart SET qty = ?, updated_at = ? WHERE id = ?`).run(newQty, now, existing.id);
  } else {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO cart (id,user_id,session_id,item_id,item_name,item_name_ar,item_image,
                        addons_id,addons_name,addons_name_ar,addons_price,addons_qty,
                        variation_id,variation,variation_ar,variation_price,
                        price,qty,tax,item_notes,is_available,created_at,updated_at,branch_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, null, sid,
      payload.item_id, payload.item_name, payload.item_name_ar ?? null, payload.item_image ?? null,
      payload.addons_id ?? null, payload.addons_name ?? null, payload.addons_name_ar ?? null,
      payload.addons_price ?? null, payload.addons_qty ?? null,
      payload.variation_id ?? null, payload.variation ?? null, payload.variation_ar ?? null,
      payload.variation_price ?? null,
      payload.price, q, null, payload.item_notes ?? null, 1, now, now, Number(getMeta('branch_id') || 0)
    );
  }
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:setQty', async (_e, id: string, qty: number) => {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Invalid qty');
  db.prepare(`UPDATE cart SET qty = ?, updated_at = ? WHERE id = ?`).run(q, nowMs(), id);
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:inc', async (_e, id: string) => {
  db.prepare(`UPDATE cart SET qty = qty + 1, updated_at = ? WHERE id = ?`).run(nowMs(), id);
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:dec', async (_e, id: string) => {
  const row = db.prepare(`SELECT qty FROM cart WHERE id = ?`).get(id) as any;
  const q = Number(row?.qty || 0);
  if (q <= 1) db.prepare(`DELETE FROM cart WHERE id = ?`).run(id);
  else db.prepare(`UPDATE cart SET qty = qty - 1, updated_at = ? WHERE id = ?`).run(nowMs(), id);
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:remove', async (_e, id: string) => {
  db.prepare(`DELETE FROM cart WHERE id = ?`).run(id);
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:setNotes', async (_e, id: string, note: string) => {
  db.prepare(`UPDATE cart SET item_notes = ?, updated_at = ? WHERE id = ?`).run(note ?? null, nowMs(), id);
  return { ok: true };
});
ipcMain.handle('cart:setContext', async (_e, ctx: { order_type?: number; city_id?: string | null; void_delivery_fee?: boolean }) => {
  if (ctx.order_type != null) db.prepare(`INSERT INTO meta(key,value) VALUES('cart.order_type', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(ctx.order_type));
  if (ctx.city_id !== undefined) db.prepare(`INSERT INTO meta(key,value) VALUES('cart.city_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(ctx.city_id ? String(ctx.city_id) : '');
  if (ctx.void_delivery_fee != null) db.prepare(`INSERT INTO meta(key,value) VALUES('cart.void_delivery_fee', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(ctx.void_delivery_fee ? '1' : '0');
  return { ok: true, totals: cartTotals() };
});

/** Create completed order from cart and leave it for outbox push */
ipcMain.handle('orders:createFromCart', async (_e, customerData: {
  full_name: string;
  mobile: string;
  address: string | null;
  note: string | null;
  payment_method_id: string;
  payment_method_slug: string;
}) => {
  const rows = db.prepare(`SELECT * FROM cart ORDER BY created_at ASC, rowid ASC`).all();
  const totals = cartTotals();
  if (!rows || rows.length === 0) throw new Error('Cannot create order from an empty cart.');

  const deviceId = getMeta('device_id');
  const branchId = Number(getMeta('branch_id') ?? 0);
  const orderType = Number(getMeta('cart.order_type') || 2);
  const cartCityId = getMeta('cart.city_id'); // --- FIX: Get city_id from meta
  const voidFee = getMeta('cart.void_delivery_fee') === '1' ? 1 : 0; // --- ADDED: Get void_fee status

  const orderId = crypto.randomUUID();
  const orderNumber = allocUniqueOrderNumber(); 
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO orders (id, number, device_id, branch_id, order_type, status, full_name, mobile, address, note,
                          payment_method_id, payment_method_slug, subtotal, discount_total, delivery_fee, grand_total,
                          opened_at, created_at, synced_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
    `).run(
      orderId, orderNumber, deviceId, branchId, orderType,
      customerData.full_name, customerData.mobile, customerData.address, customerData.note,
      customerData.payment_method_id, customerData.payment_method_slug,
      totals.subtotal, totals.discount_total, totals.delivery_fee, totals.grand_total,
      now
    );

    // --- MODIFIED: Persist context fields if columns exist ---
    if (hasColumn('orders', 'city_id') && cartCityId) {
      db.prepare(`UPDATE orders SET city_id = ? WHERE id = ?`).run(cartCityId, orderId);
    }
    if (hasColumn('orders', 'void_delivery_fee')) {
      db.prepare(`UPDATE orders SET void_delivery_fee = ? WHERE id = ?`).run(voidFee, orderId);
    }
    // --- End modification ---

    const lineInsert = db.prepare(`
      INSERT INTO order_lines (id, order_id, item_id, name, name_ar, qty, unit_price, line_total, notes,
                               variation_id, variation, variation_price, addons_id, addons_name, addons_price, addons_qty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of rows) {
      const unitPrice = baseUnitPrice(item);
      const lineTotal = calcLineTotal(item);
      lineInsert.run(
        crypto.randomUUID(), orderId, item.item_id, item.item_name, item.item_name_ar, item.qty,
        unitPrice, lineTotal, item.item_notes ?? null,
        item.variation_id ?? null, item.variation ?? null, item.variation_price ?? null,
        item.addons_id ?? null, item.addons_name ?? null, item.addons_price ?? null, item.addons_qty ?? null
      );
    }

    db.prepare('DELETE FROM cart').run();
  })();
  
  // Recalc totals *after* transaction to ensure all fields (like city_id) are set
  const _re = recalcOrderTotals(orderId);

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  const lines = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(orderId);
  return { order, lines, queued_for_push: true };
});

/* ======================================================================
    IPC: Outbox (push completed orders) — Sync button uses these
    ====================================================================== */

/** How many completed orders are waiting to be sent */
ipcMain.handle('orders:unsyncedCount', async () => {
  const n = (db.prepare(`SELECT COUNT(*) FROM orders WHERE status='completed' AND (synced_at IS NULL OR synced_at=0)`).pluck().get() as number) || 0;
  return { count: n };
});

/** Push one by id (helpful to re-try a specific ticket) */
ipcMain.handle('orders:pushOne', async (_e, orderId: string) => {
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');
  const payload = buildOrderPayload(orderId);
  if (!payload) throw new Error('Order not found');

  const envelope = { client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}` };
  await pushOutbox(envelope, { orders: [payload] });
  markOrdersSynced([orderId]);
  return { ok: true, pushed: 1 };
});

// replace the signature block with the extra fields
ipcMain.handle('orders:complete', async (_e, orderId: string, customer: {
  full_name: string;
  mobile: string;
  address?: string | null;
  note?: string | null;
  payment_method_id: string;
  payment_method_slug: string;
  // --- NEW optional geo fields from checkout form ---
  state_id?: string | null;
  city_id?: string | null;
  block_id?: string | null;
}) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  if (!order) throw new Error('Order not found');

  // Persist geo IDs when columns exist (safe on older DBs)
  if (hasColumn('orders', 'state_id')) db.prepare(`UPDATE orders SET state_id = ? WHERE id = ?`).run(customer.state_id ?? null, orderId);
  if (hasColumn('orders', 'city_id'))  db.prepare(`UPDATE orders SET city_id  = ? WHERE id = ?`).run(customer.city_id  ?? null, orderId);
  if (hasColumn('orders', 'block_id')) db.prepare(`UPDATE orders SET block_id = ? WHERE id = ?`).run(customer.block_id ?? null, orderId);

  // --- ADDED: Persist void_delivery_fee context from 'cart' meta ---
  // This ensures the setting is "locked in" before totals are calculated.
  const voidFee = getMeta('cart.void_delivery_fee') === '1' ? 1 : 0;
  if (hasColumn('orders', 'void_delivery_fee')) {
      db.prepare(`UPDATE orders SET void_delivery_fee = ? WHERE id = ?`).run(voidFee, orderId);
  }
  // --- End addition ---

  // Ensure totals are up to date (after saving geo so delivery_fee can derive from city)
  const totals = recalcOrderTotals(orderId);
  const now = Date.now();

  db.prepare(`
    UPDATE orders
    SET status='completed',
        full_name=?,
        mobile=?,
        address=?,
        note=?,
        payment_method_id=?,
        payment_method_slug=?,
        subtotal=?,
        discount_total=?,
        delivery_fee=?,
        grand_total=?,
        closed_at=?,
        synced_at=NULL
    WHERE id = ?
  `).run(
    customer.full_name,
    customer.mobile,
    customer.address ?? null,
    customer.note ?? null,
    customer.payment_method_id,
    customer.payment_method_slug,
    totals.subtotal,
    totals.discount_total,
    totals.delivery_fee,
    totals.grand_total,
    now,
    orderId
  );

  // (push logic stays as in your file)
  let pushed = 0;
  try {
    if ((getMeta('pos.mode') || 'live') === 'live') {
      const base = getMeta('server.base_url') || '';
      const device_id = getMeta('device_id') || '';
      const branch_id = Number(getMeta('branch_id') || 0);
      const token = await loadSecret('device_token');
      if (base && device_id && token) {
        configureApi(base, { id: device_id, branch_id }, token);
        const payload = buildOrderPayload(orderId);
        if (payload) {
          const envelope = { client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}` };
          await pushOutbox(envelope, { orders: [payload] });
          markOrdersSynced([orderId]);
          pushed = 1;
        }
      }
    }
  } catch (e) {
    console.warn('[orders:complete] push failed, will retry via autosync:', (e as any)?.message);
  }

  const refreshed = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  const lines = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(orderId);
  return { ok: true, pushed, order: refreshed, lines };
});

ipcMain.handle('dev:stats', () => {
  const q = (sql: string) => (db.prepare(sql).pluck().get() as number) || 0
  return {
    items: q('SELECT COUNT(*) FROM items'),
    variations: q('SELECT COUNT(*) FROM variations'),
    addon_groups: q('SELECT COUNT(*) FROM addon_groups'),
    addons: q('SELECT COUNT(*) FROM addons'),
    item_addon_groups: q('SELECT COUNT(*) FROM item_addon_groups'),
    categories: q('SELECT COUNT(*) FROM categories'),
    subcategories: q('SELECT COUNT(*) FROM subcategories'),
    promos: q('SELECT COUNT(*) FROM promos'),
    tables: q('SELECT COUNT(*) FROM tables'),
    pos_users: q('SELECT COUNT(*) FROM pos_users'),
  }
})


/** Push a batch of unsynced completed orders */
ipcMain.handle('sync:flushOrders', async (_e, limit = 20) => {
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');

  const toPush = collectUnsyncedOrders(limit);
  if (!toPush.length) return { ok: true, pushed: 0 };

  const envelope = { client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}` };
  await pushOutbox(envelope, { orders: toPush });

  markOrdersSynced(toPush.map(o => o.id));
  return { ok: true, pushed: toPush.length };
});

// Assign a table to a dine-in order
ipcMain.handle('orders:setTable', async (_e, orderId: string, payload: { table_id: string; covers?: number }) => {
  const o = db.prepare(`SELECT id, order_type, table_id FROM orders WHERE id = ?`).get(orderId) as any;
  if (!o) throw new Error('Order not found');
  if (Number(o.order_type) !== 3) throw new Error('Order is not dine-in');

  const t = db.prepare(`SELECT id, label, number, capacity, is_available FROM tables WHERE id = ?`).get(payload.table_id) as any;
  if (!t) throw new Error('Table not found');
  if (Number(t.is_available) !== 1 && t.id !== o.table_id) throw new Error('Table is not available');

  const covers = Math.max(1, Number(payload.covers ?? 1));

  db.transaction(() => {
    if (o.table_id && o.table_id !== t.id) {
      db.prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`).run(o.table_id);
    }
    db.prepare(`UPDATE orders SET table_id = ?, covers = ? WHERE id = ?`).run(t.id, covers, orderId);
    db.prepare(`UPDATE tables SET is_available = 0 WHERE id = ?`).run(t.id);
  })();

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  const tn = db.prepare(`SELECT COALESCE(label, 'Table '||number) AS name FROM tables WHERE id = ?`).get(order.table_id) as any;
  order.table_name = tn?.name ?? null;

  return { ok: true, order };
});

// Clear the table from an order
ipcMain.handle('orders:clearTable', async (_e, orderId: string) => {
  const o = db.prepare(`SELECT id, table_id FROM orders WHERE id = ?`).get(orderId) as any;
  if (!o) throw new Error('Order not found');

  db.transaction(() => {
    if (o.table_id) db.prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`).run(o.table_id);
    db.prepare(`UPDATE orders SET table_id = NULL, covers = NULL WHERE id = ?`).run(orderId);
  })();

  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, order };
});


// --- Auth services adapter wired to your current project ---
const services = {
  store: {
    get: (k: string) => getMeta(k),
    set: (k: string, v: any) => setMeta(k, v),
    delete: (k: string) => setMeta(k, null),
  },
  sync: {
    // configure(baseUrl) => configures axios client using the stored device + token
    configure: async (baseUrl: string) => {
      const device_id = getMeta('device_id') || '';
      const branch_id = Number(getMeta('branch_id') || 0);
      const token = await loadSecret('device_token');
      if (!device_id || !token) throw new Error('Not paired');
      setMeta('server.base_url', baseUrl);
      configureApi(baseUrl, { id: device_id, branch_id }, token);
    },

    // bootstrap(baseUrl, pairCode) => PAIR the device (uses your existing pairDevice)
    // NOTE: we read optional temp values (saved by the UI) for deviceName/branchId.
    bootstrap: async (baseUrl: string | null, pairCode: string) => {
      const url = baseUrl || services.store.get('server.base_url') || '';
      if (!url) throw new Error('Missing base URL');

      const machineId = await readOrCreateMachineId();

      const tmpBranch = services.store.get('tmp.branch_id');
      const tmpDeviceName = services.store.get('tmp.device_name');
      const branchId = String(tmpBranch ?? services.store.get('branch_id') ?? '');
      const deviceName = tmpDeviceName || 'POS';

      await pairDevice(url, pairCode, branchId, deviceName, machineId);

      services.store.set('tmp.branch_id', null);
      services.store.set('tmp.device_name', null);

      return { device_id: services.store.get('device_id') || null };
    },

    // run() => pull + (optional) push unsynced, reusing your helpers
    run: async () => {
      const base = getMeta('server.base_url') || '';
      const device_id = getMeta('device_id') || '';
      const branch_id = Number(getMeta('branch_id') || 0);
      const token = await loadSecret('device_token');
      if (!base || !device_id || !token) throw new Error('Not configured');

      configureApi(base, { id: device_id, branch_id }, token);
      await pullChanges();

      // optional: also push some queued orders (keeps parity with sync:run)
      const pending = (db.prepare(
        `SELECT COUNT(*) FROM orders WHERE status='completed' AND (synced_at IS NULL OR synced_at=0)`
      ).pluck().get() as number) || 0;

      if (pending > 0) {
        const batch = collectUnsyncedOrders(25);
        if (batch.length) {
          const envelope = { client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}` };
          await pushOutbox(envelope, { orders: batch });
          markOrdersSynced(batch.map(o => o.id));
        }
      }
    },
  },
};

// ✅ Register the new handlers (pass your existing db instance)
registerAuthHandlers(ipcMain, db, {
  store: services.store,
  sync: {
    pairDevice,   // <-- from your sync.ts
    bootstrap,    // <-- from your sync.ts
    run: services.sync.run,       // use the async run helper from services
    configure: services.sync.configure, // use the async configure helper from services
  }
});

/* ======================================================================
    Background Auto-Sync (pull + flush) with backoff
    ====================================================================== */

let autoTimer: NodeJS.Timeout | null = null;
let backoffMs = 30000; // 30s; grows to 5min on failures

async function autoSyncTick() {
  try {
    if ((getMeta('pos.mode') || 'live') !== 'live') return;

    const base = getMeta('server.base_url') || '';
    const device_id = getMeta('device_id') || '';
    const branch_id = Number(getMeta('branch_id') || 0);
    const token = await loadSecret('device_token');

    if (!base || !device_id || !token) return;

    // Ensure API is configured (idempotent)
    configureApi(base, { id: device_id, branch_id }, token);

    // Pull any changes (safe)
    await pullChanges();

    // Push outbox if any
    const pending = (db.prepare(`SELECT COUNT(*) FROM orders WHERE status='completed' AND (synced_at IS NULL OR synced_at=0)`).pluck().get() as number) || 0;
    if (pending > 0) {
      const batch = collectUnsyncedOrders(25);
      if (batch.length) {
        const envelope = { client_msg_id: `pos-${Date.now()}-${Math.random().toString(36).slice(2)}` };
        await pushOutbox(envelope, { orders: batch });
        markOrdersSynced(batch.map(o => o.id));
      }
    }

    // success: reset backoff
    backoffMs = 30000;
    setMeta('sync.last_at', String(Date.now()));
  } catch(err) {
    console.error('[AutoSync] Tick failed:', err.message);
    // exponential-ish backoff up to 5 min
    backoffMs = Math.min(backoffMs * 2, 5 * 60 * 1000);
  } finally {
    scheduleNextAutoSync();
  }
}

function scheduleNextAutoSync() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(autoSyncTick, backoffMs);
}

function startAutoSyncLoop() {
  if (autoTimer) return;
  scheduleNextAutoSync();
}