import axios, { AxiosInstance } from 'axios';
import db, { getMeta, setMeta } from './db';
import { deleteSecret, loadSecret, saveSecret } from './secureStore';
import { prefetchItemImages } from './imageCache';
import { app } from 'electron';

import { posError } from '../shared/errorCodes';
import {
  BRANCH_PROFILE_META_KEY,
  normalizeBranchProfile,
  serializeBranchProfile,
} from './branchProfile';
type Device = { id: string; branch_id: number };

// ---------- Auth error ----------
export class AuthError extends Error {
  constructor(message = 'Authentication failed, please re-pair.') {
    super(message);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

/**
 * The build number as the server wants to compare it: bare semver, no "v".
 *
 * The back office sorts these with PHP's version_compare to decide which
 * tills are too old to enforce a feature gate, so a stray "v" prefix does not
 * merely look untidy — it sorts wrong and mis-gates a real till.
 *
 * A prerelease suffix is deliberately left intact rather than trimmed: a
 * build calling itself 0.4.23-beta.1 must not report as the release, and
 * quietly rewriting it would put a beta in the field wearing a release
 * number.
 */
export function normalizeAppVersion(raw: string): string {
  return String(raw ?? '').trim().replace(/^v/i, '');
}

function appVersion(): string {
  return normalizeAppVersion(app.getVersion());
}

/**
 * Both spellings go on every request, on purpose.
 *
 * The till has reported its version since the header was added, but under
 * `X-Pos-Version` — which nothing upstream reads, so every authenticated call
 * looked version-less and pos_devices.app_version stayed frozen at whatever
 * /register recorded on pairing day. The back office was judging live tills
 * by their pairing-day build.
 *
 * `X-App-Version` is the name the server actually reads. The old name stays
 * alongside it so this build does not go dark to anything already keyed on
 * it, and because a header costs nothing next to a wrong answer about what is
 * in the field.
 */
function versionHeaders(): Record<string, string> {
  const v = appVersion();
  return { 'X-App-Version': v, 'X-Pos-Version': v };
}

let api: AxiosInstance;

export function configureApi(baseUrl: string, device: Device, token: string) {
  api = axios.create({
    baseURL: baseUrl.replace(/\/+$/, '') + '/api/pos',
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Pos-Device': device.id,
      // Rides on every request — push, pull, bootstrap and time — so the
      // server sees which build a till is running without the till having to
      // report it separately, and without a version-specific endpoint to keep
      // in step.
      ...versionHeaders(),
    },
  });

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const st = error?.response?.status;
      if (st === 401 || st === 403) {
        await deleteSecret('device_token');
        setMeta('device_id', '');
        throw new AuthError();
      }
      if (st === 423) {
        // server says device locked
        setMeta(
          'device.locked_at',
          String(error?.response?.data?.locked_at ?? Date.now())
        );
      }
      return Promise.reject(error);
    }
  );
}

function markSyncedNow() {
  setMeta('sync.last_at', String(Date.now()));
}

/* ---------- Normalizers (coerce to SQLite-friendly values) ---------- */
const S = (v: any) => (v === undefined || v === null ? null : String(v));
const N = (v: any) =>
  v === undefined || v === null || v === '' ? 0 : Number(v);
const B = (v: any) => (v ? 1 : 0); // boolean → 0/1

function normItem(it: any) {
  return {
    id: S(it.id)!,
    category_id: S(it.category_id),
    subcategory_id: S(it.subcategory_id),
    name: S(it.name) ?? '',
    name_ar: S(it.name_ar) ?? '',
    barcode: S(it.barcode),
    price: N(it.price),
    image: S(it.image),
    size: S(it.size),
    has_variations: B(it.has_variations),
    has_addons: B(it.has_addons),
    type: S(it.type),
    is_outofstock: B(it.is_outofstock),
    branch_id:
      it.branch_id === null || it.branch_id === undefined
        ? null
        : N(it.branch_id),
    updated_at: S(it.updated_at),
  };
}

function normVariation(v: any) {
  return {
    id: S(v.id)!,
    item_id: S(v.item_id)!,
    name: S(v.name) || '',
    name_ar: S(v.name_ar) || '',
    price: v.price === null || v.price === undefined ? null : N(v.price),
    sale_price:
      v.sale_price === null || v.sale_price === undefined
        ? null
        : N(v.sale_price),
    updated_at: S(v.updated_at),
  };
}

function normItemAddonGroup(m: any) {
  return {
    id: S(m.id)!,
    item_id: S(m.item_id)!,
    group_id: S(m.group_id)!,
    is_required: B(m.is_required),
    max_select:
      m.max_select === null || m.max_select === undefined
        ? null
        : N(m.max_select),
    updated_at: S(m.updated_at),
  };
}

function mapRole(typeOrRole: any) {
  if (typeOrRole == null) return 'branch';

  // 1) Old numeric "type" support
  const t = Number(typeOrRole);
  if (!Number.isNaN(t)) {
    switch (t) {
      case 1: // TYPE_ADMIN
        return 'admin';
      case 4: // TYPE_KITCHEN
        return 'kitchen';
      case 6: // TYPE_POS / branch user
        return 'pos';
      default:
        return 'branch';
    }
  }

  // 2) String-based roles / aliases
  const raw = String(typeOrRole).toLowerCase().trim();

  // Already normalized
  if (['admin', 'manager', 'accountant', 'pos', 'kitchen', 'branch'].includes(raw)) {
    return raw;
  }

  // Admin-like aliases
  if (raw === 'super admin' || raw === 'super_admin' || raw === 'basma admin') {
    return 'admin';
  }

  // Kitchen / operations / supervisors group
  if (
    raw === 'kitchen' ||
    raw === 'chef' ||
    raw === 'cook' ||
    raw === 'operations' ||
    raw === 'operation supervisor' ||
    raw === 'operations manger' ||
    raw === 'operations manager' ||
    raw === 'supervisor'
  ) {
    return 'kitchen';
  }

  // Branch / store / sales / store-access (basic/premium/enterprise) etc.
  if (
    [
      'helper',
      'sales',
      'sales_manager',
      'sales representative',
      'basic',
      'premium',
      'enterprise',
      'basic store access',
      'premium store access',
      'enterprise store access',
      'store',
      'store helper',
      'store supervisor',
      'customer',
       'services',
    ].includes(raw)
  ) {
    return 'branch';
  }

  // Default: safest is branch-level user
  return 'branch';
}

function normUser(u: any) {
  return {
    id: Number(u.id),
    name: (u.name ?? '') as string,
    username: u.username != null ? String(u.username) : null,
    email: u.email ? String(u.email).toLowerCase() : null,
    mobile: u.mobile ?? '',
    role: mapRole(u.role ?? u.type),
    password_hash: (u.password_hash ?? u.password ?? null) as string | null, // Laravel hash ($2y$…)
    is_active: u.is_active === undefined ? 1 : u.is_active ? 1 : 0,
    branch_id: u.branch_id == null ? null : Number(u.branch_id),
    updated_at: u.updated_at ? String(u.updated_at) : null,
  };
}

function normPromo(p: any) {
  return {
    id: S(p.id)!,
    code: S(p.code) ?? '',
    type: S(p.type) ?? 'percent', // server uses percent (offer_amount)
    value: N(p.value),
    min_total: N(p.min_total),
    max_discount:
      p.max_discount === null || p.max_discount === undefined
        ? null
        : N(p.max_discount),
    start_at: S(p.start_at),
    end_at: S(p.end_at),
    active: B(p.active),
    updated_at: S(p.updated_at),
  };
}

function normPromoExclusion(x: any) {
  return {
    promo_id: S(x.promo_id)!,
    item_id: S(x.item_id)!,
  };
}

function normGroup(g: any) {
  return {
    id: S(g.id)!,
    name: S(g.name) ?? '',
    name_ar: S(g.name_ar) ?? '',
    is_required: B(g.is_required),
    max_select: N(g.max_select),
    updated_at: S(g.updated_at),
  };
}

function normAddon(a: any, groupId?: string) {
  return {
    id: S(a.id)!,
    group_id: S(groupId ?? a.group_id)!,
    name: S(a.name) ?? '',
    name_ar: S(a.name_ar) ?? '',
    price: N(a.price),
    updated_at: S(a.updated_at),
  };
}

function normCategory(c: any) {
  return {
    id: S(c.id)!,
    name: S(c.name) ?? '',
    name_ar: S(c.name_ar) ?? '',
    position: N(c.position),
    visible: B(c.visible),
    updated_at: S(c.updated_at),
  };
}

function normPayMethod(pm: any) {
  return {
    id: S(pm.id)!,
    slug: S(pm.slug) ?? '',
    name_en: S(pm.name_en) ?? '',
    name_ar: S(pm.name_ar) ?? '',
    legacy_code: S(pm.legacy_code) ?? null, // TEXT in schema; keep as string
    is_active: B(pm.is_active),
    is_online: B(pm.is_online),
    supports_payment_link: B(pm.supports_payment_link),
    sort_order: N(pm.sort_order),
    updated_at: S(pm.updated_at),
  };
}

function normTable(t: any) {
  return {
    id: S(t.id)!,
    branch_id: N(t.branch_id),
    label: S(t.label) || '',
    number: N(t.number),
    capacity: N(t.capacity),
    is_available: B(t.is_available),
    updated_at: S(t.updated_at),
  };
}

function normState(s: any) {
  return {
    id: S(s.id)!,
    name: S(s.name) || '',
    name_ar: S(s.name_ar) || '',
    is_active: B(s.is_active),
    updated_at: S(s.updated_at),
  };
}

function normCity(c: any) {
  return {
    id: S(c.id)!,
    state_id: S(c.state_id),
    name: S(c.name) || '',
    name_ar: S(c.name_ar) || '',
    min_order: N(c.min_order),
    delivery_fee: N(c.delivery_fee),
    is_active: B(c.is_active),
    updated_at: S(c.updated_at),
  };
}

function normBlock(b: any) {
  return {
    id: S(b.id)!,
    city_id: S(b.city_id),
    name: S(b.name) || '',
    name_ar: S(b.name_ar) || '',
    is_active: B(b.is_active),
    updated_at: S(b.updated_at),
  };
}

function normSubcat(sc: any) {
  return {
    id: S(sc.id)!,
    category_id: S(sc.category_id),
    name: S(sc.name) || '',
    name_ar: S(sc.name_ar) || '',
    position: N(sc.position),
    visible: B(sc.visible),
    updated_at: S(sc.updated_at),
  };
}

/** Raw numeric status code as sent by the server, or null if not numeric. */
/**
 * Parse a server timestamp. Prefers Unix ms (created_at_ms). Falls back to a
 * bare MySQL datetime by normalising it to ISO and treating it as Asia/Kuwait
 * (UTC+3, no DST) — the app timezone the backend stores wall-clock time in.
 */
export function parseServerTime(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;

  if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n < 1e12 ? n * 1000 : n; // seconds vs milliseconds
  }

  const raw = String(v).trim();
  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return iso;

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi, sec] = m;
    return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}+03:00`);
  }
  return null;
}

function serverStatusCode(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Map the backend's numeric order status to a POS label.
 *
 * TODO(backend): the code→meaning list is not documented anywhere in this repo
 * — see docs/BACKEND-QUESTIONS.md, section 1. Until it is confirmed, unknown
 * codes render as "Status <n>" rather than being guessed at, because guessing
 * would show a cashier a confidently wrong state (e.g. calling a preparing
 * order "completed").
 */
// Confirmed enum lives in utils/serverStatus.ts (backend §1.1). We keep the
// numeric code in status_code and store an English label for legacy readers;
// the UI localises from status_code so it can honour the order-type nuance.
const SERVER_STATUS_LABELS: Record<number, string> = {
  0: 'pending payment',
  1: 'received',
  2: 'preparing',
  3: 'ready',
  4: 'done',
  5: 'cancelled by customer',
  6: 'cancelled by admin',
  7: 'awaiting pickup',
  8: 'rejected (auto)',
  9: 'rejected',
};

function mapServerStatus(v: any): string {
  // Already a POS-style string (some endpoints send strings) — keep it.
  if (typeof v === 'string' && v.trim() && !/^\d+(\.\d+)?$/.test(v.trim())) {
    return v.trim().toLowerCase();
  }

  const code = serverStatusCode(v);
  if (code == null) return 'unknown';
  return SERVER_STATUS_LABELS[code] ?? `status ${code}`;
}

/**
 * Statuses a sale cannot come back out of: DONE, CANCELLED_CLIENT,
 * CANCELLED_ADMIN, REJECTED_AUTO, REJECTED.
 *
 * The server enforces this same list device→server: applyPushedUpdate() refuses
 * to move an order out of it and answers PUSH_ORDER_FINALIZED. We enforce the
 * mirror image server→device so both ends run one rule instead of two that can
 * drift. Without it an offline till that completed a ticket at 14:00 has it
 * reopened by an office edit made at 14:10 and pulled at 14:35 — the same
 * resurrection the bootstrap seed already guards against.
 */
const TERMINAL_STATUS_CODES = new Set([4, 5, 6, 8, 9]);
const TERMINAL_STATUS_WORDS = new Set([
  'done',
  'completed',
  'closed',
  'cancelled',
  'canceled',
  'rejected',
]);

export function isTerminalLocalOrder(row: any): boolean {
  if (!row) return false;
  const code = row.status_code == null ? null : Number(row.status_code);
  if (code != null && Number.isFinite(code) && TERMINAL_STATUS_CODES.has(code))
    return true;
  const label = String(row.status ?? '').toLowerCase();
  if (!label) return false;
  return [...TERMINAL_STATUS_WORDS].some((w) => label.includes(w));
}

/**
 * Add-ons arrive from /pull already parsed into [{id,name,price,qty}], but the
 * local order_lines columns — and the renderer that reads them — hold the same
 * five parallel CSV strings the server stores. Fold them back so a pulled line
 * is indistinguishable from a line this till rang up.
 *
 * A comma inside an add-on name corrupts the row, exactly as it does in the
 * server's own column. That is the format's flaw, not this function's, and
 * round-tripping it keeps the two ends consistent rather than inventing a
 * third encoding.
 */
export function addonsToCsv(addons: any): {
  addons_id: string | null;
  addons_name: string | null;
  addons_price: string | null;
  addons_qty: string | null;
} {
  const list = Array.isArray(addons) ? addons : [];
  if (!list.length)
    return {
      addons_id: null,
      addons_name: null,
      addons_price: null,
      addons_qty: null,
    };
  const col = (key: string) =>
    list.map((a) => (a?.[key] == null ? '' : String(a[key]))).join(',');
  return {
    addons_id: col('id'),
    addons_name: col('name'),
    addons_price: col('price'),
    addons_qty: col('qty'),
  };
}

/**
 * The pull feed sends created_at as a bare MySQL datetime while orders_seed
 * sends ISO-8601 for the same field, and locally-rung orders write epoch ms
 * as text. Normalising the two server shapes to ISO keeps the local column
 * at two formats rather than three.
 */
function normalizeServerCreatedAt(createdAt: any, createdAtMs: any) {
  const ms = parseServerTime(createdAtMs ?? createdAt);
  return ms == null ? S(createdAt) : new Date(ms).toISOString();
}

/**
 * Pull the payment method off a server order, whatever shape it arrives in.
 *
 * The till pushes the method up in two forms already — `payment.method_slug`
 * and `payments[].method` (handlers/sync.ts) — so the backend holds it for
 * every order this device rang. What comes back down was simply never read:
 * neither feed's normaliser looked for a payment field, so 100+ orders on a
 * live till carry no method at all and the closing report prints them as
 * "Unknown".
 *
 * The key name on the down-feed is not documented (docs/BACKEND-QUESTIONS.md
 * §payment methods is still "?"), so rather than block on that, read every
 * shape the API plausibly uses. A key that never arrives costs nothing; the
 * one that does arrive is captured without another round trip to the backend.
 */
export function extractPaymentMethod(o: any): {
  payment_method_id: string | null;
  payment_method_slug: string | null;
} {
  const nested = [
    o?.payment,
    o?.payment_method,
    o?.paymentMethod,
    Array.isArray(o?.payments) ? o.payments[0] : null,
  ].filter((v) => v && typeof v === 'object');

  const pick = (...values: any[]) => {
    for (const v of values) {
      // A nested object here means the caller asked for `.slug` on something
      // that is itself the method object; skip rather than stringify to
      // "[object Object]" and write that into the column.
      if (v == null || typeof v === 'object') continue;
      const text = String(v).trim();
      if (text) return text;
    }
    return null;
  };

  // `payment_method` may itself be the slug when the API sends a bare string.
  const flatSlug = typeof o?.payment_method === 'string' ? o.payment_method : null;

  return {
    payment_method_id: pick(
      o?.payment_method_id,
      ...nested.map((n: any) => n.method_id),
      ...nested.map((n: any) => n.payment_method_id),
      // `.id` ONLY from an object that is itself a payment method. On a
      // `payments: [{ id: 991, amount: 5 }]` tender line, `.id` is the payment
      // row's own key — writing that would make the order look resolved,
      // remove it from the repair queue for good, and print a bare number as
      // the method name. Strictly worse than "Unknown".
      o?.payment_method?.id,
      o?.paymentMethod?.id
    ),
    payment_method_slug: pick(
      o?.payment_method_slug,
      flatSlug,
      ...nested.map((n: any) => n.method_slug),
      ...nested.map((n: any) => n.slug),
      ...nested.map((n: any) => n.method),
      ...nested.map((n: any) => n.code)
    ),
  };
}

/**
 * How many distinct tender lines the server sent for one order.
 *
 * The POS credits a whole order to a single method, which is right if a sale is
 * always settled one way and quietly wrong if it is not: 5 KWD cash + the rest
 * on KNET would post the entire total to cash. Nobody could say for certain
 * whether this shop splits payments, so rather than assume, count — an order
 * that arrives with more than one method is surfaced instead of silently
 * mis-credited, and the answer comes from the till's own traffic.
 */
export function countTenders(o: any): number {
  const list = Array.isArray(o?.payments) ? o.payments : [];
  const methods = new Set(
    list
      .map((t: any) =>
        String(t?.method ?? t?.method_slug ?? t?.slug ?? t?.payment_method_id ?? '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean)
  );
  return methods.size;
}

/** Running tally of split-tender orders, so the repair screen can report it. */
export function noteSplitTender(orderRef: string, tenders: number) {
  if (tenders < 2) return;
  const seen = Number(getMeta('payment.split_tender_count') ?? 0) + 1;
  setMeta('payment.split_tender_count', String(seen));
  setMeta('payment.split_tender_last', orderRef);
  console.warn(
    `[sync] order ${orderRef} carries ${tenders} payment methods; the report ` +
      `credits the whole total to the first. Split tender is not modelled yet.`
  );
}

export function normPullOrder(o: any) {
  const cust = o?.customer ?? {};
  const tot = o?.totals ?? {};
  return {
    id: S(o.id)!,
    number: S(o.number) || '',
    reference_no: S(o.reference_no ?? o.reference_number),
    branch_id: N(o.branch_id),
    order_type: N(o.order_type),
    status: mapServerStatus(o.status),
    status_code: serverStatusCode(o.status),
    full_name: S(cust.full_name) || '',
    mobile: S(cust.mobile) || '',
    email: S(cust.email),
    payment_type: N(o.payment_type),
    ...extractPaymentMethod(o),
    subtotal: N(tot.subtotal),
    discount_amount: N(tot.discount),
    discount_pr: N(tot.discount_pr),
    delivery_fee: N(tot.delivery_fee),
    grand_total: N(tot.grand_total),
    promocode: S(tot.promocode),
    created_at: normalizeServerCreatedAt(o.created_at, o.created_at_ms),
    opened_at: parseServerTime(o.created_at_ms ?? o.created_at),
  };
}

export function normPullLine(l: any, localOrderId: string) {
  return {
    id: S(l.id)!,
    order_id: localOrderId,
    item_id: S(l.item_id),
    name: S(l.name),
    name_ar: S(l.name_ar),
    qty: N(l.qty),
    unit_price: N(l.unit_price),
    line_total: N(l.line_total),
    variation_id: S(l.variation_id),
    variation: S(l.variation),
    variation_price: N(l.variation_price),
    notes: S(l.item_notes ?? l.notes),
    updated_at: parseServerTime(l.created_at_ms ?? l.created_at),
    ...addonsToCsv(l.addons),
  };
}

export function normOrderSeed(o: any) {
  return {
    id: S(o.id)!,
    number: S(o.number) || '',
    // The feed has always sent this and the normaliser never read it, so every
    // seeded order landed with a NULL branch. The closing report keeps
    // branch-less rows deliberately (they might be this till's own older
    // sales), which meant another branch's lookup orders were counted into
    // this branch's takings — 42 orders and 330.150 on the till this was found
    // on. The pull feed has always read it; the seed simply never did.
    // NOT N(): that turns a missing value into 0, and 0 is a branch the report
    // filter does not match — a feed that omitted the field would make those
    // orders vanish from the report entirely. Absent stays NULL, which the
    // report still counts.
    branch_id: o.branch_id == null || o.branch_id === '' ? null : N(o.branch_id),
    // Human-facing running number (0001, 0002 …) allocated by the server.
    reference_no: S(o.reference_no ?? o.reference_number),
    // §4.1: the pull feed sends a bare MySQL datetime ("2026-08-16 10:19:03")
    // with no timezone — not valid ISO 8601, so strict parsers fall through to
    // epoch zero, which is the 1970 dates we were seeing. created_at_ms is
    // unambiguous Unix milliseconds and is present on both feeds.
    created_at: S(o.created_at),
    opened_at: parseServerTime(o.created_at_ms ?? o.created_at),
    order_type: N(o.order_type),
    // The server sends a NUMERIC status code (1, 2, 4, …) while the POS uses
    // strings ('open', 'placed', 'closed'). Writing the number straight into
    // `status` mixed two vocabularies and surfaced as "2.0" in the UI. Keep the
    // raw code in status_code; `status` gets a label via mapServerStatus().
    status: mapServerStatus(o.status),
    status_code: serverStatusCode(o.status),
    mobile: S(o.mobile) || '',
    full_name: S(o.full_name) || '',
    grand_total: N(o.grand_total),
    // The seed feed is where most server orders enter a till, and it carried
    // no payment method at all — the single biggest source of "Unknown" on the
    // closing report.
    ...extractPaymentMethod(o),
  };
}

// Sync POS working hours from online Laravel -> local SQLite `time` table
export async function syncPosTime(): Promise<void> {
  // ⬇ adjust client name if yours is different (`api`, `http`, etc.)
  if (!api) {
    throw posError('POS_CFG_API_NOT_READY');
  }

  const res = await api.get('/time'); // Laravel route we created
  const payload = res.data;

  const rows: Array<{
    id: number;
    day: string;
    open_time: string;
    close_time: string;
    always_close: boolean | number;
  }> = payload?.data ?? [];

  if (!Array.isArray(rows) || rows.length === 0) {
    // nothing to sync, just return
    return;
  }

  const upsert = db.prepare(
    `
    INSERT INTO time (id, day, open_time, close_time, always_close)
    VALUES (@id, @day, @open_time, @close_time, @always_close)
    ON CONFLICT(id) DO UPDATE SET
      day          = excluded.day,
      open_time    = excluded.open_time,
      close_time   = excluded.close_time,
      always_close = excluded.always_close
  `
  );

  const runTxn = db.transaction((items: typeof rows) => {
    for (const r of items) {
      upsert.run({
        id: r.id,
        day: r.day,
        open_time: r.open_time,
        close_time: r.close_time,
        always_close: r.always_close ? 1 : 0,
      });
    }
  });

  runTxn(rows);
}

/* ---------- Pairing ---------- */
export async function pairDevice(
  baseUrl: string,
  pairCode: string,
  branchId: string,
  deviceName: string,
  machineId: string
) {
  // Pairing runs on its own instance — there is no token yet — so it does not
  // inherit the headers configureApi sets and has to carry the version itself.
  const pairingApi = axios.create({
    baseURL: baseUrl.replace(/\/+$/, '') + '/api/pos',
    timeout: 15000,
    headers: { ...versionHeaders() },
  });

  const { data } = await pairingApi.post('/register', {
    code: pairCode,
    branch_id: branchId,
    name: deviceName,
    machine_id: machineId,
    // Known from the first contact, so a device that never syncs again still
    // has a recorded version.
    app_version: appVersion(),
  });

  if (!data.device?.id || !data.token) {
    throw posError('POS_PAIR_RESPONSE_INVALID');
  }

  setMeta('device_id', data.device.id);
  setMeta('server.base_url', baseUrl);
  if (data.device.branch_id)
    setMeta('branch_id', String(data.device.branch_id));
  await saveSecret('device_token', data.token);

  // The caller needs the whole device, not just its ids: locked_at and
  // killswitch_after_days ride along on this response and decide whether the
  // freshly paired till starts locked.
  return {
    deviceId: data.device.id,
    branchId: data.device.branch_id,
    device: data.device,
  };
}

/**
 * Cache the branch identity that /bootstrap and the /pull feed both send.
 *
 * The two payloads are byte-identical by design, so they share this one
 * writer — the alternative was two parsers drifting apart and a receipt whose
 * footer depended on whether the till had re-bootstrapped or merely pulled.
 *
 * The legacy `branch.id` / `branch.name` meta keys are kept in step because
 * the pairing and UI code still read them.
 */
function persistBranchProfile(raw: any): boolean {
  const profile = normalizeBranchProfile(raw);
  if (!profile) return false;

  setMeta(BRANCH_PROFILE_META_KEY, serializeBranchProfile(profile));
  setMeta('branch_id', profile.id);
  setMeta('branch.id', profile.id);
  if (profile.name) setMeta('branch.name', profile.name);
  return true;
}

/* ---------- Bootstrap (full catalog seed) ---------- */
export async function bootstrap(baseUrl: string) {
  console.log('[SYNC] bootstrap() called with', baseUrl);
  const deviceId = getMeta('device_id') ?? '';
  const token = await loadSecret('device_token');
  const branchId = Number(getMeta('branch_id') ?? 0);
  if (!deviceId || !token) throw posError('POS_AUTH_MISSING');

  const device = { id: deviceId, branch_id: branchId };
  configureApi(baseUrl, device, token);

  try {
    await syncPosTime();
  } catch (err) {
    console.error('[SYNC] syncPosTime() failed during bootstrap:', err);
  }

  const { data } = await api.get('/bootstrap');

  // Persist branch identity for the UI and, since 0.4.22, for the receipt.
  // `id` and `name` are unchanged from the shape older builds read; the rest
  // of the row (address, hours, invoice note) is what stops the counter and
  // the back office printing two different footers for one order.
  persistBranchProfile(data?.branch);

  if (data?.device) {
    if (data.device.killswitch_after_days != null) {
      setMeta(
        'device.killswitch_after_days',
        String(data.device.killswitch_after_days)
      );
    }
    if (data.device.locked_at) {
      setMeta('device.locked_at', String(data.device.locked_at));
    } else {
      setMeta('device.locked_at', '');
    }
  }

  const catalog = data.catalog ?? data;
  const asArray = (x: any): any[] =>
    Array.isArray(x) ? x : x ? Object.values(x) : [];

  const items = asArray(catalog.items ?? catalog.item);
  const itemVariations = asArray(
    catalog.item_variations ?? catalog.variations ?? []
  );
  const itemAddonGroups = asArray(catalog.item_addon_groups ?? []);
  const promos = asArray(catalog.promos ?? catalog.promo_codes);
  const promoExclusions = asArray(catalog.promo_exclusions ?? []);
  const groups = asArray(
    catalog.addons ?? catalog.addon_groups ?? catalog.addons_groups
  );
  const categories = asArray(catalog.categories);
  const payMethods = asArray(
    catalog.payment_methods ?? catalog.web_payment_methods ?? catalog.payments
  );
  const settings = asArray(catalog.settings ?? []);
  const states = asArray(catalog.states ?? []);
  const cities = asArray(catalog.cities ?? []);
  const blocks = asArray(catalog.blocks ?? []);
  // The payload has used more than one shape for these over time; read them
  // all, because an unread key looks identical to "the server deleted them"
  // and would make the prune below destroy a valid catalog.
  const subcats = (() => {
    const flat = asArray(
      catalog.subcategories ?? catalog.sub_categories ?? catalog.subcats ?? []
    );
    const nested = asArray(catalog.categories).flatMap((c: any) =>
      asArray(c?.subcategories ?? c?.sub_categories ?? c?.children ?? [])
    );
    const byId = new Map<string, any>();
    for (const r of [...flat, ...nested]) {
      const id = S(r?.id);
      if (id) byId.set(id, r);
    }
    return [...byId.values()];
  })();
  const ordersSeed = asArray(catalog.orders_seed ?? []);
  const tables = asArray(catalog.tables ?? catalog.table_list ?? []);
  const users = asArray(data.users ?? catalog.users ?? []);

  // Role permissions are server-owned. Absent and empty mean different things
  // here and must not be collapsed: a server that has not been updated sends
  // no key at all, and wiping the till's table on that would strip every
  // permission a shop had set. An explicit empty list is the back office
  // saying "no overrides — use the built-in defaults", which is a real
  // instruction and is applied.
  const rolePermsRaw =
    data.role_permissions ??
    catalog.role_permissions ??
    catalog.pos_role_permissions;
  const rolePerms =
    rolePermsRaw === undefined ? null : asArray(rolePermsRaw ?? []);

  const tx = db.transaction(() => {
    // items
    const upItem = db.prepare(`
  INSERT INTO items (
    id,
    category_id,
    subcategory_id,
    name,
    name_ar,
    barcode,
    price,
    image,
    size,
    has_variations,
    has_addons,
    type,
    is_outofstock,
    branch_id,
    updated_at
  ) VALUES (
    @id,
    @category_id,
    @subcategory_id,
    @name,
    @name_ar,
    @barcode,
    @price,
    @image,
    @size,
    @has_variations,
    @has_addons,
    @type,
    @is_outofstock,
    @branch_id,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    category_id    = excluded.category_id,
    subcategory_id = excluded.subcategory_id,
    name           = excluded.name,
    name_ar        = excluded.name_ar,
    barcode        = excluded.barcode,
    price          = excluded.price,
    image          = excluded.image,
    size           = excluded.size,
    has_variations = excluded.has_variations,
    has_addons     = excluded.has_addons, 
    type           = excluded.type,
    is_outofstock  = excluded.is_outofstock,
    branch_id      = excluded.branch_id,
    updated_at     = excluded.updated_at
`);

    for (const it of items) upItem.run(normItem(it));

    // variations
    const upVar = db.prepare(`
      INSERT INTO variations (id,item_id,name,name_ar,price,sale_price,updated_at)
      VALUES (@id,@item_id,@name,@name_ar,@price,@sale_price,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        item_id=excluded.item_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        price=excluded.price,
        sale_price=excluded.sale_price,
        updated_at=excluded.updated_at
    `);
    for (const v of itemVariations) upVar.run(normVariation(v));

    // addon groups + addons
    const upGroup = db.prepare(`
      INSERT INTO addon_groups (id,name,name_ar,is_required,max_select,updated_at)
      VALUES (@id,@name,@name_ar,@is_required,@max_select,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        name_ar=excluded.name_ar,
        is_required=excluded.is_required,
        max_select=excluded.max_select,
        updated_at=excluded.updated_at
    `);
    const upAddon = db.prepare(`
      INSERT INTO addons (id,group_id,name,name_ar,price,updated_at)
      VALUES (@id,@group_id,@name,@name_ar,@price,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        group_id=excluded.group_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        price=excluded.price,
        updated_at=excluded.updated_at
    `);
    for (const g of groups) {
      const ng = normGroup(g);
      upGroup.run(ng);
      const children = asArray(g.items ?? g.addons);
      for (const a of children) upAddon.run(normAddon(a, ng.id));
    }

    // item ↔ addon group map
    const upItemAddonGroup = db.prepare(`
      INSERT INTO item_addon_groups (id,item_id,group_id,is_required,max_select,updated_at)
      VALUES (@id,@item_id,@group_id,@is_required,@max_select,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        item_id=excluded.item_id,
        group_id=excluded.group_id,
        is_required=excluded.is_required,
        max_select=excluded.max_select,
        updated_at=excluded.updated_at
    `);
    // The server ships links whose addon group it does not ship: /bootstrap has
    // returned 73 item_addon_groups referencing groups 3-10 while sending only 4
    // groups. On a till that has synced for months the parents are already
    // present and the insert passes, but on a FRESH database every one of those
    // links violates the FK, the whole transaction rolls back, and the till can
    // never bootstrap at all. One inconsistent link must not cost the operator
    // their entire catalog, so skip the orphans and say how many — loudly, since
    // each skipped row is an add-on group the operator will not see on an item.
    const hasItem = db.prepare('SELECT 1 FROM items WHERE id=?').pluck();
    const hasGroup = db.prepare('SELECT 1 FROM addon_groups WHERE id=?').pluck();
    let orphanLinks = 0;
    for (const m of itemAddonGroups) {
      const link = normItemAddonGroup(m);
      // Checked against the DB, not just this payload: a parent may legitimately
      // have arrived in an earlier sync.
      if (!hasItem.get(link.item_id) || !hasGroup.get(link.group_id)) {
        orphanLinks++;
        continue;
      }
      upItemAddonGroup.run(link);
    }
    if (orphanLinks) {
      console.warn(
        `[SYNC] skipped ${orphanLinks}/${itemAddonGroups.length} item add-on links — ` +
          'the server sent links whose item or addon group it did not send. ' +
          'Those add-ons will not appear on their items until the payload is fixed.'
      );
    }

    // promos
    const upPromo = db.prepare(`
      INSERT INTO promos (id,code,type,value,min_total,max_discount,start_at,end_at,active,updated_at)
      VALUES (@id,@code,@type,@value,@min_total,@max_discount,@start_at,@end_at,@active,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        code=excluded.code,
        type=excluded.type,
        value=excluded.value,
        min_total=excluded.min_total,
        max_discount=excluded.max_discount,
        start_at=excluded.start_at,
        end_at=excluded.end_at,
        active=excluded.active,
        updated_at=excluded.updated_at
    `);
    for (const p of promos) upPromo.run(normPromo(p));

    // promo item exclusions (unique pair)
    const upPromoEx = db.prepare(`
      INSERT INTO promo_item_exclusions (promo_id,item_id)
      VALUES (@promo_id,@item_id)
      ON CONFLICT(promo_id,item_id) DO NOTHING
    `);
    for (const e of promoExclusions) upPromoEx.run(normPromoExclusion(e));

    // categories
    const upCat = db.prepare(`
      INSERT INTO categories (id,name,name_ar,position,visible,updated_at)
      VALUES (@id,@name,@name_ar,@position,@visible,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        name_ar=excluded.name_ar,
        position=excluded.position,
        visible=excluded.visible,
        updated_at=excluded.updated_at
    `);
    for (const c of categories) upCat.run(normCategory(c));

    // payment methods
    const upPM = db.prepare(`
      INSERT INTO payment_methods (id,slug,name_en,name_ar,legacy_code,is_active,is_online,supports_payment_link,sort_order,updated_at)
      VALUES (@id,@slug,@name_en,@name_ar,@legacy_code,@is_active,@is_online,@supports_payment_link,@sort_order,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug,
        name_en=excluded.name_en,
        name_ar=excluded.name_ar,
        legacy_code=excluded.legacy_code,
        is_active=excluded.is_active,
        is_online=excluded.is_online,
        supports_payment_link=excluded.supports_payment_link,
        sort_order=excluded.sort_order,
        updated_at=excluded.updated_at
    `);
    for (const pm of payMethods) upPM.run(normPayMethod(pm));

    // tables
    const upTable = db.prepare(`
      INSERT INTO tables (id,branch_id,label,number,capacity,is_available,updated_at)
      VALUES (@id,@branch_id,@label,@number,@capacity,@is_available,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        branch_id=excluded.branch_id,
        label=excluded.label,
        number=excluded.number,
        capacity=excluded.capacity,
        is_available=excluded.is_available,
        updated_at=excluded.updated_at
    `);
    for (const t of tables) upTable.run(normTable(t));

    // settings
    const upSetting = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    for (const s of settings) {
      upSetting.run(
        String(s.key),
        String(s.value ?? ''),
        s.updated_at ? String(s.updated_at) : null
      );
    }

    // geo
    const upState = db.prepare(`
      INSERT INTO states (id,name,name_ar,is_active,updated_at)
      VALUES (@id,@name,@name_ar,@is_active,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        name_ar=excluded.name_ar,
        is_active=excluded.is_active,
        updated_at=excluded.updated_at
    `);
    for (const s of states) upState.run(normState(s));

    const upCity = db.prepare(`
      INSERT INTO cities (id,state_id,name,name_ar,min_order,delivery_fee,is_active,updated_at)
      VALUES (@id,@state_id,@name,@name_ar,@min_order,@delivery_fee,@is_active,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        state_id=excluded.state_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        min_order=excluded.min_order,
        delivery_fee=excluded.delivery_fee,
        is_active=excluded.is_active,
        updated_at=excluded.updated_at
    `);
    for (const c of cities) upCity.run(normCity(c));

    const upBlock = db.prepare(`
      INSERT INTO blocks (id,city_id,name,name_ar,is_active,updated_at)
      VALUES (@id,@city_id,@name,@name_ar,@is_active,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        city_id=excluded.city_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        is_active=excluded.is_active,
        updated_at=excluded.updated_at
    `);
    for (const b of blocks) upBlock.run(normBlock(b));

    const upSub = db.prepare(`
      INSERT INTO subcategories (id,category_id,name,name_ar,position,visible,updated_at)
      VALUES (@id,@category_id,@name,@name_ar,@position,@visible,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        category_id=excluded.category_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        position=excluded.position,
        visible=excluded.visible,
        updated_at=excluded.updated_at
    `);
    for (const sc of subcats) upSub.run(normSubcat(sc));

    // Bootstrap upserts but never deleted, so anything removed in the back
    // office survived even a full resync — deleted categories kept showing on
    // the POS grid indefinitely. Bootstrap is the COMPLETE catalog (confirmed
    // with the backend: no pagination, no limit), so any local row absent from
    // the payload has genuinely gone and must be pruned.
    //
    // Guarded on a non-empty payload: an empty list means a failed or partial
    // response, and wiping the catalog on that would take the till offline.
    const pruneMissing = (
      table: string,
      incoming: any[],
      label: string
    ) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      const ids = incoming.map((r) => S(r?.id)).filter(Boolean) as string[];
      if (!ids.length) return;

      const placeholders = ids.map(() => '?').join(',');
      const stale = db
        .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE id NOT IN (${placeholders})`)
        .get(...ids) as { c?: number };

      const n = Number(stale?.c ?? 0);
      if (!n) return;

      // Refuse to act on an implausibly small payload. A key we failed to read
      // is indistinguishable from "the server deleted almost everything", and
      // guessing wrong empties a live catalog mid-service. Deleting most of a
      // table is a legitimate but rare admin action, so make it explicit rather
      // than automatic.
      const localTotal =
        Number(
          (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as any)?.c ?? 0
        ) || 0;
      const wouldRemoveShare = localTotal ? n / localTotal : 0;

      if (localTotal > 10 && wouldRemoveShare > 0.75) {
        console.warn(
          `[sync] REFUSING to prune ${n}/${localTotal} ${label} — the payload ` +
            `carried only ${ids.length}. That usually means a payload key ` +
            `changed, not a mass deletion. Nothing was removed.`
        );
        return;
      }

      db.prepare(`DELETE FROM ${table} WHERE id NOT IN (${placeholders})`).run(...ids);
      console.log(`[sync] pruned ${n} ${label} removed on the server`);
    };

    console.log('[sync] bootstrap payload sizes', {
      categories: categories.length,
      subcategories: subcats.length,
      items: items.length,
      variations: itemVariations.length,
      addon_groups: groups.length,
      tables: tables.length,
      payment_methods: payMethods.length,
      catalog_keys: Object.keys(catalog || {}),
    });

    pruneMissing('categories', categories, 'categories');
    pruneMissing('subcategories', subcats, 'subcategories');
    pruneMissing('items', items, 'items');
    pruneMissing('variations', itemVariations, 'variations');
    pruneMissing('addon_groups', groups, 'add-on groups');
    pruneMissing('item_addon_groups', itemAddonGroups, 'item add-on links');
    pruneMissing('promos', promos, 'promos');
    pruneMissing('tables', tables, 'tables');
    pruneMissing('payment_methods', payMethods, 'payment methods');

    // Add-ons are nested under their groups in the payload, so flatten before
    // comparing — otherwise every add-on would look absent and be deleted.
    const allAddons = groups.flatMap((g: any) =>
      asArray(g?.addons ?? g?.items ?? [])
    );
    pruneMissing('addons', allAddons, 'add-ons');

    // recent orders seed (for phone lookup)
    const upOrderSeed = db.prepare(`
      INSERT INTO orders (id, number, reference_no, branch_id, opened_at, created_at, order_type, status, status_code, mobile, full_name, grand_total, payment_method_id, payment_method_slug)
      VALUES (@id, @number, @reference_no, @branch_id, COALESCE(@opened_at, strftime('%s','now')*1000), @created_at, @order_type, @status, @status_code, @mobile, @full_name, @grand_total, @payment_method_id, @payment_method_slug)
      ON CONFLICT(id) DO UPDATE SET
        number      = excluded.number,
        reference_no = COALESCE(excluded.reference_no, reference_no),
        branch_id   = COALESCE(excluded.branch_id, branch_id),
        opened_at   = COALESCE(excluded.opened_at, opened_at),
        created_at  = COALESCE(excluded.created_at, created_at),
        order_type  = excluded.order_type,
        status      = excluded.status,
        status_code = excluded.status_code,
        mobile      = excluded.mobile,
        full_name   = excluded.full_name,
        grand_total = excluded.grand_total,
        -- COALESCE, never a bare assignment: an order rung up on THIS till
        -- already knows how it was paid, and a feed that omits the field would
        -- otherwise erase that on the next sync. A server value only ever
        -- fills a blank here.
        payment_method_id   = COALESCE(excluded.payment_method_id, payment_method_id),
        payment_method_slug = COALESCE(excluded.payment_method_slug, payment_method_slug)
    `);
    // Orders this device created are pushed up and then come back down in the
    // seed feed under the SERVER's id. Keyed on id alone that never matches the
    // local UUID, so it inserted a second row — colliding on `number`, which
    // made the dedupe trigger rename OUR row to 'L-<number>-<hex>'. Match on
    // number first and skip: the local row is the authoritative copy.
    const findLocalByNumber = db.prepare(
      `SELECT id FROM orders WHERE number = ? LIMIT 1`
    );
    for (const o of ordersSeed) {
      const row = normOrderSeed(o);
      if (!row.number) continue;

      const local = findLocalByNumber.get(row.number) as
        | { id: string }
        | undefined;

      // A local order is authoritative even after the server starts returning
      // the same temp_id as its id. Re-applying the seed's older status here
      // resurrected completed kitchen tickets as READY on every bootstrap.
      if (local) {
        console.log(
          '[sync] seed order already exists locally, skipping duplicate',
          { number: row.number, localId: local.id, serverId: row.id }
        );
        continue;
      }
      upOrderSeed.run(row);
    }

    const upUser = db.prepare(`
  INSERT INTO pos_users (
    id,
    name,
    username,
    email,
    mobile,
    role,
    password_hash,
    is_active,
    branch_id,
    updated_at
  ) VALUES (
    @id,
    @name,
    @username,
    lower(@email),
    @mobile,
    @role,
    @password_hash,
    @is_active,
    @branch_id,
    @updated_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name          = excluded.name,
    username      = excluded.username,
    email         = excluded.email,
    mobile        = excluded.mobile,
    role          = excluded.role,
    password_hash = excluded.password_hash,
    is_active     = excluded.is_active,
    branch_id     = excluded.branch_id,
    updated_at    = excluded.updated_at
    `);

    for (const u of users) upUser.run(normUser(u));

    if (rolePerms) {
      // Replaced wholesale rather than upserted. A permission the back office
      // revoked disappears from the payload entirely, so merging would leave
      // the revoked grant in place on the till forever — the failure mode is
      // silent and it fails open.
      db.prepare('DELETE FROM pos_role_permissions').run();
      const upRolePerm = db.prepare(
        `INSERT OR REPLACE INTO pos_role_permissions
           (role, permission, allowed, updated_by, updated_at)
         VALUES (@role, @permission, @allowed, @updated_by, @updated_at)`
      );
      for (const r of rolePerms) {
        const role = String(r?.role ?? '').trim().toLowerCase();
        const permission = String(r?.permission ?? '').trim();
        if (!role || !permission) continue;
        upRolePerm.run({
          role,
          permission,
          allowed: r?.allowed ? 1 : 0,
          updated_by: r?.updated_by ?? null,
          updated_at: Number(r?.updated_at) || Date.now(),
        });
      }
      // Marks the till as server-governed, which is what turns the local
      // permissions editor read-only. Set only when the server actually sent
      // the key, so a shop on an older backend keeps editing locally.
      db.prepare(
        `INSERT INTO sync_state(key,value) VALUES('permissions.source','server')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run();
      console.log('[sync] role permissions applied from server', {
        rows: rolePerms.length,
      });
    }

    // cursor
    db.prepare(
      `
      INSERT INTO sync_state(key,value) VALUES('cursor',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `
    ).run(String(data.cursor ?? 0));
  });

  tx();
  markSyncedNow();
  await prefetchItemImages(6);

  // Return payload for main.ts handler
  return data;
}

/* ---------- Pull (incremental) ---------- */
/**
 * Statements and guards shared by the /pull change feed and the on-demand
 * single-order fetch. Both write the same two tables under the same rules, so
 * they share one implementation rather than two that drift.
 *
 * Prepared lazily: the tables exist only after migrate() has run.
 */
let orderSyncOpsCache: ReturnType<typeof buildOrderSyncOps> | null = null;
function buildOrderSyncOps() {
  const upPullOrder = db.prepare(`
    INSERT INTO orders (
      id, number, reference_no, branch_id, order_type, status, status_code,
      full_name, mobile, email, payment_type, payment_method_id,
      payment_method_slug, subtotal, discount_amount,
      discount_pr, delivery_fee, grand_total, promocode, created_at,
      opened_at, updated_at, server_id
    ) VALUES (
      @id, @number, @reference_no, @branch_id, @order_type, @status,
      @status_code, @full_name, @mobile, @email, @payment_type,
      @payment_method_id, @payment_method_slug, @subtotal,
      @discount_amount, @discount_pr, @delivery_fee, @grand_total,
      @promocode, @created_at, @opened_at, @updated_at, @server_id
    )
    ON CONFLICT(id) DO UPDATE SET
      number          = excluded.number,
      reference_no    = COALESCE(excluded.reference_no, reference_no),
      branch_id       = COALESCE(excluded.branch_id, branch_id),
      order_type      = excluded.order_type,
      status          = excluded.status,
      status_code     = excluded.status_code,
      full_name       = excluded.full_name,
      mobile          = excluded.mobile,
      email           = COALESCE(excluded.email, email),
      payment_type    = excluded.payment_type,
      -- See the seed upsert: fill a blank, never overwrite what this till knows.
      payment_method_id   = COALESCE(excluded.payment_method_id, payment_method_id),
      payment_method_slug = COALESCE(excluded.payment_method_slug, payment_method_slug),
      subtotal        = excluded.subtotal,
      discount_amount = excluded.discount_amount,
      discount_pr     = excluded.discount_pr,
      delivery_fee    = excluded.delivery_fee,
      grand_total     = excluded.grand_total,
      promocode       = COALESCE(excluded.promocode, promocode),
      opened_at       = COALESCE(excluded.opened_at, opened_at),
      updated_at      = excluded.updated_at,
      server_id       = excluded.server_id
  `);

  const upPullLine = db.prepare(`
    INSERT INTO order_lines (
      id, order_id, item_id, name, name_ar, qty, unit_price, line_total,
      variation_id, variation, variation_price,
      addons_id, addons_name, addons_price, addons_qty, notes, updated_at
    ) VALUES (
      @id, @order_id, @item_id, @name, @name_ar, @qty, @unit_price,
      @line_total, @variation_id, @variation, @variation_price,
      @addons_id, @addons_name, @addons_price, @addons_qty, @notes,
      @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      order_id        = excluded.order_id,
      item_id         = excluded.item_id,
      name            = excluded.name,
      name_ar         = excluded.name_ar,
      qty             = excluded.qty,
      unit_price      = excluded.unit_price,
      line_total      = excluded.line_total,
      variation_id    = excluded.variation_id,
      variation       = excluded.variation,
      variation_price = excluded.variation_price,
      addons_id       = excluded.addons_id,
      addons_name     = excluded.addons_name,
      addons_price    = excluded.addons_price,
      addons_qty      = excluded.addons_qty,
      notes           = excluded.notes,
      updated_at      = excluded.updated_at
  `);

  const parkLine = db.prepare(`
    INSERT INTO order_lines_pending (id, order_id, payload, received_at)
    VALUES (@id, @order_id, @payload, @received_at)
    ON CONFLICT(id) DO UPDATE SET
      order_id    = excluded.order_id,
      payload     = excluded.payload,
      received_at = excluded.received_at
  `);

  const qOrderById = db.prepare(
    'SELECT id, status, status_code FROM orders WHERE id = ?'
  );
  const qOrderByNumber = db.prepare(
    'SELECT id, status, status_code FROM orders WHERE number = ? LIMIT 1'
  );

  /**
   * Find the local row a server order maps to.
   *
   * An order this till rang up was pushed with a local UUID and comes back
   * under the SERVER's integer id, so matching on id alone misses it and we
   * insert a second row for the same sale. That does not throw — the
   * tr_orders_num_dedupe_ins trigger resolves the UNIQUE(number) clash by
   * renaming OUR row to 'L-<number>-<hex>' and letting the insert through, so
   * the failure is silent: the till's own order loses its number and the
   * duplicate takes its place. Verified against a copy of a live db.
   *
   * Fall back to number, and report whether the match was ours so the caller
   * can leave our own lines alone.
   */
  const resolveLocalOrder = (serverId: string, number: string | null) => {
    const byId = qOrderById.get(serverId) as any;
    if (byId) return { row: byId, localId: serverId, isLocalOrigin: false };
    if (!number) return { row: null, localId: null, isLocalOrigin: false };
    const byNumber = qOrderByNumber.get(number) as any;
    if (!byNumber) return { row: null, localId: null, isLocalOrigin: false };
    return {
      row: byNumber,
      localId: String(byNumber.id),
      isLocalOrigin: true,
    };
  };

  const drainPendingLines = (localOrderId: string) => {
    const parked = db
      .prepare('SELECT id, payload FROM order_lines_pending WHERE order_id = ?')
      .all(localOrderId) as Array<{ id: string; payload: string }>;
    if (!parked.length) return;
    const drop = db.prepare('DELETE FROM order_lines_pending WHERE id = ?');
    for (const p of parked) {
      try {
        upPullLine.run(normPullLine(JSON.parse(p.payload), localOrderId));
        drop.run(p.id);
      } catch (e) {
        // Never rethrow inside the page transaction: see order_lines_pending.
        console.error('[sync] parked line failed to apply', p.id, e);
      }
    }
    console.log('[sync] drained parked lines', {
      order_id: localOrderId,
      count: parked.length,
    });
  };

  return {
    upPullOrder,
    upPullLine,
    parkLine,
    resolveLocalOrder,
    drainPendingLines,
  };
}
function orderSyncOps() {
  if (!orderSyncOpsCache) orderSyncOpsCache = buildOrderSyncOps();
  return orderSyncOpsCache;
}

/**
 * Fetch one order and its lines straight from the server.
 *
 * A header and its lines get separate change-log ids and are not guaranteed to
 * land in the same /pull page, so a till can legitimately hold a header whose
 * lines are still parked in order_lines_pending — or a parked line whose header
 * never comes. Nothing on the feed alone ever resolves that, which is why this
 * escape hatch is a requirement rather than a convenience.
 */
export async function fetchOrderFromServer(serverOrderId: string) {
  if (!api) throw posError('POS_CFG_API_NOT_READY');
  try {
    const { data } = await api.get(
      `/orders/${encodeURIComponent(serverOrderId)}`
    );
    // Envelope confirmed against a live response: plainly { order, lines },
    // both keys always present, lines always an array, no order.lines.
    return { order: data?.order ?? null, lines: data?.lines ?? [] };
  } catch (e: any) {
    // The server answers POS_ORDER_NOT_FOUND here. The POS deliberately does
    // not mirror that code: it already has POS_VAL_ORDER_NOT_FOUND for this
    // exact condition, and one code per condition beats one per origin.
    if (e?.response?.status === 404) throw posError('POS_VAL_ORDER_NOT_FOUND');
    throw e;
  }
}

/**
 * Apply a server-fetched order locally. Returns how many lines were written.
 *
 * Runs the same statements and the same guards as the change feed — see
 * orderSyncOps(). The terminal guard covers the header only: a finalized order
 * must not have its status regressed, but its lines are a record of what was
 * sold and are exactly what we came here for.
 */
export async function reconcileOrderFromServer(
  serverOrderId: string
): Promise<number> {
  const payload = await fetchOrderFromServer(serverOrderId);
  if (!payload.order) return 0;

  const ops = orderSyncOps();
  const orderRow = normPullOrder(payload.order);
  const found = ops.resolveLocalOrder(orderRow.id, orderRow.number || null);

  // This till rang the order up; its own lines are authoritative.
  if (found.isLocalOrigin) return 0;

  const target = found.localId ?? orderRow.id;
  const write = db.transaction(() => {
    if (!isTerminalLocalOrder(found.row)) {
      ops.upPullOrder.run({
        ...orderRow,
        id: target,
        updated_at: Date.now(),
        server_id: orderRow.id,
      });
    }
    let written = 0;
    for (const l of payload.lines) {
      try {
        ops.upPullLine.run(normPullLine(l, target));
        written++;
      } catch (e) {
        console.error('[sync] line from order fetch failed', l?.id, e);
      }
    }
    ops.drainPendingLines(target);
    return written;
  });

  const written = write();
  console.log('[sync] reconciled order from server', {
    server_id: serverOrderId,
    local_id: target,
    lines: written,
  });
  return written;
}

/**
 * Fill in the payment method on orders that arrived before the feeds read it.
 *
 * The columns were never written by either down-feed, so a till that has been
 * running a while holds a pile of orders whose method is simply absent — they
 * print as "Unknown" on the closing report and no amount of fixing the report
 * recovers them. Nothing local can: there is no tender table, no payment link
 * and no outbox on these rows. The server is the only copy, and it has one,
 * because every order this till rang was pushed up with `payment.method_slug`.
 *
 * Deliberately NOT reconcileOrderFromServer():
 *  - that skips terminal orders to protect their status, and a third of these
 *    are DONE — exactly the closed days a shop reprints a report for;
 *  - it rewrites the header and lines, which is far more than this needs.
 * This writes two columns and only where they are empty, so it cannot regress
 * a status, a total or a line, and re-running it is harmless.
 */
export async function backfillPaymentMethods(
  limit = 200,
  opts: { auto?: boolean } = {}
): Promise<{
  scanned: number;
  updated: number;
  unresolved: number;
  failed: number;
  splitTender: number;
  linesAdded: number;
  notOnServer: number;
}> {
  if (!api) throw posError('POS_CFG_API_NOT_READY');

  // If the server has no method to give, an automatic run is one HTTP call per
  // order, every sync, forever, for nothing. One fruitless automatic pass turns
  // the automatic half off; the Settings button ignores the flag and clears it
  // the moment a repair actually lands, so the shop is never stuck with it.
  if (opts.auto && getMeta('payment.autofix_off') === '1') {
    return {
      scanned: 0,
      updated: 0,
      unresolved: 0,
      failed: 0,
      splitTender: 0,
      linesAdded: 0,
      notOnServer: 0,
    };
  }

  // Two different holes, one request each. An order can be missing its payment
  // method, its lines, or both — the seed feed supplies neither — and a single
  // GET /orders/{id} answers for all of it.
  const rows = db
    .prepare(
      `
      SELECT o.id, COALESCE(NULLIF(TRIM(o.server_id), ''), o.id) AS remote_id,
             COALESCE(NULLIF(TRIM(o.payment_method_slug), ''),
                      NULLIF(TRIM(o.payment_method_id), '')) IS NULL AS needs_method,
             NOT EXISTS (
               SELECT 1 FROM order_lines l WHERE l.order_id = o.id
             ) AS needs_lines
      FROM orders o
      WHERE COALESCE(o.grand_total, 0) > 0
        AND (
          COALESCE(NULLIF(TRIM(o.payment_method_slug), ''),
                   NULLIF(TRIM(o.payment_method_id), '')) IS NULL
          OR NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.id)
        )
      ORDER BY COALESCE(o.opened_at, 0) DESC
      LIMIT ?
    `
    )
    .all(limit) as Array<{
    id: string;
    remote_id: string;
    needs_method: number;
    needs_lines: number;
  }>;

  // COALESCE on the way in as well as the way out: between the read above and
  // the write below the cashier may have rung the order up on this till, and
  // the local answer is the better one.
  const write = db.prepare(`
    UPDATE orders
    SET payment_method_id   = COALESCE(NULLIF(TRIM(payment_method_id), ''), @payment_method_id),
        payment_method_slug = COALESCE(NULLIF(TRIM(payment_method_slug), ''), @payment_method_slug)
    WHERE id = @id
  `);

  let updated = 0;
  let unresolved = 0;
  let failed = 0;
  let splitTender = 0;
  let linesAdded = 0;
  // Two very different answers that were reported as one. "The server has no
  // method for this order" is a data question for the backend; "the server has
  // never heard of this order" is a local-only row that no repair can ever
  // reach. Telling the shop the first when it is the second sends them asking
  // the wrong people.
  let notOnServer = 0;

  /**
   * The same call that carries the payment method carries the order's lines,
   * and we were discarding them.
   *
   * The seed feed sends no lines at all (verified against the live API: 0 of
   * 65 rows), so every order that entered a till that way has a total and
   * nothing to explain it — which is why "By Item" and "By Category" print
   * empty for days that plainly had sales. Taking the lines here costs no
   * extra request.
   *
   * Only ever for an order that has NO lines locally. An order rung up on this
   * till owns its own lines and they are authoritative.
   */
  const countLines = db.prepare(
    'SELECT COUNT(*) FROM order_lines WHERE order_id = ?'
  );

  for (const row of rows) {
    let payload: Awaited<ReturnType<typeof fetchOrderFromServer>>;
    try {
      payload = await fetchOrderFromServer(row.remote_id);
    } catch (e: any) {
      // An order the server has never heard of is not a failure to report and
      // not worth retrying; anything else is a real fault worth counting.
      if (e?.code === 'POS_VAL_ORDER_NOT_FOUND') notOnServer++;
      else failed++;
      continue;
    }

    const tenders = countTenders(payload.order ?? {});
    if (tenders > 1) {
      splitTender++;
      noteSplitTender(row.remote_id, tenders);
    }

    const method = extractPaymentMethod(payload.order ?? {});
    if (row.needs_method) {
      if (method.payment_method_id || method.payment_method_slug) {
        write.run({ ...method, id: row.id });
        updated++;
      } else {
        // The server holds this order but records no method for it.
        unresolved++;
      }
    }

    try {
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      if (lines.length && Number(countLines.pluck().get(row.id) ?? 0) === 0) {
        const ops = orderSyncOps();
        const writeLines = db.transaction(() => {
          for (const l of lines) {
            ops.upPullLine.run(normPullLine(l, row.id));
            linesAdded++;
          }
        });
        writeLines();
      }
    } catch (e) {
      // Lines are a bonus on this pass; never let them cost the payment repair.
      console.error('[sync] backfill could not write lines for', row.id, e);
    }
  }

  // Scanned orders but recovered nothing: the server does not return a method
  // on this endpoint, and no amount of retrying changes that.
  //
  // `!failed` matters. A network blip or a 5xx also recovers nothing, and
  // latching the automatic pass off for that would mean one bad Wi-Fi moment
  // silently disables the repair until somebody finds the Settings button
  // months later. Only a clean run that genuinely had nothing to take counts.
  if (rows.length && !updated && !linesAdded && !failed && !notOnServer) {
    if (opts.auto) setMeta('payment.autofix_off', '1');
  } else if (updated || linesAdded) {
    setMeta('payment.autofix_off', '0');
  }

  console.log('[sync] payment method backfill', {
    scanned: rows.length,
    updated,
    unresolved,
    failed,
    splitTender,
    linesAdded,
    notOnServer,
    auto: !!opts.auto,
  });
  return {
    scanned: rows.length,
    updated,
    unresolved,
    failed,
    splitTender,
    linesAdded,
    notOnServer,
  };
}

export async function pullChanges() {
  const cursorRow = db
    .prepare('SELECT value FROM sync_state WHERE key = ?')
    .pluck()
    .get('cursor') as string | undefined;
  const cursor = Number(cursorRow ?? 0);

  const { data } = await api.post('/pull', { cursor });

  const changedItemIds: string[] = [];

  const apply = db.transaction((changes: any[]) => {
    const upItem = db.prepare(`
      INSERT INTO items (
        id,
        category_id,
        subcategory_id,
        name,
        name_ar,
        barcode,
        price,
        image,
        size,
        has_variations,
        has_addons,
        type,
        is_outofstock,
        branch_id,
        updated_at
      ) VALUES (
        @id,
        @category_id,
        @subcategory_id,
        @name,
        @name_ar,
        @barcode,
        @price,
        @image,
        @size,
        @has_variations,
        @has_addons,
        @type,
        @is_outofstock,
        @branch_id,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        category_id    = excluded.category_id,
        subcategory_id = excluded.subcategory_id,
        name           = excluded.name,
        name_ar        = excluded.name_ar,
        barcode        = excluded.barcode,
        price          = excluded.price,
        image          = excluded.image,
        size           = excluded.size,
        has_variations = excluded.has_variations,
        has_addons     = excluded.has_addons,
        type           = excluded.type,
        is_outofstock  = excluded.is_outofstock,
        branch_id      = excluded.branch_id,
        updated_at     = excluded.updated_at
    `);

    const upVar = db.prepare(`
      INSERT INTO variations (id,item_id,name,name_ar,price,sale_price,updated_at)
      VALUES (@id,@item_id,@name,@name_ar,@price,@sale_price,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        item_id=excluded.item_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        price=excluded.price,
        sale_price=excluded.sale_price,
        updated_at=excluded.updated_at
    `);
    const upPromo = db.prepare(`
      INSERT INTO promos (id,code,type,value,min_total,max_discount,start_at,end_at,active,updated_at)
      VALUES (@id,@code,@type,@value,@min_total,@max_discount,@start_at,@end_at,@active,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        code=excluded.code,type=excluded.type,value=excluded.value,min_total=excluded.min_total,max_discount=excluded.max_discount,
        start_at=excluded.start_at,end_at=excluded.end_at,active=excluded.active,updated_at=excluded.updated_at
    `);
    // Categories and subcategories were missing from the change feed entirely,
    // so a category deleted (or renamed) in the back office stayed on the till
    // forever. They are visible on the main POS screen, which made it obvious.
    const upCatPull = db.prepare(`
      INSERT INTO categories (id,name,name_ar,position,visible,updated_at)
      VALUES (@id,@name,@name_ar,@position,@visible,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, name_ar=excluded.name_ar,
        position=excluded.position, visible=excluded.visible,
        updated_at=excluded.updated_at
    `);
    const upSubPull = db.prepare(`
      INSERT INTO subcategories (id,category_id,name,name_ar,position,visible,updated_at)
      VALUES (@id,@category_id,@name,@name_ar,@position,@visible,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        category_id=excluded.category_id,
        name=excluded.name, name_ar=excluded.name_ar,
        position=excluded.position, visible=excluded.visible,
        updated_at=excluded.updated_at
    `);

    const upPromoEx = db.prepare(`
      INSERT INTO promo_item_exclusions (promo_id,item_id)
      VALUES (@promo_id,@item_id)
      ON CONFLICT(promo_id,item_id) DO NOTHING
    `);
    const upGroup = db.prepare(`
      INSERT INTO addon_groups (id,name,name_ar,is_required,max_select,updated_at)
      VALUES (@id,@name,@name_ar,@is_required,@max_select,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,name_ar=excluded.name_ar,is_required=excluded.is_required,max_select=excluded.max_select,updated_at=excluded.updated_at
    `);
    const upAddon = db.prepare(`
      INSERT INTO addons (id,group_id,name,name_ar,price,updated_at)
      VALUES (@id,@group_id,@name,@name_ar,@price,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        group_id=excluded.group_id,name=excluded.name,name_ar=excluded.name_ar,price=excluded.price,updated_at=excluded.updated_at
    `);
    const upItemAddonGroup = db.prepare(`
      INSERT INTO item_addon_groups (id,item_id,group_id,is_required,max_select,updated_at)
      VALUES (@id,@item_id,@group_id,@is_required,@max_select,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        item_id=excluded.item_id,group_id=excluded.group_id,is_required=excluded.is_required,max_select=excluded.max_select,updated_at=excluded.updated_at
    `);
    const upUser = db.prepare(`
      INSERT INTO pos_users (
        id,
        name,
        username,
        email,
        mobile,
        role,
        password_hash,
        is_active,
        branch_id,
        updated_at
      ) VALUES (
        @id,
        @name,
        @username,
        lower(@email),
        @mobile,
        @role,
        @password_hash,
        @is_active,
        @branch_id,
        @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name          = excluded.name,
        username      = excluded.username,
        email         = excluded.email,
        mobile        = excluded.mobile,
        role          = excluded.role,
        password_hash = excluded.password_hash,
        is_active     = excluded.is_active,
        branch_id     = excluded.branch_id,
        updated_at    = excluded.updated_at
    `);

    const {
      upPullOrder,
      upPullLine,
      parkLine,
      resolveLocalOrder,
      drainPendingLines,
    } = orderSyncOps();

    const delBy = (table: string, pk: any) =>
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(S(pk));

    for (const c of changes) {
      const op = c.op;
      const tbl = String(c.table || '').toLowerCase();

      if (tbl === 'item' || tbl === 'items') {
        if (op === 'delete') {
          delBy('items', c.pk);
        } else if (c.data) {
          upItem.run(normItem(c.data));
          changedItemIds.push(String(c.data.id));
        }
      } else if (
        tbl === 'variation' ||
        tbl === 'variations' ||
        tbl === 'item_variations'
      ) {
        if (op === 'delete') delBy('variations', c.pk);
        else if (c.data) upVar.run(normVariation(c.data));
      } else if (tbl === 'promocode' || tbl === 'promos') {
        if (op === 'delete') delBy('promos', c.pk);
        else if (c.data) upPromo.run(normPromo(c.data));
      } else if (tbl === 'item_promocode' || tbl === 'promo_item_exclusions') {
        if (op === 'delete') {
          // support pk as [promo_id,item_id] OR object OR rely on data
          let promoId: any, itemId: any;
          if (Array.isArray(c.pk) && c.pk.length >= 2) {
            [promoId, itemId] = c.pk;
          } else if (c.pk && typeof c.pk === 'object') {
            promoId = c.pk.promo_id ?? c.pk.promocode_id;
            itemId = c.pk.item_id;
          } else if (c.data) {
            promoId = c.data.promo_id ?? c.data.promocode_id;
            itemId = c.data.item_id;
          }
          if (promoId != null && itemId != null) {
            db.prepare(
              `DELETE FROM promo_item_exclusions WHERE promo_id = ? AND item_id = ?`
            ).run(S(promoId), S(itemId));
          }
        } else if (c.data) {
          upPromoEx.run({
            promo_id: S(c.data.promo_id ?? c.data.promocode_id)!,
            item_id: S(c.data.item_id)!,
          });
        }
      } else if (tbl === 'addons_group' || tbl === 'addon_groups') {
        if (op === 'delete') delBy('addon_groups', c.pk);
        else if (c.data) upGroup.run(normGroup(c.data));
      } else if (tbl === 'addons' || tbl === 'addon') {
        if (op === 'delete') delBy('addons', c.pk);
        else if (c.data) upAddon.run(normAddon(c.data));
      } else if (tbl === 'item_addons_group' || tbl === 'item_addon_groups') {
        if (op === 'delete') delBy('item_addon_groups', c.pk);
        else if (c.data) {
          // Same orphan guard as bootstrap: a link whose item or group was
          // never sent would abort this whole pull transaction.
          const link = normItemAddonGroup(c.data);
          const parentsExist =
            db.prepare('SELECT 1 FROM items WHERE id=?').pluck().get(link.item_id) &&
            db
              .prepare('SELECT 1 FROM addon_groups WHERE id=?')
              .pluck()
              .get(link.group_id);
          if (parentsExist) upItemAddonGroup.run(link);
          else
            console.warn(
              `[SYNC] pull: skipped item add-on link ${link.id} — no matching item or addon group`
            );
        }
      } else if (tbl === 'pos_user' || tbl === 'pos_users') {
        if (op === 'delete') delBy('pos_users', c.pk);
        else if (c.data) upUser.run(normUser(c.data));
      } else if (
        tbl === 'role_permission' ||
        tbl === 'role_permissions' ||
        tbl === 'pos_role_permissions'
      ) {
        // The row is keyed on (role, permission), not on a single id, so both
        // halves have to come off `data`. A delete carrying only a scalar pk
        // cannot be resolved to a row here — it is logged rather than guessed
        // at, because deleting the wrong permission fails open.
        const role = String(c.data?.role ?? '').trim().toLowerCase();
        const permission = String(c.data?.permission ?? '').trim();
        if (!role || !permission) {
          console.warn('[sync] role permission change without role/permission', {
            op,
            pk: c.pk,
          });
        } else if (op === 'delete') {
          db.prepare(
            'DELETE FROM pos_role_permissions WHERE role = ? AND permission = ?'
          ).run(role, permission);
        } else {
          db.prepare(
            `INSERT OR REPLACE INTO pos_role_permissions
               (role, permission, allowed, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(
            role,
            permission,
            c.data?.allowed ? 1 : 0,
            c.data?.updated_by ?? null,
            Number(c.data?.updated_at) || Date.now()
          );
        }
        // Any role-permission traffic at all means the back office owns them.
        db.prepare(
          `INSERT INTO sync_state(key,value) VALUES('permissions.source','server')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run();
      } else if (tbl === 'category' || tbl === 'categories') {
        if (op === 'delete') {
          // Subcategories and items hang off the category; drop them too so
          // the grid cannot show orphans pointing at a category that is gone.
          db.prepare(`DELETE FROM subcategories WHERE category_id = ?`).run(
            S(c.pk)
          );
          delBy('categories', c.pk);
        } else if (c.data) {
          upCatPull.run(normCategory(c.data));
        }
      } else if (tbl === 'subcategory' || tbl === 'subcategories') {
        if (op === 'delete') delBy('subcategories', c.pk);
        else if (c.data) upSubPull.run(normSubcat(c.data));
      } else if (tbl === 'table' || tbl === 'tables') {
        if (op === 'delete') delBy('tables', c.pk);
        else if (c.data) db.prepare(
          `INSERT INTO tables (id,branch_id,label,number,capacity,is_available,updated_at)
           VALUES (@id,@branch_id,@label,@number,@capacity,@is_available,@updated_at)
           ON CONFLICT(id) DO UPDATE SET
             branch_id=excluded.branch_id, label=excluded.label,
             number=excluded.number, capacity=excluded.capacity,
             is_available=excluded.is_available, updated_at=excluded.updated_at`
        ).run(normTable(c.data));
      } else if (
        tbl === 'setting' ||
        tbl === 'settings' ||
        tbl === 'app_setting' ||
        tbl === 'app_settings' ||
        tbl === 'about_us' ||
        tbl === 'branding'
      ) {
        // Settings were written by bootstrap() and by nothing else, so a change
        // to one never reached a till that had already bootstrapped — it fell
        // through this chain into "unhandled" and was dropped. That is why an
        // operator logo uploaded after a till was set up never appeared on its
        // receipts: the URL lived in app_settings and only a full re-bootstrap
        // would fetch it.
        if (op === 'delete') {
          if (c.pk != null) {
            db.prepare('DELETE FROM app_settings WHERE key = ?').run(S(c.pk));
          }
        } else if (c.data) {
          // The feed has sent these as a single {key,value} and as a bag of
          // key/value pairs, depending on the source table.
          const rows =
            c.data.key != null
              ? [c.data]
              : Object.entries(c.data).map(([key, value]) => ({ key, value }));
          const upSet = db.prepare(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `);
          for (const r of rows) {
            if (r?.key == null) continue;
            upSet.run(
              String(r.key),
              r.value == null ? '' : String(r.value),
              r.updated_at ? String(r.updated_at) : String(Date.now())
            );
          }
        }
      } else if (tbl === 'order' || tbl === 'orders') {
        // A sale is never deleted locally off the feed: the till's own record
        // of what it sold outlives an admin removing the row upstream.
        if (op === 'delete') {
          console.warn('[sync] ignoring order delete from feed', { pk: c.pk });
        } else if (c.data) {
          const row = normPullOrder(c.data);
          const found = resolveLocalOrder(row.id, row.number || null);

          if (isTerminalLocalOrder(found.row)) {
            // See TERMINAL_STATUS_CODES. An office edit made while this till
            // was offline must not reopen a ticket the till already finished.
            console.log('[sync] skipping update to finalized order', {
              number: row.number,
              local_status: found.row.status,
              incoming_status: row.status,
            });
          } else {
            const target = found.localId ?? row.id;
            upPullOrder.run({
              ...row,
              id: target,
              updated_at: Date.now(),
              server_id: row.id,
            });
            drainPendingLines(target);
          }
        }
      } else if (
        tbl === 'order_line' ||
        tbl === 'order_lines' ||
        tbl === 'order_detail' ||
        tbl === 'order_details'
      ) {
        // Both names are handled on purpose: the server emits `order_details`
        // today and may rewrite it to `order_lines` on the wire, the way it
        // already rewrites pos_user_permissions to users. Accepting both means
        // the rename can land on either side, in either order, with no gap.
        if (op === 'delete') {
          delBy('order_lines', c.pk);
          db.prepare('DELETE FROM order_lines_pending WHERE id = ?').run(S(c.pk));
        } else if (c.data) {
          const serverOrderId = S(c.data.order_id);
          const number = S(c.data.order_number) || null;
          const found = serverOrderId
            ? resolveLocalOrder(serverOrderId, number)
            : { row: null, localId: null, isLocalOrigin: false };

          if (found.isLocalOrigin) {
            // This till rang the order up; its own lines are authoritative and
            // the echo would duplicate them under the server's line ids.
            console.log('[sync] ignoring line for locally-created order', {
              number,
            });
          } else if (found.localId) {
            upPullLine.run(normPullLine(c.data, found.localId));
          } else if (serverOrderId) {
            // Header not here yet — park it rather than insert and trip the FK.
            parkLine.run({
              id: S(c.data.id),
              order_id: serverOrderId,
              payload: JSON.stringify(c.data),
              received_at: Date.now(),
            });
          }
        }
      } else if (tbl === 'branch' || tbl === 'branches') {
        // The feed is already scoped — a device only ever receives its own
        // branch — but a row for some other branch would silently rewrite this
        // till's receipt footer, so the id is checked rather than assumed.
        const ownBranchId = String(getMeta('branch.id') ?? getMeta('branch_id') ?? '');
        const rowBranchId = S(c.data?.id ?? c.pk) ?? '';

        if (ownBranchId && rowBranchId && ownBranchId !== rowBranchId) {
          console.warn('[sync] ignoring branch row for another branch', {
            own: ownBranchId,
            row: rowBranchId,
          });
        } else if (op === 'delete') {
          // The branch this till sells for is gone upstream. Lock rather than
          // unpair or wipe: the outbox may still hold sales nobody has banked,
          // and those have to survive for an operator to recover. A locked
          // till stops selling, which is the point — it must not keep printing
          // a footer for a shop that no longer exists.
          setMeta('pos.locked', '1');
          setMeta('pos.lock_reason', 'branch_removed');
          setMeta(BRANCH_PROFILE_META_KEY, '');
          console.warn('[sync] branch deleted upstream → locking till', {
            pk: c.pk,
          });
        } else if (persistBranchProfile(c.data)) {
          // The branch is back (restored upstream, or this till reassigned).
          // The feed that locked the till is the only thing that can lift it:
          // the device-state check in clearPosLock() deliberately will not.
          if (getMeta('pos.lock_reason') === 'branch_removed') {
            setMeta('pos.locked', '0');
            setMeta('pos.lock_reason', '');
            setMeta('pos.locked_at', '');
            console.log('[sync] branch restored → till unlocked');
          }
        } else {
          console.warn('[sync] branch change with no usable row', { pk: c.pk });
        }
      } else if (tbl === 'payment_method' || tbl === 'payment_methods') {
        if (op === 'delete') delBy('payment_methods', c.pk);
      } else if (tbl === 'state' || tbl === 'states') {
        if (op === 'delete') delBy('states', c.pk);
      } else if (tbl === 'city' || tbl === 'cities') {
        if (op === 'delete') delBy('cities', c.pk);
      } else if (tbl === 'block' || tbl === 'blocks') {
        if (op === 'delete') delBy('blocks', c.pk);
      } else if (op === 'delete') {
        console.warn('[sync] unhandled delete in change feed', {
          table: tbl,
          pk: c.pk,
        });
      }
      // (extend for other tables if your /pull adds them)
    }

    db.prepare(
      `
      INSERT INTO sync_state(key,value) VALUES('cursor',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `
    ).run(String(data.cursor ?? cursor));
  });

  apply(data.changes ?? []);
  markSyncedNow();

  if (changedItemIds.length) {
    await prefetchItemImages([...new Set(changedItemIds)], 6);
  }
  try {
    await syncPosTime();
  } catch (err) {
    console.error('[SYNC] syncPosTime() failed during pullChanges:', err);
  }
}

/* ---------- Push (orders/payments) ---------- */
export async function pushOutbox(
  envelope: { client_msg_id: string },
  batch: { orders: any[]; payments?: any[] }
) {
  // Also in the envelope, not only the header. Order rows record the build
  // that rang them, and without this the server fell back to deriving a name
  // from client_msg_id — which is where the meaningless "pos-1" in
  // device_info came from.
  const { data } = await api.post('/push', {
    envelope: { ...envelope, app_version: appVersion() },
    ...batch,
  });
  markSyncedNow();
  return data;
}
