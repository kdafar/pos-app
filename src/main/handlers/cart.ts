// src/main/handlers/cart.ts
import type { IpcMain } from 'electron';
import crypto from 'node:crypto';
import db, { getMeta } from '../db';

const nowMs = () => Date.now();

/* --------------------- helpers (local to cart) --------------------- */

function parseNumList(input: any): number[] {
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

function addonsUnitTotal(addons_price: any, addons_qty: any): number {
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

function baseUnitPrice(row: any): number {
  const varP = Number(row.variation_price);
  const price = Number(row.price);
  const unit = Number.isFinite(varP) && varP > 0 ? varP : Number(price) || 0;
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
  const discount_total = 0; // promos apply on orders, not cart

  const orderType = Number(getMeta('cart.order_type') || 0);
  let delivery_fee = 0;

  if (orderType === 1) {
    const cityId = getMeta('cart.city_id');
    if (cityId) {
      const city = db
        .prepare(`SELECT delivery_fee FROM cities WHERE id = ?`)
        .get(cityId) as any;

      if (city && Number.isFinite(Number(city.delivery_fee))) {
        delivery_fee = Number(city.delivery_fee);
      }
    }

    if (getMeta('cart.void_delivery_fee') === '1') {
      delivery_fee = 0;
    }
  }

  const grand_total = +(subtotal - discount_total + delivery_fee).toFixed(3);

  return { subtotal, discount_total, delivery_fee, grand_total };
}

/* ---------------------- IPC handler registration ---------------------- */

export function registerCartHandlers(ipcMain: IpcMain) {
  ipcMain.handle('cart:list', async () => {
    const rows = db
      .prepare(`SELECT * FROM cart ORDER BY created_at ASC, rowid ASC`)
      .all();
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

    const existing = db
      .prepare(
        `
        SELECT * FROM cart
        WHERE item_id = ?
          AND IFNULL(variation_id,'') = IFNULL(?, '')
          AND IFNULL(addons_id,'')   = IFNULL(?, '')
        LIMIT 1
      `
      )
      .get(keyItem, keyVar, keyAdds) as any;

    if (existing) {
      const newQty = (Number(existing.qty) || 0) + q;
      db.prepare(`UPDATE cart SET qty = ?, updated_at = ? WHERE id = ?`).run(
        newQty,
        now,
        existing.id
      );
    } else {
      const id = crypto.randomUUID();
      db.prepare(
        `
        INSERT INTO cart (
          id,user_id,session_id,item_id,item_name,item_name_ar,item_image,
          addons_id,addons_name,addons_name_ar,addons_price,addons_qty,
          variation_id,variation,variation_ar,variation_price,
          price,qty,tax,item_notes,is_available,
          created_at,updated_at,branch_id
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `
      ).run(
        id,
        null,
        sid,
        payload.item_id,
        payload.item_name,
        payload.item_name_ar ?? null,
        payload.item_image ?? null,
        payload.addons_id ?? null,
        payload.addons_name ?? null,
        payload.addons_name_ar ?? null,
        payload.addons_price ?? null,
        payload.addons_qty ?? null,
        payload.variation_id ?? null,
        payload.variation ?? null,
        payload.variation_ar ?? null,
        payload.variation_price ?? null,
        payload.price,
        q,
        null,
        payload.item_notes ?? null,
        1,
        now,
        now,
        Number(getMeta('branch_id') || 0)
      );
    }

    return { ok: true, totals: cartTotals() };
  });

  ipcMain.handle('cart:setQty', async (_e, id: string, qty: number) => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) throw new Error('Invalid qty');

    db.prepare(`UPDATE cart SET qty = ?, updated_at = ? WHERE id = ?`).run(
      q,
      nowMs(),
      id
    );
    return { ok: true, totals: cartTotals() };
  });

  ipcMain.handle('cart:inc', async (_e, id: string) => {
    db.prepare(
      `UPDATE cart SET qty = qty + 1, updated_at = ? WHERE id = ?`
    ).run(nowMs(), id);
    return { ok: true, totals: cartTotals() };
  });

  ipcMain.handle('cart:dec', async (_e, id: string) => {
    const row = db.prepare(`SELECT qty FROM cart WHERE id = ?`).get(id) as any;
    const q = Number(row?.qty || 0);

    if (q <= 1) {
      db.prepare(`DELETE FROM cart WHERE id = ?`).run(id);
    } else {
      db.prepare(
        `UPDATE cart SET qty = qty - 1, updated_at = ? WHERE id = ?`
      ).run(nowMs(), id);
    }

    return { ok: true, totals: cartTotals() };
  });

  ipcMain.handle('cart:remove', async (_e, id: string) => {
    db.prepare(`DELETE FROM cart WHERE id = ?`).run(id);
    return { ok: true, totals: cartTotals() };
  });

  ipcMain.handle('cart:setNotes', async (_e, id: string, note: string) => {
    db.prepare(
      `UPDATE cart SET item_notes = ?, updated_at = ? WHERE id = ?`
    ).run(note ?? null, nowMs(), id);
    return { ok: true };
  });

  ipcMain.handle(
    'cart:setContext',
    async (
      _e,
      ctx: {
        order_type?: number;
        city_id?: string | null;
        void_delivery_fee?: boolean;
      }
    ) => {
      if (ctx.order_type != null) {
        db.prepare(
          `
          INSERT INTO meta(key,value)
          VALUES('cart.order_type', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
        ).run(String(ctx.order_type));
      }

      if (ctx.city_id !== undefined) {
        db.prepare(
          `
          INSERT INTO meta(key,value)
          VALUES('cart.city_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
        ).run(ctx.city_id ? String(ctx.city_id) : '');
      }

      if (ctx.void_delivery_fee != null) {
        db.prepare(
          `
          INSERT INTO meta(key,value)
          VALUES('cart.void_delivery_fee', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
        ).run(ctx.void_delivery_fee ? '1' : '0');
      }

      return { ok: true, totals: cartTotals() };
    }
  );
}
