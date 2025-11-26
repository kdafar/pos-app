// src/main/handlers/payments.ts
import type { IpcMain } from 'electron';
import axios from 'axios';
import db, { getMeta } from '../db';
import { loadSecret } from '../secureStore';

type PaymentLinkArgs = {
  external_order_id: string;
  order_number?: string | null;
  amount: number;
  currency?: string;
  customer?: {
    name?: string | null;
    email?: string | null;
    mobile?: string | null;
  };
};

export function registerPaymentHandlers(ipcMain: IpcMain) {
  // --- Create payment link via backend ---
  ipcMain.handle(
    'payments:createLink',
    async (_event, arg: PaymentLinkArgs | string, maybeAmount?: number) => {
      const base = getMeta('server.base_url') || '';
      const deviceId = getMeta('device_id') || '';
      const branchId = Number(getMeta('branch_id') || 0); // not used in payload, but useful context
      const token = await loadSecret('device_token');

      if (!base || !deviceId || !token) {
        throw new Error(
          'Not configured for payments (missing base URL / device / token)'
        );
      }

      // Local axios client for /api/pos
      const client = axios.create({
        baseURL: base.replace(/\/+$/, '') + '/api/pos',
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Pos-Device': deviceId, // posDevice middleware reads this
        },
      });

      // Support 2 call shapes:
      // 1) invoke('payments:createLink', { external_order_id, amount, ... })
      // 2) invoke('payments:createLink', orderId, amount)
      let payload: PaymentLinkArgs;

      if (typeof arg === 'object' && arg !== null) {
        payload = {
          currency: 'KWD',
          ...arg,
        };
      } else {
        payload = {
          external_order_id: String(arg),
          amount: Number(maybeAmount ?? 0),
          currency: 'KWD',
        };
      }

      // POST /api/pos/payments/link → { url, status, expires_at, provider_ref }
      const { data } = await client.post('/payments/link', payload);
      return data;
    }
  );

  // --- List active payment methods (for payment selector) ---
  ipcMain.handle('payments:listMethods', async () => {
    return db
      .prepare(
        `
        SELECT id, slug, name_en, name_ar, legacy_code, is_active
        FROM payment_methods
        WHERE is_active = 1
        ORDER BY legacy_code ASC
      `
      )
      .all();
  });
}
