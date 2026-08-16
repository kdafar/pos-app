// src/main/handlers/payments.ts
import type { IpcMain } from 'electron';
import axios from 'axios';
import QRCode from 'qrcode';
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
  /**
   * Render a payment link as a QR the CUSTOMER scans with their own phone.
   *
   * The link used to be opened with shell.openExternal, which launched the
   * payment page in the cashier's browser on the till — the customer never saw
   * it, and the till was hijacked mid-sale. A till is a shared device; nothing
   * customer-facing belongs in its browser.
   */
  ipcMain.handle('payments:linkQr', async (_e, url: string) => {
    const text = String(url ?? '').trim();
    if (!text) return null;
    try {
      return await QRCode.toDataURL(text, {
        margin: 1,
        scale: 8, // large enough to scan off a screen at arm's length
        errorCorrectionLevel: 'M',
      });
    } catch (e: any) {
      console.error('[payments:linkQr] failed:', e?.message || e);
      return null;
    }
  });

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

  /**
   * Ask the server whether a payment link has been settled, and record the
   * answer locally so the till can show paid/unpaid without being online.
   *
   * Nothing polled this before, so a cashier had no way to know whether an
   * online order had actually been paid — the link was created and then the
   * result was never looked at again.
   */
  ipcMain.handle('payments:checkStatus', async (_e, orderId: string) => {
    const id = String(orderId ?? '').trim();
    if (!id) return { status: null };

    const base = getMeta('server.base_url') || '';
    const deviceId = getMeta('device_id') || '';
    const token = await loadSecret('device_token');

    const local = db
      .prepare(
        `SELECT payment_link_status FROM orders WHERE id = ? LIMIT 1`
      )
      .get(id) as { payment_link_status?: string } | undefined;

    if (!base || !deviceId || !token) {
      // Offline: report what we last knew rather than implying "unpaid".
      return { status: local?.payment_link_status ?? null, offline: true };
    }

    try {
      const client = axios.create({
        baseURL: base.replace(/\/+$/, '') + '/api/pos',
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Pos-Device': deviceId,
        },
      });

      const { data } = await client.get('/payments/status', {
        params: { external_id: id },
      });

      const raw = String(
        data?.status ?? data?.payment_status ?? ''
      ).toLowerCase();
      const status = /paid|success|captured|completed/.test(raw)
        ? 'paid'
        : /fail|declin|cancel|expired/.test(raw)
        ? 'failed'
        : 'pending';

      db.prepare(
        `UPDATE orders
            SET payment_link_status = ?,
                payment_link_verified_at = ?,
                updated_at = ?
          WHERE id = ?`
      ).run(status, Date.now(), Date.now(), id);

      return { status, raw };
    } catch (e: any) {
      console.warn('[payments:checkStatus] failed:', e?.message || e);
      return { status: local?.payment_link_status ?? null, error: true };
    }
  });

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
