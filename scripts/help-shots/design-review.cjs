// scripts/help-shots/design-review.cjs
//
// Photographs the restyled screens on the demo till (invented data only) at the
// screen sizes the till has to serve, in light/dark and English/Arabic.
//
//   npm run build && node scripts/help-shots/design-review.cjs <out-dir> [brand-hex]
//
// Printing and the cash drawer are stubbed, so nothing reaches a real printer.
const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2];
const BRAND = process.argv[3];
if (!OUT) throw new Error('usage: design-review.cjs <out-dir> [brand-hex]');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIZES = [
  { id: '1366x768', w: 1366, h: 768 },
  { id: '1024x600', w: 1024, h: 600 },
  { id: '1920x1080', w: 1920, h: 1080 },
  { id: 'tablet-800x1280', w: 800, h: 1280 },
  { id: 'phone-412x900', w: 412, h: 900 },
];
const L = {
  en: { lang: 'English', pw: 'Enter password', signIn: 'Sign in', NEW: 'NEW', burger: 'Classic Burger', double: 'Double', cheese: 'Cheese', add: 'Add to order', juice: 'Orange Juice', place: 'Place order', recent: 'Recent Orders', kitchen: 'Kitchen display', closing: 'Closing Report', settings: 'Settings' },
  ar: { lang: 'العربية', pw: 'أدخل كلمة المرور', signIn: 'تسجيل الدخول', NEW: 'جديد', burger: 'برجر كلاسيك', double: 'دبل', cheese: 'جبن', add: 'إضافة للطلب', juice: 'عصير برتقال', place: 'تأكيد الطلب', recent: 'آخر الطلبات', kitchen: 'شاشة المطبخ', closing: 'تقرير الإغلاق', settings: 'الإعدادات' },
};

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
  win.setDefaultTimeout(8000);
  await sleep(2500);

  const shot = async (name) => {
    await sleep(700);
    await win.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('  ', name);
  };
  const safe = async (name, fn) => {
    try { await fn(); } catch (e) { console.log('  FAILED', name, e.message.split('\n')[0]); }
  };
  const setTheme = async (theme) => {
    await win.evaluate(async (th) => {
      await window.api.invoke('store:set', 'ui.theme', th);
      document.documentElement.classList.toggle('dark', th === 'dark');
    }, theme);
  };

  let first = true;
  for (const lang of ['en', 'ar']) {
    for (const theme of ['light', 'dark']) {
      const t = L[lang];
      const sizes = lang === 'en' && theme === 'light' ? SIZES : [SIZES[0]];
      await win.setViewportSize({ width: 1366, height: 768 });
      await setTheme(theme);
      await win.getByText(t.lang, { exact: true }).first().click().catch(() => {});
      await sleep(500);
      const tag = `${lang}-${theme}`;
      for (const s of sizes) {
        await win.setViewportSize({ width: s.w, height: s.h });
        await safe(`login ${tag} ${s.id}`, () => shot(`${tag}-${s.id}-01-login`));
      }
      await win.setViewportSize({ width: 1366, height: 768 });
      await safe('sign in', async () => {
        await win.getByText('Huda Manager', { exact: true }).first().click();
        await win.getByPlaceholder(t.pw).fill('demo1234');
        await win.getByRole('button', { name: t.signIn, exact: true }).click();
        await win.waitForURL(/#\/$/, { timeout: 15000 });
        await sleep(1500);
      });
      if (first) {
        // One order in the cart, used by every later shot.
        await safe('build order', async () => {
          await win.getByRole('button', { name: t.NEW }).first().click();
          await sleep(700);
          await win.getByText(t.burger, { exact: true }).first().click();
          await sleep(700);
          const d = win.getByRole('dialog').last();
          await d.getByText(t.double, { exact: true }).first().click();
          await d.getByText(t.cheese, { exact: true }).first().click();
          await d.getByRole('button', { name: t.add }).click();
          await sleep(600);
          await win.getByText(t.juice, { exact: true }).first().click();
          await sleep(600);
        });
        first = false;
      }
      for (const s of sizes) {
        await win.setViewportSize({ width: s.w, height: s.h });
        await safe(`order ${tag} ${s.id}`, () => shot(`${tag}-${s.id}-02-order`));
        await safe(`checkout ${tag} ${s.id}`, async () => {
          await win.getByRole('button', { name: t.place }).last().click();
          await sleep(800);
          await shot(`${tag}-${s.id}-03-checkout`);
          const cancel = win.getByRole('button', { name: lang === 'en' ? 'Cancel' : 'إلغاء', exact: true }).last();
          if (await cancel.isVisible().catch(() => false)) await cancel.click();
          await sleep(500);
        });
        for (const [label, file] of [[t.recent, '04-orders'], [t.kitchen, '05-kitchen'], [t.closing, '06-closing'], [t.settings, '07-settings']]) {
          await safe(`${file} ${tag} ${s.id}`, async () => {
            const route = { '04-orders': '/orders', '05-kitchen': '/kitchen', '06-closing': '/reports/closing', '07-settings': '/settings' }[file];
            await win.evaluate((r) => { window.location.hash = '#' + r; }, route);
            await sleep(1200);
            await shot(`${tag}-${s.id}-${file}`);
          });
        }
        await safe('back to order', async () => {
          await win.evaluate(() => { window.location.hash = '#/'; });
          await sleep(900);
        });
      }
      await safe('sign out', async () => {
        await win.evaluate(() => { window.location.hash = '#/logout'; });
        await win.waitForURL(/#\/login/, { timeout: 15000 });
        await sleep(1200);
      });
    }
  }
  await app.close();
  console.log('REVIEW DONE');
})().catch((e) => { console.error('REVIEW FAILED', e.message.split('\n')[0]); process.exit(1); });
