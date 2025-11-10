// src/main/handlers/orders.ts
import type { IpcMain } from 'electron'
import type { Database as BetterSqliteDB } from 'better-sqlite3'

type Services = {
  store: { get(k: string): any; set(k: string, v: any): void; delete(k: string): void }
}

function now() { return Date.now() }
function getCurrentUserId(services: Services): number | null {
  const id = services.store.get('auth.user_id')
  return id != null ? Number(id) : null
}

function isPosLocked(db: BetterSqliteDB): boolean {
  // kill switch: meta('pos.locked') === '1'
  try {
    // try common meta tables
    const row =
      db.prepare(`SELECT value FROM app_meta WHERE key='pos.locked'`).get() as any
      || db.prepare(`SELECT value FROM meta WHERE key='pos.locked'`).get() as any
      || db.prepare(`SELECT value FROM pos_meta WHERE key='pos.locked'`).get() as any
    const v = (row?.value ?? '0').toString()
    return v === '1' || v.toLowerCase() === 'true'
  } catch { return false }
}

function ensureSchema(db: BetterSqliteDB) {
  // action log
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT,
      action TEXT NOT NULL,
      payload TEXT,
      performed_by_user_id INTEGER,
      created_at INTEGER NOT NULL
    );
  `)

  // tables (minimal – will be seeded by sync)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seats INTEGER DEFAULT 2
    );
  `)

  // orders: add late columns (ignore if they already exist)
  const add = (sql: string) => { try { db.exec(sql) } catch { /* no-op if exists */ } }

  add(`ALTER TABLE orders ADD COLUMN created_by_user_id INTEGER`)
  add(`ALTER TABLE orders ADD COLUMN completed_by_user_id INTEGER`)
  add(`ALTER TABLE orders ADD COLUMN printed_by_user_id INTEGER`)
  add(`ALTER TABLE orders ADD COLUMN printed_at INTEGER`)
  add(`ALTER TABLE orders ADD COLUMN is_locked INTEGER DEFAULT 0`)
  add(`ALTER TABLE orders ADD COLUMN payment_link_url TEXT`)
  add(`ALTER TABLE orders ADD COLUMN payment_link_status TEXT`)
  add(`ALTER TABLE orders ADD COLUMN payment_link_verified_at INTEGER`)
  add(`ALTER TABLE orders ADD COLUMN tax_total REAL DEFAULT 0`)
  add(`ALTER TABLE orders ADD COLUMN customer_name TEXT`)
  add(`ALTER TABLE orders ADD COLUMN customer_mobile TEXT`)
  add(`ALTER TABLE orders ADD COLUMN customer_address TEXT`)
  add(`ALTER TABLE orders ADD COLUMN customer_note TEXT`)
  add(`ALTER TABLE orders ADD COLUMN table_id TEXT`)
  add(`ALTER TABLE orders ADD COLUMN table_name TEXT`)
  add(`ALTER TABLE orders ADD COLUMN covers INTEGER`)
}

function logAction(db: BetterSqliteDB, orderId: string, action: string, payload: any, userId: number | null) {
  db.prepare(
    `INSERT INTO pos_action_log (order_id, action, meta_json, performed_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, action, JSON.stringify(payload ?? null), userId, now())
}

export function registerOrderHandlers(ipcMain: IpcMain, db: BetterSqliteDB, services: Services) {
  ensureSchema(db)

  /* ========== Helpers / queries ========== */
  const qGetOrder = db.prepare(`
    SELECT o.*
    FROM orders o
    WHERE o.id = ?
    LIMIT 1
  `)

  const qTableName = db.prepare(`SELECT name FROM tables WHERE id = ? LIMIT 1`)

  const qListTables = db.prepare(`
    SELECT t.id, t.name, t.seats,
      CASE
        WHEN EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status IN ('open','hold')) THEN 'occupied'
        ELSE 'available'
      END AS status
    FROM tables t
    ORDER BY t.name COLLATE NOCASE
  `)

  /* ========== IPC: tables:list ========== */
  ipcMain.handle('tables:list', () => {
    const rows = qListTables.all() as Array<{id:string;name:string;seats:number;status:string}>
    return rows.map(r => ({ ...r, current_order_id: null })) // you can enrich if you track mapping
  })

  /* ========== IPC: orders:setTable(orderId, tableId) ========== */
  ipcMain.handle('orders:setTable', (_e, orderId: string, tableId: string) => {
    if (isPosLocked(db)) throw new Error('POS is locked')

    const userId = getCurrentUserId(services)
    const order = qGetOrder.get(orderId) as any
    if (!order) throw new Error('Order not found')
    if (order.is_locked) throw new Error('Order is locked')

    const tname = (qTableName.get(tableId) as any)?.name ?? null

    const tx = db.transaction(() => {
      db.prepare(`UPDATE orders SET table_id=?, table_name=?, updated_at=? WHERE id=?`)
        .run(tableId, tname, now(), orderId)
      logAction(db, orderId, 'orders:setTable', { table_id: tableId, table_name: tname }, userId)
    })
    tx()

    return { ok: true, table_id: tableId, table_name: tname }
  })

  /* ========== IPC: orders:complete(orderId, {customer, totals, status}) ========== */
  ipcMain.handle('orders:complete', (_e, orderId: string, payload: {
    customer?: { full_name?: string; mobile?: string; address?: string; note?: string | null }
    totals?: { subtotal: number; discount: number; tax: number; grand_total: number }
    status?: string
  }) => {
    if (isPosLocked(db)) throw new Error('POS is locked')

    const userId = getCurrentUserId(services)
    const order = qGetOrder.get(orderId) as any
    if (!order) throw new Error('Order not found')
    if (order.is_locked) throw new Error('Order is locked')

    const status = payload?.status || 'completed'
    const c = payload?.customer || {}
    const t = payload?.totals || { subtotal: order.subtotal || 0, discount: order.discount_total || 0, tax: order.tax_total || 0, grand_total: order.grand_total || 0 }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET
          status=?,
          completed_by_user_id=?,
          completed_at=?,
          is_locked=1,
          customer_name=?,
          customer_mobile=?,
          customer_address=?,
          customer_note=?,
          subtotal=?,
          discount_total=?,
          tax_total=?,
          grand_total=?,
          updated_at=?
        WHERE id=?
      `).run(
        status,
        userId,
        now(),
        c.full_name || null,
        c.mobile || null,
        c.address || null,
        c.note || null,
        t.subtotal ?? 0,
        t.discount ?? 0,
        t.tax ?? 0,
        t.grand_total ?? 0,
        now(),
        orderId
      )

      logAction(db, orderId, 'orders:complete', payload, userId)
    })
    tx()

    return { ok: true }
  })

  /* ========== IPC: orders:markPrinted(orderId) ========== */
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

  /* ========== IPC: orders:paymentLink:set(orderId, url) ========== */
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

  /* ========== IPC: orders:paymentLink:status(orderId, status) ========== */
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
}
