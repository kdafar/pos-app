import axios, { AxiosInstance } from 'axios';
import db, { getMeta, setMeta } from './db';
import { deleteSecret, loadSecret, saveSecret } from './secureStore';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ipcMain } from 'electron';

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
    },
  });

  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (error?.response && (error.response.status === 401 || error.response.status === 403)) {
        // Device revoked/expired
        await deleteSecret('device_token');
        setMeta('device_id', '');
        throw new AuthError();
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
const N = (v: any) => (v === undefined || v === null || v === '' ? 0 : Number(v));
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
    type: S(it.type),
    is_outofstock: B(it.is_outofstock),
    branch_id: it.branch_id === null || it.branch_id === undefined ? null : N(it.branch_id),
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
    sale_price: v.sale_price === null || v.sale_price === undefined ? null : N(v.sale_price),
    updated_at: S(v.updated_at),
  };
}

function normItemAddonGroup(m: any) {
  return {
    id: S(m.id)!,
    item_id: S(m.item_id)!,
    group_id: S(m.group_id)!,
    is_required: B(m.is_required),
    max_select: m.max_select === null || m.max_select === undefined ? null : N(m.max_select),
    updated_at: S(m.updated_at),
  };
}

function normPromo(p: any) {
  return {
    id: S(p.id)!,
    code: S(p.code) ?? '',
    type: S(p.type) ?? 'percent', // server uses percent (offer_amount)
    value: N(p.value),
    min_total: N(p.min_total),
    max_discount: p.max_discount === null || p.max_discount === undefined ? null : N(p.max_discount),
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

function normOrderSeed(o: any) {
  return {
    id: S(o.id)!,
    number: S(o.number) || '',
    created_at: S(o.created_at), // ISO
    opened_at: o.created_at ? Date.parse(o.created_at) : null, // ms (fallback)
    order_type: N(o.order_type),
    status: N(o.status),
    mobile: S(o.mobile) || '',
    full_name: S(o.full_name) || '',
    grand_total: N(o.grand_total),
  };
}

/* ---------- Pairing ---------- */
export async function pairDevice(baseUrl: string, pairCode: string, branchId: string, deviceName: string, machineId: string) {
  const pairingApi = axios.create({
    baseURL: baseUrl.replace(/\/+$/, '') + '/api/pos',
    timeout: 15000,
  });

  const { data } = await pairingApi.post('/register', {
    code: pairCode,
    branch_id: branchId,
    name: deviceName,
    machine_id: machineId,
  });

  if (!data.device?.id || !data.token) {
    throw new Error('Invalid response from server during pairing.');
  }

  setMeta('device_id', data.device.id);
  setMeta('server.base_url', baseUrl);
  if (data.device.branch_id) setMeta('branch_id', String(data.device.branch_id));
  await saveSecret('device_token', data.token);

  return { deviceId: data.device.id, branchId: data.device.branch_id };
}

/* ---------- Bootstrap (full catalog seed) ---------- */
export async function bootstrap(baseUrl: string) {
  const deviceId = getMeta('device_id') ?? '';
  const token = await loadSecret('device_token');
  const branchId = Number(getMeta('branch_id') ?? 0);
  if (!deviceId || !token) throw new Error('Not paired');

  const device = { id: deviceId, branch_id: branchId };
  configureApi(baseUrl, device, token);

  const { data } = await api.get('/bootstrap');

  // persist branch meta for UI
  if (data?.branch?.id != null) {
    setMeta('branch_id', String(data.branch.id));
    setMeta('branch.id', String(data.branch.id));
  }
  if (data?.branch?.name) {
    setMeta('branch.name', String(data.branch.name));
  }

  const catalog = data.catalog ?? data;
  const asArray = (x: any): any[] => (Array.isArray(x) ? x : x ? Object.values(x) : []);

  const items = asArray(catalog.items ?? catalog.item);
  const itemVariations = asArray(catalog.item_variations ?? catalog.variations ?? []);
  const itemAddonGroups = asArray(catalog.item_addon_groups ?? []);
  const promos = asArray(catalog.promos ?? catalog.promo_codes);
  const promoExclusions = asArray(catalog.promo_exclusions ?? []);
  const groups = asArray(catalog.addons ?? catalog.addon_groups ?? catalog.addons_groups);
  const categories = asArray(catalog.categories);
  const payMethods = asArray(catalog.payment_methods ?? catalog.web_payment_methods ?? catalog.payments);
  const settings = asArray(catalog.settings ?? []);
  const states = asArray(catalog.states ?? []);
  const cities = asArray(catalog.cities ?? []);
  const blocks = asArray(catalog.blocks ?? []);
  const subcats = asArray(catalog.subcategories ?? []);
  const ordersSeed = asArray(catalog.orders_seed ?? []);
  const tables = asArray(catalog.tables ?? catalog.table_list ?? []);

  const tx = db.transaction(() => {
    // items
    const upItem = db.prepare(`
      INSERT INTO items (
        id,category_id,subcategory_id,name,name_ar,barcode,price,image,size,has_variations,type,is_outofstock,branch_id,updated_at
      ) VALUES (
        @id,@category_id,@subcategory_id,@name,@name_ar,@barcode,@price,@image,@size,@has_variations,@type,@is_outofstock,@branch_id,@updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        category_id=excluded.category_id,
        subcategory_id=excluded.subcategory_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        barcode=excluded.barcode,
        price=excluded.price,
        image=excluded.image,
        size=excluded.size,
        has_variations=excluded.has_variations,
        type=excluded.type,
        is_outofstock=excluded.is_outofstock,
        branch_id=excluded.branch_id,
        updated_at=excluded.updated_at
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
    for (const m of itemAddonGroups) upItemAddonGroup.run(normItemAddonGroup(m));

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
      INSERT INTO payment_methods (id,slug,name_en,name_ar,legacy_code,is_active,sort_order,updated_at)
      VALUES (@id,@slug,@name_en,@name_ar,@legacy_code,@is_active,@sort_order,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug,
        name_en=excluded.name_en,
        name_ar=excluded.name_ar,
        legacy_code=excluded.legacy_code,
        is_active=excluded.is_active,
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
      upSetting.run(String(s.key), String(s.value ?? ''), s.updated_at ? String(s.updated_at) : null);
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

    // recent orders seed (for phone lookup)
    const upOrderSeed = db.prepare(`
      INSERT INTO orders (id, number, opened_at, created_at, order_type, status, mobile, full_name, grand_total)
      VALUES (@id, @number, COALESCE(@opened_at, strftime('%s','now')*1000), @created_at, @order_type, @status, @mobile, @full_name, @grand_total)
      ON CONFLICT(id) DO UPDATE SET
        number      = excluded.number,
        opened_at   = COALESCE(excluded.opened_at, opened_at),
        created_at  = COALESCE(excluded.created_at, created_at),
        order_type  = excluded.order_type,
        status      = excluded.status,
        mobile      = excluded.mobile,
        full_name   = excluded.full_name,
        grand_total = excluded.grand_total
    `);
    for (const o of ordersSeed) upOrderSeed.run(normOrderSeed(o));

    // cursor
    db.prepare(`
      INSERT INTO sync_state(key,value) VALUES('cursor',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(String(data.cursor ?? 0));
  });

  tx();
  markSyncedNow();
}

/* ---------- Pull (incremental) ---------- */
export async function pullChanges() {
  const cursorRow = db.prepare('SELECT value FROM sync_state WHERE key = ?').pluck().get('cursor') as string | undefined;
  const cursor = Number(cursorRow ?? 0);

  const { data } = await api.post('/pull', { cursor });

  const apply = db.transaction((changes: any[]) => {
    const upItem = db.prepare(`
      INSERT INTO items (
        id,category_id,subcategory_id,name,name_ar,barcode,price,image,size,has_variations,type,is_outofstock,branch_id,updated_at
      ) VALUES (
        @id,@category_id,@subcategory_id,@name,@name_ar,@barcode,@price,@image,@size,@has_variations,@type,@is_outofstock,@branch_id,@updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        category_id=excluded.category_id,
        subcategory_id=excluded.subcategory_id,
        name=excluded.name,
        name_ar=excluded.name_ar,
        barcode=excluded.barcode,
        price=excluded.price,
        image=excluded.image,
        size=excluded.size,
        has_variations=excluded.has_variations,
        type=excluded.type,
        is_outofstock=excluded.is_outofstock,
        branch_id=excluded.branch_id,
        updated_at=excluded.updated_at
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

    for (const c of changes) {
      const op = c.op;
      const tbl = String(c.table || '').toLowerCase();

      // helper delete by id (pk) with fallback composite handling for promo exclusions
      const delBy = (table: string, pk: any) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(S(pk));

      if (tbl === 'item' || tbl === 'items') {
        if (op === 'delete') delBy('items', c.pk);
        else if (c.data) upItem.run(normItem(c.data));
      } else if (tbl === 'variation' || tbl === 'variations' || tbl === 'item_variations') {
        if (op === 'delete') delBy('variations', c.pk);
        else if (c.data) upVar.run(normVariation(c.data));
      } else if (tbl === 'promocode' || tbl === 'promos') {
        if (op === 'delete') delBy('promos', c.pk);
        else if (c.data) upPromo.run(normPromo(c.data));
      } else if (tbl === 'item_promocode' || tbl === 'promo_item_exclusions') {
        if (op === 'delete') {
          // expect pk to contain promo_id & item_id in data or in pk tuple
          const row = c.data ?? {};
          db.prepare(`DELETE FROM promo_item_exclusions WHERE promo_id = ? AND item_id = ?`)
            .run(S(row.promo_id ?? row.promocode_id), S(row.item_id));
        } else if (c.data) {
          const row = {
            promo_id: S(c.data.promo_id ?? c.data.promocode_id)!,
            item_id: S(c.data.item_id)!,
          };
          upPromoEx.run(row);
        }
      } else if (tbl === 'addons_group' || tbl === 'addon_groups') {
        if (op === 'delete') delBy('addon_groups', c.pk);
        else if (c.data) upGroup.run(normGroup(c.data));
      } else if (tbl === 'addons' || tbl === 'addon') {
        if (op === 'delete') delBy('addons', c.pk);
        else if (c.data) upAddon.run(normAddon(c.data));
      } else if (tbl === 'item_addons_group' || tbl === 'item_addon_groups') {
        if (op === 'delete') delBy('item_addon_groups', c.pk);
        else if (c.data) upItemAddonGroup.run(normItemAddonGroup(c.data));
      }
      // Extend here for categories, tables, states, cities, blocks, subcategories if your /pull returns them.
    }

    db.prepare(`
      INSERT INTO sync_state(key,value) VALUES('cursor',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `).run(String(data.cursor ?? cursor));
  });

  apply(data.changes ?? []);
  markSyncedNow();
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
