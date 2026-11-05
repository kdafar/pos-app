// Photographs the promo dialog with the code field focused (checks for a
// single focus ring). Demo profile only.
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
  await win.setViewportSize({ width: 1366, height: 768 });
  await win.evaluate(() => { location.hash = '#/login'; }); await sleep(1000);
  await win.getByText('English', { exact: true }).first().click().catch(() => {});
  await win.getByText('Sara Cashier', { exact: true }).first().click();
  await win.getByPlaceholder('Enter password').fill('demo1234');
  await win.getByRole('button', { name: 'Sign in', exact: true }).click();
  await win.waitForURL(/#\/$/, { timeout: 15000 }); await sleep(1500);
  await win.getByRole('button', { name: 'NEW' }).first().click(); await sleep(700);
  await win.getByText('Orange Juice', { exact: true }).first().click(); await sleep(600);
  await win.getByRole('button', { name: /Apply Promo Code/ }).first().click(); await sleep(900);
  await win.keyboard.type('TE'); await sleep(400);
  await win.screenshot({ path: path.join(OUT, 'promo-focus.png') });
  await app.close();
  console.log('PROMO DONE');
})().catch((e) => { console.error('PROMO FAILED', e.message.split(String.fromCharCode(10))[0]); process.exit(1); });
