// src/main/handlers/payments.ts
import type { IpcMain } from 'electron';
import axios from 'axios';
import QRCode from 'qrcode';
import db, { getMeta } from '../db';
import { loadSecret } from '../secureStore';
import { isTerminalServerStatus } from '../utils/serverStatus';
import { isTerminal } from '../utils/orderStatus';

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

  /**
   * Change the payment method on an existing order.
   *
   * A cashier rings up "cash", the customer then pays by KNET — with no way to
   * correct it the day's takings are wrong by that amount. Allowed on closed
   * orders deliberately: the correction is almost always needed after the sale.
   *
   * Clears synced_at so the change reaches the server; push applies payment on
   * re-push of a known external_id.
   */
  ipcMain.handle(
    'orders:setPaymentMethod',
    async (_e, orderId: string, methodId: string) => {
      const id = String(orderId ?? '').trim();
      if (!id) throw new Error('Order id is required');

      const method = db
        .prepare(
        `SELECT id, slug, name_en, name_ar, is_online, supports_payment_link FROM payment_methods WHERE id = ?`
        )
        .get(String(methodId)) as any;
      if (!method) throw new Error('Unknown payment method');

      const order = db
        .prepare(`SELECT id, status, status_code FROM orders WHERE id = ?`)
        .get(id) as any;
      if (!order) throw new Error('Order not found');
      if (isTerminal(order.status) || isTerminalServerStatus(order.status_code)) {
        throw new Error('Completed orders cannot change their payment method');
      }

      db.prepare(
        `UPDATE orders
            SET payment_method_id   = ?,
                payment_method_slug = ?,
                updated_at          = ?,
                synced_at           = NULL
          WHERE id = ?`
      ).run(String(method.id), method.slug ?? '', Date.now(), id);

      console.log('[orders:setPaymentMethod]', {
        order: id,
        to: method.slug,
      });

      return {
        ok: true,
        slug: method.slug,
        name_en: method.name_en,
        is_online: Boolean(method.is_online),
        supports_payment_link: Boolean(method.supports_payment_link),
      };
    }
  );

  ipcMain.handle(
    'orders:setCustomerMobile',
    async (_e, orderId: string, mobile: string) => {
      const id = String(orderId ?? '').trim();
      const normalized = String(mobile ?? '').replace(/\D/g, '');
      if (normalized.length < 8 || normalized.length > 15) {
        throw new Error('Enter a valid customer mobile number');
      }
      const order = db
        .prepare('SELECT status, status_code FROM orders WHERE id = ?')
        .get(id) as any;
      if (!order) throw new Error('Order not found');
      if (isTerminal(order.status) || isTerminalServerStatus(order.status_code)) {
        throw new Error('Completed orders cannot be changed');
      }
      db.prepare(
        'UPDATE orders SET mobile = ?, updated_at = ?, synced_at = NULL WHERE id = ?'
      ).run(normalized, Date.now(), id);
      return { ok: true, mobile: normalized };
    }
  );

  /** The stored payment link for an order, so the QR can be shown again. */
  ipcMain.handle('orders:paymentLink:get', async (_e, orderId: string) => {
    const row = db
      .prepare(
        `SELECT payment_link_url, payment_link_status, grand_total, mobile, number, reference_no
           FROM orders WHERE id = ? LIMIT 1`
      )
      .get(String(orderId ?? '')) as any;
    if (!row?.payment_link_url) return null;
    return {
      url: row.payment_link_url,
      status: row.payment_link_status ?? null,
      amount: Number(row.grand_total ?? 0),
      mobile: row.mobile ?? null,
      label: row.reference_no ? `#${row.reference_no}` : row.number ?? null,
    };
  });

  // --- List active payment methods (for payment selector) ---
  ipcMain.handle('payments:listMethods', async () => {
    return db
      .prepare(
        `
        SELECT id, slug, name_en, name_ar, legacy_code, is_active,
               is_online, supports_payment_link
        FROM payment_methods
        WHERE is_active = 1
        ORDER BY legacy_code ASC
      `
      )
      .all();
  });
}
