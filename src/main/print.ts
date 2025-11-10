import { BrowserWindow, ipcMain, app } from 'electron';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';

// ⬇️ Replace these with your real DB accessors
// If you already have repositories, import them instead.
import Database from 'better-sqlite3';
const db = new Database(path.join(app.getPath('userData'), 'pos.db')); // adjust

type OrderType = 1 | 2 | 3;
type OrderRow = {
  id: string;
  number: string;
  order_type: OrderType;
  payment_method_slug?: string;
  delivery_fee?: number;
  discount_amount?: number;
  grand_total?: number;
  subtotal?: number;
  delivery_date?: string | null;
  created_at: string;
  full_name?: string;
  mobile?: string;
  address?: string | null;
  landmark?: string | null;
  table_name?: string | null;
  branch_name?: string | null;
  branch_phone?: string | null;
  order_number?: string | null; // for QR
};
type LineRow = {
  id: string;
  item_name: string;
  item_name_ar?: string | null;
  variation?: string | null;
  size?: string | null;
  item_notes?: string | null;
  qty: number;
  price: number;
  addons_json?: string | null; // optional JSON [{name,name_ar,qty,price}]
};

// ---- helpers --------------------------------------------------------------

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function getOrder(orderId: string): OrderRow | undefined {
  // ⚠️ Adjust table/column names to your schema
  const row = db.prepare(`
    SELECT
      o.id, o.number, o.order_type, o.payment_method_slug,
      o.delivery_fee, o.discount_amount, o.grand_total, o.subtotal,
      o.delivery_date, o.created_at,
      o.full_name, o.mobile, o.address, o.landmark,
      o.table_name, o.branch_name, o.branch_phone,
      o.order_number
    FROM orders o
    WHERE o.id = ?
  `).get(orderId) as OrderRow | undefined;
  return row;
}

function getLines(orderId: string): LineRow[] {
  // ⚠️ Adjust to your schema (order_details)
  const rows = db.prepare(`
    SELECT
      od.id,
      COALESCE(od.item_name, i.name_en)      AS item_name,
      COALESCE(od.item_name_ar, i.name_ar)   AS item_name_ar,
      od.variation, od.size, od.item_notes,
      od.qty, od.unit_price AS price,
      od.addons_json
    FROM order_details od
    LEFT JOIN items i ON i.id = od.item_id
    WHERE od.order_id = ?
    ORDER BY od.id ASC
  `).all(orderId) as LineRow[];
  return rows;
}

async function toDataUrl(filePath: string | null | undefined): Promise<string | null> {
  try {
    if (!filePath) return null;
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1) || 'png';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

function orderTypeLabel(t: OrderType) {
  return t === 1 ? 'Delivery' : t === 2 ? 'Pickup' : 'Dine-in';
}

// generate QR & barcode as base64 (no internet)
async function makeQrPngDataUrl(text: string) {
  return await QRCode.toDataURL(text || '', { margin: 1, scale: 4, errorCorrectionLevel: 'M' });
}
async function makeCode128PngDataUrl(text: string) {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 2,
    height: 10,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ---- receipt HTML (self-contained, Blade-like) ----------------------------

function renderReceiptHTML(opts: {
  aboutLogo?: string | null;
  branchName?: string | null;
  branchPhone?: string | null;
  lang: 'ar' | 'en';
  order: OrderRow;
  lines: LineRow[];
  qrDataUrl?: string | null;
  barcodeDataUrl?: string | null;
}) {
  const { aboutLogo, branchName, branchPhone, order, lines, lang, qrDataUrl, barcodeDataUrl } = opts;

  const fmt = (n?: number | null) => (Number(n || 0)).toFixed(3);
  let itemsHtml = '';
  let total = 0;

  for (const L of lines) {
    total += L.qty * L.price;
    const name = lang === 'ar' ? (L.item_name_ar || L.item_name) : (L.item_name || L.item_name_ar || '');
    const optParts: string[] = [];
    if (L.variation) optParts.push(`[${L.variation}]`);
    if (L.size)      optParts.push(`(${L.size})`);

    itemsHtml += `
      <tr>
        <td style="font-size:15px; line-height:18px; text-align:left;">
          ${name} ${optParts.join(' ') || ''}
          ${L.item_notes ? `<br><small>* ${String(L.item_notes).replace(/\n/g,'<br>')}</small>` : ''}
        </td>
        <td style="font-size:15px; text-align:right;">${L.qty}</td>
        <td style="font-size:15px; text-align:right;">${fmt(L.price * L.qty)}</td>
      </tr>
    `;

    // addons
    if (L.addons_json) {
      try {
        const addons: Array<{name?:string;name_ar?:string;qty?:number;price?:number}> = JSON.parse(L.addons_json);
        for (const a of addons) {
          const aname = lang === 'ar' ? (a.name_ar || a.name || '') : (a.name || a.name_ar || '');
          itemsHtml += `
            <tr>
              <td style="font-size:13px; text-align:right;">${aname}</td>
              <td style="font-size:13px; text-align:right;">${a.qty ?? 1}</td>
              <td style="font-size:13px; text-align:right;">${fmt((a.price ?? 0) * (a.qty ?? 1))}</td>
            </tr>
          `;
          total += (a.price ?? 0) * (a.qty ?? 1) * L.qty;
        }
        itemsHtml += `<tr><td colspan="3"><hr></td></tr>`;
      } catch { /* ignore */ }
    } else {
      itemsHtml += `<tr><td colspan="3"><hr></td></tr>`;
    }
  }

  let orderTotal = total + (order.delivery_fee || 0) - (order.discount_amount || 0);

  const addressBlock =
    order.order_type === 1
      ? (order.address ? order.address : '')
      : order.order_type === 3
      ? (order.table_name ? `Table: ${order.table_name}` : '')
      : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Order #${order.number}</title>
  <style>
    html,body { margin:0; padding:0; background:#fff; }
    body.printbody { width:78mm; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
    table { border-collapse: collapse; }
    hr { border:none; border-top:1px solid #000; }
    .center { display:block; margin: 0 auto; }
    @media print {
      @page { margin: 0; }
      body { margin: 0.5cm 0.5cm; }
    }
  </style>
</head>
<body class="printbody">
  <div id="printDiv">
    <table width="85%" align="center">
      <tr>
        <td style="text-align:center; padding-top:5px;">
          ${aboutLogo ? `<img src="${aboutLogo}" style="width:40mm;" />` : ''}
          ${branchName ? `<div style="font-weight:bold; font-size:16px; margin-top:6px;">${branchName}${branchPhone ? ' - '+branchPhone : ''}</div>` : ''}
        </td>
      </tr>
    </table>

    <table width="85%" align="center" style="border-bottom:1px solid #000;">
      <tr>
        <td style="text-align:center;">
          <h3 style="margin:8px 0 10px 0; font-weight:bold;">
            Invoice ${order.id}<br/>
            ${orderTypeLabel(order.order_type)}<br/>
            <small style="font-weight:normal;">${order.payment_method_slug || ''}</small>
          </h3>
        </td>
      </tr>
    </table>

    ${order.delivery_date ? `
      <table width="85%" align="center">
        <tr style="font-size:16px;">
          <td align="left">** وقت التسليم **</td>
          <td align="right">${new Date(order.delivery_date).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</td>
        </tr>
      </table>
      <br/>` : ''}

    <table width="85%" align="center" style="border-bottom:1px solid #000;">
      <tr>
        <td style="font-size:12px; text-align:left;">
          ${new Date(order.created_at).toLocaleString()}<br/>
          Name: ${order.full_name || ''}
        </td>
        <td style="font-size:12px; text-align:right;">
          Mobile: ${order.mobile || ''}
        </td>
      </tr>
      <tr>
        <td colspan="2" style="font-size:12px;">
          ${addressBlock ? `<br/>${addressBlock}` : ''}
          ${order.landmark ? `<br/>${order.landmark}` : ''}
        </td>
      </tr>
    </table>

    <table width="85%" align="center" cellpadding="0" cellspacing="0" style="padding-bottom:20px;">
      <thead>
        <tr>
          <th width="50%" style="text-align:left; font-size:15px;">Item</th>
          <th width="10%" style="text-align:right; font-size:15px;">Qty</th>
          <th width="30%" style="text-align:right; font-size:15px;">Amount</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <table width="85%" align="center">
      <tr>
        <td width="50%" style="text-align:right;"><strong>Subtotal</strong></td>
        <td width="50%" style="text-align:right;"><strong>${fmt(total)}</strong></td>
      </tr>
      ${order.order_type === 1 ? `
      <tr>
        <td style="text-align:right;"><strong>Delivery</strong></td>
        <td style="text-align:right;"><strong>${fmt(order.delivery_fee)}</strong></td>
      </tr>` : ''}
      ${Number(order.discount_amount || 0) !== 0 ? `
      <tr>
        <td style="text-align:right;"><strong>Discount</strong></td>
        <td style="text-align:right;"><strong>- ${fmt(order.discount_amount)}</strong></td>
      </tr>` : ''}
      <tr>
        <td style="text-align:right;"><strong>Grand Total</strong></td>
        <td style="text-align:right;"><strong>${fmt(orderTotal)}</strong></td>
      </tr>
    </table>

    <table width="85%" align="center" style="border-top:1px solid #000; margin-top:6px;">
      <tr>
        <td style="padding:8px 0;">
          ${qrDataUrl ? `<img src="${qrDataUrl}" width="100" height="100" />` : ''}
        </td>
        <td style="text-align:center;">
          ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" style="height:40px; width:150px;" />` : ''}
        </td>
      </tr>
    </table>

    <script>
      // Auto print when loaded (renderer context)
      window.addEventListener('load', () => {
        window.print();
      });
    </script>
  </div>
</body>
</html>`;
}

// ---- print flow -----------------------------------------------------------

async function printHtmlSilently(html: string): Promise<void> {
  const win = new BrowserWindow({ show: false, width: 420, height: 800, webPreferences: { javascript: true } });
  try {
    // data URL avoids any disk writes
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await win.loadURL(dataUrl);

    // tiny settle
    await sleep(120);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: true, printBackground: true, deviceName: '' }, (ok, reason) =>
        ok ? resolve() : reject(new Error(reason || 'Print failed'))
      );
    });
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

async function printToPdfFile(html: string): Promise<string> {
  const win = new BrowserWindow({ show: false, width: 420, height: 800, webPreferences: { javascript: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await win.webContents.printToPDF({ printBackground: true });
  const out = path.join(os.tmpdir(), `receipt-${Date.now()}.pdf`);
  await fs.writeFile(out, pdf);
  if (!win.isDestroyed()) win.close();
  return out;
}

// ---- IPCs ----------------------------------------------------------------

export function registerLocalPrintHandlers(getSetting: (k: string) => any) {
  app.commandLine.appendSwitch('disable-print-preview');

  // Main printing IPC (OFFLINE-FIRST)
  ipcMain.handle('orders:print', async (_e, orderId: string, opts?: { savePdf?: boolean }) => {
    const lang = (getSetting('ui.lang') as 'ar' | 'en') || 'en';

    // 1) Load local data
    const order = getOrder(orderId);
    if (!order) throw new Error('Order not found locally');

    const lines = getLines(orderId);

    // 2) Assets (logo stored locally after sync? Adjust path or omit)
    const aboutLogoPath = getSetting('assets.about_logo_path'); // e.g. '/mnt/app/about/logo.png'
    const aboutLogo = await toDataUrl(aboutLogoPath);

    // 3) Codes
    const qrText = order.order_number || order.number || String(order.id);
    const qrDataUrl = await makeQrPngDataUrl(qrText);
    const codeText = `${(getSetting('gps.username') || 'XXX').toString().slice(0,3)}${order.id}`;
    const barcodeDataUrl = await makeCode128PngDataUrl(codeText);

    // 4) HTML
    const html = renderReceiptHTML({
      aboutLogo,
      branchName: order.branch_name || null,
      branchPhone: order.branch_phone || null,
      lang, order, lines, qrDataUrl, barcodeDataUrl,
    });

    // 5) Print or save PDF
    if (opts?.savePdf) {
      const pdfPath = await printToPdfFile(html);
      return { ok: true, pdfPath };
    }
    await printHtmlSilently(html);

    // 6) Optional: mark printed
    try {
      db.prepare(`UPDATE orders SET printed_at = datetime('now') WHERE id = ?`).run(orderId);
    } catch {}

    return { ok: true };
  });
}
