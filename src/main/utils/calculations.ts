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
  if (cid != null && cid !== '') return String(cid);

  const metaCid = services.meta.get('cart.city_id');
  return metaCid ? String(metaCid) : null;
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
 * void_delivery_fee flags (order-level first, then cart meta).
 */
export function computeDeliveryFee(services: MainServices, order: any): number {
  if (Number(order?.order_type) !== 1) return 0;

  // Prefer persisted flag
  if (Number(order?.void_delivery_fee) === 1) return 0;

  // Fallback to cart meta for open orders
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

  const sums = db
    .prepare(
      `
      SELECT COALESCE(SUM(line_total), 0) AS subtotal
      FROM order_lines
      WHERE order_id = ?
    `
    )
    .get(orderId) as { subtotal: number };

  const order = getOrderRow(services, orderId);
  const subtotal = Number(sums?.subtotal || 0);

  const promo = resolvePromoByCode(services, order?.promocode ?? null);
  const discount_total = computePromoDiscount(subtotal, promo);

  const delivery_fee = computeDeliveryFee(services, order);
  const tax_total = 0; // adjust if you add tax logic

  const grand_total = +(subtotal - discount_total + delivery_fee).toFixed(3);

  db.prepare(
    `
      UPDATE orders
      SET subtotal = ?, tax_total = ?, discount_total = ?, delivery_fee = ?, grand_total = ?
      WHERE id = ?
    `
  ).run(
    subtotal,
    tax_total,
    discount_total,
    delivery_fee,
    grand_total,
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
