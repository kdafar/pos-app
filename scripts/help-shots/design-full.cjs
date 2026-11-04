// scripts/help-shots/design-full.cjs
//
// Photographs EVERY screen and popup of the till on the demo profile
// (invented data only), with real placed orders so lists and the kitchen are
// not empty. Printing and the cash drawer are stubbed.
//
//   npm run build && node scripts/help-shots/design-full.cjs <out-dir> [brand-hex]
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2];
const BRAND = process.argv[3];
if (!OUT) throw new Error('usage: design-full.cjs <out-dir> [brand-hex]');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VARIANTS = [
  { id: 'en-light-1366', lang: 'en', theme: 'light', w: 1366, h: 768 },
  { id: 'ar-dark-1366', lang: 'ar', theme: 'dark', w: 1366, h: 768 },
  { id: 'en-light-1024x600', lang: 'en', theme: 'light', w: 1024, h: 600 },
  { id: 'en-light-phone', lang: 'en', theme: 'light', w: 412, h: 900 },
];
const T = {
  en: {
    lang: 'English', pw: 'Enter password', signIn: 'Sign in', NEW: 'NEW', burger: 'Classic Burger', double: 'Double',
    cheese: 'Cheese', add: 'Add to order', juice: 'Orange Juice', kunafa: 'Kunafa', place: 'Place order',
    updatePay: 'Update / Pay', fullName: 'Full name', notes: 'Special instructions…', cash: 'Cash', knet: 'KNET',
    dineIn: 'Dine-in', pickup: 'Pickup', assign: 'Assign Table', promo: 'Apply Promo Code', clear: 'Clear cart',
    cancel: 'Cancel', remove: 'Remove', markPaid: 'Mark paid', unpair: 'Unpair device', keep: 'Keep paired',
    viewDetails: 'View details', more: 'More',
  },
  ar: {
    lang: 'العربية', pw: 'أدخل كلمة المرور', signIn: 'تسجيل الدخول', NEW: 'جديد', burger: 'برجر كلاسيك', double: 'دبل',
    cheese: 'جبن', add: 'إضافة للطلب', juice: 'عصير برتقال', kunafa: 'كنافة', place: 'تأكيد الطلب',
    updatePay: 'تحديث / دفع', fullName: 'الاسم الكامل', notes: '...تعليمات خاصة', cash: 'نقدي', knet: 'كي نت',
    dineIn: 'داخل المطعم', pickup: 'استلام', assign: 'تحديد الطاولة', promo: 'تطبيق كود الخصم', clear: 'تفريغ السلة',
    cancel: 'إلغاء', remove: 'حذف', markPaid: 'تسجيل كمدفوع', unpair: 'إلغاء ربط الجهاز', keep: 'خلّه مربوط',
    viewDetails: 'عرض التفاصيل', more: 'المزيد',
  },
};
const ROUTES = [
  ['20-orders', '/orders'], ['30-kitchen', '/kitchen'], ['31-closing', '/reports/closing'],
  ['40-categories', '/categories'], ['41-items', '/items'], ['42-promos', '/promos'], ['43-tables', '/tables'],
  ['44-payment-methods', '/payment-methods'], ['45-locations', '/locations'], ['46-settings', '/settings'],
  ['47-updates', '/updates'], ['48-permissions', '/permissions'], ['50-help', '/help'],
];

(async () => {
  const env = { ...process.env, POS_PROFILE: 'demo' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (BRAND) env.DEMO_BRAND = BRAND;
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')], { env });

  const app = await electron.launch({ args: [ROOT], env });
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  await app.evaluate(({ ipcMain }) => {
    for (const ch of ['orders:print', 'reports:printThermal', 'print:test', 'drawer:open']) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, async () => ({ ok: true, demo: true }));
    }
  });
  win.setDefaultTimeout(6000);
  await sleep(2500);

  let V;
  const shot = async (name) => {
    await sleep(600);
    await win.screenshot({ path: path.join(OUT, `${V.id}-${name}.png`) });
    console.log('  ', V.id, name);
  };
  const safe = async (name, fn) => {
    try { await fn(); } catch (e) { console.log('  FAILED', V?.id, name, e.message.split('\n')[0]); }
  };
  const go = (route) => win.evaluate((r) => { window.location.hash = '#' + r; }, route);
  const btn = (name, exact = true) => win.getByRole('button', { name, exact });
  const dialog = () => win.getByRole('dialog').last();
  const esc = async () => { await win.keyboard.press('Escape'); await sleep(400); };
  const checkout = () => win.locator('div.fixed.inset-0.z-50 > div').first();

  let ordersPlaced = false;
  for (V of VARIANTS) {
    const t = T[V.lang];
    console.log('==', V.id);
    await win.setViewportSize({ width: 1366, height: 768 });
    await go('/login');
    await sleep(1200);
    await win.evaluate(async (th) => {
      await window.api.invoke('store:set', 'ui.theme', th);
      document.documentElement.classList.toggle('dark', th === 'dark');
    }, V.theme);
    await win.getByText(t.lang, { exact: true }).first().click().catch(() => {});
    await sleep(500);
    await win.setViewportSize({ width: V.w, height: V.h });

    await safe('login', () => shot('01-login'));
    await safe('unpair dialog', async () => {
      await btn(t.unpair, false).first().click();
      await sleep(700);
      await shot('02-unpair-dialog');
      await btn(t.keep, false).last().click();
      await sleep(400);
    });
    await safe('sign in', async () => {
      await win.getByText('Noor Admin', { exact: true }).first().click();
      await win.getByPlaceholder(t.pw).fill('demo1234');
      await btn(t.signIn).click();
      await win.waitForURL(/#\/$/, { timeout: 15000 });
      await sleep(1500);
    });

    if (!ordersPlaced) {
      ordersPlaced = true;
      // A: pickup, burger + juice, cash, with a kitchen note.
      await safe('order A', async () => {
        await btn(t.NEW, false).first().click(); await sleep(700);
        await win.getByText(t.burger, { exact: true }).first().click(); await sleep(700);
        const d = dialog();
        await d.getByText(t.double, { exact: true }).first().click();
        await d.getByText(t.cheese, { exact: true }).first().click();
        await d.getByRole('button', { name: t.add }).click(); await sleep(600);
        await win.getByText(t.juice, { exact: true }).first().click(); await sleep(600);
        await btn(t.place, false).last().click(); await sleep(900);
        const c = checkout();
        await c.getByPlaceholder(t.fullName).fill('Ali');
        await c.getByPlaceholder(t.notes).fill('No onions, please');
        await c.getByText(t.cash, { exact: true }).first().click();
        await c.getByRole('button', { name: t.place }).click(); await sleep(1500);
      });
      // B: pickup, kunafa, KNET (left unpaid for the Mark paid dialog).
      await safe('order B', async () => {
        await btn(t.NEW, false).first().click(); await sleep(700);
        await win.getByText(t.kunafa, { exact: true }).first().click(); await sleep(600);
        await btn(t.place, false).last().click(); await sleep(900);
        const c = checkout();
        await c.getByPlaceholder(t.fullName).fill('Mona');
        await c.getByText(t.knet, { exact: true }).first().click();
        await c.getByRole('button', { name: t.place }).click(); await sleep(1500);
      });
      // C: dine-in on a table, placed (stays on screen, lines locked).
      await safe('order C', async () => {
        await btn(t.NEW, false).first().click(); await sleep(700);
        await win.locator('header').getByText(t.dineIn, { exact: true }).first().click(); await sleep(700);
        await btn(t.assign, false).first().click(); await sleep(800);
        await dialog().getByText('T2', { exact: true }).first().click(); await sleep(800);
        if (await dialog().isVisible().catch(() => false)) {
          await dialog().getByRole('button', { name: t.assign }).click().catch(() => {});
          await sleep(500);
        }
        await win.getByText(t.juice, { exact: true }).first().click(); await sleep(600);
        await btn(t.updatePay, false).last().click(); await sleep(900);
        const c = checkout();
        await c.getByPlaceholder(t.fullName).fill('Sara');
        await c.getByText(t.cash, { exact: true }).first().click();
        await c.getByRole('button', { name: t.place }).click(); await sleep(1500);
      });
    }

    await go('/'); await sleep(1200);
    await safe('order screen', () => shot('10-order-dinein'));
    await safe('table picker', async () => {
      await win.locator('button:has(svg.lucide-table-2), button:has(svg.lucide-table)').first().click(); await sleep(800);
      await shot('12-table-picker'); await esc();
    });
    // A fresh pickup draft for the cart / popups.
    await safe('draft', async () => {
      await btn(t.NEW, false).first().click(); await sleep(700);
      await win.getByText(t.juice, { exact: true }).first().click(); await sleep(500);
      await win.getByText(t.kunafa, { exact: true }).first().click(); await sleep(500);
      await shot('13-order-cart');
    });
    await safe('options', async () => {
      await win.getByText(t.burger, { exact: true }).first().click(); await sleep(800);
      await shot('14-options-dialog'); await esc();
    });
    await safe('promo', async () => {
      await btn(t.promo, false).first().click(); await sleep(700);
      await shot('15-promo-dialog');
      // Hand-built popup: no Escape; close it with Cancel like a cashier.
      await btn(t.cancel, true).last().click(); await sleep(400);
    });
    await safe('confirm', async () => {
      await btn(t.clear, false).first().click(); await sleep(700);
      await shot('16-confirm-dialog');
      await btn(t.cancel, true).last().click().catch(() => esc()); await sleep(400);
    });
    await safe('checkout', async () => {
      await btn(t.place, false).last().click(); await sleep(900);
      await shot('17-checkout');
      await checkout().getByRole('button', { name: t.cancel, exact: true }).click(); await sleep(500);
    });
    if (V.w < 768) {
      await safe('more sheet', async () => {
        await btn(t.more, false).last().click(); await sleep(800);
        await shot('18-more-sheet'); await esc();
      });
    }

    for (const [name, route] of ROUTES) {
      await safe(name, async () => { await go(route); await sleep(1300); await shot(name); });
      if (name === '20-orders') {
        await safe('mark paid', async () => {
          await btn(t.markPaid, false).first().click(); await sleep(800);
          await shot('21-mark-paid-dialog'); await esc();
        });
        await safe('order details', async () => {
          await win.getByText('Mona', { exact: true }).first().click(); await sleep(900);
          await shot('22-order-details'); await esc();
        });
      }
    }
    await safe('help step', async () => {
      await go('/help?from=%2F'); await sleep(1300); await shot('51-help-step');
    });
    await safe('sign out', async () => {
      await go('/logout'); await win.waitForURL(/#\/login/, { timeout: 15000 }); await sleep(1200);
    });
    // Manager approval only opens for someone without the right: the cashier.
    await safe('approval as cashier', async () => {
      await win.getByText('Sara Cashier', { exact: true }).first().click();
      await win.getByPlaceholder(t.pw).fill('demo1234');
      await btn(t.signIn).click();
      await win.waitForURL(/#\/$/, { timeout: 15000 }); await sleep(1500);
      await btn(t.NEW, false).first().click(); await sleep(700);
      await win.locator('header').getByText(t.dineIn, { exact: true }).last().click(); await sleep(700);
      await btn(t.assign, false).first().click(); await sleep(800);
      await dialog().getByText('T3', { exact: true }).first().click(); await sleep(800);
      if (await dialog().isVisible().catch(() => false)) {
        await dialog().getByRole('button', { name: t.assign }).click().catch(() => {}); await sleep(500);
      }
      await win.getByText(t.juice, { exact: true }).first().click(); await sleep(600);
      await btn(t.updatePay, false).last().click(); await sleep(900);
      await checkout().getByPlaceholder(t.fullName).fill('Yousef');
      await checkout().getByText(t.cash, { exact: true }).first().click();
      await checkout().getByRole('button', { name: t.place }).click(); await sleep(1500);
      await btn(t.remove, false).last().click(); await sleep(900);
      await shot('11-approval-dialog');
      await btn(t.cancel, true).last().click().catch(() => esc()); await sleep(400);
      await go('/logout'); await win.waitForURL(/#\/login/, { timeout: 15000 }); await sleep(1200);
    });
  }
  await app.close();
  console.log('FULL DONE');
})().catch((e) => { console.error('FULL FAILED', e.message.split('\n')[0]); process.exit(1); });
