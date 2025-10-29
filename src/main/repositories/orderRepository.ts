import db from '../db';
import crypto from 'node:crypto';

type Totals = { subtotal:number; tax_total:number; discount_total:number; delivery_fee:number; grand_total:number };
type TaxSettingRow = { value: string };
type OrderLinePriceRow = { qty: number; unit_price: number; d: number };
type OrderDeliveryFeeRow = { delivery_fee: number };
type ActiveOrderPositionRow = { p: number };
type ItemPriceRow = { id: string; name: string; name_ar: string; price: number };
type ExistingOrderLineRow = { id: string; qty: number; unit_price: number };

function getTaxRate(): number {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key='tax.percent'`).get() as TaxSettingRow | undefined;
  const pct = row?.value ? Number(row.value) : 0;
  return isFinite(pct) ? pct : 0;
}

function computeTotals(orderId: string): Totals {
  const taxPct = getTaxRate();
  const lines = db.prepare(`SELECT qty, unit_price, COALESCE(discount_amount,0) AS d FROM order_lines WHERE order_id=?`).all(orderId) as OrderLinePriceRow[];
  const subtotal = lines.reduce((s,l)=> s + (Number(l.qty)*Number(l.unit_price)), 0);
  const discount_total = lines.reduce((s,l)=> s + Number(l.d), 0);
  const tax_total = +( (subtotal - discount_total) * (taxPct/100) ).toFixed(3);
  const delivery_fee = Number(db.prepare(`SELECT delivery_fee FROM orders WHERE id=?`).get(orderId)?.delivery_fee ?? 0);
  const grand_total = +(subtotal - discount_total + tax_total + delivery_fee).toFixed(3);
  return { subtotal:+subtotal.toFixed(3), tax_total, discount_total:+discount_total.toFixed(3), delivery_fee:+delivery_fee.toFixed(3), grand_total };
}

export const OrderRepo = {
  start({ orderType = 2, branchId, deviceId }: { orderType?: number; branchId?: number; deviceId?: string }) {
    const id = crypto.randomUUID();
    const number = `D${Date.now().toString().slice(-8)}`;
    const now = Date.now();

    const pos = (db.prepare(`SELECT COALESCE(MAX(tab_position), -1)+1 AS p FROM active_orders`).get() as ActiveOrderPositionRow | undefined)?.p ?? 0;

    db.transaction(()=>{
      db.prepare(`INSERT INTO orders (id,number,device_id,branch_id,order_type,status,opened_at,updated_at)
                  VALUES (?,?,?,?,?,'open',?,?)`).run(id, number, deviceId ?? null, branchId ?? null, orderType, now, now);
      db.prepare(`INSERT INTO active_orders (order_id, tab_position, last_accessed) VALUES (?,?,?)`).run(id, pos, now);
    })();

    return { id, number, order_type: orderType };
  },

  get(orderId: string) {
    const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(orderId);
    const lines = db.prepare(`SELECT * FROM order_lines WHERE order_id=? ORDER BY rowid`).all(orderId);
    const totals = computeTotals(orderId);
    return { order: { ...order, ...totals }, lines };
  },

  addLine(orderId: string, itemId: string, qty = 1) {
    const item = db.prepare(`SELECT id,name,name_ar,price FROM items WHERE id=?`).get(itemId) as ItemPriceRow | undefined;
    if (!item) throw new Error('Item not found');

    const existing = db.prepare(`SELECT id, qty, unit_price FROM order_lines WHERE order_id=? AND item_id=?`).get(orderId, itemId) as ExistingOrderLineRow | undefined;
    if (existing) {
      const newQty = Number(existing.qty) + qty;
      const lineTotal = +(newQty * Number(existing.unit_price)).toFixed(3);
      db.prepare(`UPDATE order_lines SET qty=?, line_total=? WHERE id=?`).run(newQty, lineTotal, existing.id);
    } else {
      const id = crypto.randomUUID();
      const unit = Number(item.price);
      db.prepare(`
        INSERT INTO order_lines (id,order_id,item_id,name,name_ar,unit_price,qty,tax_amount,discount_amount,line_total)
        VALUES (?,?,?,?,?,?,?,0,0,?)
      `).run(id, orderId, itemId, item.name, item.name_ar, unit, qty, +(unit*qty).toFixed(3));
    }
    db.prepare(`UPDATE orders SET updated_at=? WHERE id=?`).run(Date.now(), orderId);
    return this.get(orderId);
  },

  setOrderType(orderId: string, type: 1|2|3) {
    db.prepare(`UPDATE orders SET order_type=?, updated_at=? WHERE id=?`).run(type, Date.now(), orderId);
    return this.get(orderId);
  },

  setCustomer(orderId: string, info: { full_name?:string; mobile?:string; address?:string; city_id?:string; delivery_fee?:number }) {
    const fee = info.delivery_fee ?? null;
    db.prepare(`
      UPDATE orders SET full_name=COALESCE(?,full_name),
                        mobile=COALESCE(?,mobile),
                        address=COALESCE(?,address),
                        city_id=COALESCE(?,city_id),
                        delivery_fee=COALESCE(?,delivery_fee),
                        updated_at=?
      WHERE id=?`)
      .run(info.full_name ?? null, info.mobile ?? null, info.address ?? null, info.city_id ?? null, fee, Date.now(), orderId);
    return this.get(orderId);
  },

  setStatus(orderId: string, status: 'open'|'draft'|'closed'|'completed'|'cancelled') {
    const now = Date.now();
    const closables = (status === 'closed' || status === 'completed');
    db.prepare(`UPDATE orders SET status=?, closed_at=CASE WHEN ? THEN ? ELSE closed_at END, updated_at=? WHERE id=?`)
      .run(status, closables ? 1 : 0, now, now, orderId);
    if (closables) db.prepare(`DELETE FROM active_orders WHERE order_id=?`).run(orderId);
    return this.get(orderId);
  },

  listActive() {
    return db.prepare(`
      SELECT ao.order_id as id, ao.tab_position, o.number, o.order_type, o.updated_at
      FROM active_orders ao
      JOIN orders o ON o.id = ao.order_id
      ORDER BY ao.tab_position ASC
    `).all();
  },

  listPrepared(limit = 12) {
    return db.prepare(`
      SELECT id, number, grand_total, status, closed_at, updated_at
      FROM orders
      WHERE status IN ('closed','completed')
      ORDER BY closed_at DESC NULLS LAST, updated_at DESC
      LIMIT ?
    `).all(limit);
  },
};
