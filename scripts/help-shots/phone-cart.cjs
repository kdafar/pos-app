// Photographs the phone cart: the bar under the catalog, then the cart sheet
// opened from it; plus a tablet and laptop shot to confirm they are unchanged.
// Demo profile only.
const { _electron: electron } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = {
  en: { lang: 'English', pw: 'Enter password', signIn: 'Sign in', NEW: 'NEW', juice: 'Orange Juice', view: 'View cart', place: 'Place order' },
  ar: { lang: 'العربية', pw: 'أدخل كلمة المرور', signIn: 'تسجيل الدخول', NEW: 'جديد', juice: 'عصير برتقال', view: 'عرض السلة', place: 'تأكيد الطلب' },
};
(async () => {
  const env = { ...process.env, POS_PROFILE: 'demo' }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')], { env });
  const app = await electron.launch({ args: [ROOT], env });
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  win.setDefaultTimeout(8000); await sleep(2500);
  for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
    const t = T[lang];
    await win.setViewportSize({ width: 1366, height: 768 });
    await win.evaluate(() => { location.hash = '#/login'; }); await sleep(1000);
    await win.evaluate(async (th) => { await window.api.invoke('store:set', 'ui.theme', th); document.documentElement.classList.toggle('dark', th === 'dark'); }, theme);
    await win.getByText(t.lang, { exact: true }).first().click().catch(() => {});
    await sleep(400);
    await win.getByText('Sara Cashier', { exact: true }).first().click();
    await win.getByPlaceholder(t.pw).fill('demo1234');
    await win.getByRole('button', { name: t.signIn, exact: true }).click();
    await win.waitForURL(/#\/$/, { timeout: 15000 }); await sleep(1500);
    await win.getByRole('button', { name: t.NEW }).first().click(); await sleep(700);
    await win.getByText(t.juice, { exact: true }).first().click(); await sleep(500);
    await win.getByText(t.juice, { exact: true }).first().click(); await sleep(600);
    for (const [w, h] of [[412, 900], [360, 640]]) {
      await win.setViewportSize({ width: w, height: h }); await sleep(900);
      await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-cart-bar.png`) });
      await win.getByRole('button', { name: new RegExp(t.view) }).click(); await sleep(600);
      await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-cart-sheet.png`) });
      if (w === 412) {
        // Checkout must open on top of the sheet.
        await win.getByRole('button', { name: t.place }).last().click(); await sleep(900);
        await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-cart-checkout.png`) });
        await win.keyboard.press('Escape'); await sleep(500);
      }
      await win.keyboard.press('Escape'); await sleep(400);
    }
    for (const [w, h] of [[800, 1280], [1366, 768]]) {
      await win.setViewportSize({ width: w, height: h }); await sleep(900);
      await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-order.png`) });
    }
    console.log('  ', lang, 'done');
    await win.setViewportSize({ width: 1366, height: 768 });
    await win.evaluate(() => { location.hash = '#/logout'; }); await sleep(1500);
  }
  await app.close();
  console.log('CART DONE');
})().catch((e) => { console.error('CART FAILED', e.message.split('\n')[0]); process.exit(1); });
