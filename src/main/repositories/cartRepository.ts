import db from '../db';
import crypto from 'node:crypto';

export const CartRepo = {
  importSessionCartToOrder(sessionId: string, orderId: string) {
    const rows = db.prepare(`SELECT * FROM cart WHERE session_id=?`).all(sessionId) as any[];
    const ins = db.prepare(`
      INSERT INTO order_lines (id,order_id,item_id,name,name_ar,unit_price,qty,discount_amount,line_total,notes)
      VALUES (@id,@order_id,@item_id,@name,@name_ar,@unit_price,@qty,0,@line_total,@item_notes)
    `);
    const tx = db.transaction((rs: any[]) => {
      rs.forEach(c => {
        const id = crypto.randomUUID();
        const unit = Number(c.price);
        const qty = Number(c.qty ?? 1);
        ins.run({
          id, order_id: orderId, item_id: String(c.item_id),
          name: c.item_name, name_ar: c.item_name_ar,
          unit_price: unit, qty, line_total: +(unit*qty).toFixed(3),
          item_notes: c.item_notes ?? null,
        });
      });
    });
    tx(rows);
  },
};
