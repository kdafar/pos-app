import { shell, type IpcMain } from 'electron';
import crypto from 'node:crypto';
import type { MainServices } from '../types/common';

// ⚙️ Utils
import { allocUniqueOrderNumber } from '../utils/orderNumbers';
import { recalcOrderTotals } from '../utils/calculations';
import { logAction } from '../utils/logging';

export function registerOrdersHandlers(
  ipcMain: IpcMain,
  services: MainServices
) {
  const { rawDb, store } = services;
  const nowMs = () => Date.now();

  // ─────────────────────────────────────────────────────────────
  // 🛡️ LOCAL HELPERS
  // ─────────────────────────────────────────────────────────────

  const hasColumn = (table: string, column: string): boolean => {
    try {
      const cols = rawDb
        .prepare<unknown[]>(`PRAGMA table_info(${table})`)
        .all() as any[];
      return cols.some((c) => c.name === column);
    } catch {
      return false;
    }
  };

  const isPosLocked = (): boolean => {
    const val = store.get('pos.locked');
    return (
      String(val).toLowerCase() === '1' || String(val).toLowerCase() === 'true'
    );
  };

  const getCurrentPosUser = () => {
    const rawId = store.get('auth.user_id');
    const id = rawId != null && rawId !== '' ? String(rawId) : null;
    if (!id) return { id: null, isAdmin: true };
    try {
      const u = rawDb
        .prepare(`SELECT role FROM pos_users WHERE id = ?`)
        .get(id) as any;
      const role = (u?.role || '').toLowerCase();
      const isAdmin = ['admin', 'owner', 'manager', 'super_admin'].includes(
        role
      );
      return { id, isAdmin };
    } catch {
      return { id, isAdmin: true };
    }
  };

  const buildUserFilter = (alias: string) => {
    const { id, isAdmin } = getCurrentPosUser();
    const hasCreated = hasColumn('orders', 'created_by_user_id');
    const hasCompleted = hasColumn('orders', 'completed_by_user_id');

    if (!id || isAdmin || (!hasCreated && !hasCompleted)) {
      return { sql: '', params: {} as Record<string, any> };
    }

    let expr = '';
    if (hasCreated && hasCompleted) {
      expr = `COALESCE(${alias}.created_by_user_id, ${alias}.completed_by_user_id)`;
    } else if (hasCreated) {
      expr = `${alias}.created_by_user_id`;
    } else {
      expr = `${alias}.completed_by_user_id`;
    }

    return {
      sql: ` AND ${expr} = @user_id `,
      params: { user_id: id },
    };
  };

  const getOrderRow = (orderId: string) => {
    return rawDb.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as
      | any
      | undefined;
  };

  const assertOrderEditable = (orderId: string) => {
    const order = getOrderRow(orderId);
    if (!order) throw new Error('Order not found');

    const { isAdmin } = getCurrentPosUser();
    const locked =
      hasColumn('orders', 'is_locked') && Number(order.is_locked ?? 0) === 1;
    const status = (order.status || '').toLowerCase();

    if (!isAdmin) {
      if (locked) throw new Error('Order is locked');
      if (['completed', 'cancelled', 'closed'].includes(status)) {
        throw new Error('Completed orders cannot be edited');
      }
    }
    return order;
  };

  function getOrderWithLines(orderId: string) {
    const order = getOrderRow(orderId);
    if (!order) return null;

    const lines = rawDb
      .prepare(
        `SELECT * FROM order_lines WHERE order_id = ? ORDER BY rowid ASC`
      )
      .all(orderId) as any[];

    if (order.table_id && hasColumn('tables', 'label')) {
      const t = rawDb
        .prepare(
          `SELECT COALESCE(label, 'Table '||number) as name FROM tables WHERE id = ?`
        )
        .get(order.table_id) as any;
      order.table_name = t?.name || order.table_name;
    }

    return { order, lines };
  }

  function recalcAndGet(orderId: string) {
    try {
      recalcOrderTotals(services, orderId);
    } catch (e) {
      console.error('Recalc failed', e);
    }
    return getOrderWithLines(orderId);
  }

  const log = (action: string, orderId: string | null, payload: any = null) => {
    try {
      logAction(services, orderId, action, payload);
    } catch {
      /* ignore */
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 📋 LISTING / QUERY
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle('orders:listOpen', async () => {
    const { sql: userSql, params } = buildUserFilter('o');
    return rawDb
      .prepare(
        `SELECT o.* FROM orders o WHERE o.status IN ('open', 'pending') ${userSql} ORDER BY o.opened_at DESC, o.created_at DESC`
      )
      .all(params);
  });

  ipcMain.handle('orders:listActive', async () => {
    const { sql: userSql, params } = buildUserFilter('o');
    // Only show orders from the last 24 hours to hide "yesterday's" orders
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const rows = rawDb
      .prepare(
        `
        SELECT o.*
        FROM orders o
        WHERE o.status IN ('open', 'pending', 'ready', 'prepared')
        AND (o.opened_at > @cutoff OR o.created_at > @cutoff)
        ${userSql}
        ORDER BY o.opened_at DESC, o.created_at DESC
      `
      )
      .all({ ...params, cutoff }) as any[];
    return rows;
  });

  ipcMain.handle('orders:listPrepared', async () => {
    const { sql: userSql, params } = buildUserFilter('o');
    return rawDb
      .prepare(
        `SELECT o.* FROM orders o WHERE o.status IN ('prepared', 'ready') ${userSql} ORDER BY o.updated_at DESC`
      )
      .all(params);
  });

  ipcMain.handle('orders:listByDate', async (_evt, args: any) => {
    const from = Number(args?.from ?? 0);
    const to = Number(args?.to ?? 0);
    const status = (args?.status ?? '').toString().trim();
    const branchId = args?.branch_id;
    const { sql: userSql, params: userParams } = buildUserFilter('orders');
    const where: string[] = ['1=1'];
    const params: any = { ...userParams };

    if (from > 0) {
      where.push('created_at >= @from');
      params.from = from;
    }
    if (to > 0) {
      where.push('created_at <= @to');
      params.to = to;
    }
    if (status) {
      where.push('status = @status');
      params.status = status;
    }
    if (branchId) {
      where.push('branch_id = @branch_id');
      params.branch_id = branchId;
    }

    const sql = `SELECT * FROM orders WHERE ${where.join(
      ' AND '
    )} ${userSql} ORDER BY created_at DESC LIMIT 500`;
    return rawDb.prepare(sql).all(params);
  });

  ipcMain.handle('orders:listAll', async () => {
    const { sql: userSql, params } = buildUserFilter('orders');
    return rawDb
      .prepare(
        `SELECT * FROM orders WHERE 1=1 ${userSql} ORDER BY created_at DESC LIMIT 100`
      )
      .all(params);
  });

  // ─────────────────────────────────────────────────────────────
  // 🚀 CORE ORDER LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle('orders:start', async () => {
    if (isPosLocked()) throw new Error('POS is locked');
    const id = crypto.randomUUID();
    const ts = nowMs();
    const number = allocUniqueOrderNumber(services);
    const orderType = 2;

    const deviceId = store.get('device_id');
    const branchId = Number(store.get('branch_id') || 0);
    const { id: userId } = getCurrentPosUser();

    const cols = [
      'id',
      'number',
      'status',
      'order_type',
      'device_id',
      'branch_id',
      'subtotal',
      'grand_total',
      'opened_at',
    ];
    const vals = [id, number, 'open', orderType, deviceId, branchId, 0, 0, ts];
    const placeholders = ['?', '?', '?', '?', '?', '?', '?', '?', '?'];

    if (hasColumn('orders', 'created_at')) {
      cols.push('created_at');
      placeholders.push('?');
      vals.push(ts);
    }
    if (hasColumn('orders', 'created_by_user_id')) {
      cols.push('created_by_user_id');
      placeholders.push('?');
      vals.push(userId);
    }

    rawDb
      .prepare(
        `INSERT INTO orders (${cols.join(',')}) VALUES (${placeholders.join(
          ','
        )})`
      )
      .run(...vals);
    log('orders.start', id, { number, order_type: orderType });
    return getOrderWithLines(id);
  });

  ipcMain.handle(
    'orders:setType',
    async (_e, orderId: string, type: 1 | 2 | 3) => {
      if (isPosLocked()) throw new Error('POS is locked');
      assertOrderEditable(orderId);
      rawDb
        .prepare(
          `UPDATE orders SET order_type = ?, updated_at = ? WHERE id = ?`
        )
        .run(type, nowMs(), orderId);
      log('orders.setType', orderId, { type });
      return recalcAndGet(orderId);
    }
  );

  ipcMain.handle('orders:get', async (_e, orderId: string) =>
    getOrderWithLines(orderId)
  );

  // ─────────────────────────────────────────────────────────────
  // 🛒 LINES / ITEMS
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'orders:addLine',
    async (_e, orderId: string, itemId: string, qty = 1) => {
      if (isPosLocked()) throw new Error('POS is locked');
      assertOrderEditable(orderId);

      const item = rawDb
        .prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`)
        .get(itemId) as any;
      if (!item) throw new Error('Item not found');

      const row = rawDb
        .prepare(
          `SELECT id, qty, unit_price FROM order_lines WHERE order_id = ? AND item_id = ? AND variation_id IS NULL AND addons_id IS NULL`
        )
        .get(orderId, itemId) as any;

      if (row) {
        const newQty = Number(row.qty || 0) + Number(qty || 0);
        if (newQty <= 0) {
          rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`).run(row.id);
        } else {
          const newTotal = +(newQty * Number(row.unit_price || 0)).toFixed(3);
          rawDb
            .prepare(
              `UPDATE order_lines SET qty = ?, line_total = ? WHERE id = ?`
            )
            .run(newQty, newTotal, row.id);
        }
      } else if (qty > 0) {
        const id = crypto.randomUUID();
        const unit = Number(item.price || 0);
        rawDb
          .prepare(
            `INSERT INTO order_lines (id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id, name_ar) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`
          )
          .run(
            id,
            orderId,
            item.id,
            item.name,
            qty,
            unit,
            +(qty * unit).toFixed(3),
            item.name_ar ?? null
          );
      }
      return recalcAndGet(orderId);
    }
  );

  ipcMain.handle(
    'orders:setLineQty',
    async (_e, lineId: string, qty: number) => {
      if (isPosLocked()) throw new Error('POS is locked');
      const line = rawDb
        .prepare(`SELECT * FROM order_lines WHERE id = ?`)
        .get(lineId) as any;
      if (!line) throw new Error('Line not found');
      assertOrderEditable(line.order_id);

      if (qty <= 0) {
        rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`).run(lineId);
      } else {
        const unit = Number(line.unit_price || 0);
        const lineTotal = +(unit * qty).toFixed(3);
        rawDb
          .prepare(
            `UPDATE order_lines SET qty = ?, line_total = ?, updated_at = ? WHERE id = ?`
          )
          .run(qty, lineTotal, nowMs(), lineId);
      }
      return recalcAndGet(line.order_id);
    }
  );

  ipcMain.handle('orders:removeLine', async (_e, lineId: string) => {
    if (isPosLocked()) throw new Error('POS is locked');
    const line = rawDb
      .prepare(`SELECT * FROM order_lines WHERE id = ?`)
      .get(lineId) as any;
    if (!line) return null;
    assertOrderEditable(line.order_id);
    rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`).run(lineId);
    return recalcAndGet(line.order_id);
  });

  ipcMain.handle(
    'orders:removeLineByItem',
    async (_e, orderId: string, itemId: string) => {
      if (isPosLocked()) throw new Error('POS is locked');
      assertOrderEditable(orderId);
      rawDb
        .prepare(`DELETE FROM order_lines WHERE order_id = ? AND item_id = ?`)
        .run(orderId, itemId);
      return recalcAndGet(orderId);
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 🏷️ PROMO & STATUS
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle('orders:removePromo', async (_e, orderId: string) => {
    if (isPosLocked()) throw new Error('POS is locked');
    assertOrderEditable(orderId);
    rawDb
      .prepare(
        `UPDATE orders SET promocode = NULL, updated_at = ? WHERE id = ?`
      )
      .run(nowMs(), orderId);
    return recalcAndGet(orderId);
  });

  ipcMain.handle(
    'orders:applyPromo',
    async (_e, orderId: string, promoCode: string | null) => {
      if (isPosLocked()) throw new Error('POS is locked');
      assertOrderEditable(orderId);
      rawDb
        .prepare(`UPDATE orders SET promocode = ?, updated_at = ? WHERE id = ?`)
        .run(promoCode?.trim().toUpperCase(), nowMs(), orderId);
      // Return full order so frontend updates immediately
      return recalcAndGet(orderId);
    }
  );

  ipcMain.handle('orders:close', async (_e, orderId: string) => {
    recalcOrderTotals(services, orderId);
    rawDb
      .prepare(
        `UPDATE orders SET status = 'closed', updated_at = ? WHERE id = ?`
      )
      .run(nowMs(), orderId);
    return getOrderWithLines(orderId);
  });

  ipcMain.handle('orders:reopen', async (_e, orderId: string) => {
    rawDb
      .prepare(`UPDATE orders SET status = 'open', updated_at = ? WHERE id = ?`)
      .run(nowMs(), orderId);
    return getOrderWithLines(orderId);
  });

  ipcMain.handle('orders:cancel', async (_e, orderId: string) => {
    if (isPosLocked()) throw new Error('POS is locked');
    rawDb
      .prepare(
        `UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?`
      )
      .run(nowMs(), orderId);
    return getOrderWithLines(orderId);
  });

  // ─────────────────────────────────────────────────────────────
  // ✅ CHECKOUT / COMPLETE (FIXED: Column checks)
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'orders:complete',
    async (_e, orderId: string, customer: any) => {
      if (isPosLocked()) throw new Error('POS is locked');
      assertOrderEditable(orderId);
      const order = getOrderRow(orderId);
      if (!order) throw new Error('Order not found');

      const type = Number(order.order_type || 0);
      const errors: string[] = [];
      if (!customer.full_name?.trim()) errors.push('Customer name is required');
      if (type === 1 && !customer.address)
        errors.push('Address is required for delivery');
      if (type === 3 && !order.table_id)
        errors.push('Table must be assigned for dine-in');
      if (errors.length) throw new Error(errors.join('\n'));

      const ts = nowMs();
      const { id: userId } = getCurrentPosUser();
      const totals = recalcOrderTotals(services, orderId);

      const cols = [
        "status = 'completed'",
        'full_name = ?',
        'mobile = ?',
        'address = ?',
        'note = ?',
        'payment_method_id = ?',
        'payment_method_slug = ?',
        'subtotal = ?',
        'grand_total = ?',
        'updated_at = ?',
      ];

      const params: any[] = [
        customer.full_name,
        customer.mobile ?? '',
        customer.address ?? '',
        customer.note ?? '',
        customer.payment_method_id,
        customer.payment_method_slug ?? '',
        totals.subtotal,
        totals.grand_total,
        ts,
      ];

      // FIX 2: Check for completed_at OR closed_at
      if (hasColumn('orders', 'completed_at')) {
        cols.push('completed_at = ?');
        params.push(ts);
      } else if (hasColumn('orders', 'closed_at')) {
        // Fallback for older schemas
        cols.push('closed_at = ?');
        params.push(ts);
      }

      if (hasColumn('orders', 'completed_by_user_id')) {
        cols.push('completed_by_user_id = ?');
        params.push(userId);
      }

      if (hasColumn('orders', 'is_locked')) {
        cols.push('is_locked = 1');
      }

      params.push(orderId);

      const sql = `UPDATE orders SET ${cols.join(', ')} WHERE id = ?`;

      try {
        rawDb.prepare(sql).run(...params);
      } catch (err: any) {
        console.error('Orders:complete SQL Error:', err.message);
        throw new Error('Database error during completion: ' + err.message);
      }

      if (order.table_id)
        rawDb
          .prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`)
          .run(order.table_id);

      log('orders.complete', orderId, { customer, totals });
      return recalcAndGet(orderId);
    }
  );

  // ... (markPrinted, paymentLink, createFromCart omitted but assumed present)
  ipcMain.handle('orders:markPrinted', async (_e, orderId: string) => {
    const ts = nowMs();
    const cols = ['printed_at = ?', 'updated_at = ?'];
    if (hasColumn('orders', 'is_locked')) cols.push('is_locked = 1');
    rawDb
      .prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`)
      .run(ts, ts, orderId);
    return getOrderWithLines(orderId);
  });

  ipcMain.handle(
    'orders:paymentLink:set',
    async (_e, orderId: string, url: string) => {
      rawDb
        .prepare(
          `UPDATE orders SET payment_link_url = ?, payment_link_status = 'pending', updated_at = ? WHERE id = ?`
        )
        .run(url, nowMs(), orderId);
      return getOrderWithLines(orderId);
    }
  );

  ipcMain.handle(
    'orders:paymentLink:status',
    async (_e, orderId: string, status: string) => {
      const isPaid = ['paid', 'captured', 'success'].includes(
        status.toLowerCase()
      );
      rawDb
        .prepare(
          `UPDATE orders SET payment_link_status = ?, payment_link_verified_at = ?, updated_at = ? WHERE id = ?`
        )
        .run(status, isPaid ? nowMs() : null, nowMs(), orderId);
      return getOrderWithLines(orderId);
    }
  );

  ipcMain.handle('orders:createFromCart', async (_e, customerData: any) => {
    if (isPosLocked()) throw new Error('POS is locked');
    const cartItems = rawDb
      .prepare(`SELECT * FROM cart ORDER BY created_at ASC`)
      .all() as any[];
    if (cartItems.length === 0) throw new Error('Cart is empty');

    const id = crypto.randomUUID();
    const ts = nowMs();
    const number = allocUniqueOrderNumber(services);
    const { id: userId } = getCurrentPosUser();
    const orderType = Number(store.get('cart.order_type') || 2);

    const parseNumList = (input: any) => {
      try {
        const j = JSON.parse(input);
        return Array.isArray(j) ? j.map(Number) : [Number(j)];
      } catch {
        return [];
      }
    };
    const calcLineTotal = (row: any) => {
      const p = Number(row.price || 0),
        vp = Number(row.variation_price);
      const base = vp > 0 ? vp : p;
      let aTotal = 0;
      parseNumList(row.addons_price).forEach((price, i) => {
        aTotal += price * (parseNumList(row.addons_qty)[i] || 1);
      });
      return +((base + aTotal) * (row.qty || 1)).toFixed(3);
    };

    const cols = [
      'id',
      'number',
      'status',
      'order_type',
      'device_id',
      'branch_id',
      'full_name',
      'mobile',
      'address',
      'note',
      'payment_method_id',
      'subtotal',
      'grand_total',
      'opened_at',
      'created_at',
    ];
    const vals = [
      id,
      number,
      'completed',
      orderType,
      store.get('device_id'),
      Number(store.get('branch_id') || 0),
      customerData.full_name,
      customerData.mobile,
      customerData.address,
      customerData.note,
      customerData.payment_method_id,
      0,
      0,
      ts,
      ts,
    ];
    const ph = cols.map(() => '?');

    if (hasColumn('orders', 'created_by_user_id')) {
      cols.push('created_by_user_id');
      ph.push('?');
      vals.push(userId);
    }
    if (hasColumn('orders', 'completed_by_user_id')) {
      cols.push('completed_by_user_id');
      ph.push('?');
      vals.push(userId);
    }
    if (hasColumn('orders', 'is_locked')) {
      cols.push('is_locked');
      ph.push('1');
    }

    rawDb.transaction(() => {
      rawDb
        .prepare(
          `INSERT INTO orders (${cols.join(',')}) VALUES (${ph.join(',')})`
        )
        .run(...vals);
      const lineStmt = rawDb.prepare(
        `INSERT INTO order_lines (id, order_id, item_id, name, name_ar, qty, unit_price, line_total, notes, variation_id, variation, variation_price, addons_id, addons_name, addons_price, addons_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of cartItems) {
        const unit =
          Number(item.variation_price) > 0
            ? Number(item.variation_price)
            : Number(item.price);
        lineStmt.run(
          crypto.randomUUID(),
          id,
          item.item_id,
          item.item_name,
          item.item_name_ar,
          item.qty,
          unit,
          calcLineTotal(item),
          item.item_notes,
          item.variation_id,
          item.variation,
          item.variation_price,
          item.addons_id,
          item.addons_name,
          item.addons_price,
          item.addons_qty
        );
      }
      rawDb.prepare('DELETE FROM cart').run();
    })();

    return recalcAndGet(id);
  });

  // ─────────────────────────────────────────────────────────────
  // 🍽️ TABLES (FIXED: Removed table_name update)
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'orders:setTable',
    async (_e, orderId: string, payload: any) => {
      const ts = nowMs();
      const tableId = payload?.table_id;
      const covers = payload?.covers ?? 1;
      const table = rawDb
        .prepare(`SELECT * FROM tables WHERE id = ?`)
        .get(tableId) as any;
      if (!table) throw new Error('Table not found');

      const o = getOrderRow(orderId);
      if (!o) throw new Error('Order not found');
      if (Number(o.order_type) !== 3) throw new Error('Order is not dine-in');

      // FIX 1: Removed 'table_name' from query
      rawDb.transaction(() => {
        if (o.table_id && o.table_id !== tableId) {
          rawDb
            .prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`)
            .run(o.table_id);
        }
        rawDb
          .prepare(`UPDATE tables SET is_available = 0 WHERE id = ?`)
          .run(tableId);
        rawDb
          .prepare(
            `UPDATE orders SET table_id = ?, covers = ?, updated_at = ? WHERE id = ?`
          )
          .run(tableId, covers, ts, orderId);
      })();
      return getOrderWithLines(orderId);
    }
  );

  ipcMain.handle('orders:clearTable', async (_e, orderId: string) => {
    rawDb.transaction(() => {
      const o = getOrderRow(orderId);
      if (o?.table_id)
        rawDb
          .prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`)
          .run(o.table_id);
      // FIX 1: Removed 'table_name' from query
      rawDb
        .prepare(
          `UPDATE orders SET table_id = NULL, covers = NULL, updated_at = ? WHERE id = ?`
        )
        .run(nowMs(), orderId);
    })();
    return getOrderWithLines(orderId);
  });

  // ─────────────────────────────────────────────────────────────
  // 🌐 UTILS & SHELL
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!url) return;
    await shell.openExternal(url);
    return { ok: true };
  });
}
