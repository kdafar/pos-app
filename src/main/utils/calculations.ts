// src/main/utils/calculations.ts
import type { MainServices } from '../types/common';

export type PromoRow = {
  id: string;
  code: string;
  type: 'percent' | 'amount';
  value: number;
  min_total?: number | null;
  max_discount?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  active?: number | null;
};

export type Totals = {
  subtotal: number;
  tax_total: number;
  discount_total: number;
  delivery_fee: number;
  grand_total: number;
};

/* ------------------------ Cart line helpers ------------------------ */

export function parseNumList(input: any): number[] {
  if (input == null) return [];
  if (typeof input === 'number') return [input];

  const s = String(input).trim();
  if (!s) return [];

  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map((n) => Number(n) || 0);
    const n = Number(j);
    return Number.isFinite(n) ? [n] : [];
  } catch {
    return s.split(',').map((x) => Number(x.trim()) || 0);
  }
}

export function addonsUnitTotal(addons_price: any, addons_qty: any): number {
  const prices = parseNumList(addons_price);
  const qtys = parseNumList(addons_qty);
  if (!prices.length) return 0;

  if (!qtys.length) {
    return prices.reduce((a, b) => a + (Number(b) || 0), 0);
  }

  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    const p = Number(prices[i]) || 0;
    const q = Number(qtys[i] ?? 1) || 1;
    sum += p * q;
  }
  return sum;
}

/**
 * Base unit price for a cart row / order_line source row.
 * Uses variation_price if > 0, then price, then adds addons total.
 */
export function baseUnitPrice(row: any): number {
  const varP = Number(row.variation_price);
  const price = Number(row.price);
  const unit = Number.isFinite(varP) && varP > 0 ? varP : Number(price) || 0;
  const addons = addonsUnitTotal(row.addons_price, row.addons_qty);
  return unit + addons;
}

export function calcLineTotal(row: any): number {
  const unit = baseUnitPrice(row);
  const qty = Number(row.qty) || 0;
  return +(unit * qty).toFixed(3);
}

/* --------------------- Promo & delivery helpers --------------------- */

export function resolvePromoByCode(
  services: MainServices,
  code: string | null
): PromoRow | null {
  if (!code) return null;

  const row = services.rawDb
    .prepare(
      `
      SELECT id, code, type, value, min_total, max_discount, start_at, end_at, active
      FROM promos
      WHERE UPPER(code) = UPPER(?) AND active = 1
      LIMIT 1
    `
    )
    .get(code) as PromoRow | undefined;

  if (!row) return null;

  const now = Date.now();
  const startsOk = !row.start_at || new Date(row.start_at).getTime() <= now;
  const endsOk = !row.end_at || new Date(row.end_at).getTime() >= now;

  return startsOk && endsOk ? row : null;
}

export function computePromoDiscount(
  subtotal: number,
  promo: PromoRow | null
): number {
  if (!promo) return 0;

  const minTotal = Number(promo.min_total ?? 0);
  if (subtotal < minTotal) return 0;

  let discount = 0;
  if (promo.type === 'percent') {
    discount = subtotal * (Number(promo.value || 0) / 100);
  } else {
    discount = Number(promo.value || 0);
  }

  const cap = Number(promo.max_discount ?? 0);
  if (Number.isFinite(cap) && cap > 0) discount = Math.min(discount, cap);

  discount = Math.max(0, Math.min(discount, subtotal));
  return +discount.toFixed(3);
}

function getOrderRow(services: MainServices, orderId: string): any | null {
  return services.rawDb
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .get(orderId) as any;
}

function getOrderCityId(services: MainServices, order: any): string | null {
  const cid = order?.city_id ?? null;
  if (cid == null || cid === '') return null;
  return String(cid);
}

function getDeliveryFeeForCity(
  services: MainServices,
  cityId: string | null
): number {
  if (!cityId) return 0;
  const row = services.rawDb
    .prepare(`SELECT delivery_fee FROM cities WHERE id = ?`)
    .get(cityId) as any;
  const fee = Number(row?.delivery_fee ?? 0);
  return Number.isFinite(fee) ? fee : 0;
}

/**
 * Compute delivery fee for an order.
 * Only applies to delivery orders (order_type === 1) and honors the
 * void_delivery_fee flags.
 */
export function computeDeliveryFee(services: MainServices, order: any): number {
  if (Number(order?.order_type) !== 1) return 0;

  // Prefer persisted flag
  if (Number(order?.void_delivery_fee) === 1) return 0;

  // Fallback meta flag (legacy)
  const voidFeeMeta =
    (services.meta.get('cart.void_delivery_fee') || '') === '1';
  if (voidFeeMeta) return 0;

  const cityId = getOrderCityId(services, order);
  return getDeliveryFeeForCity(services, cityId);
}

/* ---------------------- Recalculate order totals --------------------- */

export function recalcOrderTotals(
  services: MainServices,
  orderId: string
): Totals {
  const db = services.rawDb;

  // 1) Subtotal from lines
  const sums = db
    .prepare(
      `
      SELECT COALESCE(SUM(line_total), 0) AS subtotal
      FROM order_lines
      WHERE order_id = ?
    `
    )
    .get(orderId) as { subtotal: number };

  let subtotal = Number(sums?.subtotal || 0);
  subtotal = +subtotal.toFixed(3);

  // 2) Load order row
  const order = getOrderRow(services, orderId);

  // 3) Discount (promo OR manual)
  const promo = resolvePromoByCode(services, order?.promocode ?? null);
  const promoDiscount = computePromoDiscount(subtotal, promo);

  // Manual discount already stored on order (amount or percentage)
  let manualDiscount = 0;

  if (order?.discount_amount != null && order.discount_amount !== '') {
    const d = Number(order.discount_amount);
    if (Number.isFinite(d) && d > 0) {
      manualDiscount = +d.toFixed(3);
    }
  } else if (order?.discount_pr != null && order.discount_pr !== '') {
    const pr = Number(order.discount_pr);
    if (Number.isFinite(pr) && pr > 0) {
      manualDiscount = +(subtotal * (pr / 100)).toFixed(3);
    }
  }

  // If there is a promo, prefer its discount; otherwise use manual.
  const discount_amount = promo ? promoDiscount : manualDiscount;
  const discount_total = discount_amount; // keep both in sync

  // 4) Delivery fee
  let delivery_fee = 0;

  // Prefer per-order value if present & non-zero
  if (order && order.delivery_fee != null && order.delivery_fee !== '') {
    const df = Number(order.delivery_fee);
    if (Number.isFinite(df) && df !== 0) {
      delivery_fee = df;
    }
  }

  // If still zero, compute from city/settings
  if (delivery_fee === 0) {
    delivery_fee = computeDeliveryFee(services, order);
  }

  delivery_fee = +delivery_fee.toFixed(3);

  // 5) Tax (none for now – hook here later)
  const tax_total = 0;

  // 6) Grand total
  const grand_total = +(subtotal - discount_amount + delivery_fee).toFixed(3);

  // 7) Persist to orders
  db.prepare(
    `
      UPDATE orders
      SET subtotal        = ?,
          tax_total       = ?,
          discount_total  = ?,
          discount_amount = ?,
          delivery_fee    = ?,
          grand_total     = ?,
          updated_at      = ?
      WHERE id = ?
    `
  ).run(
    subtotal,
    tax_total,
    discount_total,
    discount_amount,
    delivery_fee,
    grand_total,
    Date.now(),
    orderId
  );

  return {
    subtotal,
    tax_total,
    discount_total,
    delivery_fee,
    grand_total,
  };
}
