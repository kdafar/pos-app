import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import db, { getMeta, migrate, setMeta } from './db';
import { saveSecret, loadSecret } from './secureStore';
import { bootstrap, configureApi, pairDevice, pullChanges, pushOutbox } from './sync';
import crypto from 'node:crypto';

// The built directory structure
//
// ├─┬─┬ out
// │ │ ├── main
// │ │ │   └── index.js
// │ │ ├── preload
// │ │ │   └── index.js
// │ │ └── renderer
// │
process.env.APP_ROOT = path.join(__dirname, '../..');

async function createWindow() {
  migrate();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Use the preload script provided by electron-vite.
      // It's compiled and placed in the out directory.
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Vite DEV server URL
  const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // Load the index.html of the app.
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const nowMs = () => Date.now();

// parses JSON array, CSV string, or a single number -> number[]
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

// addons total per unit (sum(price_i * qty_i))
function addonsUnitTotal(addons_price: any, addons_qty: any): number {
  const prices = parseNumList(addons_price);
  const qtys   = parseNumList(addons_qty);
  if (!prices.length) return 0;
  if (!qtys.length) return prices.reduce((a,b)=>a+(Number(b)||0), 0);
  let sum = 0;
  for (let i=0;i<prices.length;i++){
    const p = Number(prices[i]) || 0;
    const q = Number(qtys[i] ?? 1) || 1;
    sum += p * q;
  }
  return sum;
}

function baseUnitPrice(row: any): number {
  // prefer variation_price if variation selected; else price
  const varP = Number(row.variation_price);
  const price = Number(row.price);
  const unit = Number.isFinite(varP) && varP > 0 ? varP : (Number(price)||0);
  const addons = addonsUnitTotal(row.addons_price, row.addons_qty);
  return unit + addons;
}

function calcLineTotal(row: any): number {
  const unit = baseUnitPrice(row);
  const qty  = Number(row.qty) || 0;
  return +(unit * qty).toFixed(3);
}

function cartTotals() {
  const rows = db.prepare(`SELECT * FROM cart`).all() as any[];
  const subtotal = rows.reduce((s, r) => s + calcLineTotal(r), 0);
  // tax disabled per your request
  const discount_total = 0;

  // delivery fee from selected city if order_type=1 (delivery)
  const orderType = Number(getMeta('cart.order_type') || 0); // 1 delivery, 2 pickup, 3 dine-in
  let delivery_fee = 0;
  if (orderType === 1) {
    const cityId = getMeta('cart.city_id');
    if (cityId) {
      const city = db.prepare(`SELECT delivery_fee FROM cities WHERE id = ?`).get(cityId) as any;
      if (city && Number.isFinite(Number(city.delivery_fee))) delivery_fee = Number(city.delivery_fee);
    }
    // allow voiding delivery fee (like web)
    if (getMeta('cart.void_delivery_fee') === '1') delivery_fee = 0;
  }

  const grand_total = +(subtotal - discount_total + delivery_fee).toFixed(3);
  return { subtotal, discount_total, delivery_fee, grand_total };
}

/** KV **/
ipcMain.handle('store:set', async (_e, key: string, value: string) => {
  if (key === 'device_token') return saveSecret('device_token', value);
  setMeta(key, value);
});
ipcMain.handle('store:get', async (_e, key: string) => {
  if (key === 'device_token') return loadSecret('device_token');
  return getMeta(key) ?? null;
});

/** Sync Configure — persist base URL too **/
ipcMain.handle('sync:configure', async (_e, baseUrl: string) => {
  const device_id = getMeta('device_id') ?? '';
  const branch_id = Number(getMeta('branch_id') ?? 0);
  const token = await loadSecret('device_token');
  if (!device_id || !token) throw new Error('Not paired');

  setMeta('server.base_url', baseUrl);
  configureApi(baseUrl, { id: device_id, branch_id }, token);
});

/** Pairing **/
ipcMain.handle('sync:pair', async (_e, baseUrl: string, pairCode: string, branchId: string, deviceName: string) => {
  // Get or create a unique, persistent ID for this machine
  let mid = getMeta('machine_id');
  if (!mid) mid = await app.getMachineId();
  setMeta('machine_id', mid);
  return pairDevice(baseUrl, pairCode, branchId, deviceName, mid);
});

/** Pull/Bootstrap/Push **/
ipcMain.handle('sync:bootstrap', async (_e, baseUrl?: string) => {
  const url = baseUrl || getMeta('server.base_url') || '';
  if (!url) throw new Error('Missing base URL');
  return bootstrap(url);
});
ipcMain.handle('sync:pull', async () => {
  // Optional: respect offline mode
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');
  return pullChanges();
});
ipcMain.handle('sync:push', async (_e, envelope, batch) => {
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');
  return pushOutbox(envelope, batch);
});

/** Ensure at least one bootstrap when DB is empty **/
ipcMain.handle('app:ensureBootstrap', async () => {
  const itemsCount = (db.prepare('SELECT COUNT(*) FROM items').pluck().get() as number) || 0;
  if (itemsCount > 0) return { bootstrapped: false, itemsCount };

  const base = getMeta('server.base_url');
  if (!base) return { bootstrapped: false, itemsCount: 0, error: 'No server.base_url set' };

  await bootstrap(base);
  const after = (db.prepare('SELECT COUNT(*) FROM items').pluck().get() as number) || 0;
  return { bootstrapped: true, itemsCount: after };
});

/** Live/Offline mode + status **/
ipcMain.handle('sync:getStatus', async () => {
  console.log('\n[DEBUG] Checking sync status...');
  const mode = getMeta('pos.mode') || 'live';
  const last_sync_at = Number(getMeta('sync.last_at') || 0);
  const base_url = getMeta('server.base_url') || '';
  const deviceId = getMeta('device_id');
  console.log(`[DEBUG]  - Found deviceId in DB: ${deviceId || 'null'}`);
  let token = deviceId ? await loadSecret('device_token') : null;
  console.log(`[DEBUG]  - Loaded token from keychain (initial attempt): ${token ? '*** (present)' : 'null'}`);

  // Retry loading token once if deviceId exists but token is missing, to handle keytar init race condition
  if (deviceId && !token) {
    console.log('[DEBUG]  - deviceId exists but token is missing. Retrying after delay...');
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
    token = await loadSecret('device_token');
    console.log(`[DEBUG]  - Loaded token from keychain (second attempt): ${token ? '*** (present)' : 'null'}`);
  }

  const paired = !!(deviceId && token);
  console.log(`[DEBUG]  - Final paired status: ${paired}`);
  const cursor = paired ? (Number(db.prepare('SELECT value FROM sync_state WHERE key = ?').pluck().get('cursor') || 0)) : 0;

  const branch_name = getMeta('branch.name') || '';
  const branch_id = Number(getMeta('branch_id') || 0);
  const result = { mode, last_sync_at, base_url, cursor, paired, token_present: !!token, device_id: deviceId || null, branch_name, branch_id };
  console.log('[DEBUG] Returning status:', JSON.stringify(result));
  return result;
});
ipcMain.handle('sync:setMode', async (_e, mode: 'live' | 'offline') => {
  setMeta('pos.mode', mode);
  return { ok: true, mode };
});
ipcMain.handle('sync:now', async () => {
  if ((getMeta('pos.mode') || 'live') !== 'live') throw new Error('Offline mode');
  const base = getMeta('server.base_url') || '';
  if (!base) throw new Error('No server.base_url');
  await bootstrap(base);
  await pullChanges();
  return { ok: true };
});

/** IPC — secure bridge **/

ipcMain.handle('catalog:search', async (_e, q: string) => {
  const stmt = db.prepare(`
    SELECT id, name, name_ar, barcode, price, is_outofstock
    FROM items
    WHERE name LIKE ? OR name_ar LIKE ? OR barcode = ?
    LIMIT 50
  `);
  return stmt.all(`%${q}%`, `%${q}%`, q);
});

// ---------- Catalog read-only ----------
ipcMain.handle('catalog:listCategories', async () => {
  return db.prepare(`
    SELECT id, name, name_ar, position, visible, updated_at
    FROM categories
    ORDER BY position ASC, name COLLATE NOCASE ASC
  `).all();
});

ipcMain.handle('orders:setDeliveryFee', async (_e, orderId: string, fee: number) => {
  const val = Math.max(0, Number(fee || 0));
  db.prepare(`UPDATE orders SET delivery_fee = ? WHERE id = ?`).run(val, orderId);
  const totals = recalcOrderTotals(orderId);
  const order  = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, totals, order };
});

ipcMain.handle('tables:listAvailable', async () => {
  const branchId = Number(getMeta('branch_id') || 0);
  return db.prepare(`
    SELECT id, label, number, capacity, is_available, branch_id
    FROM tables
    WHERE is_available = 1 AND (branch_id = ? OR ? = 0)
    ORDER BY number ASC, label COLLATE NOCASE ASC
  `).all(branchId, branchId);
});

ipcMain.handle('catalog:listItems', async (_e, filter: { q?: string|null; categoryId?: string|null; subcategoryId?: string|null } | null = null) => {
  const where: string[] = [];
  const params: any[] = [];

  if (filter?.q) {
    where.push(`(name LIKE ? OR name_ar LIKE ? OR barcode = ?)`);
    const q = filter.q.trim();
    params.push(`%${q}%`, `%${q}%`, q);
  }
  if (filter?.categoryId) {
    where.push(`category_id = ?`);
    params.push(filter.categoryId);
  }
  if (filter?.subcategoryId) {
    where.push(`subcategory_id = ?`);
    params.push(filter.subcategoryId);
  }

  const sql = `
    SELECT id, name, name_ar, barcode, price, is_outofstock, updated_at, category_id, subcategory_id
    FROM items
    ${where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY name COLLATE NOCASE ASC
    LIMIT 500
  `;
  return db.prepare(sql).all(...params);
});

ipcMain.handle('catalog:listAddonGroups', async () => {
  return db.prepare(`
    SELECT
      g.id, g.name, g.name_ar, g.is_required, g.max_select, g.updated_at,
      (SELECT COUNT(*) FROM addons a WHERE a.group_id = g.id) AS addons_count
    FROM addon_groups g
    ORDER BY g.name COLLATE NOCASE ASC
  `).all();
});

ipcMain.handle('catalog:listAddons', async (_e, groupId: string | null = null) => {
  if (groupId) {
    return db.prepare(`
      SELECT id, group_id, name, name_ar, price, updated_at
      FROM addons
      WHERE group_id = ?
      ORDER BY name COLLATE NOCASE ASC
    `).all(groupId);
  }
  return db.prepare(`
    SELECT id, group_id, name, name_ar, price, updated_at
    FROM addons
    ORDER BY name COLLATE NOCASE ASC
    LIMIT 500
  `).all();
});

ipcMain.handle('catalog:listPromos', async () => {
  return db.prepare(`
    SELECT id, code, type, value, min_total, start_at, end_at, active, updated_at
    FROM promos
    ORDER BY code COLLATE NOCASE ASC
  `).all();
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

ipcMain.handle('geo:listCities', async () => {
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


ipcMain.handle('orders:byMobile', async (_e, mobile: string) => {
  const q = (mobile ?? '').trim();
  if (!q) return [];
  const digits = q.replace(/\D+/g,'');
  return db.prepare(`
    SELECT id, number, opened_at, created_at, order_type, status, mobile, full_name, grand_total
    FROM orders
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(mobile,'-',''),' ',''),'+',''),'(','') LIKE ?
      AND (order_type = 1 OR order_type = 2)
    ORDER BY COALESCE(opened_at, strftime('%s', COALESCE(created_at,'now'))*1000) DESC
    LIMIT 5
  `).all(`%${digits}%`);
});

function currentSessionId() {
  return getMeta('device_id') || 'local';
}

// list cart + totals
ipcMain.handle('cart:list', async () => {
  const rows = db.prepare(`
    SELECT * FROM cart ORDER BY created_at ASC, rowid ASC
  `).all();
  return { rows, totals: cartTotals() };
});

// clear cart
ipcMain.handle('cart:clear', async () => {
  db.prepare(`DELETE FROM cart`).run();
  return { ok: true, totals: cartTotals() };
});

// add/merge item into cart
ipcMain.handle('cart:add', async (_e, payload: {
  item_id: string;
  item_name: string;
  item_name_ar?: string;
  item_image?: string;
  price: number;
  qty?: number;
  // optional
  variation_id?: string|null;
  variation?: string|null;
  variation_ar?: string|null;
  variation_price?: number|null;
  addons_id?: string|null;        // comma-separated ids or JSON array string
  addons_name?: string|null;
  addons_name_ar?: string|null;
  addons_price?: string|null;     // CSV or JSON array of numbers
  addons_qty?: string|null;       // CSV or JSON array of numbers
  item_notes?: string|null;
}) => {
  const now = nowMs();
  const sid = currentSessionId();
  const q = Number(payload.qty ?? 1) || 1;

  // Merge keys: item + variation + addons_id
  const keyItem = String(payload.item_id);
  const keyVar  = payload.variation_id ? String(payload.variation_id) : null;
  const keyAdds = payload.addons_id ? String(payload.addons_id) : null;

  const existing = db.prepare(`
    SELECT * FROM cart
    WHERE item_id = ? AND IFNULL(variation_id,'') = IFNULL(?, '') AND IFNULL(addons_id,'') = IFNULL(?, '')
    LIMIT 1
  `).get(keyItem, keyVar, keyAdds) as any;

  if (existing) {
    const newQty = (Number(existing.qty) || 0) + q;
    db.prepare(`UPDATE cart SET qty = ?, updated_at = ? WHERE id = ?`)
      .run(newQty, now, existing.id);
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

// set quantity (absolute)
ipcMain.handle('cart:setQty', async (_e, id: string, qty: number) => {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) throw new Error('Invalid qty');
  db.prepare(`UPDATE cart SET qty = ?, updated_at = ? WHERE id = ?`).run(q, nowMs(), id);
  return { ok: true, totals: cartTotals() };
});

// increment or decrement by 1
ipcMain.handle('cart:inc', async (_e, id: string) => {
  db.prepare(`UPDATE cart SET qty = qty + 1, updated_at = ? WHERE id = ?`).run(nowMs(), id);
  return { ok: true, totals: cartTotals() };
});
ipcMain.handle('cart:dec', async (_e, id: string) => {
  const row = db.prepare(`SELECT qty FROM cart WHERE id = ?`).get(id) as any;
  const q = Number(row?.qty || 0);
  if (q <= 1) {
    db.prepare(`DELETE FROM cart WHERE id = ?`).run(id);
  } else {
    db.prepare(`UPDATE cart SET qty = qty - 1, updated_at = ? WHERE id = ?`).run(nowMs(), id);
  }
  return { ok: true, totals: cartTotals() };
});

// remove line
ipcMain.handle('cart:remove', async (_e, id: string) => {
  db.prepare(`DELETE FROM cart WHERE id = ?`).run(id);
  return { ok: true, totals: cartTotals() };
});

// notes
ipcMain.handle('cart:setNotes', async (_e, id: string, note: string) => {
  db.prepare(`UPDATE cart SET item_notes = ?, updated_at = ? WHERE id = ?`).run(note ?? null, nowMs(), id);
  return { ok: true };
});

// cart context (order_type, city_id, void_delivery_fee)
ipcMain.handle('cart:setContext', async (_e, ctx: { order_type?: number; city_id?: string|null; void_delivery_fee?: boolean }) => {
  if (ctx.order_type != null) db.prepare(`INSERT INTO meta(key,value) VALUES('cart.order_type', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(ctx.order_type));
  if (ctx.city_id !== undefined) db.prepare(`INSERT INTO meta(key,value) VALUES('cart.city_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(ctx.city_id ? String(ctx.city_id) : '');
  if (ctx.void_delivery_fee != null) db.prepare(`INSERT INTO meta(key,value) VALUES('cart.void_delivery_fee', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(ctx.void_delivery_fee ? '1' : '0');
  return { ok: true, totals: cartTotals() };
});

function readSettingRaw(key: string): string | null {
  return db.prepare(`SELECT value FROM app_settings WHERE key = ?`).pluck().get(key) ?? null;
}
function readSettingBool(key: string, fallback = false): boolean {
  const v = (readSettingRaw(key) ?? '').toString().trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}
function readSettingNumber(key: string, fallback = 0): number {
  const n = Number(readSettingRaw(key));
  return Number.isFinite(n) ? n : fallback;
}

ipcMain.handle('settings:get', async (_e, key: string) => readSettingRaw(key));
ipcMain.handle('settings:getBool', async (_e, key: string, fallback = false) => readSettingBool(key, fallback));
ipcMain.handle('settings:getNumber', async (_e, key: string, fallback = 0) => readSettingNumber(key, fallback));
ipcMain.handle('settings:all', async () => {
  return db.prepare(`SELECT key, value FROM app_settings ORDER BY key ASC`).all();
});


// ---------- Orders core (local) ----------
function recalcOrderTotals(orderId: string) {
  const sums = db.prepare(`
    SELECT
      COALESCE(SUM(qty * unit_price), 0) AS subtotal
    FROM order_lines
    WHERE order_id = ?
  `).get(orderId) as { subtotal: number };

  const row = db.prepare(`SELECT COALESCE(delivery_fee,0) AS delivery_fee FROM orders WHERE id = ?`).get(orderId) as any;
  const delivery_fee   = Number(row?.delivery_fee || 0);
  const subtotal       = Number(sums?.subtotal || 0);
  const tax_total      = 0;                    // 🔕 no tax
  const discount_total = 0;                    // (add promos later)
  const grand_total    = subtotal + delivery_fee - discount_total;

  db.prepare(`
    UPDATE orders
    SET subtotal = ?, tax_total = ?, discount_total = ?, grand_total = ?
    WHERE id = ?
  `).run(subtotal, tax_total, discount_total, grand_total, orderId);

  return { subtotal, tax_total, discount_total, delivery_fee, grand_total };
}

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
  // Handler for orders that are prepared/ready for pickup/delivery
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
  const number = `POS-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const now = Date.now();

  db.prepare(`
    INSERT INTO orders (id, number, device_id, branch_id, status, subtotal, tax_total, discount_total, grand_total, opened_at)
    VALUES (?, ?, ?, ?, 'open', 0, 0, 0, 0, ?)
  `).run(id, number, deviceId, branchId, now);

  return { id, number, device_id: deviceId, branch_id: branchId, opened_at: now, status: 'open' };
});

ipcMain.handle('orders:setType', async (_e, orderId: string, type: 1 | 2 | 3) => {
  db.prepare(`UPDATE orders SET order_type = ? WHERE id = ?`).run(type, orderId);
  // Return the updated order object
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  return { ok: true, order };
});

ipcMain.handle('orders:get', async (_e, orderId: string) => {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  const lines = db.prepare(`
    SELECT id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id
    FROM order_lines WHERE order_id = ?
    ORDER BY rowid ASC
  `).all(orderId);
  return { order, lines };
});

ipcMain.handle('orders:addLine', async (_e, orderId: string, itemId: string, qty = 1) => {
  const item = db.prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`).get(itemId) as any;
  if (!item) throw new Error('Item not found');

  const existing = db.prepare(`
    SELECT id, qty, unit_price FROM order_lines
    WHERE order_id = ? AND item_id = ?
  `).get(orderId, itemId) as any;

  if (existing) {
    const newQty = existing.qty + qty;
    const newTotal = newQty * existing.unit_price;
    db.prepare(`UPDATE order_lines SET qty = ?, line_total = ? WHERE id = ?`)
      .run(newQty, newTotal, existing.id);
  } else {
    const id = crypto.randomUUID();
    const unit = Number(item.price || 0);
    db.prepare(`
      INSERT INTO order_lines (id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)
    `).run(id, orderId, item.id, item.name, qty, unit, qty * unit);
  }

  const totals = recalcOrderTotals(orderId);
  const refreshed = db.prepare(`SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`).all(orderId);
  return { totals, lines: refreshed };
});

ipcMain.handle('orders:close', async (_e, orderId: string) => {
  const now = Date.now();
  recalcOrderTotals(orderId);
  db.prepare(`
    UPDATE orders SET status = 'closed', closed_at = ? WHERE id = ?
  `).run(now, orderId);
  return { ok: true, closed_at: now };
});

// ---------- Settings (store simple KV now; wire server later) ----------
ipcMain.handle('settings:getAll', async () => {
  return db.prepare(`SELECT key, value FROM meta ORDER BY key ASC`).all();
});

ipcMain.handle('settings:set', async (_e, key: string, value: string) => {
  setMeta(key, value);
  return { ok: true };
});

function getOrderWithLines(orderId: string) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
  const lines = db.prepare(`
    SELECT id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id
    FROM order_lines
    WHERE order_id = ?
    ORDER BY rowid ASC
  `).all(orderId);
  return { order, lines };
}

ipcMain.handle('orders:createFromCart', async (_e, customerData: {
  full_name: string;
  mobile: string;
  address: string | null;
  note: string | null;
  payment_method_id: string;
  payment_method_slug: string;
}) => {
  // DO NOT call another handler. Call the underlying functions directly.
  const rows = db.prepare(`SELECT * FROM cart ORDER BY created_at ASC, rowid ASC`).all();
  const totals = cartTotals();
  if (!rows || rows.length === 0) {
    throw new Error('Cannot create order from an empty cart.');
  }

  const deviceId = getMeta('device_id');
  const branchId = Number(getMeta('branch_id') ?? 0);
  const orderType = Number(getMeta('cart.order_type') || 2);

  const orderId = crypto.randomUUID();
  const orderNumber = `POS-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO orders (id, number, device_id, branch_id, order_type, status, full_name, mobile, address, note, payment_method_id, payment_method_slug, subtotal, discount_total, delivery_fee, grand_total, opened_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(orderId, orderNumber, deviceId, branchId, orderType, customerData.full_name, customerData.mobile, customerData.address, customerData.note, customerData.payment_method_id, customerData.payment_method_slug, totals.subtotal, totals.discount_total, totals.delivery_fee, totals.grand_total, now);

    const lineInsert = db.prepare(`
      INSERT INTO order_lines (id, order_id, item_id, name, name_ar, qty, unit_price, line_total, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of rows) {
      lineInsert.run(crypto.randomUUID(), orderId, item.item_id, item.item_name, item.item_name_ar, item.qty, item.price, calcLineTotal(item), item.item_notes);
    }

    db.prepare('DELETE FROM cart').run();
  })();

  return getOrderWithLines(orderId);
});