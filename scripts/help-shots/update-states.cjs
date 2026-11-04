// Photographs the Software Update screen in each updater state (the dev build
// is always "disabled"), by answering update:status and pushing update:state
// from the main process the way the real updater does. Demo profile only.
const { _electron: electron } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now() - 5 * 60_000;
const STATES = {
  none: { state: { status: 'none' }, currentVersion: '0.6.1', lastCheckedAt: now },
  downloading: { state: { status: 'downloading', percent: 46, transferred: 58e6, total: 126e6, bytesPerSecond: 3.1e6 }, currentVersion: '0.6.1', lastCheckedAt: now },
  ready: { state: { status: 'ready', version: '0.6.2', notes: 'Faster checkout on small screens.\nKitchen display shows order notes.' }, currentVersion: '0.6.1', lastCheckedAt: now },
};
(async () => {
  const env = { ...process.env, POS_PROFILE: 'demo' }; delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')], { env });
  const app = await electron.launch({ args: [ROOT], env });
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  win.setDefaultTimeout(8000); await sleep(2500);
  const shots = [['en', 'light', 1366, 768], ['ar', 'dark', 1366, 768], ['en', 'light', 412, 900]];
  for (const [lang, theme, w, h] of shots) {
    await win.setViewportSize({ width: 1366, height: 768 });
    await win.evaluate((r) => { location.hash = r; }, '#/login'); await sleep(1000);
    await win.evaluate(async (th) => { await window.api.invoke('store:set', 'ui.theme', th); document.documentElement.classList.toggle('dark', th === 'dark'); }, theme);
    await win.getByText(lang === 'en' ? 'English' : 'العربية', { exact: true }).first().click().catch(() => {});
    await sleep(400);
    await win.getByText('Noor Admin', { exact: true }).first().click();
    await win.getByPlaceholder(lang === 'en' ? 'Enter password' : 'أدخل كلمة المرور').fill('demo1234');
    await win.getByRole('button', { name: lang === 'en' ? 'Sign in' : 'تسجيل الدخول', exact: true }).click();
    await win.waitForURL(/#\/$/, { timeout: 15000 }); await sleep(1200);
    await win.setViewportSize({ width: w, height: h });
    for (const [name, snap] of Object.entries(STATES)) {
      await app.evaluate(({ ipcMain, BrowserWindow }, s) => {
        ipcMain.removeHandler('update:status');
        ipcMain.handle('update:status', async () => s);
        for (const bw of BrowserWindow.getAllWindows()) bw.webContents.send('update:state', s);
      }, snap);
      await win.evaluate(() => { location.hash = '#/'; }); await sleep(500);
      await win.evaluate(() => { location.hash = '#/updates'; }); await sleep(1500);
      await win.screenshot({ path: path.join(OUT, `${lang}-${theme}-${w}-update-${name}.png`) });
      console.log('  ', lang, theme, w, name);
    }
    await win.evaluate(() => { location.hash = '#/logout'; }); await sleep(1500);
  }
  await app.close();
  console.log('STATES DONE');
})().catch((e) => { console.error('STATES FAILED', e.message.split('\n')[0]); process.exit(1); });
