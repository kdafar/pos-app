import { BrowserWindow, ipcMain, app } from 'electron';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import db, { getSetting, getMeta } from './db';
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
  reference_no?: string | null;
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
  addons_json?: string | null;
  is_locked?: number | null;
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
      o.reference_no,
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
      case 'placed':
        return 'تم الطلب';
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

/** Pick a string for the receipt language. The template had none of this. */
function L(lang: 'ar' | 'en', en: string, ar: string): string {
  return lang === 'ar' ? ar : en;
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
      ol.is_locked  AS is_locked,     -- 🔹 add this

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
      is_locked: r.is_locked ?? 0, // 🔹 0 or 1
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

/**
 * Receipts must carry the OPERATOR's brand (the restaurant running the till),
 * never this application's own logo.
 *
 * Sources, in order of trust:
 *   1. a logo synced from the server (settings key, remote URL or local path)
 *   2. a logo the operator dropped into <userData>/branding/logo.(png|jpg|svg)
 *
 * If none is found we print no logo at all rather than substituting ours —
 * a blank header is honest, someone else's mark on a receipt is not.
 */
const LOGO_SETTING_KEYS = [
  // Confirmed key the backend will ship in wave one. The logo lives in the
  // `about_us` table, not settings, which is why none of the guesses hit.
  'branding.logo_url',
  'assets.about_logo_path',
  'general.logo_path',
  'general.logo',
  'general.shop_logo',
  'about.logo',
  'branding.logo',
];

async function resolveOperatorLogo(
  getSetting: (k: string) => unknown
): Promise<string | null> {
  // 1) Anything the server gave us, under any of the known keys.
  for (const key of LOGO_SETTING_KEYS) {
    const raw = getSetting(key);
    // An install with no logo uploaded sends an empty value — skip the
    // block entirely rather than printing a broken image.
    const val = raw == null ? '' : String(raw).trim();
    if (!val) continue;

    if (/^data:image\//i.test(val)) return val; // already inlined
    const remoteUrl = resolveLogoUrl(val);
    if (remoteUrl) {
      const cached = await cacheRemoteLogo(remoteUrl);
      if (cached) return cached;
      continue;
    }
    const asFile = await toDataUrl(val);
    if (asFile) return asFile;
  }

  // 2) Operator-supplied file, so a site can brand its receipts today without
  //    waiting for the backend to start sending one.
  const dir = path.join(app.getPath('userData'), 'branding');
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.svg']) {
    const hit = await toDataUrl(path.join(dir, name));
    if (hit) return hit;
  }

  return null;
}

/**
 * Turn a server-supplied absolute or relative logo value into a download URL.
 * Laravel commonly exposes uploaded files as `/storage/...`; treating that as
 * a Windows file path is why a clean till never populated its logo cache.
 */
function resolveLogoUrl(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (!value.startsWith('/') && !value.startsWith('./')) return null;

  const baseUrl = String(getMeta('server.base_url') || '').trim();
  if (!/^https?:\/\//i.test(baseUrl)) return null;

  try {
    return new URL(value, baseUrl.replace(/\/+$/, '') + '/').toString();
  } catch {
    return null;
  }
}

/** Fetch and cache the configured receipt logo on demand from Settings. */
export async function fetchOperatorLogo(): Promise<{
  ok: true;
  key: string;
  url?: string;
}> {
  for (const key of LOGO_SETTING_KEYS) {
    const value = String(getSetting(key) || '').trim();
    if (!value) continue;

    if (/^data:image\//i.test(value)) return { ok: true, key };

    const remoteUrl = resolveLogoUrl(value);
    if (!remoteUrl) {
      const local = await toDataUrl(value);
      if (local) return { ok: true, key };
      throw new Error(`Logo setting ${key} is not a valid server URL or local file.`);
    }

    const cached = await cacheRemoteLogo(remoteUrl);
    if (!cached) throw new Error(`Could not download the logo from ${remoteUrl}`);
    return { ok: true, key, url: remoteUrl };
  }

  throw new Error(
    'The server did not provide a receipt logo setting (expected branding.logo_url).'
  );
}

/** Download a remote logo once and reuse it, so printing works offline. */
/** How long a cached logo is trusted before we revalidate against the server. */
const LOGO_REVALIDATE_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Download a remote logo and reuse it, so printing keeps working offline.
 *
 * The cache filename is derived from a hash of the URL, not a fixed name. That
 * matters: the operator uploading a new logo changes the filename (and so the
 * URL), which must produce a fresh download rather than silently reprinting the
 * old mark forever. Keying on a constant name was exactly that bug.
 *
 * A same-URL replacement is handled too — after LOGO_REVALIDATE_MS we make a
 * conditional request and only rewrite the file when the server says it
 * changed. If the network is down we keep printing the cached copy, because a
 * slightly stale logo beats a receipt with no branding at all.
 */
async function cacheRemoteLogo(url: string): Promise<string | null> {
  const dir = path.join(app.getPath('userData'), 'branding');
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  const ext = (path.extname(new URL(url).pathname) || '.png')
    .slice(0, 5)
    .toLowerCase();
  const file = path.join(dir, `remote-logo-${key}${ext}`);
  const mime = ext.replace('.', '') || 'png';

  let stat: { mtimeMs: number } | null = null;
  try {
    stat = await fs.stat(file);
  } catch {
    stat = null;
  }

  const fresh = stat && Date.now() - stat.mtimeMs < LOGO_REVALIDATE_MS;
  if (fresh) {
    const cached = await toDataUrl(file);
    if (cached) return cached;
  }

  try {
    // Deliberately NOT using If-Modified-Since as the source of truth. A
    // replaced file can keep its name, its length and even its Last-Modified
    // (some CDNs and PHP storage handlers serve a stale or absent header), so
    // header-based revalidation quietly reprints the old mark. Compare the
    // bytes instead: hash what we get and only rewrite when the hash differs.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('empty response');

    const incomingHash = crypto.createHash('sha256').update(buf).digest('hex');
    const existingHash = await hashFile(file);

    if (existingHash === incomingHash) {
      // Identical bytes — touch it so we do not re-download for another TTL.
      await fs.utimes(file, new Date(), new Date()).catch(() => {});
      return `data:image/${mime};base64,${buf.toString('base64')}`;
    }

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, buf);
    await pruneOldRemoteLogos(dir, path.basename(file));

    console.log('[print] operator logo changed — cache replaced', {
      url,
      bytes: buf.length,
      was: existingHash ? existingHash.slice(0, 12) : '(none)',
      now: incomingHash.slice(0, 12),
    });
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch (e: any) {
    console.warn('[print] could not refresh operator logo:', e?.message || e);
    // Offline or server down — fall back to whatever we already have.
    return await toDataUrl(file);
  }
}

/** sha256 of a file's contents, or null when it does not exist. */
async function hashFile(file: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(file);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/** Remove superseded logo caches so the folder does not accumulate. */
async function pruneOldRemoteLogos(dir: string, keep: string) {
  try {
    for (const name of await fs.readdir(dir)) {
      if (name.startsWith('remote-logo-') && name !== keep) {
        await fs.unlink(path.join(dir, name)).catch(() => {});
      }
    }
  } catch {
    /* nothing to prune */
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
  // ---- items & addons ----
  let itemsHtml = '';

  // For fallback subtotal if order.subtotal is null
  let computedSubtotal = 0;
  for (const L of lines) {
    computedSubtotal += L.qty * L.price;
  }

  // 🔹 Split into main (locked) and added-later (unlocked)
  const mainLines = lines.filter((L: any) => Number(L.is_locked ?? 0) === 1);
  const addedLines = lines.filter((L: any) => Number(L.is_locked ?? 0) !== 1);

  const hasSplit = mainLines.length > 0 && addedLines.length > 0;

  const sectionLabelMain = lang === 'ar' ? 'الطلب الرئيسي' : 'Main order';
  const sectionLabelAdded =
    lang === 'ar' ? 'الطلبات المضافة لاحقاً' : 'Added later';

  function renderLinesSection(label: string | null, section: LineRow[]) {
    if (!section.length) return;

    if (label) {
      itemsHtml += `
        <tr>
          <td colspan="3"
              style="font-size:14px;font-family:'Open Sans',sans-serif;font-weight:bold;padding-top:4px;padding-bottom:2px;border-top:1px solid #000;">
            ${label}
          </td>
        </tr>
      `;
    }

    for (const L of section) {
      const lineTotal = L.qty * L.price;

      // Kitchen tickets are read by staff who use both languages, and the
      // transliteration in the catalog is inconsistent — one line risks the
      // wrong dish going out. Show both when both exist and differ.
      const name =
        lang === 'ar'
          ? L.item_name_ar || L.item_name
          : L.item_name || L.item_name_ar || '';
      const secondary =
        lang === 'ar' &&
        L.item_name_ar &&
        L.item_name &&
        L.item_name_ar !== L.item_name
          ? L.item_name
          : '';

      const optParts: string[] = [];
      if (L.variation) optParts.push(`[${L.variation}]`);
      if (L.size) optParts.push(`(${L.size})`);

      itemsHtml += `
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:18px;vertical-align:top;text-align:left;">
            ${name} ${optParts.join(' ') || ''}
            ${secondary ? `<span class="item-en">${secondary}</span>` : ''}
            ${
              L.item_notes
                ? `<br><small>* ${String(L.item_notes).replace(
                    /\n/g,
                    '<br>'
                  )}</small>`
                : ''
            }
          </td>
          <td class="num" style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:18px;vertical-align:top;">
            ${L.qty}
          </td>
          <td class="money" style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:18px;vertical-align:top;">
            ${fmt(lineTotal)}
          </td>
        </tr>
      `;

      // Addons (unchanged)
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
  }

  if (hasSplit) {
    // 🔸 “Main order” and “Added later” shown separately
    renderLinesSection(sectionLabelMain, mainLines);
    renderLinesSection(sectionLabelAdded, addedLines);
  } else {
    // No split (e.g. take-away), just show as one block
    renderLinesSection(null, lines);
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

  // Always formatted with Latin digits; the .ltr class stops bidi reordering
  // it inside an Arabic paragraph.
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

  const rtl = lang === 'ar';
  // KD / د.ك — the operator's own settings carry both spellings.
  const cur = rtl ? 'د.ك' : currency || 'KD';

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <title>Order #${order.number}</title>
  <style>
    /* ---- Arabic receipt (ar-KW), operator-approved rules ---------------
         1. Full RTL mirroring, not a half-mirrored layout.
         2. Bilingual item names, Arabic over English, where both exist.
         3. Latin numerals (0123) so the receipt reconciles by eye against
            the dashboard and end-of-day reports.
       Money, quantities and phone numbers are pinned LTR: inside an Arabic
       paragraph bidi would otherwise reorder "12.500" into nonsense. ---- */
    ${rtl ? `
    body, #printDiv { direction: rtl; }
    #printDiv td, #printDiv th, #printDiv div, #printDiv p { text-align: right; }
    .num, .money, .ltr { direction: ltr; unicode-bidi: isolate; text-align: left; }
    #printDiv, #printDiv td, #printDiv p { line-height: 1.7; }
    .item-en { display: block; font-size: 12px; font-weight: 400; opacity: .75;
               direction: ltr; text-align: right; }
    ` : `
    .num, .money, .ltr { direction: ltr; unicode-bidi: isolate; }
    .item-en { display: none; }
    `}
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
                  branchPhone ? ' - <span class="ltr">' + branchPhone + '</span>' : ''
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
            ${
              order.reference_no
                ? // The server's running number is what the customer quotes
                  // back and what the dashboard shows, so it is the only
                  // number on the receipt.
                  `${lang === 'ar' ? 'رقم الطلب' : 'Order'} #${order.reference_no}<br>`
                : // No reference yet. Print the system number alone rather than
                  // annotating it "pending sync": that phrase is an internal
                  // state, it means nothing to the customer holding the slip,
                  // and it reads as though something went wrong with their
                  // order. Staff can see sync state in the app.
                  `${order.number || order.id}<br>`
            }
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
          <span class="ltr">${createdLabel}</span><br>
          ${L(lang, 'Name', 'الاسم')}: ${order.full_name || ''}
        </td>
        <td>
          ${L(lang, 'Mobile', 'الموبايل')}: <span class="ltr">${order.mobile || ''}</span>
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
          <th style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;font-weight:normal;line-height:1;vertical-align:top;padding-bottom:5px;text-align:left;" width="50%">${L(lang, 'Item', 'الصنف')}</th>
          <th style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;font-weight:normal;line-height:1;vertical-align:top;padding-bottom:5px;text-align:right;" width="10%">${L(lang, 'Qty', 'الكمية')}</th>
          <th style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;font-weight:normal;line-height:1;vertical-align:top;padding-bottom:5px;text-align:right;" width="30%">${L(lang, 'Amount', 'المبلغ')}</th>
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
            <br><strong>${L(lang, 'Subtotal', 'المجموع')}</strong>
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:bottom;text-align:right;" width="50%">
            <strong class="money">${cur} ${fmt(subtotal)}</strong>
          </td>
        </tr>
        ${
          typeCode === 1 && Math.abs(deliveryCharge) > 0.0005
            ? `
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>${L(lang, 'Delivery charge', 'رسوم التوصيل')}</strong>
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong class="money">${cur} ${fmt(deliveryCharge)}</strong>
          </td>
        </tr>`
            : ''
        }
        ${
          discount !== 0
            ? `
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>${L(lang, 'Discount', 'الخصم')}</strong> ${
              order.promocode ? `(${order.promocode})` : ''
            }
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong class="money">- ${cur} ${fmt(discount)}</strong>
          </td>
        </tr>`
            : ''
        }
        <tr>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong>${L(lang, 'Grand total', 'الإجمالي')}</strong>
          </td>
          <td style="font-size:15px;font-family:'Open Sans',sans-serif;color:#000;line-height:22px;vertical-align:top;text-align:right;">
            <strong class="money">${cur} ${fmt(grandTotal)}</strong>
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
    title: 'Receipt',
    webPreferences: { javascript: true },
  });

  let tmpFile: string | null = null;

  try {
    // A temp file rather than a data: URL. Data URLs are size-limited for
    // top-level navigation and any parse failure resolves as a silent no-op —
    // the window stays blank, print() has nothing to render, and the button
    // looks dead. A file:// load fails loudly instead.
    tmpFile = path.join(os.tmpdir(), `pos-receipt-${Date.now()}.html`);
    await fs.writeFile(tmpFile, html, 'utf8');
    console.log('[print] rendering receipt', {
      file: tmpFile,
      bytes: Buffer.byteLength(html, 'utf8'),
    });

    await Promise.race([
      win.loadFile(tmpFile),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Receipt page failed to render in time.')),
          15_000
        )
      ),
    ]);
    console.log('[print] receipt page loaded');

    // tiny settle
    await sleep(150);

    // No printer at all makes webContents.print() fail in ways that vary by
    // platform — sometimes an error, sometimes a callback that never fires.
    // Check first so the cashier gets a real message instead of a dead button.
    const printers = await win.webContents.getPrintersAsync();
    console.log(
      '[print] printers available:',
      printers.map((p) => p.name)
    );
    if (!printers.length) {
      throw new Error(
        'No printer is installed on this computer. Add a printer in Windows settings, then try again.'
      );
    }

    // A till prints a receipt on every sale, so a modal dialog per sale is a
    // keystroke the cashier has to spend with a customer waiting. Print
    // straight to the printer by default; `print.show_dialog = 1` restores the
    // dialog for a shop that wants to choose per receipt.
    const wantDialog = String(getSetting('print.show_dialog') ?? '').trim() === '1';

    // A named printer wins if one is configured and actually present. Falling
    // back rather than failing matters: a printer renamed in Windows would
    // otherwise stop the till printing entirely.
    const configured = String(getSetting('print.printer_name') ?? '').trim();
    const deviceName =
      configured && printers.some((p) => p.name === configured)
        ? configured
        : undefined;
    if (configured && !deviceName) {
      console.warn(
        `[print] configured printer "${configured}" not found; using the system default`
      );
    }

    // Silent printing needs no window on screen, and showing one mid-service
    // steals focus from the order the cashier is ringing up.
    if (wantDialog) {
      win.show();
      win.focus();
    }

    // The print callback can simply never fire, which happens on Windows when
    // the spooler is wedged — the old code awaited forever, the IPC never
    // returned, and the button looked completely dead. Bound it.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        done(() =>
          reject(
            new Error(
              'The print dialog did not respond. Check that the printer is online, then try again.'
            )
          )
        );
      }, 120_000);

      // deviceName is omitted rather than passed as '' when there is no
      // configured printer — '' is not "use the default", and on Windows it can
      // make the call fail silently.
      win.webContents.print(
        {
          silent: !wantDialog,
          printBackground: true,
          ...(deviceName ? { deviceName } : {}),
        },
        (ok, reason) =>
          done(() =>
            ok
              ? resolve()
              : // "cancelled" is the user closing the dialog, not a failure.
              /cancel/i.test(reason || '')
              ? resolve()
              : reject(new Error(reason || 'Print failed'))
          )
      );
    });

    console.log(
      `[print] sent to ${deviceName || 'default printer'}${
        wantDialog ? ' (via dialog)' : ' silently'
      }`
    );
    if (!win.isDestroyed()) win.close();
  } catch (err) {
    // Leave the receipt on screen when printing fails. The cashier can still
    // read it, and Ctrl+P from that window reaches the OS dialog directly —
    // far better mid-service than a button that appears to do nothing.
    console.error('[print] failed:', err);
    if (!win.isDestroyed()) {
      win.setTitle('Receipt — printing failed, use Ctrl+P');
      win.show();
      win.focus();
    }
    throw err;
  } finally {
    if (tmpFile) fs.unlink(tmpFile).catch(() => {});
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
  console.log('[print] registering IPC handlers');
  // Main printing IPC (OFFLINE-FIRST)
  ipcMain.handle(
    'orders:print',
    async (_e, orderId: string, opts?: { savePdf?: boolean }) => {
      // The language toggle persists ui.lang through store:set, which writes to
      // the `meta` table — getSetting only reads `app_settings`, so the receipt
      // silently printed English no matter what the cashier had selected.
      // Read meta first, keep app_settings as an override for site-wide config.
      const lang: 'ar' | 'en' =
        (getSetting('ui.lang') as 'ar' | 'en') ||
        (getMeta('ui.lang') as 'ar' | 'en') ||
        'en';
      const currency = (getSetting('pos.currency') as string) || 'KD';

      console.log('[print] orders:print requested', { orderId, lang });

      const order = getOrder(orderId);
      if (!order) throw new Error('Order not found locally');

      const lines = getLines(orderId);

      // Orders pulled from the server for phone lookup live in the same table
      // but carry no local line items, so there is nothing to put on a receipt.
      // Say so rather than printing a blank docket.
      if (!lines.length) {
        throw new Error(
          'This order was synced from the server for lookup only — its items are not stored on this till, so it cannot be reprinted here.'
        );
      }

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

      // 🔹 The OPERATOR's logo — never this app's own brand mark.
      const aboutLogo = await resolveOperatorLogo(getSetting);

      // 🔹 Operator name & phone. The previous keys (general.site_title,
      //    about.name_en, general.phone) are not what the server actually
      //    syncs, so every receipt silently fell back to the branch name.
      //    The real keys are general.shop_name / shop_name_ar / contact_phone.
      const shopNameEn =
        (getSetting('general.shop_name') as string) ||
        (getSetting('general.site_title') as string) ||
        (getSetting('about.name_en') as string) ||
        null;

      const shopNameAr = (getSetting('general.shop_name_ar') as string) || null;

      // Arabic receipts lead with the Arabic trading name where one exists.
      const brandName =
        (lang === 'ar' ? shopNameAr || shopNameEn : shopNameEn || shopNameAr) ||
        order.branch_name ||
        null;

      const brandPhone =
        (getSetting('general.contact_phone') as string) ||
        (getSetting('general.contact_whatsapp') as string) ||
        (getSetting('general.phone') as string) ||
        (getSetting('about.phone') as string) ||
        order.branch_phone ||
        null;

      // Everything scannable on the receipt carries the same number the header
      // prints — the server's reference once it exists. The barcode was
      // encoding order.id, the local row, so one slip could show the customer
      // one number and hand a scanner a different one.
      const scanRef = order.reference_no
        ? String(order.reference_no)
        : order.order_number || order.number || String(order.id);

      // The QR opens the order on the website, and the website looks the order
      // up by `order_number` — front/OrderController@orderdetails queries
      // `where('order_number', $request->id)`. So the URL must carry the
      // 15-character random string (or the POS-… one for till orders), NOT the
      // reference.
      //
      // This is the correction to an earlier "cleanup": three identifiers for
      // one sale did need fixing, but two of them are for humans (the header
      // and the scanner code, both the reference) and this one is a database
      // key. It cannot be normalised away.
      //
      // Keeping order_number in the URL is also what makes it safe to print:
      // reference_no is a zero-padded sequence, so a reference-based URL would
      // let anyone walk the whole order history by counting.
      const lookupKey = order.order_number || order.number || String(order.id);

      // Template is a setting so the path can move without a POS build.
      // {order_number} is the one that belongs in a URL; {reference} is offered
      // only for a template that wants it in a query string or label.
      const host = String(
        getSetting('server.base_url') || getMeta('server.base_url') || ''
      )
        .trim()
        .replace(/\/+$/, '');
      const template = String(getSetting('branding.order_url') || '').trim();
      const orderUrl = template
        ? template
            .replace(/\{order_number\}/gi, encodeURIComponent(lookupKey))
            .replace(/\{reference\}|\{ref\}/gi, encodeURIComponent(scanRef))
        : host
        ? `${host}/order-details/${encodeURIComponent(lookupKey)}`
        : '';

      // With no host and no template there is no page to open, so encode the
      // lookup key itself rather than printing a QR that resolves nowhere.
      const qrDataUrl = await makeQrPngDataUrl(orderUrl || lookupKey);

      // Code128 stays the short lookup code. A URL here would be far too wide
      // to scan on a 58mm roll, and in-store scanners want the number, not a
      // link.
      const codeText = `${(getSetting('gps.username') || 'XXX')
        .toString()
        .slice(0, 3)}${scanRef}`;
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
