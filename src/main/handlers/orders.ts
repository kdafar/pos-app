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

    if (!id) {
      return {
        id: null,
        isAdmin: true,
        name: null,
        mobile: null,
        email: null,
      };
    }

    try {
      const u = rawDb
        .prepare(`SELECT role, name, mobile, email FROM pos_users WHERE id = ?`)
        .get(id) as any;

      const role = (u?.role || '').toLowerCase();
      const isAdmin = ['admin', 'owner', 'manager', 'super_admin'].includes(
        role
      );

      return {
        id,
        isAdmin,
        name: u?.name ?? null,
        mobile: u?.mobile ?? null,
        email: u?.email ?? null,
      };
    } catch {
      return {
        id,
        isAdmin: true,
        name: null,
        mobile: null,
        email: null,
      };
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

  const assertOrderEditable = (
    orderId: string,
    opts?: { allowAddOnLockedDineIn?: boolean }
  ) => {
    const order = getOrderRow(orderId);
    if (!order) throw new Error('Order not found');

    const { isAdmin } = getCurrentPosUser();
    const locked =
      hasColumn('orders', 'is_locked') && Number(order.is_locked ?? 0) === 1;
    const status = (order.status || '').toLowerCase();
    const isDineIn = Number(order.order_type) === 3;

    if (!isAdmin) {
      if (locked) {
        const canBypass = opts?.allowAddOnLockedDineIn && isDineIn;

        if (!canBypass) {
          throw new Error('Order is locked');
        }
      }

      if (['completed', 'cancelled', 'closed'].includes(status)) {
        throw new Error('Completed orders cannot be edited');
      }
    }

    return order;
  };

  function getOrderWithLines(orderId: string) {
    const order = getOrderRow(orderId);
    if (!order) return null;

    // detect if order_lines has is_locked column
    const lineHasLock = hasColumn('order_lines', 'is_locked');

    const selectSql = `
      SELECT
        id,
        order_id,
        item_id,
        name,
        name_ar,
        unit_price,
        qty,
        tax_amount,
        discount_amount,
        line_total,
        variation,
        variation_price,
        addons_id,
        addons_name,
        addons_price,
        addons_qty,
        notes,
        ${lineHasLock ? 'is_locked' : '0 AS is_locked'}
      FROM order_lines
      WHERE order_id = ?
      ORDER BY rowid ASC
    `;

    const lines = rawDb.prepare(selectSql).all(orderId) as any[];

    console.log('[orders:getOrderWithLines] lines snapshot', {
      order_id: orderId,
      count: lines.length,
      sample: lines.slice(0, 3).map((l) => ({
        id: l.id,
        name: l.name,
        is_locked: l.is_locked,
      })),
    });

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

    const deviceId = store.get('device_id');
    const branchId = Number(store.get('branch_id') || 0);
    const { id: userId } = getCurrentPosUser();

    let existing: any = null;

    // 🔍 Look for any open/pending order with ZERO lines for this device/branch
    try {
      const whereParts: string[] = [`o.status IN ('open','pending')`];
      const params: any = {};

      if (branchId) {
        whereParts.push('o.branch_id = @branch_id');
        params.branch_id = branchId;
      }
      if (deviceId) {
        whereParts.push('o.device_id = @device_id');
        params.device_id = deviceId;
      }

      const where = whereParts.length
        ? `WHERE ${whereParts.join(' AND ')}`
        : '';

      existing = rawDb
        .prepare(
          `
          SELECT o.id, COUNT(ol.id) AS line_count
          FROM orders o
          LEFT JOIN order_lines ol ON ol.order_id = o.id
          ${where}
          GROUP BY o.id
          HAVING line_count = 0
          ORDER BY o.opened_at DESC, o.created_at DESC
          LIMIT 1
        `
        )
        .get(params) as any;
    } catch (e) {
      console.error('[orders:start] empty-order check SQL error:', e);
      // If query fails, we just fall back to normal creation
    }

    // ♻️ If we found an empty open/pending order, REUSE it instead of creating a new one
    if (existing?.id) {
      console.log('[orders:start] reusing existing empty order:', existing.id);
      return getOrderWithLines(existing.id);
    }

    // ── Normal order creation as before ─────────────────────────
    const id = crypto.randomUUID();
    const ts = nowMs();
    const number = allocUniqueOrderNumber(services);
    const orderType = 2;

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

      const order = getOrderRow(orderId);
      if (!order) throw new Error('Order not found');

      const currentType = Number(order.order_type || 0);
      const status = (order.status || '').toLowerCase();

      const isLocked =
        hasColumn('orders', 'is_locked') && Number(order.is_locked ?? 0) === 1;

      const hasPayment =
        hasColumn('orders', 'payment_method_id') &&
        order.payment_method_id != null &&
        String(order.payment_method_id) !== '';

      // ❌ 1) Do not allow changing type for a dine-in order that has a table
      if (currentType === 3 && order.table_id && type !== 3) {
        throw new Error(
          'Cannot change order type for a dine-in order that has a table assigned.'
        );
      }

      // ❌ 2) Once the order is placed/updated, do not allow type change
      //    (i.e. anything beyond a fresh "open" order with no lock/payment)
      if (
        status !== 'open' || // pending / prepared / ready / completed / closed
        isLocked ||
        hasPayment
      ) {
        throw new Error(
          'Order type cannot be changed after the order has been placed or updated.'
        );
      }

      // ✅ If we get here, it is still a fresh editable order
      rawDb
        .prepare(
          `UPDATE orders SET order_type = ?, updated_at = ? WHERE id = ?`
        )
        .run(type, nowMs(), orderId);

      log('orders.setType', orderId, { from: currentType, to: type });

      return recalcAndGet(orderId);
    }
  );

  ipcMain.handle('orders:get', async (_e, orderId: string) =>
    getOrderWithLines(orderId)
  );

  ipcMain.handle('orders:getForTable', async (_e, tableId: number) => {
    // Finds the active open order for this table
    const order = rawDb
      .prepare(
        `SELECT * FROM orders WHERE table_id = ? AND status NOT IN ('completed', 'cancelled', 'closed') ORDER BY created_at DESC LIMIT 1`
      )
      .get(tableId) as any;

    if (order) {
      return getOrderWithLines(order.id);
    }
    return null;
  });

  // ─────────────────────────────────────────────────────────────
  // 🛒 LINES / ITEMS
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'orders:addLine',
    async (_e, orderId: string, itemId: string, qty = 1) => {
      if (isPosLocked()) throw new Error('POS is locked');

      // Allow adding even if locked for dine-in
      const order = assertOrderEditable(orderId, {
        allowAddOnLockedDineIn: true,
      });

      const item = rawDb
        .prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`)
        .get(itemId) as any;
      if (!item) throw new Error('Item not found');

      const isLockedDineIn =
        Number(order.order_type) === 3 &&
        hasColumn('orders', 'is_locked') &&
        Number(order.is_locked ?? 0) === 1;

      // Look for an *unlocked* line of the same bare item (no variation/addons)
      let row: any = null;

      const hasLineLock = hasColumn('order_lines', 'is_locked');

      const candidates = rawDb
        .prepare(
          `
            SELECT id, qty, unit_price
            ${
              hasLineLock
                ? ', COALESCE(is_locked, 0) AS is_locked'
                : ', 0 AS is_locked'
            }
            FROM order_lines
            WHERE order_id = ? AND item_id = ? AND variation_id IS NULL AND addons_id IS NULL
          `
        )
        .all(orderId, itemId) as any[];

      // Prefer an UNLOCKED line to merge into
      row = candidates.find((l) => Number(l.is_locked || 0) === 0) || null;

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
            `INSERT INTO order_lines (id, order_id, item_id, name, qty, unit_price, tax_amount, line_total, temp_line_id, name_ar)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`
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
    'orders:addLineWithAddons',
    async (
      _e,
      orderId: string,
      itemId: string,
      qty: number = 1,
      payload: any
    ) => {
      if (isPosLocked()) throw new Error('POS is locked');

      // Allow adding even if locked for dine-in (same as addLine)
      const order = assertOrderEditable(orderId, {
        allowAddOnLockedDineIn: true,
      });

      if (qty <= 0) throw new Error('Quantity must be > 0');

      // Base item
      const item = rawDb
        .prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`)
        .get(itemId) as any;
      if (!item) throw new Error('Item not found');

      // (Optional) variation support — for now we ignore; you can extend later
      const variationId = payload?.variation_id || null;
      let variationName: string | null = null;
      let variationPrice: number | null = null;

      if (variationId) {
        const v = rawDb
          .prepare(
            `SELECT id, name, price, sale_price FROM variations WHERE id = ?`
          )
          .get(variationId) as any;
        if (v) {
          variationName = v.name || null;
          variationPrice = Number(v.sale_price || v.price || 0);
        }
      }

      const basePrice =
        variationPrice != null ? variationPrice : Number(item.price || 0);

      // Build addons snapshot
      const selections = Array.isArray(payload?.addons) ? payload.addons : [];

      const addonIds: string[] = [];
      const addonNames: string[] = [];
      const addonPrices: number[] = [];
      const addonQtys: number[] = [];

      for (const sel of selections) {
        if (!sel?.addon_id) continue;
        const a = rawDb
          .prepare(`SELECT id, name, price FROM addons WHERE id = ?`)
          .get(sel.addon_id) as any;
        if (!a) continue;

        const q = Number(sel.qty || 1) || 1;
        const price = Number(a.price || 0);

        addonIds.push(a.id);
        addonPrices.push(price);
        addonQtys.push(q);

        // Nice label: "Ketchup" or "Ketchup ×2"
        const label = q > 1 ? `${a.name} ×${q}` : a.name;
        addonNames.push(label);
      }

      // Extra per-unit from addons
      let addonsExtraPerUnit = 0;
      addonPrices.forEach((price, idx) => {
        const q = addonQtys[idx] || 1;
        addonsExtraPerUnit += price * q;
      });

      const perUnitTotal = basePrice + addonsExtraPerUnit;
      const lineTotal = +(perUnitTotal * qty).toFixed(3);

      // IMPORTANT: we always insert a NEW line (no merging),
      // so different addon combos stay as separate rows.
      const id = crypto.randomUUID();

      rawDb
        .prepare(
          `
          INSERT INTO order_lines (
            id,
            order_id,
            item_id,
            name,
            name_ar,
            unit_price,
            qty,
            tax_amount,
            discount_amount,
            line_total,
            variation_id,
            variation,
            variation_price,
            addons_id,
            addons_name,
            addons_price,
            addons_qty,
            notes,
            temp_line_id
          ) VALUES (
            @id,
            @order_id,
            @item_id,
            @name,
            @name_ar,
            @unit_price,
            @qty,
            0,
            0,
            @line_total,
            @variation_id,
            @variation,
            @variation_price,
            @addons_id,
            @addons_name,
            @addons_price,
            @addons_qty,
            NULL,
            NULL
          )
        `
        )
        .run({
          id,
          order_id: orderId,
          item_id: item.id,
          name: item.name,
          name_ar: item.name_ar ?? null,
          unit_price: perUnitTotal, // base + addons (per unit)
          qty,
          line_total: lineTotal,
          variation_id: variationId,
          variation: variationName,
          variation_price: variationPrice,
          addons_id: addonIds.length > 0 ? JSON.stringify(addonIds) : null,
          addons_name: addonNames.length > 0 ? addonNames.join(', ') : null,
          addons_price:
            addonPrices.length > 0 ? JSON.stringify(addonPrices) : null,
          addons_qty: addonQtys.length > 0 ? JSON.stringify(addonQtys) : null,
        });

      log('orders.addLineWithAddons', orderId, {
        item_id: item.id,
        qty,
        variation_id: variationId,
        addons: selections,
      });

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

      // DINE-IN LOCK CHECK
      if (hasColumn('order_lines', 'is_locked') && line.is_locked == 1) {
        throw new Error('This item is locked/printed and cannot be modified.');
      }

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

    // DINE-IN LOCK CHECK
    if (hasColumn('order_lines', 'is_locked') && line.is_locked == 1) {
      throw new Error('This item is locked/printed and cannot be removed.');
    }

    assertOrderEditable(line.order_id);
    rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`).run(lineId);
    return recalcAndGet(line.order_id);
  });

  ipcMain.handle(
    'orders:removeLineByItem',
    async (_e, orderId: string, itemId: string) => {
      if (isPosLocked()) throw new Error('POS is locked');
      assertOrderEditable(orderId);

      // Only remove unlocked lines
      let sql = `DELETE FROM order_lines WHERE order_id = ? AND item_id = ?`;
      if (hasColumn('order_lines', 'is_locked')) {
        sql += ` AND (is_locked IS NULL OR is_locked = 0)`;
      }

      rawDb.prepare(sql).run(orderId, itemId);
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
    const ts = nowMs();
    const order = getOrderRow(orderId);
    if (!order) throw new Error('Order not found');

    // ── 0) Basic info ──────────────────────────────────────────────────────────
    const orderType = Number(order.order_type ?? order.type ?? 0);

    // Count items in the order (we only enforce guards when there are items)
    let itemsCount = 0;
    try {
      const row = rawDb
        .prepare('SELECT COUNT(*) AS c FROM order_lines WHERE order_id = ?')
        .get(orderId) as { c?: number };
      itemsCount = row?.c ?? 0;
    } catch (err) {
      console.error('[orders:close] failed to count order_lines', err);
    }

    // ── 0.1) DELIVERY GUARD: require address if there are items ───────────────
    if (itemsCount > 0 && orderType === 1) {
      // Be a bit defensive with field names, in case your schema changed
      const stateId = (order as any).state_id ?? (order as any).state ?? null;
      const cityId = (order as any).city_id ?? (order as any).city ?? null;
      const blockId = (order as any).block_id ?? (order as any).block ?? null;

      if (!stateId || !cityId || !blockId) {
        throw new Error(
          'Delivery address missing. Please select State, City and Block in the checkout screen before closing this delivery order.'
        );
      }
    }

    // ── 0.2) DINE-IN GUARD: require table if there are items ──────────────────
    if (itemsCount > 0 && orderType === 3) {
      if (!order.table_id) {
        throw new Error(
          'Table not assigned. Please assign a table before closing this dine-in order.'
        );
      }
    }

    // ── 1) Auth user & default customer info ──────────────────────────────────
    const {
      id: userId,
      name: userName,
      mobile: userMobile,
      email: userEmail,
    } = getCurrentPosUser();

    // Prepare default customer details (like quick mode)
    let fullName = (order.full_name ?? '').toString().trim();
    let mobile = (order.mobile ?? '').toString().trim();
    let email = (order.email ?? '').toString().trim();

    if (!fullName) {
      fullName = userName || 'POS Customer';
    }
    if (!mobile) {
      // Same spirit as Checkout quick mode: fallback mobile
      mobile = userMobile || '55555555';
    }
    if (!email) {
      email = userEmail || '';
    }

    const cols: string[] = ['status = ?', 'updated_at = ?'];
    const params: any[] = ['closed', ts];

    // Make sure customer fields are not empty
    if (hasColumn('orders', 'full_name')) {
      cols.push('full_name = ?');
      params.push(fullName);
    }
    if (hasColumn('orders', 'mobile')) {
      cols.push('mobile = ?');
      params.push(mobile);
    }
    if (hasColumn('orders', 'email')) {
      cols.push('email = ?');
      params.push(email || null);
    }

    // ── 2) User tracking: fill created_by/completed_by if missing ─────────────
    if (userId) {
      if (
        hasColumn('orders', 'completed_by_user_id') &&
        (order.completed_by_user_id == null ||
          String(order.completed_by_user_id) === '')
      ) {
        cols.push('completed_by_user_id = ?');
        params.push(userId);
      }

      if (
        hasColumn('orders', 'created_by_user_id') &&
        (order.created_by_user_id == null ||
          String(order.created_by_user_id) === '')
      ) {
        cols.push('created_by_user_id = ?');
        params.push(userId);
      }
    }

    // Mark final timestamps when available
    if (hasColumn('orders', 'completed_at')) {
      cols.push('completed_at = ?');
      params.push(ts);
    } else if (hasColumn('orders', 'closed_at')) {
      cols.push('closed_at = ?');
      params.push(ts);
    }

    // Once closed, lock it
    if (hasColumn('orders', 'is_locked')) {
      cols.push('is_locked = 1');
    }

    // WHERE id = ?
    params.push(orderId);

    rawDb
      .prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`)
      .run(...params);

    log('orders.close', orderId, {
      status: 'closed',
      autoFilled: {
        full_name: fullName,
        mobile,
        email,
        userId,
      },
    });

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
  // ✅ CHECKOUT / COMPLETE
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

      // 1) 🔹 Persist customer + GEO fields so recalc can see city_id
      rawDb
        .prepare(
          `
          UPDATE orders SET
            full_name   = ?,
            mobile      = ?,
            address     = ?,
            note        = ?,
            state_id    = ?,
            city_id     = ?,
            block_id    = ?,
            block       = ?,
            landmark    = ?
          WHERE id = ?
        `
        )
        .run(
          customer.full_name,
          customer.mobile ?? '',
          customer.address ?? '',
          customer.note ?? '',
          customer.state_id ?? null,
          customer.city_id ?? null,
          customer.block_id ?? null,
          customer.block ?? null,
          customer.landmark ?? null,
          orderId
        );

      // 2) 🔹 Now recalc with the correct city_id → will set delivery_fee, discount_total, grand_total
      const totals = recalcOrderTotals(services, orderId);

      // 3) 🔹 Mark order as prepared + set payment + totals
      const newStatus = type === 3 ? 'prepared' : 'completed';

      const cols = [
        'status = ?',
        'payment_method_id = ?',
        'payment_method_slug = ?',
        'subtotal = ?',
        'grand_total = ?',
        'updated_at = ?',
      ];

      const params: any[] = [
        newStatus,
        customer.payment_method_id,
        customer.payment_method_slug ?? '',
        totals.subtotal,
        totals.grand_total,
        ts,
      ];

      if (hasColumn('orders', 'completed_by_user_id')) {
        cols.push('completed_by_user_id = ?');
        params.push(userId);
      }

      if (hasColumn('orders', 'is_locked')) {
        cols.push('is_locked = 1');
      }

      if (type !== 3 && hasColumn('orders', 'completed_at')) {
        cols.push('completed_at = ?');
        params.push(ts);
      }

      params.push(orderId);

      const sql = `UPDATE orders SET ${cols.join(', ')} WHERE id = ?`;

      try {
        rawDb.prepare(sql).run(...params);
      } catch (err: any) {
        console.error('Orders:complete SQL Error:', err.message);
        throw new Error('Database error during completion: ' + err.message);
      }

      log('orders.complete', orderId, { customer, totals, status: newStatus });
      return recalcAndGet(orderId);
    }
  );

  // New handler to explicitly release/finish a dine-in table
  ipcMain.handle('orders:releaseTable', async (_e, orderId: string) => {
    const ts = nowMs();
    const order = getOrderRow(orderId);
    if (!order) return;

    // 1. Mark order as completed
    let sql = `UPDATE orders SET status = 'completed', updated_at = ?`;
    if (hasColumn('orders', 'completed_at')) sql += `, completed_at = ?`;
    sql += ` WHERE id = ?`;

    const params = [ts];
    if (hasColumn('orders', 'completed_at')) params.push(ts);
    params.push(orderId);

    rawDb.prepare(sql).run(...params);

    // 2. Release table
    if (order.table_id) {
      rawDb
        .prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`)
        .run(order.table_id);
    }

    return getOrderWithLines(orderId);
  });

  // ... (markPrinted, paymentLink, createFromCart omitted but assumed present)
  ipcMain.handle('orders:markPrinted', async (_e, orderId: string) => {
    const ts = nowMs();
    const cols = ['printed_at = ?', 'updated_at = ?'];
    // For dine-in, printing might lock the lines too
    if (hasColumn('order_lines', 'is_locked')) {
      rawDb
        .prepare(`UPDATE order_lines SET is_locked = 1 WHERE order_id = ?`)
        .run(orderId);
    }

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
  // 🍽️ TABLES
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

  ipcMain.handle(
    'tables:getActiveOrderForTable',
    async (_e, tableId: string) => {
      const { sql: userSql, params } = buildUserFilter('o');

      const row = rawDb
        .prepare(
          `
        SELECT o.*
        FROM orders o
        WHERE o.table_id = @table_id
          AND o.status IN ('open', 'pending', 'ready', 'prepared')
          ${userSql}
        ORDER BY o.opened_at DESC, o.created_at DESC
        LIMIT 1
      `
        )
        .get({ ...params, table_id: tableId }) as any;

      return row || null;
    }
  );

  ipcMain.handle('orders:clearTable', async (_e, orderId: string) => {
    const order = getOrderRow(orderId);
    if (!order) return getOrderWithLines(orderId);

    // 🚫 Safety: do NOT allow clearing table if the order has any items
    try {
      const row = rawDb
        .prepare('SELECT COUNT(*) AS c FROM order_lines WHERE order_id = ?')
        .get(orderId) as { c?: number };

      const count = row?.c ?? 0;
      if (count > 0) {
        throw new Error(
          'Cannot remove the table from an order that already has items. Use "Close & Release" instead.'
        );
      }
    } catch (err) {
      console.error('[orders:clearTable] count check failed', err);
      // If we can’t be sure, better not clear.
      throw new Error('Could not verify order lines – table not cleared.');
    }

    rawDb.transaction(() => {
      if (order.table_id) {
        rawDb
          .prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`)
          .run(order.table_id);
      }

      rawDb
        .prepare(
          `UPDATE orders SET table_id = NULL, covers = NULL, updated_at = ? WHERE id = ?`
        )
        .run(nowMs(), orderId);
    });

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
