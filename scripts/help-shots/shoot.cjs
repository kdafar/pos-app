// scripts/help-shots/shoot.cjs
//
// Takes the help-guide pictures from the real app, in English and Arabic.
//
//   npm run build            (the script drives out/, so build first)
//   node scripts/help-shots/shoot.cjs [only-this-picture]
//
// What it does, per language:
//   1. Launches the app on the isolated "demo" profile and re-seeds it with
//      made-up data (seed-demo.cjs). Real tills and real data are never used.
//   2. Replaces the print and cash-drawer handlers with ones that do nothing,
//      so no paper comes out of a real printer while it runs.
//   3. Walks through the screens like a cashier and a manager would.
//   4. For each picture, records where the marked buttons are (as % of the
//      picture) and saves a WebP into src/renderer/help/images/.
//   5. Writes src/renderer/help/images/markers.json.
//
// The number of markers per picture must match the number of notes in the
// words files — help.test.ts checks it.
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const IMAGES = path.join(ROOT, 'src/renderer/help/images');
const MARKERS = path.join(IMAGES, 'markers.json');
const DEBUG = path.join(__dirname, 'debug');
const ONLY = process.argv[2] || null;
const { PASSWORD, MANAGER_CODE } = { PASSWORD: 'demo1234', MANAGER_CODE: '246810' };

/* Exact on-screen labels (copied from src/renderer/i18n/strings*.ts). */
const T = {
  en: {
    lang: 'English', signIn: 'Sign in', password: 'Enter password', NEW: 'NEW',
    burger: 'Classic Burger', double: 'Double', cheese: 'Cheese', addToOrder: 'Add to order',
    juice: 'Orange Juice', kunafa: 'Kunafa', placeOrder: 'Place order',
    customerName: 'Customer Name', cash: 'Cash', knet: 'KNET', cashReceived: 'Cash received',
    change: 'Change', markPaid: 'Mark paid', reference: 'KNET slip reference',
    approvalCode: 'Approval code', approve: 'Approve', wrongItem: 'Wrong item', cancel: 'Cancel',
    dineIn: 'Dine-in', assignTable: 'Assign Table', signOut: 'Sign out',
    recentOrders: 'Recent Orders', kitchen: 'Kitchen display', closing: 'Closing Report',
    startPreparing: 'Start preparing', newOrders: 'New orders', printThermal: 'Print Thermal',
    totalEarning: 'Total Earning', viewDetails: 'View details', printReceipt: 'Print receipt',
    online: 'Online', syncNow: 'Sync now', expand: 'Expand sidebar', collapse: 'Collapse sidebar', mainHall: 'Main hall', table: 'T2',
    search: 'Search number / name / mobile / status…', remove: 'Remove', close: 'Close',
    customerA: 'Ali', customerB: 'Mona',
  },
  ar: {
    lang: 'العربية', signIn: 'تسجيل الدخول', password: 'أدخل كلمة المرور', NEW: 'جديد',
    burger: 'برجر كلاسيك', double: 'دبل', cheese: 'جبن', addToOrder: 'إضافة للطلب',
    juice: 'عصير برتقال', kunafa: 'كنافة', placeOrder: 'تأكيد الطلب',
    customerName: 'اسم العميل', cash: 'نقدي', knet: 'كي نت', cashReceived: 'المبلغ المدفوع',
    change: 'الباقي', markPaid: 'تسجيل كمدفوع', reference: 'رقم مرجع إيصال كي نت',
    approvalCode: 'رمز الموافقة', approve: 'موافقة', wrongItem: 'صنف خاطئ', cancel: 'إلغاء',
    dineIn: 'داخل المطعم', assignTable: 'تحديد الطاولة', signOut: 'تسجيل الخروج',
    recentOrders: 'آخر الطلبات', kitchen: 'شاشة المطبخ', closing: 'تقرير الإغلاق',
    startPreparing: 'بدء التحضير', newOrders: 'طلبات جديدة', printThermal: 'طباعة حرارية',
    totalEarning: 'إجمالي الإيراد', viewDetails: 'عرض التفاصيل', printReceipt: 'طباعة الفاتورة',
    online: 'متصل', syncNow: 'مزامنة الآن', expand: 'توسيع القائمة الجانبية', collapse: 'طي القائمة الجانبية', mainHall: 'الصالة', table: 'ط2',
    search: '...ابحث برقم الطلب أو الاسم أو الموبايل أو الحالة', remove: 'حذف', close: 'إغلاق',
    customerA: 'علي', customerB: 'منى',
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Where each marker sits, as % of the clip box: on the target's top corner at
 * the side reading starts from (left in English, right in Arabic). On the
 * centre it covered the very label it was pointing at.
 */
async function markersFor(clip, targets, rtl) {
  const out = [];
  const clamp = (v) => Math.min(97, Math.max(3, v));
  for (const t of targets) {
    const b = await t.boundingBox();
    if (!b) throw new Error('marker target not visible');
    const px = rtl ? b.x + b.width : b.x;
    const x = clamp(((px - clip.x) / clip.width) * 100);
    const y = clamp(((b.y - clip.y) / clip.height) * 100);
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return out;
}

async function toWebp(win, png) {
  // Chromium encodes WebP itself, so no image library is needed.
  const b64 = await win.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', 0.82).split(',')[1];
  }, png.toString('base64'));
  return Buffer.from(b64, 'base64');
}

async function run(lang) {
  const t = T[lang];
  const env = { ...process.env, POS_PROFILE: 'demo' };
  delete env.ELECTRON_RUN_AS_NODE;

  // First launch makes sure the demo schema exists; then seed and relaunch.
  let app = await electron.launch({ args: [ROOT], env });
  await (await app.firstWindow()).waitForTimeout(2500);
  await app.close();
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')], { stdio: 'inherit' });

  // The app holds a single-instance lock; give the first one time to let go.
  await sleep(2500);
  app = await electron.launch({ args: [ROOT], env });
  // Never leave a demo till running if this script dies half-way.
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  await app.evaluate(({ ipcMain }) => {
    for (const ch of ['orders:print', 'reports:printThermal', 'print:test', 'drawer:open']) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, async () => ({ ok: true, demo: true }));
    }
  });
  await win.setViewportSize({ width: 1366, height: 820 });
  win.setDefaultTimeout(8000);
  await win.waitForTimeout(2500);

  const results = {};
  const shot = async (file, { clip: clipLoc, marks, maxHeight }) => {
    if (ONLY && ONLY !== file) return;
    await sleep(500);
    const vp = win.viewportSize();
    let clip = { x: 0, y: 0, width: vp.width, height: vp.height };
    if (clipLoc) {
      const b = await clipLoc.boundingBox();
      const pad = 12;
      clip = {
        x: Math.max(0, b.x - pad),
        y: Math.max(0, b.y - pad),
        width: Math.min(vp.width - Math.max(0, b.x - pad), b.width + pad * 2),
        height: Math.min(vp.height - Math.max(0, b.y - pad), b.height + pad * 2),
      };
    }
    if (maxHeight) clip.height = Math.min(clip.height, maxHeight);
    const markers = await markersFor(clip, marks, lang === 'ar');
    const png = await win.screenshot({ clip });
    fs.writeFileSync(path.join(IMAGES, `${file}.${lang}.webp`), await toWebp(win, png));
    results[file] = markers;
    console.log(`  ${lang} ${file}: ${markers.length} markers`);
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      fs.mkdirSync(DEBUG, { recursive: true });
      await win.screenshot({ path: path.join(DEBUG, `${lang}-${name}.png`) }).catch(() => {});
      console.error(`  ${lang} ${name} FAILED: ${e.message.split('\n')[0]}`);
    }
  };
  const btn = (name, exact = true) => win.getByRole('button', { name, exact });
  const dialog = () => win.getByRole('dialog').last();
  // Checkout is a hand-rolled overlay, not a role=dialog.
  const checkoutPanel = () => win.locator('div.fixed.inset-0.z-50 > div').first();

  /* ---------- language ---------- */
  await win.getByText(t.lang, { exact: true }).first().click();
  await sleep(600);

  /* ---------- sign in (cashier) ---------- */
  const signIn = async (who) => {
    await win.getByText(who, { exact: true }).first().click();
    await win.getByPlaceholder(t.password).fill(PASSWORD);
  };
  await step('sign-in', async () => {
    await signIn('Sara Cashier');
    // The demo seed sets Live mode; the sign-in screen's own switch is the
    // one that sticks, so set it here too.
    await win.locator('select').first().selectOption('live').catch(() => {});
    await shot('sign-in', {
      marks: [
        win.getByText('Sara Cashier', { exact: true }).first(),
        win.getByPlaceholder(t.password),
        btn(t.signIn),
      ],
    });
    await btn(t.signIn).click();
    await win.waitForURL(/#\/$/, { timeout: 15000 });
    await sleep(1500);
  });

  /* ---------- the sync card ---------- */
  await step('check-till', async () => {
    // The order screen folds the side menu to icons; open it like staff would.
    // The demo server does not exist, so the real check says Offline. For this
    // one picture, answer the status call as a till that synced a minute ago.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('sync:status');
      ipcMain.handle('sync:status', async () => ({
        mode: 'live', online: true, last_sync_at: Date.now() - 60_000,
        base_url: 'https://majestic.example', cursor: 0, paired: true, token_present: true,
        device_id: 'demo-till-1', branch_name: 'Majestic', branch_id: 1, unsynced: 0,
      }));
    });
    await sleep(5500); // the sidebar polls the status every few seconds
    const panelBtn = () => win.locator('aside button:has(svg.flip-rtl)').first();
    await panelBtn().click();
    await sleep(700);
    const pill = win.locator('aside').getByText(t.online, { exact: true });
    await shot('check-till', {
      clip: win.locator('aside').first(),
      maxHeight: 330,
      marks: [
        win.locator('aside').getByText('Majestic').first(),
        win.locator('aside').locator('svg.lucide-timer').first(),
        pill,
        win.locator('aside').locator('svg.lucide-refresh-cw').first(),
      ],
    });
    await panelBtn().click();
    await sleep(700);
  });

  /* ---------- an order with options ---------- */
  await step('options', async () => {
    await btn(t.NEW, false).first().click();
    await sleep(800);
    await win.getByText(t.burger, { exact: true }).first().click();
    await sleep(800);
    const d = dialog();
    await d.getByText(t.double, { exact: true }).first().click();
    await d.getByText(t.cheese, { exact: true }).first().click();
    await shot('options', {
      clip: d,
      marks: [
        d.getByText(t.double, { exact: true }).first(),
        d.getByText(t.cheese, { exact: true }).first(),
        d.getByRole('button', { name: t.addToOrder }),
      ],
    });
    await d.getByRole('button', { name: t.addToOrder }).click();
    await sleep(800);
  });

  await step('order-screen', async () => {
    await win.getByText(t.juice, { exact: true }).first().click();
    await sleep(800);
    await shot('order-screen', {
      marks: [
        btn(t.NEW, false).first(),
        // .last(): the order's own tab also says "Pickup"; the type switch comes after it.
        win.locator('header').getByText(lang === 'en' ? 'Pickup' : 'استلام', { exact: true }).last(),
        win.getByText(t.juice, { exact: true }).last(),
        btn(t.placeOrder, false).last(),
      ],
    });
  });

  /* ---------- checkout + cash ---------- */
  await step('checkout', async () => {
    await btn(t.placeOrder, false).last().click();
    await sleep(1000);
    const d = checkoutPanel();
    await d.getByPlaceholder(lang === 'en' ? 'Full name' : 'الاسم الكامل').fill(t.customerA);
    // A kitchen note, so the kitchen picture shows the yellow note box.
    await d.getByPlaceholder(lang === 'en' ? 'Special instructions…' : '...تعليمات خاصة').fill(lang === 'en' ? 'No onions, please' : 'بدون بصل لو سمحت');
    await d.getByText(t.cash, { exact: true }).first().click();
    await shot('checkout', {
      clip: d,
      marks: [
        d.getByPlaceholder(lang === 'en' ? 'Full name' : 'الاسم الكامل'),
        d.getByText(t.cash, { exact: true }).first(),
        d.getByRole('button', { name: t.placeOrder }),
      ],
    });
  });
  await step('cash', async () => {
    const d = checkoutPanel();
    const field = d.locator('label', { hasText: t.cashReceived }).locator('input');
    await field.fill('10');
    await sleep(400);
    await shot('cash', {
      clip: d,
      marks: [field, d.getByText(t.change, { exact: true }).first()],
    });
    await d.getByRole('button', { name: t.placeOrder }).click();
    await sleep(1500);
  });

  /* ---------- KNET + mark paid (through Recent Orders) ---------- */
  await step('mark-paid', async () => {
    await btn(t.NEW, false).first().click();
    await sleep(800);
    await win.getByText(t.kunafa, { exact: true }).first().click();
    await sleep(600);
    await btn(t.placeOrder, false).last().click();
    await sleep(1000);
    let d = checkoutPanel();
    await d.getByPlaceholder(lang === 'en' ? 'Full name' : 'الاسم الكامل').fill(t.customerB);
    await d.getByText(t.knet, { exact: true }).first().click();
    await d.getByRole('button', { name: t.placeOrder }).click();
    await sleep(1500);
    // A placed pickup leaves the tab strip; staff mark it paid from the list.
    await win.getByRole('link', { name: t.recentOrders }).click();
    await sleep(1800);
    await win.locator('tr', { hasText: t.customerB }).getByRole('button', { name: t.markPaid }).first().click();
    await sleep(900);
    d = dialog();
    const ref = d.getByLabel(t.reference).first();
    await ref.fill('204517');
    await shot('mark-paid', {
      clip: d,
      marks: [d.locator('button[data-slot="trigger"]').first(), ref, d.getByRole('button', { name: t.markPaid })],
    });
    await d.getByRole('button', { name: t.markPaid }).click();
    await sleep(1200);
    await win.getByRole('link', { name: lang === 'en' ? 'Order Process' : 'شاشة الطلب' }).click();
    await sleep(1500);
  });

  /* ---------- a table: picker, then a sent dish needing approval ---------- */
  await step('table-picker', async () => {
    await btn(t.NEW, false).first().click();
    await sleep(800);
    await win.locator('header').getByText(t.dineIn, { exact: true }).first().click();
    await sleep(800);
    await btn(t.assignTable, false).first().click();
    await sleep(900);
    const d = dialog();
    await shot('table-picker', {
      clip: d,
      marks: [d.getByText(t.mainHall).first(), d.getByText(t.table, { exact: true }).first()],
    });
    await d.getByText(t.table, { exact: true }).first().click();
    await sleep(900);
    // Some builds keep the picker open for the covers step; close it if so.
    if (await dialog().isVisible().catch(() => false)) {
      await dialog().getByRole('button', { name: t.assignTable }).click().catch(() => {});
      await sleep(600);
    }
  });

  await step('approval', async () => {
    await win.getByText(t.juice, { exact: true }).first().click();
    await sleep(700);
    await btn(lang === 'en' ? 'Update / Pay' : 'تحديث / دفع', false).last().click();
    await sleep(1000);
    const c = checkoutPanel();
    await c.getByPlaceholder(lang === 'en' ? 'Full name' : 'الاسم الكامل').fill(t.customerA);
    await c.getByText(t.cash, { exact: true }).first().click();
    await c.getByRole('button', { name: t.placeOrder }).click();
    await sleep(1500);
    await win.getByRole('button', { name: t.remove }).last().click();
    await sleep(900);
    const d = dialog();
    await d.getByText(t.wrongItem).first().click().catch(() => {});
    await shot('approval', {
      clip: d,
      marks: [d.getByLabel(t.approvalCode).first(), d.getByText(t.wrongItem).first(), d.getByRole('button', { name: t.approve })],
    });
    await d.getByRole('button', { name: t.cancel }).click();
    await sleep(600);
  });

  /* ---------- manager screens ---------- */
  await step('manager-sign-in', async () => {
    await win.getByRole('link', { name: t.signOut }).click();
    await win.waitForURL(/#\/login/, { timeout: 15000 });
    await sleep(1200);
    await signIn('Huda Manager');
    await btn(t.signIn).click();
    await win.waitForURL(/#\/$/, { timeout: 15000 });
    await sleep(1200);
  });

  await step('orders', async () => {
    await win.getByRole('link', { name: t.recentOrders }).click();
    await sleep(1800);
    await shot('orders', {
      marks: [
        win.getByPlaceholder(t.search),
        win.getByRole('button', { name: t.viewDetails, exact: true }).first(),
        win.getByRole('button', { name: t.printReceipt, exact: true }).first(),
      ],
    });
  });

  await step('kitchen', async () => {
    await win.getByRole('link', { name: t.kitchen }).click();
    await sleep(1800);
    await shot('kitchen', {
      marks: [win.getByRole('heading', { name: t.newOrders }), btn(t.startPreparing, false).first()],
    });
  });

  await step('closing', async () => {
    await win.getByRole('link', { name: t.closing }).click();
    await sleep(2200);
    await shot('closing', {
      marks: [win.getByText(t.totalEarning).first(), btn(t.printThermal, false)],
    });
  });

  await app.close();
  await sleep(2500);
  return results;
}

(async () => {
  fs.mkdirSync(IMAGES, { recursive: true });
  const markers = fs.existsSync(MARKERS) ? JSON.parse(fs.readFileSync(MARKERS, 'utf8')) : {};
  for (const lang of ['en', 'ar']) {
    console.log(`== ${lang}`);
    const res = await run(lang);
    for (const [file, list] of Object.entries(res)) {
      markers[file] = markers[file] || {};
      markers[file][lang] = list;
    }
  }
  const sorted = Object.fromEntries(Object.entries(markers).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(MARKERS, JSON.stringify(sorted, null, 2) + '\n');
  console.log('markers written');
})().catch((e) => {
  console.error('SHOOT FAILED', e);
  process.exit(1);
});
