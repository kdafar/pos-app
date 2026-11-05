// Photographs Today's Orders with a few real placed orders, at several sizes,
// EN light + AR dark. Demo profile only; printing is stubbed.
// Usage: node scripts/help-shots/orders-page.cjs <outDir>
const { _electron: electron } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);
const T = {
  en: { lang: 'English', pw: 'Enter password', signIn: 'Sign in', NEW: 'NEW', burger: 'Classic Burger', double: 'Double',
    cheese: 'Cheese', add: 'Add to order', juice: 'Orange Juice', kunafa: 'Kunafa', long: 'Grilled Chicken Shawarma Plate with Garlic Sauce',
    place: 'Place order', updatePay: 'Update / Pay', fullName: 'Full name', notes: 'Special instructions…', cash: 'Cash', knet: 'KNET',
    dineIn: 'Dine-in', assign: 'Assign Table' },
};
const SIZES = [[1366, 768], [1024, 600], [1920, 1080], [412, 900]];
(async () => {
  const env = { ...process.env, POS_PROFILE: 'demo' }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')], { env });
  const app = await electron.launch({ args: [ROOT], env });
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  await app.evaluate(({ ipcMain }) => {
    for (const ch of ['orders:print', 'reports:printThermal', 'print:test', 'drawer:open']) {
      ipcMain.removeHandler(ch); ipcMain.handle(ch, async () => ({ ok: true, demo: true }));
    }
  });
  win.setDefaultTimeout(6000); await sleep(2500);
  const btn = (name, exact = true) => win.getByRole('button', { name, exact });
  const dialog = () => win.getByRole('dialog').last();
  const checkout = () => win.locator('div.fixed.inset-0.z-50 > div').first();
  const safe = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAILED', name, e.message.split(NL)[0]); } };
  const login = async (lang, theme) => {
    await win.setViewportSize({ width: 1366, height: 768 });
    await win.evaluate(() => { location.hash = '#/login'; }); await sleep(1000);
    await win.evaluate(async (th) => { await window.api.invoke('store:set', 'ui.theme', th); document.documentElement.classList.toggle('dark', th === 'dark'); }, theme);
    await win.getByText(lang === 'en' ? 'English' : 'العربية', { exact: true }).first().click().catch(() => {});
    await sleep(400);
    await win.getByText('Noor Admin', { exact: true }).first().click();
    await win.getByPlaceholder(lang === 'en' ? 'Enter password' : 'أدخل كلمة المرور').fill('demo1234');
    await win.getByRole('button', { name: lang === 'en' ? 'Sign in' : 'تسجيل الدخول', exact: true }).click();
    await win.waitForURL(/#\/$/, { timeout: 15000 }); await sleep(1200);
  };

  // Orders, placed in English once.
  const t = T.en;
  await login('en', 'light');
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
  await safe('order B', async () => {
    await btn(t.NEW, false).first().click(); await sleep(700);
    await win.getByText(t.kunafa, { exact: true }).first().click(); await sleep(600);
    await btn(t.place, false).last().click(); await sleep(900);
    const c = checkout();
    await c.getByPlaceholder(t.fullName).fill('Mona');
    await c.getByText(t.knet, { exact: true }).first().click();
    await c.getByRole('button', { name: t.place }).click(); await sleep(1500);
  });
  await safe('order C', async () => {
    await btn(t.NEW, false).first().click(); await sleep(700);
    await win.locator('header').getByText(t.dineIn, { exact: true }).first().click(); await sleep(700);
    await btn(t.assign, false).first().click(); await sleep(800);
    await dialog().getByText('T2', { exact: true }).first().click(); await sleep(800);
    if (await dialog().isVisible().catch(() => false)) { await dialog().getByRole('button', { name: t.assign }).click().catch(() => {}); await sleep(500); }
    await win.getByText(t.juice, { exact: true }).first().click(); await sleep(600);
    await btn(t.updatePay, false).last().click(); await sleep(900);
    const c = checkout();
    await c.getByPlaceholder(t.fullName).fill('Sara');
    await c.getByText(t.cash, { exact: true }).first().click();
    await c.getByRole('button', { name: t.place }).click(); await sleep(1500);
  });
  await safe('order D', async () => {
    await btn(t.NEW, false).first().click(); await sleep(700);
    await win.getByText(t.long, { exact: true }).first().click(); await sleep(500);
    await win.getByText(t.kunafa, { exact: true }).first().click(); await sleep(500);
    await btn(t.place, false).last().click(); await sleep(900);
    const c = checkout();
    await c.getByPlaceholder(t.fullName).fill('Abdullah Al-Mutairi');
    await c.getByText(t.cash, { exact: true }).first().click();
    await c.getByRole('button', { name: t.place }).click(); await sleep(1500);
  });

  for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
    if (lang !== 'en') {
      await win.evaluate(() => { location.hash = '#/logout'; }); await sleep(1500);
      await login(lang, theme);
    }
    await win.evaluate(() => { location.hash = '#/orders'; }); await sleep(1800);
    for (const [w, h] of SIZES) {
      await win.setViewportSize({ width: w, height: h }); await sleep(900);
      await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-orders.png`) });
    }
    console.log('  ', lang, 'done');
    await win.setViewportSize({ width: 1366, height: 768 });
  }
  await app.close();
  console.log('ORDERS DONE');
})().catch((e) => { console.error('ORDERS FAILED', e.message.split(String.fromCharCode(10))[0]); process.exit(1); });
