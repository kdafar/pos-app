import { BrowserWindow, ipcMain, app } from 'electron';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import db, { getSetting } from './db';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';

type OrderType = 1 | 2 | 3;

type OrderRow = {
  id: string;
  number: string;
  order_type: OrderType;
  status?: string | null;
  payment_method_slug?: string;

  city_id?: string | null; // ✅ add this

  delivery_fee?: number | null;
  discount_amount?: number | null;
  discount_total?: number | null;
  grand_total?: number | null;
  subtotal?: number | null;
  tax_total?: number | null;

  delivery_date?: string | number | null;
  created_at: string | number | null;

  full_name?: string;
  mobile?: string;
  address?: string | null;
  landmark?: string | null;
  table_name?: string | null;
  branch_name?: string | null;
  branch_phone?: string | null;
  order_number?: string | null;
  order_notes?: string | null;
  promocode?: string | null;
};

function parseList(input: any): any[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;

  const s = String(input).trim();
  if (!s) return [];

  // Try JSON first
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j;
  } catch {
    // ignore
  }

  // Fallback: comma separated
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

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

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function getOrder(orderId: string): OrderRow | undefined {
  const row = db
    .prepare(
      `
    SELECT
      o.id,
      o.number,
      o.order_type,
      o.status,
      o.payment_method_slug,

      o.city_id,                     -- ✅ add this

      o.delivery_fee               AS delivery_fee,
      o.discount_total             AS discount_total,
      o.discount_amount            AS discount_amount,
      o.tax_total                  AS tax_total,
      o.grand_total,
      o.subtotal,

      o.delivery_date,
      o.created_at,
      o.full_name,
      o.mobile,
      o.address,
      o.landmark,

      t.label AS table_name,
      NULL  AS branch_name,
      NULL  AS branch_phone,
      o.number AS order_number,
      o.note  AS order_notes,
      o.promocode
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
    WHERE o.id = ?
  `
    )
    .get(orderId) as OrderRow | undefined;

  return row;
}

function safeDate(value: string | number | null | undefined): Date {
  if (value == null) return new Date();
  if (typeof value === 'number') return new Date(value);

  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    // milliseconds timestamp stored as text
    return new Date(Number(s));
  }

  return new Date(s);
}

function orderStatusLabel(
  status: string | null | undefined,
  lang: 'ar' | 'en'
) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (lang === 'ar') {
    switch (s) {
      case 'open':
        return 'مفتوح';
      case 'pending':
        return 'قيد الانتظار';
      case 'ready':
        return 'جاهز';
      case 'prepared':
        return 'مجهز';
      case 'completed':
        return 'مكتمل';
      case 'cancelled':
        return 'ملغى';
      case 'closed':
        return 'مغلق';
      default:
        return status;
    }
  }
  // English
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getLines(orderId: string): LineRow[] {
  const raw = db
    .prepare(
      `
    SELECT
      ol.id,
      ol.name       AS item_name,
      ol.name_ar    AS item_name_ar,
      ol.variation  AS variation,
      i.size        AS size,
      ol.notes      AS item_notes,
      ol.qty,
      ol.unit_price AS price,

      -- raw addon fields in order_lines
      ol.addons_name,
      ol.addons_price,
      ol.addons_qty
    FROM order_lines ol
    LEFT JOIN items i ON i.id = ol.item_id
    WHERE ol.order_id = ?
    ORDER BY ol.id ASC
  `
    )
    .all(orderId) as any[];

  const lines: LineRow[] = raw.map((r) => {
    const names = parseList(r.addons_name);
    const prices = parseList(r.addons_price).map((v) => Number(v));
    const qtys = parseList(r.addons_qty).map((v) => Number(v));

    const addons: Array<{
      name?: string;
      name_ar?: string;
      qty?: number;
      price?: number;
    }> = [];

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      if (!name) continue;

      addons.push({
        name,
        // if you later add Arabic names, set name_ar here
        qty: Number(qtys[i] || 1) || 1,
        price: Number(prices[i] || 0) || 0,
      });
    }

    return {
      id: r.id,
      item_name: r.item_name,
      item_name_ar: r.item_name_ar,
      variation: r.variation,
      size: r.size,
      item_notes: r.item_notes,
      qty: Number(r.qty || 0),
      price: Number(r.price || 0),
      addons_json: addons.length ? JSON.stringify(addons) : null,
    };
  });

  return lines;
}

async function toDataUrl(
  filePath: string | null | undefined
): Promise<string | null> {
  try {
    if (!filePath) return null;
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1) || 'png';
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function orderTypeLabel(t: OrderType, lang: 'ar' | 'en') {
  if (lang === 'ar') {
    return t === 1 ? 'توصيل' : t === 2 ? 'استلام من المطعم' : 'طاولة';
  }

  return t === 1 ? 'Delivery' : t === 2 ? 'Pickup' : 'Dine-in';
}

// generate QR & barcode as base64 (no internet)
async function makeQrPngDataUrl(text: string) {
  return await QRCode.toDataURL(text || '', {
    margin: 1,
    scale: 4,
    errorCorrectionLevel: 'M',
  });
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
  currency: string;
  orderNotes?: string | null;
}) {
  const {
    aboutLogo,
    branchName,
    branchPhone,
    lang,
    order,
    lines,
    qrDataUrl,
    barcodeDataUrl,
    currency,
    orderNotes,
  } = opts;

  const fmt = (n?: number | null) => Number(n || 0).toFixed(3);

  // ---- items & addons ----
  let itemsHtml = '';
  let computedSubtotal = 0;

  for (const L of lines) {
    const lineTotal = L.qty * L.price;
    computedSubtotal += lineTotal;

    const name =
      lang === 'ar'
        ? L.item_name_ar || L.item_name
        : L.item_name || L.item_name_ar || '';

    const optParts: string[] = [];
    if (L.variation) optParts.push(`[${L.variation}]`);
    if (L.size) optParts.push(`(${L.size})`);

    itemsHtml += `
      <tr>
        <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:18px;vertical-align:top;text-align:left;">
          ${name} ${optParts.join(' ') || ''}
          ${
            L.item_notes
              ? `<br><small>* ${String(L.item_notes).replace(
                  /\n/g,
                  '<br>'
                )}</small>`
              : ''
          }
        </td>
        <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:18px;vertical-align:top;text-align:right;">
          ${L.qty}
        </td>
        <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:18px;vertical-align:top;text-align:right;">
          ${fmt(lineTotal)}
        </td>
      </tr>
    `;

    // (Addons still optional: addons_json can be wired later if you want)
    if (L.addons_json) {
      try {
        const addons: Array<{
          name?: string;
          name_ar?: string;
          qty?: number;
          price?: number;
        }> = JSON.parse(L.addons_json);

        for (const a of addons) {
          const aname =
            lang === 'ar'
              ? a.name_ar || a.name || ''
              : a.name || a.name_ar || '';
          const aqty = a.qty ?? 1;
          const aprice = a.price ?? 0;
          const addonTotal = aprice * aqty;

          itemsHtml += `
            <tr>
              <td style="font-size:13px;font-family:'Open Sans',sans-serif;color:#000;line-height:15px;vertical-align:top;text-align:right;">
                ${aname}
              </td>
              <td style="font-size:13px;font-family:'Open Sans',sans-serif;color:#000;line-height:15px;vertical-align:top;text-align:right;">
                ${aqty}
              </td>
              <td style="font-size:13px;font-family:'Open Sans',sans-serif;color:#000;line-height:15px;vertical-align:top;text-align:right;">
                ${fmt(addonTotal)}
              </td>
            </tr>
          `;
        }
      } catch {
        // ignore JSON errors
      }
    }

    itemsHtml += `
      <tr>
        <td colspan="3"><hr></td>
      </tr>
    `;
  }

  // ---- totals from ORDER row (with fallback) ----
  const subtotal =
    order.subtotal != null && !Number.isNaN(Number(order.subtotal))
      ? Number(order.subtotal)
      : computedSubtotal;

  const discount =
    order.discount_amount != null &&
    !Number.isNaN(Number(order.discount_amount))
      ? Number(order.discount_amount)
      : order.discount_total != null &&
        !Number.isNaN(Number(order.discount_total))
      ? Number(order.discount_total)
      : 0;

  const typeCode = Number(order.order_type ?? 0);

  const deliveryCharge =
    typeCode === 1 ? Number(order.delivery_fee ?? 0) || 0 : 0;

  const grandTotal =
    order.grand_total != null && !Number.isNaN(Number(order.grand_total))
      ? Number(order.grand_total)
      : +(subtotal - discount + deliveryCharge).toFixed(3);

  // ---- date / time ----
  // ---- created_at handling (supports ms epoch or "YYYY-MM-DD HH:mm:ss") ----
  let createdAt: Date;

  if (order.created_at != null) {
    const raw = order.created_at as any;

    // Try numeric (ms since epoch)
    const num = Number(raw);
    if (!Number.isNaN(num) && num > 0) {
      createdAt = new Date(num);
    } else {
      // Fallback: SQLite-style "YYYY-MM-DD HH:mm:ss"
      // Replace space with 'T' and add 'Z' so JS parses it as UTC
      const str = String(raw).trim();
      const isoLike = str.includes('T') ? str : str.replace(' ', 'T') + 'Z';
      const d = new Date(isoLike);
      createdAt = isNaN(d.getTime()) ? new Date() : d;
    }
  } else {
    createdAt = new Date();
  }

  const createdLabel = createdAt.toLocaleString('en-KW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const deliveryTimeLabel = order.delivery_date
    ? safeDate(order.delivery_date).toLocaleTimeString('en-KW', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : '';

  const orderTypeText = orderTypeLabel(order.order_type, lang);
  const paymentLabel = order.payment_method_slug
    ? order.payment_method_slug.charAt(0).toUpperCase() +
      order.payment_method_slug.slice(1)
    : '';
  const statusText = orderStatusLabel(order.status, lang);

  const addressBlock =
    typeCode === 1
      ? order.address || ''
      : typeCode === 3
      ? order.table_name
        ? `Table: ${order.table_name}`
        : ''
      : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Order #${order.number}</title>
  <style>
    #qrcode {
      width: 256px;
      height: 256px;
      margin-top: 15px;
    }
    #printDiv {
      font-weight: 600;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    #printDiv div,
    #printDiv p,
    #printDiv a,
    #printDiv li,
    #printDiv td {
      -webkit-text-size-adjust: none;
    }
    .printbody {
      width: 78mm;
      height: 100%;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      font-family: 'Open Sans', Arial, sans-serif;
    }
    .center {
      display: block;
      margin-left: auto;
      margin-right: auto;
      width: 50%;
    }
    table { border-collapse: collapse; }
    hr { border:none; border-top:1px solid #000; }
    @media print {
      @page { margin: 0; }
      body { margin: 1cm 2cm 1cm 0cm; }
    }
  </style>
</head>
<body class="printbody">
  <div id="printDiv">
    <!-- Header -->
    <table width="85%" border="0" cellpadding="0" cellspacing="0" align="center" bgcolor="#fff">
      <tr>
        <td style="font-size:15px;font-family:'Open Sans',sans-serif;line-height:18px;vertical-align:bottom;text-align:center;padding-top:5px;">
          ${
            aboutLogo
              ? `<img style="width:40mm" src="${aboutLogo}" alt="">`
              : ''
          }
          ${
            branchName
              ? `<strong style="font-size:16px;"><br>${branchName}${
                  branchPhone ? ' - ' + branchPhone : ''
                }</strong><br>`
              : ''
          }
        </td>
      </tr>
    </table>

    <table width="85%" border="0" cellpadding="0" cellspacing="0" align="center" style="border-bottom:1px solid #000000">
      <tr>
        <td style="font-family:'Open Sans',sans-serif;line-height:15px;vertical-align:bottom;text-align:center;font-weight:bold;">
          <h3 style="font-weight:bold;margin:8px 0;">
            Invoice ${order.number || order.id}<br>
            ${orderTypeText}<br>
            <small>
              ${[paymentLabel || null, statusText || null]
                .filter(Boolean)
                .join(' • ')}
            </small>
          </h3>
        </td>
      </tr>
    </table>

    ${
      order.delivery_date
        ? `
    <table width="85%" border="0" cellpadding="0" cellspacing="0" align="center">
      <tr style="font-size:16px;color:#000;font-family:'Open Sans',sans-serif;line-height:18px;vertical-align:bottom;text-align:left;">
        <td align="left">** وقت التسليم **</td>
        <td align="right">${deliveryTimeLabel}</td>
      </tr>
    </table>
    <br>
    `
        : ''
    }

    <table width="85%" border="0" cellpadding="0" cellspacing="0" align="center" style="border-bottom:1px solid #000000">
      <tr style="font-size:12px;color:#000;font-family:'Open Sans',sans-serif;line-height:18px;vertical-align:bottom;text-align:left;">
        <td>
          ${createdLabel}<br>
          Name: ${order.full_name || ''}
        </td>
        <td>
          Mobile: ${order.mobile || ''}
        </td>
      </tr>
      <tr>
        <td colspan="2">
          ${
            order.order_type === 1
              ? addressBlock
                ? `<br>${addressBlock}`
                : ''
              : order.order_type === 3
              ? addressBlock
                ? `<br>${addressBlock}`
                : ''
              : ''
          }
          ${order.landmark ? `<br>${order.landmark}` : ''}
        </td>
      </tr>
    </table>

    ${
      orderNotes
        ? `
      <div style="padding:5px 10px 5px 15px">
        <h6>Order note:<br><small>${String(orderNotes).replace(
          /\n/g,
          '<br>'
        )}</small></h6>
      </div>
    `
        : ''
    }

    <!-- Items -->
    <table width="85%" border="0" cellpadding="2" cellspacing="2" align="center" style="padding-bottom:40px !important;">
      <thead>
        <tr>
          <th style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;font-weight:normal;line-height:1;vertical-align:top;padding-bottom:5px;text-align:left;" width="50%">Item</th>
          <th style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;font-weight:normal;line-height:1;vertical-align:top;padding-bottom:5px;text-align:right;" width="10%">Qty</th>
          <th style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;font-weight:normal;line-height:1;vertical-align:top;padding-bottom:5px;text-align:right;" width="30%">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <!-- Totals -->
    <table width="85%" border="0" cellpadding="0" cellspacing="0" align="center">
      <tbody>
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;" width="50%">
            <br><strong>Subtotal</strong>
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:bottom;text-align:right;" width="50%">
            <strong>${currency} ${fmt(subtotal)}</strong>
          </td>
        </tr>
        ${
          typeCode === 1 && Math.abs(deliveryCharge) > 0.0005
            ? `
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>Delivery charge</strong>
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>${currency} ${fmt(deliveryCharge)}</strong>
          </td>
        </tr>`
            : ''
        }
        ${
          discount !== 0
            ? `
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>Discount</strong> ${
              order.promocode ? `(${order.promocode})` : ''
            }
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>- ${currency} ${fmt(discount)}</strong>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>Grand total</strong>
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>${currency} ${fmt(grandTotal)}</strong>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- QR + Barcode -->
    <table width="85%" border="0" cellpadding="0" cellspacing="0" align="left" style="border-top:1px solid #000000;margin-top:6px;">
      <tr>
        <td>
          ${
            qrDataUrl
              ? `<img width="100" height="100" src="${qrDataUrl}" />`
              : ''
          }
        </td>
        <td>
          ${
            barcodeDataUrl
              ? `<img class="center" style="margin:10px auto 10px auto;height:40px;width:150px;" src="${barcodeDataUrl}" />`
              : ''
          }
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

// ---- print flow -----------------------------------------------------------

async function printHtmlSilently(html: string): Promise<void> {
  const win = new BrowserWindow({
    show: true,
    width: 420,
    height: 800,
    webPreferences: { javascript: true },
  });
  try {
    // data URL avoids any disk writes
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    await win.loadURL(dataUrl);

    // tiny settle
    await sleep(120);

    // Trigger print from Main Process to allow preview if silent is false
    await new Promise<void>((resolve, reject) => {
      // silent: false => opens the dialog with preview
      win.webContents.print(
        { silent: false, printBackground: true, deviceName: '' },
        (ok, reason) =>
          ok ? resolve() : reject(new Error(reason || 'Print failed'))
      );
    });
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

async function printToPdfFile(html: string): Promise<string> {
  const win = new BrowserWindow({
    show: true,
    width: 420,
    height: 800,
    webPreferences: { javascript: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const pdf = await win.webContents.printToPDF({ printBackground: true });
  const out = path.join(os.tmpdir(), `receipt-${Date.now()}.pdf`);
  await fs.writeFile(out, pdf);
  if (!win.isDestroyed()) win.close();
  return out;
}

// ---- IPCs ----------------------------------------------------------------

export function registerLocalPrintHandlers() {
  // Main printing IPC (OFFLINE-FIRST)
  ipcMain.handle(
    'orders:print',
    async (_e, orderId: string, opts?: { savePdf?: boolean }) => {
      const lang = (getSetting('ui.lang') as 'ar' | 'en') || 'en';
      const currency = (getSetting('pos.currency') as string) || 'KD';

      const order = getOrder(orderId);
      if (!order) throw new Error('Order not found locally');

      const lines = getLines(orderId);

      let effectiveDelivery = Number(order.delivery_fee ?? 0);

      if (
        order.order_type === 1 && // only for Delivery
        Math.abs(effectiveDelivery) < 0.0005 // if 0 or not set
      ) {
        const cityId = (order.city_id ?? null) as string | null;

        if (cityId) {
          const cityRow = db
            .prepare('SELECT delivery_fee FROM cities WHERE id = ?')
            .get(cityId) as any;

          const cityFee = Number(cityRow?.delivery_fee ?? 0);
          if (!Number.isNaN(cityFee) && Math.abs(cityFee) > 0.0005) {
            effectiveDelivery = cityFee;
          }
        }
      }

      // Patch order object passed into renderer
      const patchedOrder: OrderRow = {
        ...order,
        delivery_fee: effectiveDelivery,
      };

      // 🔹 Logo path (whatever key you stored in app_settings)
      const aboutLogoPath =
        (getSetting('assets.about_logo_path') as string) ||
        (getSetting('general.logo_path') as string) ||
        null;
      const aboutLogo = await toDataUrl(aboutLogoPath);

      // 🔹 Restaurant name & phone from settings, with fallback to branch
      const brandName =
        (getSetting('general.site_title') as string) ||
        (getSetting('about.name_en') as string) ||
        order.branch_name ||
        null;

      const brandPhone =
        (getSetting('general.phone') as string) ||
        (getSetting('about.phone') as string) ||
        order.branch_phone ||
        null;

      const qrText = order.order_number || order.number || String(order.id);
      const qrDataUrl = await makeQrPngDataUrl(qrText);

      const codeText = `${(getSetting('gps.username') || 'XXX')
        .toString()
        .slice(0, 3)}${order.id}`;
      const barcodeDataUrl = await makeCode128PngDataUrl(codeText);

      const html = renderReceiptHTML({
        aboutLogo,
        branchName: brandName,
        branchPhone: brandPhone,
        lang,
        order: patchedOrder, // ✅ use patched order here
        lines,
        qrDataUrl,
        barcodeDataUrl,
        currency,
        orderNotes: order.order_notes || null,
      });

      if (opts?.savePdf) {
        const pdfPath = await printToPdfFile(html);
        return { ok: true, pdfPath };
      }

      await printHtmlSilently(html);

      try {
        db.prepare(
          `UPDATE orders SET printed_at = datetime('now') WHERE id = ?`
        ).run(orderId);
      } catch {}

      return { ok: true };
    }
  );
}
