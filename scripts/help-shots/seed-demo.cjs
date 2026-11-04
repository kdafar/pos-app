// scripts/help-shots/seed-demo.cjs
//
// Fills the isolated "demo" till profile with made-up data for the help-guide
// screenshots: shop "Majestic" / "ماجستك", invented dishes, invented staff.
// NO real customers, phone numbers or orders — ever.
//
// It refuses to touch any database that is not the demo profile's, so it can
// never write into a real till. Run it through shoot.cjs, which launches the
// app once first so the schema exists.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DIR = path.join(process.env.APPDATA, 'POS App (demo)');
const DB_PATH = path.join(DIR, 'pos.db');

if (!DB_PATH.includes('(demo)')) throw new Error('refusing: not the demo profile');
if (!fs.existsSync(DB_PATH)) throw new Error(`no demo database yet at ${DB_PATH} — launch once first`);

const db = new Database(DB_PATH);
const now = new Date().toISOString();
const PASSWORD = 'demo1234';
const MANAGER_CODE = '246810';

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
function put(table, row) {
  const have = cols(table);
  const keys = Object.keys(row).filter((k) => have.includes(k));
  db.prepare(
    `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
  ).run(...keys.map((k) => row[k]));
}
function wipe(...tables) {
  for (const t of tables) {
    try {
      db.prepare(`DELETE FROM ${t}`).run();
    } catch {
      /* table absent in this schema version */
    }
  }
}
function kv(key, value) {
  put('meta', { key, value });
  put('sync_state', { key, value });
}

db.transaction(() => {
  wipe(
    'orders', 'order_lines', 'active_orders', 'pos_action_log', 'order_approvals',
    'order_paid_actions', 'auth_sessions', 'pos_users', 'categories', 'subcategories',
    'items', 'variations', 'addon_groups', 'addons', 'item_addon_groups', 'promos',
    'payment_methods', 'states', 'cities', 'blocks', 'tables', 'table_sections',
    'business_days', 'day_close_actions'
  );

  /* ---------- device: paired to a server that is not there ---------- */
  // 127.0.0.1:9 refuses at once, so the till never reaches a real server.
  kv('server.base_url', 'http://127.0.0.1:9');
  kv('device_id', 'demo-till-1');
  kv('branch_id', '1');
  kv('branch.name', 'Majestic');
  kv('pos.mode', 'live');
  kv('bootstrap.done', '1');
  kv('paid.supported', '1');
  kv('sync.last_at', String(Date.now()));
  kv(
    'branch.profile',
    JSON.stringify({
      id: '1',
      name: 'Majestic',
      name_ar: 'ماجستك',
      phone: '',
      address: '',
      address_ar: '',
      duty_time_from: null,
      duty_time_to: null,
      invoice_note: '',
      invoice_note_ar: '',
      show_change_on_receipt: true,
      updated_at: now,
    })
  );

  /* ---------- staff (invented) ---------- */
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const code = bcrypt.hashSync(MANAGER_CODE, 10);
  const staff = [
    { id: 101, name: 'Sara Cashier', role: 'pos' },
    { id: 102, name: 'Omar Kitchen', role: 'kitchen' },
    { id: 103, name: 'Huda Manager', role: 'manager', approval: true },
  ];
  for (const s of staff)
    put('pos_users', {
      id: s.id,
      name: s.name,
      username: s.name.split(' ')[0].toLowerCase(),
      email: `${s.name.split(' ')[0].toLowerCase()}@majestic.example`,
      role: s.role,
      password_hash: hash,
      is_active: 1,
      branch_id: 1,
      approval_code_hash: s.approval ? code : null,
      approval_code_set: s.approval ? 1 : 0,
      updated_at: now,
    });

  /* ---------- menu (invented) ---------- */
  const cats = [
    ['c1', 'Burgers', 'برجر'],
    ['c2', 'Sides', 'مقبلات'],
    ['c3', 'Drinks', 'مشروبات'],
    ['c4', 'Desserts', 'حلويات'],
  ];
  cats.forEach(([id, name, name_ar], i) =>
    put('categories', { id, name, name_ar, position: i, visible: 1, updated_at: now })
  );
  const items = [
    ['i1', 'c1', 'Classic Burger', 'برجر كلاسيك', 2.5, { has_addons: 1, has_variations: 1 }],
    ['i2', 'c1', 'Chicken Burger', 'برجر دجاج', 2.25, { has_addons: 1 }],
    ['i3', 'c1', 'Veggie Burger', 'برجر نباتي', 2.0, {}],
    ['i4', 'c2', 'Fries', 'بطاطس', 0.75, { has_variations: 1 }],
    ['i5', 'c2', 'Onion Rings', 'حلقات بصل', 1.0, {}],
    ['i6', 'c3', 'Orange Juice', 'عصير برتقال', 1.0, {}],
    ['i7', 'c3', 'Lemon Mint', 'ليمون نعناع', 1.25, {}],
    ['i8', 'c3', 'Water', 'ماء', 0.2, { barcode: '6200000000017' }],
    ['i9', 'c4', 'Kunafa', 'كنافة', 1.75, {}],
    ['i10', 'c4', 'Chocolate Cake', 'كيكة شوكولاتة', 1.5, { is_outofstock: 1 }],
  ];
  for (const [id, category_id, name, name_ar, price, extra] of items)
    put('items', {
      id, category_id, name, name_ar, price,
      is_outofstock: 0, has_variations: 0, has_addons: 0, branch_id: 1, updated_at: now,
      ...extra,
    });
  put('variations', { id: 'v3', item_id: 'i1', name: 'Single', name_ar: 'سنقل', price: 2.5, updated_at: now });
  put('variations', { id: 'v4', item_id: 'i1', name: 'Double', name_ar: 'دبل', price: 3.25, updated_at: now });
  put('variations', { id: 'v1', item_id: 'i4', name: 'Small', name_ar: 'صغير', price: 0.75, updated_at: now });
  put('variations', { id: 'v2', item_id: 'i4', name: 'Large', name_ar: 'كبير', price: 1.0, updated_at: now });
  put('addon_groups', { id: 'g1', name: 'Extras', name_ar: 'إضافات', is_required: 0, max_select: 3, updated_at: now });
  [
    ['a1', 'Cheese', 'جبن', 0.25],
    ['a2', 'Jalapeño', 'هالبينو', 0.15],
    ['a3', 'Extra sauce', 'صوص إضافي', 0.1],
  ].forEach(([id, name, name_ar, price]) =>
    put('addons', { id, group_id: 'g1', name, name_ar, price, updated_at: now })
  );
  for (const item of ['i1', 'i2'])
    put('item_addon_groups', { id: `${item}-g1`, item_id: item, group_id: 'g1', is_required: 0, max_select: 3, updated_at: now });

  put('promos', {
    id: 'p1', code: 'WELCOME10', type: 'percent', value: 10, min_total: 3,
    start_at: '2026-01-01 00:00:00', end_at: '2030-12-31 23:59:59', active: 1, updated_at: now,
  });

  /* ---------- payment ---------- */
  [
    ['pm1', 'cash', 'Cash', 'نقدي', 0],
    ['pm2', 'knet', 'KNET', 'كي نت', 0],
    ['pm3', 'link', 'Payment link', 'رابط دفع', 1],
  ].forEach(([id, slug, name_en, name_ar, is_online], i) =>
    put('payment_methods', { id, slug, name_en, name_ar, is_active: 1, sort_order: i, is_online, updated_at: now })
  );

  /* ---------- delivery areas ---------- */
  put('states', { id: 's1', name: 'Hawalli', name_ar: 'حولي', is_active: 1, updated_at: now });
  put('cities', { id: 'ct1', state_id: 's1', name: 'Salmiya', name_ar: 'السالمية', min_order: 3, delivery_fee: 0.5, is_active: 1, updated_at: now });
  ['1', '2', '3', '4'].forEach((b) =>
    put('blocks', { id: `b${b}`, city_id: 'ct1', name: b, name_ar: b, is_active: 1, updated_at: now })
  );

  /* ---------- tables ---------- */
  put('table_sections', { id: 'sec1', branch_id: 1, name_en: 'Main hall', name_ar: 'الصالة', sort_order: 0, is_active: 1, updated_at: now });
  put('table_sections', { id: 'sec2', branch_id: 1, name_en: 'Terrace', name_ar: 'التراس', sort_order: 1, is_active: 1, updated_at: now });
  for (let n = 1; n <= 6; n++)
    put('tables', {
      id: `t${n}`, branch_id: 1, label: `T${n}`, label_ar: `ط${n}`, number: n,
      capacity: n <= 4 ? 4 : 6, is_available: 1, section_id: n <= 4 ? 'sec1' : 'sec2',
      sort_order: n, updated_at: now,
    });
})();

// The device token: a placeholder in the profile's own secrets file (the app
// moves it into the "pos-app-demo" keychain entry on first read).
fs.writeFileSync(path.join(DIR, 'secrets.json'), JSON.stringify({ device_token: 'demo-only-token' }));

db.close();
console.log(`seeded ${DB_PATH}`);
module.exports = { PASSWORD, MANAGER_CODE };
