import db from '../db';
import crypto from 'node:crypto';
import { broadcast } from '../socket';

// ... (rest of the file is the same)

export const OrderRepo = {
  start({ orderType = 2, branchId, deviceId }: { orderType?: number; branchId?: number; deviceId?: string }) {
    // ... (rest of the function is the same)
    broadcast('orders:updated', null);
    return { id, number, order_type: orderType };
  },

  get(orderId: string) {
    // ... (rest of the function is the same)
  },

  addLine(orderId: string, itemId: string, qty = 1) {
    // ... (rest of the function is the same)
    broadcast('orders:updated', null);
    return this.get(orderId);
  },

  setOrderType(orderId: string, type: 1|2|3) {
    // ... (rest of the function is the same)
    broadcast('orders:updated', null);
    return this.get(orderId);
  },

  setCustomer(orderId: string, info: { full_name?:string; mobile?:string; address?:string; city_id?:string; delivery_fee?:number }) {
    // ... (rest of the function is the same)
    broadcast('orders:updated', null);
    return this.get(orderId);
  },

  setStatus(orderId: string, status: 'open'|'draft'|'closed'|'completed'|'cancelled') {
    // ... (rest of the function is the same)
    broadcast('orders:updated', null);
    return this.get(orderId);
  },

  // ... (rest of the file is the same)
};
