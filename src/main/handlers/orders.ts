import { shell, type IpcMain } from 'electron';
import crypto from 'node:crypto';
import type { MainServices } from '../types/common';

// ⚙️ Utils
import { allocUniqueOrderNumber } from '../utils/orderNumbers';
import {
  recalcOrderTotals,
  variationEffectivePrice,
} from '../utils/calculations';
import { logAction } from '../utils/logging';
import { allowAnonymousAdmin, isAdminRole } from '../utils/authContext';
import {
  ORDER_STATUS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  sqlList,
} from '../utils/orderStatus';
import {
  isAllowedPosTransition,
  isTerminalServerStatus,
  pushStatusForLocal,
} from '../utils/serverStatus';

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
      // Nobody signed in → no privileges (dev builds keep the old convenience).
      return {
        id: null,
        isAdmin: allowAnonymousAdmin(),
        name: null,
        mobile: null,
        email: null,
      };
    }

    try {
      const u = rawDb
        .prepare(`SELECT role, name, mobile, email FROM pos_users WHERE id = ?`)
        .get(id) as any;

      return {
        id,
        isAdmin: isAdminRole(u?.role),
        name: u?.name ?? null,
        mobile: u?.mobile ?? null,
        email: u?.email ?? null,
      };
    } catch (e) {
      // Lookup failure must deny, not escalate.
      console.error('[orders] role lookup failed; denying admin:', e);
      return {
        id,
        isAdmin: false,
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

  /**
   * Put an already-synced order back in the outbox.
   *
   * The push filter is `synced_at IS NULL`, so once an order was acked at
   * `placed` it could never be sent again — the later close never reached the
   * server, and with revenue posting keyed on the DONE status the sale never
   * reached the books. Push is idempotent on temp_id and the server now applies
   * status/totals/payment on re-push, so clearing the stamp is safe and is what
   * makes place-then-close work end to end.
   */
  const markForRepush = (orderId: string) => {
    try {
      rawDb
        .prepare(`UPDATE orders SET synced_at = NULL WHERE id = ?`)
        .run(orderId);
    } catch (e) {
      console.error('[orders] markForRepush failed', e);
    }
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

      if (TERMINAL_STATUSES.includes(status as any)) {
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
        variation_id,
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
    // 1) Normal totals recalc
    try {
      recalcOrderTotals(services, orderId);
    } catch (e) {
      console.error('Recalc failed', e);
    }

    // 2) If there are NO lines left → hard-reset totals & discount fields
    try {
      const row = rawDb
        .prepare('SELECT COUNT(*) AS c FROM order_lines WHERE order_id = ?')
        .get(orderId) as { c?: number };

      const count = row?.c ?? 0;

      if (count === 0) {
        const ts = nowMs();
        const cols: string[] = [
          'subtotal = 0',
          'grand_total = 0',
          'updated_at = ?',
        ];
        const params: any[] = [ts];

        if (hasColumn('orders', 'discount_total')) {
          cols.push('discount_total = 0');
        }
        if (hasColumn('orders', 'discount_percent')) {
          cols.push('discount_percent = 0');
        }
        if (hasColumn('orders', 'delivery_fee')) {
          cols.push('delivery_fee = 0');
        }
        if (hasColumn('orders', 'tax_total')) {
          cols.push('tax_total = 0');
        }
        if (hasColumn('orders', 'promocode')) {
          cols.push('promocode = NULL');
        }

        rawDb
          .prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`)
          .run(...params, orderId);
      }
    } catch (e) {
      console.error('[recalcAndGet] zero-lines reset failed', e);
    }

    // 3) Return fresh snapshot
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
        WHERE o.status IN (${sqlList(ACTIVE_STATUSES)})
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
    // The Today Orders page uses start_ms/end_ms while older callers use
    // from/to. Reading only the latter silently turned both bounds into zero,
    // removed the WHERE date clauses, and mixed old orders into today's list.
    const from = Number(args?.from ?? args?.start_ms ?? 0);
    const to = Number(args?.to ?? args?.end_ms ?? 0);
    const status = (args?.status ?? '').toString().trim();
    const branchId = args?.branch_id;
    const { sql: userSql, params: userParams } = buildUserFilter('orders');
    const where: string[] = [
      // Drafts are created locally as soon as New is pressed. They are not
      // sales and must not appear in the orders report before an item exists.
      `NOT (
        lower(COALESCE(status, '')) IN ('open', 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM order_lines ol WHERE ol.order_id = orders.id
        )
      )`,
    ];
    const params: any = { ...userParams };

    // `created_at` holds two different shapes: locally-created orders store
    // epoch ms as text ("1786876189385.0"), server-seeded ones store an ISO
    // string ("2026-08-16T08:57:27.000000Z"). SQLite sorts every TEXT value
    // above every INTEGER, so `created_at <= @to` was ALWAYS false for the ISO
    // rows — every order pushed by another till was silently missing from
    // Today's Orders. `opened_at` is normalised to epoch ms for both origins,
    // so filter and sort on that instead.
    const TS = `COALESCE(NULLIF(opened_at, 0), CAST(created_at AS INTEGER))`;

    if (from > 0) {
      where.push(`${TS} >= @from`);
      params.from = from;
    }
    if (to > 0) {
      where.push(`${TS} <= @to`);
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

    // Same reason: ordering on the raw column would float every ISO-dated
    // server order to the top regardless of its actual time.
    const sql = `SELECT * FROM orders WHERE ${where.join(
      ' AND '
    )} ${userSql} ORDER BY ${TS} DESC LIMIT 500`;
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

      // ❌ 1) Do not allow changing type for a dine-in order that has a table
      if (currentType === 3 && order.table_id && type !== 3) {
        throw new Error(
          'Cannot change order type for a dine-in order that has a table assigned.'
        );
      }

      // ❌ 2) A finished order is history — reopening it is a different action.
      //
      // This used to also refuse the change whenever a payment method was set,
      // which made "rang up as pickup, customer wants it delivered" impossible:
      // the POS assigns a method early, so in practice the type froze the
      // moment the order was created. A chosen payment method says nothing
      // about how the order leaves the shop, so it no longer blocks. Totals are
      // recalculated below, which is what actually has to be right.
      if (TERMINAL_STATUSES.includes(status as any) || isLocked) {
        throw new Error(
          'Order type cannot be changed after the order has been closed.'
        );
      }

      // Leaving delivery drops any fee override with it. Keeping the override
      // would mean a pickup order that later becomes a delivery again silently
      // charges nothing, because the manual flag survived with a zeroed amount.
      const cols = ['order_type = ?', 'updated_at = ?'];
      const params: any[] = [type, nowMs()];
      if (type !== 1) {
        if (hasColumn('orders', 'delivery_fee_manual')) {
          cols.push('delivery_fee_manual = 0');
        }
        if (hasColumn('orders', 'void_delivery_fee')) {
          cols.push('void_delivery_fee = 0');
        }
      }

      rawDb
        .prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`)
        .run(...params, orderId);

      log('orders.setType', orderId, { from: currentType, to: type });

      return recalcAndGet(orderId);
    }
  );

  /**
   * Set the delivery charge on an order by hand.
   *
   * Three modes, because "0" is genuinely ambiguous on a till:
   *   auto   — clear the override, charge whatever the city table says
   *   manual — charge exactly this amount (a driver's quote, a long trip)
   *   none   — no delivery charge at all (a comp, or the customer collects)
   *
   * `none` is not "manual 0": the void flag survives a city change, whereas a
   * manual 0 would look like "no fee entered yet" to anyone reading the row.
   */
  /**
   * Move an order along its lifecycle.
   *
   * Placing an order used to jump straight to closed, which meant staff had no
   * way to record where an order had actually reached — a delivery was "done"
   * the moment it was rung up. These are the states between.
   *
   * Only forward moves are offered, and only to a state the server understands
   * (pushStatusForLocal maps these onto RECEIVED / READY / DONE). Cancelling is
   * deliberately not here: the push channel cannot express it — the backend's
   * PUSHABLE_STATUSES excludes both cancelled codes and silently drops anything
   * outside that list, so a cancel would land as RECEIVED again.
   */
  ipcMain.handle(
    'orders:setStatus',
    async (_e, orderId: string, next: string) => {
      if (isPosLocked()) throw new Error('POS is locked');

      const order = getOrderRow(orderId);
      if (!order) throw new Error('Order not found');

      const allowed = [
        ORDER_STATUS.PLACED,
        ORDER_STATUS.PREPARED,
        ORDER_STATUS.READY,
        ORDER_STATUS.AWAITING_PICKUP,
        ORDER_STATUS.CLOSED,
        ORDER_STATUS.CANCELLED_CLIENT,
      ] as string[];

      const target = String(next || '').toLowerCase();
      if (!allowed.includes(target)) {
        throw new Error(`Cannot set order status to "${next}".`);
      }

      const current = String(order.status || '').toLowerCase();
      if (current === target) return getOrderWithLines(orderId);

      if (target === ORDER_STATUS.CANCELLED_CLIENT) {
        const lineCount = Number(
          rawDb
            .prepare('SELECT COUNT(*) FROM order_lines WHERE order_id = ?')
            .pluck()
            .get(orderId) ?? 0
        );
        // Server-seeded lookup rows intentionally do not store their lines on
        // this till, so a positive server total is also valid sale evidence.
        // A genuinely empty local draft has neither lines nor a positive total.
        if (lineCount === 0 && Number(order.grand_total || 0) <= 0) {
          throw new Error('An empty draft cannot be sent as a cancelled order.');
        }
      }

      const serverCode = Number(order.status_code);
      if (Number.isFinite(serverCode) && isTerminalServerStatus(serverCode)) {
        throw new Error(
          'Order is already finished on the server and cannot be changed by a device'
        );
      }
      const localCode = pushStatusForLocal(current);
      const effectiveCode = Number.isFinite(serverCode)
        ? Math.max(serverCode, localCode)
        : localCode;
      if (!isAllowedPosTransition(effectiveCode, pushStatusForLocal(target))) {
        throw new Error(`Invalid order status transition: ${current} -> ${target}`);
      }

      const cols = ['status = ?', 'updated_at = ?'];
      const params: any[] = [target, nowMs()];

      // Reaching a terminal state is what finishes the sale, and it is the
      // point the server posts revenue against (DONE).
      if (target === ORDER_STATUS.CLOSED && hasColumn('orders', 'closed_at')) {
        cols.push('closed_at = ?');
        params.push(nowMs());
      }
      if (
        target === ORDER_STATUS.CANCELLED_CLIENT &&
        hasColumn('orders', 'closed_at')
      ) {
        cols.push('closed_at = ?');
        params.push(nowMs());
      }

      rawDb
        .prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`)
        .run(...params, orderId);

      // The server has to see the new state, and the push filter skips anything
      // already stamped as synced.
      markForRepush(orderId);

      log('orders.setStatus', orderId, { from: current, to: target });

      // Deliberately no printing here. A receipt belongs to the sale, not to a
      // status change — marking an order delivered must not put paper through
      // the printer, least of all on a driver's return.
      return getOrderWithLines(orderId);
    }
  );

  ipcMain.handle(
    'orders:setDeliveryFee',
    async (
      _e,
      orderId: string,
      input: { mode: 'auto' | 'manual' | 'none'; amount?: number }
    ) => {
      if (isPosLocked()) throw new Error('POS is locked');

      const order = assertOrderEditable(orderId);

      if (Number(order.order_type) !== 1) {
        throw new Error('Only delivery orders can carry a delivery charge.');
      }

      const mode = input?.mode ?? 'auto';
      let manual = 0;
      let voided = 0;
      let fee = Number(order.delivery_fee ?? 0);

      if (mode === 'manual') {
        const amount = Number(input?.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error('Delivery charge must be a positive amount.');
        }
        // Guard against a mis-keyed amount becoming a customer-facing charge.
        if (amount > 99) {
          throw new Error('Delivery charge looks too large — check the amount.');
        }
        manual = 1;
        fee = +amount.toFixed(3);
      } else if (mode === 'none') {
        voided = 1;
        fee = 0;
      }

      const cols = ['delivery_fee = ?', 'updated_at = ?'];
      const params: any[] = [fee, nowMs()];
      if (hasColumn('orders', 'delivery_fee_manual')) {
        cols.push('delivery_fee_manual = ?');
        params.push(manual);
      }
      if (hasColumn('orders', 'void_delivery_fee')) {
        cols.push('void_delivery_fee = ?');
        params.push(voided);
      }

      rawDb
        .prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`)
        .run(...params, orderId);

      log('orders.setDeliveryFee', orderId, { mode, amount: fee });

      return recalcAndGet(orderId);
    }
  );

  ipcMain.handle('orders:get', async (_e, orderId: string) =>
    getOrderWithLines(orderId)
  );

  /**
   * Everything about one order in a single call: header, customer, address,
   * lines, payment state and a timeline.
   *
   * The timeline comes from pos_action_log, which has been written all along
   * but was never read — so "when did this happen" was unanswerable from the
   * till. Orders synced from the server for phone lookup have no local lines
   * or history; the flags say so rather than rendering a convincing blank.
   */
  ipcMain.handle('orders:getDetail', async (_e, orderId: string) => {
    const id = String(orderId ?? '').trim();
    if (!id) return null;

    const base = getOrderWithLines(id);
    if (!base?.order) return null;

    let timeline: any[] = [];
    try {
      timeline = rawDb
        .prepare(
          `SELECT l.action, l.meta_json, l.created_at, l.user_id,
                  u.name AS user_name
             FROM pos_action_log l
             LEFT JOIN pos_users u ON CAST(u.id AS TEXT) = CAST(l.user_id AS TEXT)
            WHERE l.order_id = ?
            ORDER BY l.created_at ASC`
        )
        .all(id) as any[];
    } catch (e) {
      console.error('[orders:getDetail] timeline failed', e);
    }

    // Resolve geo ids to names so the address reads as an address.
    const nameOf = (table: string, value: any) => {
      if (value == null || value === '') return null;
      try {
        const r = rawDb
          .prepare(
            `SELECT name, name_ar FROM ${table} WHERE CAST(id AS TEXT) = CAST(? AS TEXT)`
          )
          .get(String(value)) as any;
        return r ?? null;
      } catch {
        return null;
      }
    };

    const o = base.order;
    return {
      order: o,
      lines: base.lines,
      isServerSeed: (base.lines?.length ?? 0) === 0,
      geo: {
        state: nameOf('states', o.state_id),
        city: nameOf('cities', o.city_id),
        block: nameOf('blocks', o.block_id),
      },
      payment: {
        method_slug: o.payment_method_slug ?? null,
        link_url: o.payment_link_url ?? null,
        link_status: o.payment_link_status ?? null,
        verified_at: o.payment_link_verified_at ?? null,
      },
      timeline: timeline.map((t) => ({
        action: t.action,
        at: Number(t.created_at) || null,
        user: t.user_name ?? null,
        meta: (() => {
          try {
            return t.meta_json ? JSON.parse(t.meta_json) : null;
          } catch {
            return null;
          }
        })(),
      })),
    };
  });

  ipcMain.handle('orders:getForTable', async (_e, tableId: number) => {
    // Finds the active open order for this table
    const order = rawDb
      .prepare(
        `SELECT * FROM orders WHERE table_id = ? AND status NOT IN (${sqlList(TERMINAL_STATUSES)}) ORDER BY created_at DESC LIMIT 1`
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

      // Items sold by variation have no meaningful bare price — force the
      // caller through orders:addLineWithAddons so a variation is picked.
      const variationCount = rawDb
        .prepare(`SELECT COUNT(*) AS c FROM variations WHERE item_id = ?`)
        .get(item.id) as { c?: number };
      if (Number(variationCount?.c ?? 0) > 0) {
        throw new Error('Please choose a variation for this item');
      }
      if (Number(item.price ?? 0) <= 0) {
        throw new Error(`"${item.name}" has no price set and cannot be sold.`);
      }

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

      qty = Math.trunc(Number(qty));
      if (!Number.isFinite(qty) || qty <= 0)
        throw new Error('Quantity must be > 0');

      // Base item
      const item = rawDb
        .prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`)
        .get(itemId) as any;
      if (!item) throw new Error('Item not found');

      // ── Variations ───────────────────────────────────────────────
      // An item that has variations MUST be sold as one of them, otherwise
      // we would silently charge the (often placeholder) bare item price.
      const variationId =
        payload?.variation_id != null && payload.variation_id !== ''
          ? String(payload.variation_id)
          : null;

      const itemVariations = rawDb
        .prepare(
          `SELECT id, name, price, sale_price FROM variations WHERE item_id = ?`
        )
        .all(item.id) as any[];

      let variationName: string | null = null;
      let variationPrice: number | null = null;

      if (variationId) {
        const v = itemVariations.find((x) => String(x.id) === variationId);
        if (!v) {
          throw new Error('Selected variation is not available for this item');
        }
        variationName = v.name || null;
        variationPrice = variationEffectivePrice(v, item);

        // §5.2: a variation saved without a price reaches us as 0.0 and is
        // indistinguishable from a real zero. Refuse rather than give it away.
        if (variationPrice <= 0) {
          throw new Error(
            `"${item.name} — ${v.name || 'variation'}" has no price set. ` +
              `Fix it in the back office before selling it.`
          );
        }
      } else if (itemVariations.length > 0) {
        throw new Error('Please choose a variation for this item');
      }

      const basePrice =
        variationPrice != null ? variationPrice : Number(item.price || 0);
      if (!Number.isFinite(basePrice) || basePrice <= 0) {
        throw new Error(`"${item.name}" has no price set and cannot be sold.`);
      }

      // ── Addons ───────────────────────────────────────────────────
      // Only addons belonging to a group actually attached to this item may
      // be charged, and the group's required/max_select rules are enforced
      // here too — the renderer's checks are UX, not authorization.
      const selections = Array.isArray(payload?.addons) ? payload.addons : [];

      const itemGroups = rawDb
        .prepare(
          `SELECT ag.id, ag.name, iag.is_required, iag.max_select
             FROM addon_groups ag
             JOIN item_addon_groups iag ON iag.group_id = ag.id
            WHERE iag.item_id = ?`
        )
        .all(item.id) as any[];
      const itemGroupIds = new Set(itemGroups.map((g) => String(g.id)));

      const addonIds: string[] = [];
      const addonNames: string[] = [];
      const addonPrices: number[] = [];
      const addonQtys: number[] = [];
      const qtyByGroup = new Map<string, number>();

      for (const sel of selections) {
        if (!sel?.addon_id) continue;
        const a = rawDb
          .prepare(`SELECT id, group_id, name, price FROM addons WHERE id = ?`)
          .get(sel.addon_id) as any;
        if (!a) throw new Error('Selected add-on no longer exists');

        const groupId = String(a.group_id ?? '');
        if (!itemGroupIds.has(groupId)) {
          throw new Error(`"${a.name}" is not available for this item`);
        }

        const q = Math.trunc(Number(sel.qty ?? 1));
        if (!Number.isFinite(q) || q <= 0) continue;
        const price = Number(a.price || 0);

        addonIds.push(a.id);
        addonPrices.push(price);
        addonQtys.push(q);
        qtyByGroup.set(groupId, (qtyByGroup.get(groupId) ?? 0) + q);

        // Nice label: "Ketchup" or "Ketchup ×2"
        const label = q > 1 ? `${a.name} ×${q}` : a.name;
        addonNames.push(label);
      }

      for (const g of itemGroups) {
        const count = qtyByGroup.get(String(g.id)) ?? 0;
        if (Number(g.is_required) === 1 && count === 0) {
          throw new Error(`Please select an option for "${g.name}"`);
        }
        const max = Number(g.max_select);
        if (Number.isFinite(max) && max > 0 && count > max) {
          throw new Error(`You can select up to ${max} options for "${g.name}"`);
        }
      }

      // Extra per-unit from addons
      let addonsExtraPerUnit = 0;
      addonPrices.forEach((price, idx) => {
        const q = addonQtys[idx] || 1;
        addonsExtraPerUnit += price * q;
      });

      const perUnitTotal = basePrice + addonsExtraPerUnit;
      const lineTotal = +(perUnitTotal * qty).toFixed(3);

      const addonsIdJson = addonIds.length > 0 ? JSON.stringify(addonIds) : null;
      const addonsQtyJson =
        addonQtys.length > 0 ? JSON.stringify(addonQtys) : null;

      // Different variation/addon combos stay as separate rows, but adding the
      // *same* combo again bumps the existing line instead of stacking
      // duplicate rows the cashier then has to edit one by one.
      const hasLineLockCol = hasColumn('order_lines', 'is_locked');
      const twin = rawDb
        .prepare(
          `
            SELECT id, qty
              FROM order_lines
             WHERE order_id = ?
               AND item_id = ?
               AND IFNULL(variation_id, '') = IFNULL(?, '')
               AND IFNULL(addons_id, '')    = IFNULL(?, '')
               AND IFNULL(addons_qty, '')   = IFNULL(?, '')
               ${hasLineLockCol ? 'AND COALESCE(is_locked, 0) = 0' : ''}
             LIMIT 1
          `
        )
        .get(orderId, item.id, variationId, addonsIdJson, addonsQtyJson) as any;

      if (twin) {
        const newQty = Number(twin.qty || 0) + qty;
        rawDb
          .prepare(
            `UPDATE order_lines SET qty = ?, unit_price = ?, line_total = ? WHERE id = ?`
          )
          .run(newQty, perUnitTotal, +(perUnitTotal * newQty).toFixed(3), twin.id);

        log('orders.addLineWithAddons (merged)', orderId, {
          line_id: twin.id,
          item_id: item.id,
          qty: newQty,
          variation_id: variationId,
        });

        return recalcAndGet(orderId);
      }

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
          addons_id: addonsIdJson,
          addons_name: addonNames.length > 0 ? addonNames.join(', ') : null,
          addons_price:
            addonPrices.length > 0 ? JSON.stringify(addonPrices) : null,
          addons_qty: addonsQtyJson,
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

  ipcMain.handle('orders:clearLines', async (_e, orderId: string) => {
    if (isPosLocked()) throw new Error('POS is locked');

    // Will throw if order is locked or not editable for this user
    assertOrderEditable(orderId);

    // If you ever want to *keep* locked lines, change the SQL here.
    let sql = `DELETE FROM order_lines WHERE order_id = ?`;
    if (hasColumn('order_lines', 'is_locked')) {
      // only delete lines that are not locked / already printed
      sql += ` AND (is_locked IS NULL OR is_locked = 0)`;
    }

    rawDb.prepare(sql).run(orderId);

    log('orders.clearLines', orderId, null);

    return recalcAndGet(orderId);
  });

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
      throw new Error('Could not verify the order items. Please try again.');
    }

    // Closing an empty draft is a discard, not a sale or a cancellation.
    // Remove it completely so it never appears in history or reaches sync.
    if (itemsCount === 0) {
      log('orders.discardEmpty', orderId, {
        previous_status: order.status,
      });

      rawDb.transaction(() => {
        // Explicit child cleanup also covers legacy databases where foreign
        // key enforcement may not have been enabled when the DB was created.
        rawDb.prepare('DELETE FROM active_orders WHERE order_id = ?').run(orderId);
        rawDb.prepare('DELETE FROM order_lines WHERE order_id = ?').run(orderId);
        rawDb.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
      })();

      return { order: null, lines: [], discarded: true };
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
    const params: any[] = [ORDER_STATUS.CLOSED, ts];

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

    markForRepush(orderId);

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
      .prepare(
        `UPDATE orders SET status = '${ORDER_STATUS.OPEN}', updated_at = ? WHERE id = ?`
      )
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

      const lineCount = Number(
        rawDb
          .prepare('SELECT COUNT(*) FROM order_lines WHERE order_id = ?')
          .pluck()
          .get(orderId) ?? 0
      );
      if (lineCount === 0) {
        throw new Error('Cannot place an empty order. Add at least one item.');
      }

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

      // 3) 🔹 Placing records the sale; it does not finish it.
      //
      //    This used to jump straight to CLOSED for pickup and delivery, which
      //    pushStatusForLocal maps to the server's DONE — and DONE is what
      //    gates revenue posting and ingredient consumption on the backend. So
      //    a delivery was booked as completed the moment it was rung up, before
      //    anyone had driven anywhere. It also left staff no way to say where an
      //    order had actually got to.
      //
      //    PLACED maps to RECEIVED. Staff move it on from there — preparing,
      //    ready, then delivered/collected, which is what finally closes it.
      const newStatus = ORDER_STATUS.PLACED;

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
      // A pickup/delivery order is finished here, so stamp closed_at too —
      // reports and the closing report key off it.
      if (type !== 3 && hasColumn('orders', 'closed_at')) {
        cols.push('closed_at = ?');
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

      markForRepush(orderId);

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
