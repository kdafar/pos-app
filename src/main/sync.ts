import axios, { AxiosInstance } from 'axios';
import db, { getMeta, setMeta } from './db';
import { deleteSecret, loadSecret, saveSecret } from './secureStore';
import { prefetchItemImages } from './imageCache';
import { app } from 'electron';

import { posError } from '../shared/errorCodes';
type Device = { id: string; branch_id: number };

// ---------- Auth error ----------
export class AuthError extends Error {
  constructor(message = 'Authentication failed, please re-pair.') {
    super(message);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

let api: AxiosInstance;

export function configureApi(baseUrl: string, device: Device, token: string) {
  api = axios.create({
    baseURL: baseUrl.replace(/\/+$/, '') + '/api/pos',
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Pos-Device': device.id,
      // Rides on every request — push, pull and bootstrap — so the server can
      // see which build a till is running without the till having to report it
      // separately, and without a version-specific endpoint to keep in step.
      'X-Pos-Version': app.getVersion(),
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

function normOrderSeed(o: any) {
  return {
    id: S(o.id)!,
    number: S(o.number) || '',
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
  const pairingApi = axios.create({
    baseURL: baseUrl.replace(/\/+$/, '') + '/api/pos',
    timeout: 15000,
  });

  const { data } = await pairingApi.post('/register', {
    code: pairCode,
    branch_id: branchId,
    name: deviceName,
    machine_id: machineId,
    // Known from the first contact, so a device that never syncs again still
    // has a recorded version.
    app_version: app.getVersion(),
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

  // persist branch meta for UI
  if (data?.branch?.id != null) {
    setMeta('branch_id', String(data.branch.id));
    setMeta('branch.id', String(data.branch.id));
  }
  if (data?.branch?.name) {
    setMeta('branch.name', String(data.branch.name));
  }

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
      INSERT INTO orders (id, number, reference_no, opened_at, created_at, order_type, status, status_code, mobile, full_name, grand_total)
      VALUES (@id, @number, @reference_no, COALESCE(@opened_at, strftime('%s','now')*1000), @created_at, @order_type, @status, @status_code, @mobile, @full_name, @grand_total)
      ON CONFLICT(id) DO UPDATE SET
        number      = excluded.number,
        reference_no = COALESCE(excluded.reference_no, reference_no),
        opened_at   = COALESCE(excluded.opened_at, opened_at),
        created_at  = COALESCE(excluded.created_at, created_at),
        order_type  = excluded.order_type,
        status      = excluded.status,
        status_code = excluded.status_code,
        mobile      = excluded.mobile,
        full_name   = excluded.full_name,
        grand_total = excluded.grand_total
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
  const { data } = await api.post('/push', { envelope, ...batch });
  markSyncedNow();
  return data;
}
