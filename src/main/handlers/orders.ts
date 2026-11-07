import { shell, type IpcMain } from 'electron';
import crypto from 'node:crypto';
import type { MainServices } from '../types/common';
import { posError } from '../../shared/errorCodes';
import {
  WALK_IN_CUSTOMER_MOBILE,
  WALK_IN_CUSTOMER_NAME,
} from '../../shared/walkInCustomer';
import { isDeliveryEnabled } from '../services/settings';
import { isCashPayment, tenderForWire } from '../../shared/cashChange';

// ⚙️ Utils
import { allocUniqueOrderNumber } from '../utils/orderNumbers';
import {
  recalcOrderTotals,
  variationEffectivePrice,
} from '../utils/calculations';
import { logAction } from '../utils/logging';
import { allowAnonymousAdmin, isAdminRole } from '../utils/authContext';
import { reconcileOrderFromServer } from '../sync';
import { holdDeps, orderChangeDeps, schedulePushSoon, toServerUserId } from './sync';
import { holdTable, releaseHold } from '../tableHolds';
import { isOwnOrder } from '../paidMarks';
import { isLineSending, sendOrderChange, sendOrderLines, type OrderChange } from '../orderStatusActions';
import { normPullLine, orderLineUpsert, writePayParts } from '../sync';
import { largerPart, splitParts, type PayPart } from '../../shared/splitPayment';
import { newUlid } from '../../shared/paid';
import {
  ORDER_STATUS,
  TERMINAL_STATUSES,
  ACTIVE_SERVER_CODES,
  activeOrderSql,
  sqlList,
  isTerminal,
  isActiveOrder,
} from '../utils/orderStatus';
import {
  isAllowedPosTransition,
  isTerminalServerStatus,
  pushStatusForLocal,
} from '../utils/serverStatus';
import { assertPermission, getEffectivePermissions } from '../utils/permissions';
import {
  recordApproval,
  resolveApprover,
  type ApprovalInput,
} from '../utils/approvals';

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
    const { id } = getCurrentPosUser();
    const canViewAll = getEffectivePermissions(services).includes('orders.view_all');
    const hasCreated = hasColumn('orders', 'created_by_user_id');
    const hasCompleted = hasColumn('orders', 'completed_by_user_id');

    if (!id || canViewAll || (!hasCreated && !hasCompleted)) {
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

    // An order with no operator stamped on it at all is NOT someone else's
    // order — it is the branch's. Orders seeded from the server (online-store
    // tickets, and rows pushed by another till) carry no local pos_users id, so
    // `COALESCE(created, completed) = @user_id` was NULL for every one of them
    // and never true: a cashier holding 'orders.view_own' saw an empty Today's
    // Orders while the same tickets were live on the website. Same rule the
    // closing report already applies to a NULL branch_id.
    return {
      sql: ` AND (${expr} = @user_id OR ${expr} IS NULL) `,
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

  /**
   * Marks a table free only when no other active order is still seated at it.
   * Freeing it outright would let a second party be seated on top of the first.
   */
  const releaseTableIfFree = (tableId: string) => {
    const stillSeated = rawDb
      .prepare(
        `SELECT 1 FROM orders o WHERE o.table_id = ? AND ${activeOrderSql('o')} LIMIT 1`
      )
      .get(tableId);
    if (!stillSeated) {
      rawDb.prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`).run(tableId);
    }
  };

  /**
   * Lower or remove a line already sent to the kitchen. The approver is
   * resolved first (bcrypt is async); the change and its approval record are
   * then written together, and the order is re-pushed so the server prints
   * the VOID and the approval reaches the voids report.
   */
  const voidSentLine = async (line: any, qtyAfter: number, approval: ApprovalInput) => {
    const approver = await resolveApprover(services, 'void_sent_line', approval);
    const before = Number(line.qty || 0);
    rawDb.transaction(() => {
      if (qtyAfter <= 0) {
        rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`).run(line.id);
      } else {
        const lineTotal = +(Number(line.unit_price || 0) * qtyAfter).toFixed(3);
        rawDb
          .prepare(`UPDATE order_lines SET qty = ?, line_total = ?, updated_at = ? WHERE id = ?`)
          .run(qtyAfter, lineTotal, nowMs(), line.id);
      }
      recordApproval(services, approver, {
        action: 'void_sent_line',
        orderId: line.order_id,
        lineId: line.id,
        qtyBefore: before,
        qtyAfter,
      });
    })();
    log('orders.voidSentLine', line.order_id, {
      line_id: line.id,
      qty_before: before,
      qty_after: qtyAfter,
      approved_by: approver.approvedBy,
      reason: approver.reason,
    });
    const result = recalcAndGet(line.order_id);
    markForRepush(line.order_id);
    return result;
  };

  const getOrderRow = (orderId: string) => {
    return rawDb.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as
      | any
      | undefined;
  };

  /**
   * Changes the server has no route for yet (items, tables, order type) stay
   * local if made on another till's order, and the tills then disagree. Refused
   * with a clear message until they can reach the server.
   */
  const assertOwnOrder = (order: { id: string }) => {
    if (!isOwnOrder(order)) throw posError('POS_ORDER_OTHER_TILL');
  };

  /** Send a change for another till's order; the reply replaces the local copy. */
  const changeOtherTillsOrder = async (order: any, change: OrderChange) => {
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');
    const by = toServerUserId(getCurrentPosUser().id);
    const result = await sendOrderChange(orderChangeDeps(), order, by, change);
    const now = getOrderRow(order.id);
    if (order.table_id && now && !isActiveOrder(now)) releaseTableIfFree(order.table_id);
    log('orders.changeOtherTill', order.id, { ...change, approval: undefined, ...result });
    return getOrderWithLines(order.id);
  };

  /**
   * Send the lines this till added to another till's order. The local copies
   * are replaced by the server's, so they come back locked under the server's
   * ids. Returns those ids (for the added-items slip), or [] if none waited.
   */
  const sendUnsentLinesOfOtherTill = async (order: any): Promise<string[]> => {
    const unsent = rawDb
      .prepare(
        `SELECT * FROM order_lines WHERE order_id = ? AND COALESCE(is_locked, 0) = 0 ORDER BY rowid`
      )
      .all(order.id) as any[];
    if (!unsent.length) return [];
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');
    const by = toServerUserId(getCurrentPosUser().id);
    const wire = unsent.map((l) => ({ ...l, temp_line_id: String(l.id) }));
    const res = await sendOrderLines(orderChangeDeps(), order, by, wire);
    const upLine = orderLineUpsert();
    // Only the local lines the reply accounts for are replaced. A reply that
    // names its lines by temp_line_id is matched exactly; one that does not
    // must at least return as many lines as were sent.
    const confirmed = new Set(
      res.lines.map((l: any) => String(l?.temp_line_id ?? '')).filter(Boolean)
    );
    const replaced = confirmed.size
      ? unsent.filter((l) => confirmed.has(String(l.id)))
      : res.applied && res.lines.length === unsent.length
        ? unsent
        : [];
    rawDb.transaction(() => {
      const drop = rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`);
      for (const l of replaced) drop.run(l.id);
      for (const l of res.lines) upLine.run(normPullLine(l, String(order.id)));
    })();
    log('orders.addLinesOtherTill', order.id, { lines: res.lines.length, replayed: res.replayed });
    return res.lines.map((l: any) => String(l.id));
  };

  /**
   * The split asked for at checkout, as parts with the tender on the cash one,
   * or null for a single payment. Refused when the shop has split payment off
   * or the amounts do not qualify, so nothing half-split is ever stored.
   */
  const splitFor = (customer: any, grandTotal: unknown): PayPart[] | null => {
    if (customer?.split_cash_amount == null || customer.split_cash_amount === '') return null;
    const enabled =
      String(
        (rawDb
          .prepare(`SELECT value FROM app_settings WHERE key = 'orders.split_payment_enabled'`)
          .pluck()
          .get() as string | undefined) ?? ''
      ) === '1';
    const parts = enabled
      ? splitParts(Number(grandTotal), Number(customer.split_cash_amount), customer.payment_method_slug)
      : null;
    if (!parts) throw posError('POS_VAL_SPLIT_AMOUNT', { field: 'payment_method' });
    const tender = tenderForWire(customer.amount_tendered, parts[0].amount);
    if (tender != null) parts[0].amount_tendered = tender;
    return parts;
  };

  /** Close, cancel or move on another till's order. Permissions as the server has them. */
  const setOtherTillsStatus = async (order: any, next: string, approval?: ApprovalInput) => {
    const target = String(next || '').toLowerCase();
    const isClose = target === ORDER_STATUS.CLOSED;
    const isCancel = target === ORDER_STATUS.CANCELLED_CLIENT;
    const allowed: string[] = [
      ORDER_STATUS.PLACED,
      ORDER_STATUS.PREPARED,
      ORDER_STATUS.READY,
      ORDER_STATUS.AWAITING_PICKUP,
      ORDER_STATUS.CLOSED,
      ORDER_STATUS.CANCELLED_CLIENT,
    ];
    if (!allowed.includes(target)) throw posError('POS_VAL_STATUS_UNKNOWN');
    if (isCancel) assertPermission(services, 'orders.cancel');
    else if (!isClose) assertPermission(services, 'orders.change_status');

    const code = Number(order.status_code);
    if (isTerminal(order.status) || (Number.isFinite(code) && isTerminalServerStatus(code))) {
      throw posError('POS_PUSH_ORDER_FINALIZED');
    }
    // No step-order check here: the local copy can be behind, and the server
    // rules on this order. Closing from preparing is normal.
    const change: OrderChange = { status: pushStatusForLocal(target) };
    if (isClose || isCancel) change.closed_at = nowMs();

    // The server counts statuses 2, 3 and 7 as sent to the kitchen.
    let approver: Awaited<ReturnType<typeof resolveApprover>> | null = null;
    if (isCancel && [2, 3, 7].includes(code)) {
      approver = await resolveApprover(services, 'cancel_sent_order', approval);
      if (approver.approvedBy !== approver.requestedBy) {
        change.approval = {
          id: newUlid(),
          action: 'cancel_sent_order',
          requested_by: approver.requestedBy,
          approved_by: approver.approvedBy,
          approved_at: new Date().toISOString(),
          reason: approver.reason,
        };
      }
    }

    const out = await changeOtherTillsOrder(order, change);
    if (approver) recordApproval(services, approver, { action: 'cancel_sent_order', orderId: order.id });
    return out;
  };

  const assertOrderEditable = (
    orderId: string,
    opts?: { allowAddOnLockedDineIn?: boolean; allowOtherTillUnsent?: boolean }
  ) => {
    const order = getOrderRow(orderId);
    if (!order) throw posError('POS_VAL_ORDER_NOT_FOUND');
    // Another till's order takes new, unsent lines only: everything already on
    // it came from the server and is locked, so the usual line rules hold.
    if (!opts?.allowOtherTillUnsent) assertOwnOrder(order);

    const locked =
      hasColumn('orders', 'is_locked') && Number(order.is_locked ?? 0) === 1;
    const status = (order.status || '').toLowerCase();
    const isDineIn = Number(order.order_type) === 3;

    // Role is not an edit mode. Once a sale is locked, admins must use the
    // explicit audited reopen action just like everyone else; silently
    // bypassing this check let an admin add items to an already placed sale.
    // The one business exception is a dine-in table accepting a new round:
    // existing printed lines stay locked and the new lines are appended.
    if (TERMINAL_STATUSES.includes(status as any)) {
      throw posError('POS_VAL_ORDER_LOCKED');
    }

    if (locked) {
      const canAppendDineIn = opts?.allowAddOnLockedDineIn && isDineIn;
      if (!canAppendDineIn) {
        throw posError('POS_VAL_ORDER_LOCKED');
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
    // The selling strip is a cart switcher, not an operations queue. Pickup
    // and delivery leave it as soon as Place Order succeeds; their subsequent
    // lifecycle belongs in Recent Orders / Kitchen Display. Dine-in stays
    // switchable because staff legitimately append a new round to the table.
    // Only show recent rows so an abandoned draft cannot live here forever.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    const rows = rawDb
      .prepare(
        `
        SELECT o.*
        FROM orders o
        WHERE (
          o.status IN ('${ORDER_STATUS.OPEN}', '${ORDER_STATUS.PENDING}')
          OR (
            o.order_type = 3
            AND ${activeOrderSql('o')}
          )
        )
        AND (o.opened_at > @cutoff OR o.created_at > @cutoff)
        ${userSql}
        ORDER BY o.opened_at DESC, o.created_at DESC
      `
      )
      .all({ ...params, cutoff }) as any[];
    return rows;
  });

  ipcMain.handle('orders:kitchenBoard', async () => {
    assertPermission(services, 'orders.kitchen_view');
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const orders = rawDb.prepare(`
      SELECT o.* FROM orders o
      WHERE (o.status IN ('placed','prepared','ready')
          OR (o.status_code IN (${ACTIVE_SERVER_CODES.join(', ')}) AND o.status NOT IN (${sqlList(TERMINAL_STATUSES)}, 'open', 'pending')))
        AND CAST(COALESCE(NULLIF(o.opened_at, 0), o.created_at) AS REAL) > @cutoff
        AND EXISTS (SELECT 1 FROM order_lines ol WHERE ol.order_id = o.id)
      ORDER BY CAST(COALESCE(NULLIF(o.opened_at, 0), o.created_at) AS REAL) ASC
    `).all({ cutoff }) as any[];
    return orders
      .map((order) => ({ order, lines: getOrderWithLines(String(order.id))?.lines || [] }))
      .filter((ticket) => ticket.lines.length > 0);
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
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');

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
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');

      const order = getOrderRow(orderId);
      if (!order) throw posError('POS_VAL_ORDER_NOT_FOUND');
      assertOwnOrder(order);

      const currentType = Number(order.order_type || 0);
      const status = (order.status || '').toLowerCase();

      // The picker hides Delivery when the branch has it switched off, but the
      // picker is UX. The setting can also flip mid-session now that it comes
      // down the pull feed, so a renderer holding a stale `true` must still be
      // refused here. Switching an order that is ALREADY delivery back to
      // itself stays allowed — that is how staff finish work in flight.
      if (type === 1 && currentType !== 1 && !isDeliveryEnabled()) {
        throw posError('POS_VAL_DELIVERY_DISABLED');
      }

      const isLocked =
        hasColumn('orders', 'is_locked') && Number(order.is_locked ?? 0) === 1;

      // ❌ 1) Do not allow changing type for a dine-in order that has a table
      if (currentType === 3 && order.table_id && type !== 3) {
        throw posError('POS_VAL_TYPE_LOCKED_TABLE');
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
        throw posError('POS_VAL_TYPE_LOCKED_CLOSED');
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
    async (_e, orderId: string, next: string, approval?: ApprovalInput) => {
      const row = getOrderRow(orderId);
      if (row && !isOwnOrder(row)) return setOtherTillsStatus(row, next, approval);

      assertPermission(services, 'orders.change_status');
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');

      const order = row;
      if (!order) throw posError('POS_VAL_ORDER_NOT_FOUND');

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
        throw posError('POS_VAL_STATUS_UNKNOWN');
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
          throw posError('POS_VAL_CANCEL_EMPTY_DRAFT');
        }
      }

      const serverCode = Number(order.status_code);
      if (Number.isFinite(serverCode) && isTerminalServerStatus(serverCode)) {
        throw posError('POS_PUSH_ORDER_FINALIZED');
      }
      const localCode = pushStatusForLocal(current);
      const effectiveCode = Number.isFinite(serverCode)
        ? Math.max(serverCode, localCode)
        : localCode;
      if (!isAllowedPosTransition(effectiveCode, pushStatusForLocal(target))) {
        throw posError('POS_VAL_STATUS_TRANSITION', {
          params: { current, target },
        });
      }

      // Cancelling an order already sent to the kitchen is the operator's
      // decision to gate (2026-11-01): orders.cancel_sent, or a manager's code.
      // A draft that never left the till is cancelled as before.
      const sentToKitchen = ![ORDER_STATUS.OPEN, ORDER_STATUS.PENDING].includes(current as any);
      const cancelApprover =
        target === ORDER_STATUS.CANCELLED_CLIENT && sentToKitchen
          ? await resolveApprover(services, 'cancel_sent_order', approval)
          : null;

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

      if (cancelApprover) {
        recordApproval(services, cancelApprover, {
          action: 'cancel_sent_order',
          orderId,
        });
      }

      // A finished dine-in order gives its table back. Closing from the status
      // menu never did, so the table stayed red with nothing seated at it.
      if (isTerminal(target) && order.table_id) {
        releaseTableIfFree(order.table_id);
      }

      // The server has to see the new state, and the push filter skips anything
      // already stamped as synced.
      markForRepush(orderId);
      schedulePushSoon(orderId);

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
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');

      const order = assertOrderEditable(orderId);

      if (Number(order.order_type) !== 1) {
        throw posError('POS_VAL_DELIVERY_FEE_WRONG_TYPE');
      }

      const mode = input?.mode ?? 'auto';
      let manual = 0;
      let voided = 0;
      let fee = Number(order.delivery_fee ?? 0);

      if (mode === 'manual') {
        const amount = Number(input?.amount);
        if (!Number.isFinite(amount) || amount < 0) {
          throw posError('POS_VAL_DELIVERY_FEE_NOT_POSITIVE', { field: 'delivery_fee' });
        }
        // Guard against a mis-keyed amount becoming a customer-facing charge.
        if (amount > 99) {
          throw posError('POS_VAL_DELIVERY_FEE_TOO_LARGE', { field: 'delivery_fee' });
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

      // Without this the corrected fee never leaves the till: the row keeps
      // whatever synced_at it already had, the outbox skips it, and the
      // server's figure and the till's disagree permanently. Every other
      // total-changing handler (close, complete, setStatus) already does this.
      markForRepush(orderId);
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

    const permissions = getEffectivePermissions(services);
    if (!permissions.includes('orders.view_all')) {
      assertPermission(services, 'orders.view_own');
      const actorId = getCurrentPosUser().id;
      const owner = rawDb
        .prepare(
          `SELECT COALESCE(created_by_user_id, completed_by_user_id) AS user_id
             FROM orders WHERE id = ?`
        )
        .get(id) as { user_id?: string | number | null } | undefined;
      // Same rule buildUserFilter applies to the list: an order with nobody
      // stamped on it belongs to the branch, not to another operator. A strict
      // equality check read the NULL owner of a server-seeded ticket as "not
      // yours" and denied the cashier the detail of a row the list had just
      // shown them.
      const ownerId = String(owner?.user_id ?? '');
      if (!actorId || (ownerId !== '' && ownerId !== String(actorId))) {
        throw new Error('Permission denied.');
      }
    }

    let base = getOrderWithLines(id);
    if (!base?.order) return null;

    // A server-sourced order can legitimately arrive as a header with no lines:
    // the feed gives a header and its lines separate change-log ids and does not
    // promise them in the same page. Heal it from the single-order endpoint on
    // first open, and fail soft — an offline till must still show the header it
    // has rather than an error where the ticket should be.
    if (!base.lines?.length) {
      const serverId = String(base.order.server_id ?? base.order.id ?? '');
      // Server ids are integers; a locally-rung order has a UUID and an empty
      // line list there is a real empty order, not a gap to go fetch.
      if (/^\d+$/.test(serverId)) {
        try {
          const written = await reconcileOrderFromServer(serverId);
          if (written > 0) base = getOrderWithLines(id) ?? base;
        } catch (e) {
          console.error('[orders:getDetail] line reconcile failed', serverId, e);
        }
      }
    }

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
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');

      // Allow adding even if locked for dine-in
      assertOrderEditable(orderId, {
        allowAddOnLockedDineIn: true, allowOtherTillUnsent: true,
      });

      const item = rawDb
        .prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`)
        .get(itemId) as any;
      if (!item) throw posError('POS_VAL_ITEM_NOT_FOUND');

      // Items sold by variation have no meaningful bare price — force the
      // caller through orders:addLineWithAddons so a variation is picked.
      const variationCount = rawDb
        .prepare(`SELECT COUNT(*) AS c FROM variations WHERE item_id = ?`)
        .get(item.id) as { c?: number };
      if (Number(variationCount?.c ?? 0) > 0) {
        throw posError('POS_VAL_VARIATION_REQUIRED');
      }
      if (Number(item.price ?? 0) <= 0) {
        throw posError('POS_VAL_ITEM_NO_PRICE', { params: { name: String(item.name ?? '') } });
      }

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

      // Prefer an UNLOCKED line to merge into (never one still being sent)
      row = candidates.find((l) => Number(l.is_locked || 0) === 0 && !isLineSending(l.id)) || null;

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
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');

      // Allow adding even if locked for dine-in (same as addLine)
      assertOrderEditable(orderId, {
        allowAddOnLockedDineIn: true, allowOtherTillUnsent: true,
      });

      qty = Math.trunc(Number(qty));
      if (!Number.isFinite(qty) || qty <= 0)
        throw posError('POS_VAL_QTY', { field: 'qty' });

      // Base item
      const item = rawDb
        .prepare(`SELECT id, name, name_ar, price FROM items WHERE id = ?`)
        .get(itemId) as any;
      if (!item) throw posError('POS_VAL_ITEM_NOT_FOUND');

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
          throw posError('POS_VAL_VARIATION');
        }
        variationName = v.name || null;
        variationPrice = variationEffectivePrice(v, item);

        // §5.2: a variation saved without a price reaches us as 0.0 and is
        // indistinguishable from a real zero. Refuse rather than give it away.
        if (variationPrice <= 0) {
          throw posError('POS_VAL_VARIATION_NO_PRICE', {
            params: {
              name: String(item.name ?? ''),
              variation: String(v.name || 'variation'),
            },
          });
        }
      } else if (itemVariations.length > 0) {
        throw posError('POS_VAL_VARIATION_REQUIRED');
      }

      const basePrice =
        variationPrice != null ? variationPrice : Number(item.price || 0);
      if (!Number.isFinite(basePrice) || basePrice <= 0) {
        throw posError('POS_VAL_ITEM_NO_PRICE', { params: { name: String(item.name ?? '') } });
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
        if (!a) throw posError('POS_VAL_ADDON_NOT_FOUND');

        const groupId = String(a.group_id ?? '');
        if (!itemGroupIds.has(groupId)) {
          throw posError('POS_VAL_ADDON_UNAVAILABLE', { params: { name: String(a.name ?? '') } });
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
          throw posError('POS_VAL_ADDON_GROUP_REQUIRED', { params: { group: String(g.name ?? '') } });
        }
        const max = Number(g.max_select);
        if (Number.isFinite(max) && max > 0 && count > max) {
          throw posError('POS_VAL_ADDON_GROUP_MAX', {
            params: { max, group: String(g.name ?? '') },
          });
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
    async (_e, lineId: string, qty: number, approval?: ApprovalInput) => {
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');
      const line = rawDb
        .prepare(`SELECT * FROM order_lines WHERE id = ?`)
        .get(lineId) as any;
      if (!line) throw posError('POS_VAL_LINE_NOT_FOUND');

      // A line already sent to the kitchen. More of it is a new round (a new
      // line), never a quantity change; less of it is a void, which needs
      // orders.void_sent_line or a manager's approval code.
      if (hasColumn('order_lines', 'is_locked') && line.is_locked == 1) {
        const before = Number(line.qty || 0);
        if (!(qty < before)) throw posError('POS_VAL_LINE_SENT_MODIFY');
        assertOrderEditable(line.order_id, { allowAddOnLockedDineIn: true });
        return voidSentLine(line, Math.max(0, qty), approval);
      }

      // The line check above protects what was sent; a new round on a placed
      // table must stay correctable before it is sent.
      if (isLineSending(line.id)) throw posError('POS_ORDER_LINES_SENDING');
      assertOrderEditable(line.order_id, { allowAddOnLockedDineIn: true, allowOtherTillUnsent: true });

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

  ipcMain.handle('orders:removeLine', async (_e, lineId: string, approval?: ApprovalInput) => {
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');
    const line = rawDb
      .prepare(`SELECT * FROM order_lines WHERE id = ?`)
      .get(lineId) as any;
    if (!line) return null;

    // A sent line is voided, not just removed: approval, record, re-push.
    if (hasColumn('order_lines', 'is_locked') && line.is_locked == 1) {
      assertOrderEditable(line.order_id, { allowAddOnLockedDineIn: true });
      return voidSentLine(line, 0, approval);
    }

    if (isLineSending(line.id)) throw posError('POS_ORDER_LINES_SENDING');
    assertOrderEditable(line.order_id, { allowAddOnLockedDineIn: true, allowOtherTillUnsent: true });
    rawDb.prepare(`DELETE FROM order_lines WHERE id = ?`).run(lineId);
    return recalcAndGet(line.order_id);
  });

  ipcMain.handle(
    'orders:removeLineByItem',
    async (_e, orderId: string, itemId: string) => {
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');
      // Deletes unlocked lines only, so a placed table can drop an unsent item.
      assertOrderEditable(orderId, { allowAddOnLockedDineIn: true, allowOtherTillUnsent: true });

      // Only remove unlocked lines
      let sql = `DELETE FROM order_lines WHERE order_id = ? AND item_id = ?`;
      if (hasColumn('order_lines', 'is_locked')) {
        sql += ` AND (is_locked IS NULL OR is_locked = 0)`;
      }

      const sending = (rawDb
        .prepare(`SELECT id FROM order_lines WHERE order_id = ? AND item_id = ?`)
        .pluck()
        .all(orderId, itemId) as string[]).filter(isLineSending);
      if (sending.length) throw posError('POS_ORDER_LINES_SENDING');
      rawDb.prepare(sql).run(orderId, itemId);
      return recalcAndGet(orderId);
    }
  );

  ipcMain.handle('orders:clearLines', async (_e, orderId: string) => {
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');

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
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');
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
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');
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
    if (!order) throw posError('POS_VAL_ORDER_NOT_FOUND');
    if (!isOwnOrder(order)) return setOtherTillsStatus(order, ORDER_STATUS.CLOSED);

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
      throw posError('POS_VAL_LINES_UNREADABLE');
    }

    // Closing an empty draft is a discard, not a sale or a cancellation.
    // Remove it completely so it never appears in history or reaches sync.
    if (itemsCount === 0) {
      log('orders.discardEmpty', orderId, {
        previous_status: order.status,
      });

      if (order.hold_table_id) {
        await releaseHold(holdDeps(), String(order.hold_table_id), {
          temp_id: String(orderId),
          by: toServerUserId(getCurrentPosUser().id),
        });
      }
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
        throw posError('POS_VAL_CITY_REQUIRED', { field: 'geo' });
      }
    }

    // ── 0.2) DINE-IN GUARD: require table if there are items ──────────────────
    if (itemsCount > 0 && orderType === 3) {
      if (!order.table_id) {
        throw posError('POS_VAL_TABLE_REQUIRED', { field: 'table' });
      }
    }

    // ── 1) Auth user & default customer info ──────────────────────────────────
    // Only the id is wanted here now: the operator identifies the STAFF on
    // this sale, never the customer.
    const { id: userId } = getCurrentPosUser();

    // Prepare default customer details (like quick mode)
    let fullName = (order.full_name ?? '').toString().trim();
    let mobile = (order.mobile ?? '').toString().trim();
    let email = (order.email ?? '').toString().trim();

    // A sale closed without a customer is an anonymous walk-in, and that is
    // what it must be recorded as. This used to fall back to the OPERATOR's
    // own name, personal mobile and email, so every ticket closed straight
    // from the order side — reopened orders, dine-in, anything that never
    // went through the checkout modal — was pushed with the cashier stored as
    // the customer. The back office saw staff personal numbers in the
    // customer column, and the placeholder below was never reached.
    //
    // The operator is not lost: they are recorded as staff on
    // created_by_user_id / completed_by_user_id, which the push payload now
    // sends as server_user_id.
    if (!fullName) {
      fullName = WALK_IN_CUSTOMER_NAME;
    }
    if (!mobile) {
      mobile = WALK_IN_CUSTOMER_MOBILE;
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

    // A closed order gives its table back, as releaseTable and setStatus do.
    // Today only an empty dine-in reaches here with a table, but a close that
    // left one busy is exactly the bug Close & Release had.
    if (order.table_id) releaseTableIfFree(order.table_id);

    markForRepush(orderId);
    schedulePushSoon(orderId);

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
    assertPermission(services, 'orders.reopen');
    const order = getOrderRow(orderId);
    if (!order) throw posError('POS_VAL_ORDER_NOT_FOUND');
    assertOwnOrder(order);

    const assignments = [`status = '${ORDER_STATUS.OPEN}'`, 'updated_at = ?', 'synced_at = NULL'];
    if (hasColumn('orders', 'is_locked')) assignments.push('is_locked = 0');
    rawDb
      .prepare(
        `UPDATE orders SET ${assignments.join(', ')} WHERE id = ?`
      )
      .run(nowMs(), orderId);
    log('orders.reopen', orderId, { previous_status: order.status });
    return getOrderWithLines(orderId);
  });

  ipcMain.handle('orders:cancel', async (_e, orderId: string) => {
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');
    const row = getOrderRow(orderId);
    if (row && !isOwnOrder(row)) return setOtherTillsStatus(row, ORDER_STATUS.CANCELLED_CLIENT);
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
      if (isPosLocked()) throw posError('POS_TILL_LOCKED');

      // Another till's order: its customer and sent lines are not ours to
      // change. New lines go to the server first; then how it was paid. A
      // tender is only ever kept for cash.
      const row = getOrderRow(orderId);
      if (row && !isOwnOrder(row)) {
        const added = await sendUnsentLinesOfOtherTill(row);
        const fresh = getOrderRow(orderId) ?? row;
        const split = splitFor(customer, fresh.grand_total);
        if (split) {
          const out = await changeOtherTillsOrder(fresh, {
            payments: split.map((p) => ({
              method: p.method,
              amount: p.amount,
              ...(p.amount_tendered != null ? { amount_tendered: p.amount_tendered } : {}),
            })),
          });
          return { ...(out as any), added_line_ids: added };
        }
        const slug = String(customer?.payment_method_slug ?? '').trim();
        const tender = isCashPayment(slug)
          ? tenderForWire(customer?.amount_tendered, fresh.grand_total)
          : null;
        const sameMethod = !slug || slug === String(fresh.payment_method_slug ?? '');
        const out =
          sameMethod && tender == null
            ? getOrderWithLines(orderId)
            : await changeOtherTillsOrder(fresh, {
                ...(sameMethod ? {} : { payment_method: slug }),
                ...(tender == null ? {} : { amount_tendered: tender }),
              });
        // The renderer prints a slip of just these for the kitchen.
        return { ...(out as any), added_line_ids: added };
      }

      // Same exception as addLine: a dine-in table takes a new round after it
      // was first placed. Without it the round could be added but never
      // placed — checkout refused it as POS_VAL_ORDER_LOCKED.
      assertOrderEditable(orderId, { allowAddOnLockedDineIn: true });

      const order = getOrderRow(orderId);
      if (!order) throw posError('POS_VAL_ORDER_NOT_FOUND');

      const lineCount = Number(
        rawDb
          .prepare('SELECT COUNT(*) FROM order_lines WHERE order_id = ?')
          .pluck()
          .get(orderId) ?? 0
      );
      if (lineCount === 0) {
        throw posError('POS_VAL_CART_EMPTY');
      }

      // Backstop only: the checkout screen validates the same three rules up
      // front and marks the offending field, so a cashier normally never gets
      // here. Reaching this means something bypassed the form, and one clear
      // coded error is more use than a joined list of English sentences.
      const type = Number(order.order_type || 0);

      if (!customer.full_name?.trim()) {
        throw posError('POS_VAL_NAME_REQUIRED', { field: 'full_name' });
      }
      if (type === 1 && !customer.address) {
        throw posError('POS_VAL_ADDRESS_REQUIRED', { field: 'address' });
      }
      if (type === 3 && !order.table_id) {
        throw posError('POS_VAL_TABLE_REQUIRED', { field: 'table' });
      }

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

      // Cash received, when the cashier was asked for it.
      //
      // Recorded against the recalculated grand total rather than the one the
      // checkout screen was showing: the recalc above can move the delivery
      // fee, and a tender validated against a stale total is how you get a
      // slip whose change line does not match its own bill. tenderForWire
      // drops anything short — that is a partial payment, not a rounding
      // question — and drops it silently, because the sale itself is valid.
      const split = splitFor(customer, totals.grand_total);
      if (split) {
        // The order carries the larger part, as the server files it.
        const main = largerPart(split);
        const m = rawDb
          .prepare(`SELECT id, slug FROM payment_methods WHERE slug = ? LIMIT 1`)
          .get(main.method) as any;
        params[1] = m?.id != null ? String(m.id) : customer.payment_method_id;
        params[2] = main.method;
      }
      const tendered = split
        ? split[0].amount_tendered ?? null
        : isCashPayment(customer.payment_method_slug)
          ? tenderForWire(customer.amount_tendered, totals.grand_total)
          : null;

      if (hasColumn('orders', 'amount_tendered')) {
        cols.push('amount_tendered = ?');
        params.push(tendered);
      }

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
        throw posError('POS_DB_WRITE_FAILED', { cause: err });
      }

      // Split parts, or none: a re-checkout as one payment clears an old split.
      writePayParts(orderId, split ?? []);

      // Placing sends every line, so every line is now "sent". This is what
      // tells a later round apart from the first: only unlocked lines can be
      // changed, and a repeat of the same item becomes its own line instead of
      // silently raising the quantity of one already in the kitchen. It used
      // to happen only in orders:markPrinted, which nothing calls.
      if (hasColumn('order_lines', 'is_locked')) {
        rawDb
          .prepare(`UPDATE order_lines SET is_locked = 1 WHERE order_id = ?`)
          .run(orderId);
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
    if (!isOwnOrder(order)) return setOtherTillsStatus(order, ORDER_STATUS.CLOSED);

    // 1. Mark order as completed — finished the same way orders:close finishes
    // one. This path used to skip three things: the re-push, so the server
    // kept the order open and its table busy, and every sync turned the table
    // red again on the till; closed_at, which the closing report keys off; and
    // the lock.
    const cols = [`status = 'completed'`, 'updated_at = ?'];
    const params: Array<number | string> = [ts];
    for (const col of ['completed_at', 'closed_at']) {
      if (hasColumn('orders', col)) {
        cols.push(`${col} = ?`);
        params.push(ts);
      }
    }
    if (hasColumn('orders', 'is_locked')) cols.push('is_locked = 1');
    params.push(orderId);

    rawDb.prepare(`UPDATE orders SET ${cols.join(', ')} WHERE id = ?`).run(...params);

    // 2. Release table
    if (order.table_id) releaseTableIfFree(order.table_id);

    markForRepush(orderId);
    schedulePushSoon(orderId);
    log('orders.releaseTable', orderId, { table_id: order.table_id });

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
    if (isPosLocked()) throw posError('POS_TILL_LOCKED');
    const cartItems = rawDb
      .prepare(`SELECT * FROM cart ORDER BY created_at ASC`)
      .all() as any[];
    if (cartItems.length === 0) throw posError('POS_VAL_CART_EMPTY');

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
      if (!table) throw posError('POS_VAL_TABLE_NOT_FOUND');

      const o = getOrderRow(orderId);
      if (o) assertOwnOrder(o);
      if (!o) throw posError('POS_VAL_ORDER_NOT_FOUND');
      if (Number(o.order_type) !== 3) throw posError('POS_VAL_NOT_DINE_IN');

      // A draft holds its table so every other till sees it as taken. Asked
      // before anything changes here: if another till has it, nothing moves.
      const isDraft = ['open', 'pending'].includes(String(o.status ?? '').toLowerCase());
      const moving = String(o.table_id ?? '') !== String(tableId);
      let heldNow = false;
      if (isDraft && moving) {
        const res = await holdTable(holdDeps(), String(tableId), {
          temp_id: String(orderId),
          covers,
          by: toServerUserId(getCurrentPosUser().id),
        });
        heldNow = res.held;
      }

      rawDb.transaction(() => {
        rawDb
          .prepare(
            `UPDATE orders SET table_id = ?, covers = ?, updated_at = ? WHERE id = ?`
          )
          .run(tableId, covers, ts, orderId);
        if (isDraft && moving) {
          // hold_at 0: not confirmed yet, so the next sync takes the hold.
          rawDb
            .prepare(`UPDATE orders SET hold_table_id = ?, hold_at = ? WHERE id = ?`)
            .run(String(tableId), heldNow ? Date.now() : 0, orderId);
        }
        // A fresh choice supersedes the server's refusal of the last one.
        if (hasColumn('orders', 'push_notice')) {
          rawDb.prepare(`UPDATE orders SET push_notice = NULL WHERE id = ?`).run(orderId);
        }
        if (o.table_id && o.table_id !== tableId) {
          releaseTableIfFree(o.table_id);
        }
        rawDb
          .prepare(`UPDATE tables SET is_available = 0 WHERE id = ?`)
          .run(tableId);
      })();
      if (isDraft && moving && o.hold_table_id) {
        await releaseHold(holdDeps(), String(o.hold_table_id), {
          temp_id: String(orderId),
          by: toServerUserId(getCurrentPosUser().id),
        });
      }
      // Moving an order that has already been sent must reach the server too;
      // the push skips anything already stamped as synced.
      markForRepush(orderId);
      schedulePushSoon(orderId);
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
          AND ${activeOrderSql('o')}
          ${userSql}
        ORDER BY o.opened_at DESC, o.created_at DESC
        LIMIT 1
      `
        )
        .get({ ...params, table_id: tableId }) as any;

      return row || null;
    }
  );

  ipcMain.handle(
    'orders:clearTable',
    async (
      _e,
      arg: string | { table_id?: string | number; order_id?: string | number | null },
      approval?: ApprovalInput
    ) => {
      // The admin Tables page clears by table, not by order: it frees a table
      // left marked busy and detaches whatever is still seated there. It used to
      // pass this object as an order id, which matched nothing, so the button
      // did nothing at all.
      if (arg && typeof arg === 'object') {
        assertPermission(services, 'tables.manage');
        const tableId = arg.table_id != null ? String(arg.table_id) : '';
        if (!tableId) throw posError('POS_VAL_TABLE_NOT_FOUND');
        const ts = nowMs();
        const seated = rawDb
          .prepare(
            `SELECT id FROM orders o WHERE o.table_id = ? AND ${activeOrderSql('o')}`
          )
          .pluck()
          .all(tableId) as string[];
        // Freeing it here would not free it on the server or the other tills.
        if (seated.some((id) => !isOwnOrder({ id }))) throw posError('POS_ORDER_OTHER_TILL');
        // Freeing a table someone is still sat at, with an order that has
        // items, is a force close: tables.force_close or a manager's code. A
        // table that only looks busy (a stale flag, an empty draft) is not.
        const withItems = seated.filter(
          (id) =>
            Number(
              rawDb.prepare('SELECT COUNT(*) FROM order_lines WHERE order_id = ?').pluck().get(id) ?? 0
            ) > 0
        );
        const forceApprover = withItems.length
          ? await resolveApprover(services, 'force_close_table', approval)
          : null;
        rawDb.transaction(() => {
          if (forceApprover) {
            for (const orderId of withItems) {
              recordApproval(services, forceApprover, {
                action: 'force_close_table',
                orderId,
                tableId,
              });
            }
          }
          rawDb
            .prepare(
              `UPDATE orders SET table_id = NULL, covers = NULL, updated_at = ?
               WHERE table_id = ? AND id IN (SELECT o.id FROM orders o WHERE ${activeOrderSql('o')})`
            )
            .run(ts, tableId);
          rawDb
            .prepare(`UPDATE tables SET is_available = 1 WHERE id = ?`)
            .run(tableId);
        })();
        seated.forEach(markForRepush);
        // Not null: the approval wrapper reads null as "dialog cancelled".
        return { ok: true, detached: seated.length };
      }

      const orderId = arg;
      const order = getOrderRow(orderId);
      if (!order) return getOrderWithLines(orderId);
      assertOwnOrder(order);

      // 🚫 Safety: do NOT allow clearing table if the order has any items
      let count: number;
      try {
        const row = rawDb
          .prepare('SELECT COUNT(*) AS c FROM order_lines WHERE order_id = ?')
          .get(orderId) as { c?: number };
        count = row?.c ?? 0;
      } catch (err) {
        console.error('[orders:clearTable] count check failed', err);
        // If we can’t be sure, better not clear.
        throw posError('POS_VAL_TABLE_CLEAR_UNVERIFIED');
      }
      // Outside the try: this refusal was being caught and re-thrown as
      // "could not verify", which told the cashier the wrong thing.
      if (count > 0) throw posError('POS_VAL_TABLE_HAS_ITEMS');

      // The transaction is invoked, not just built. It used to be missing its
      // trailing (), so clearing never ran: the order stayed on its table and
      // the table stayed busy.
      rawDb.transaction(() => {
        rawDb
          .prepare(
            `UPDATE orders SET table_id = NULL, covers = NULL, hold_table_id = NULL, hold_at = NULL, updated_at = ? WHERE id = ?`
          )
          .run(nowMs(), orderId);
        if (order.table_id) releaseTableIfFree(order.table_id);
      })();
      if (order.hold_table_id) {
        await releaseHold(holdDeps(), String(order.hold_table_id), {
          temp_id: String(orderId),
          by: toServerUserId(getCurrentPosUser().id),
        });
      }

      return getOrderWithLines(orderId);
    }
  );

  // ─────────────────────────────────────────────────────────────
  // 🌐 UTILS & SHELL
  // ─────────────────────────────────────────────────────────────

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (!url) return;
    await shell.openExternal(url);
    return { ok: true };
  });
}
