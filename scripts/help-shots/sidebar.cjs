// Photographs the full (expanded) side menu at desktop sizes, EN light + AR dark.
// Demo profile only.
const { _electron: electron } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const env = { ...process.env, POS_PROFILE: 'demo' }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')], { env });
  const app = await electron.launch({ args: [ROOT], env });
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  win.setDefaultTimeout(8000); await sleep(2500);
  for (const [lang, theme] of [['en', 'light'], ['ar', 'dark']]) {
    await win.setViewportSize({ width: 1366, height: 768 });
    await win.evaluate(() => { location.hash = '#/login'; }); await sleep(1000);
    await win.evaluate(async (th) => { await window.api.invoke('store:set', 'ui.theme', th); document.documentElement.classList.toggle('dark', th === 'dark'); }, theme);
    await win.getByText(lang === 'en' ? 'English' : 'العربية', { exact: true }).first().click().catch(() => {});
    await sleep(400);
    await win.getByText('Noor Admin', { exact: true }).first().click();
    await win.getByPlaceholder(lang === 'en' ? 'Enter password' : 'أدخل كلمة المرور').fill('demo1234');
    await win.getByRole('button', { name: lang === 'en' ? 'Sign in' : 'تسجيل الدخول', exact: true }).click();
    await win.waitForURL(/#\/$/, { timeout: 15000 }); await sleep(1200);
    for (const [w, h] of [[1366, 768], [1920, 1080]]) {
      await win.setViewportSize({ width: w, height: h }); await sleep(700);
      // Open the menu if it is the icon rail (rail is ~76px wide).
      const asideW = await win.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width || 0);
      if (asideW < 120) { await win.locator('aside button[aria-label]').first().click().catch(() => {}); await win.mouse.move(w - 10, h - 10); await sleep(500); }
      const asideW2 = await win.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width || 0);
      // Show the More group the way an admin sees it.
      await win.locator('#nav-more-toggle[aria-expanded=false]').click().catch(() => {}); await sleep(400);
      await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-sidebar.png`) });
      console.log('  ', lang, w, 'aside', Math.round(asideW2));
    }
    await win.evaluate(() => { location.hash = '#/logout'; }); await sleep(1500);
  }
  await app.close();
  console.log('SIDEBAR DONE');
})().catch((e) => { console.error('SIDEBAR FAILED', e.message.split('\n')[0]); process.exit(1); });
