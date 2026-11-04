// Dev aid: opens a list of guide steps (signed in as the demo manager) and saves the
// picture part of each to OUT_DIR, so marker placement can be checked by eye.
const { _electron: electron } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEPS = {
  en: [['knet', 'KNET or card'], ['approve', 'Remove a dish that was already sent'], ['kitchen screen', 'Read the kitchen screen'], ['closing report', 'Print the closing report'], ['find an order', 'Find an order'], ['sign in', 'Sign in'], ['check', 'Check the till is ready']],
  ar: [['كي نت', 'كي نت أو بطاقة'], ['شاشة المطبخ', 'قراءة شاشة المطبخ'], ['تقرير', 'طباعة تقرير الإغلاق'], ['الطاولة', 'فتح طاولة']],
};
(async () => {
  execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.cjs')]);
  const env = { ...process.env, POS_PROFILE: 'demo' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [ROOT], env });
  process.on('exit', () => { try { app.process().kill(); } catch {} });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.setViewportSize({ width: 1366, height: 820 });
  win.setDefaultTimeout(8000);
  await sleep(2500);
  for (const lang of ['en', 'ar']) {
    const L = lang === 'en'
      ? { lang: 'English', pw: 'Enter password', signIn: 'Sign in', search: 'Search the guide…', signOut: 'Sign out' }
      : { lang: 'العربية', pw: 'أدخل كلمة المرور', signIn: 'تسجيل الدخول', search: '...ابحث في الدليل', signOut: 'تسجيل الخروج' };
    await win.getByText(L.lang, { exact: true }).first().click();
    await sleep(500);
    await win.getByText('Huda Manager', { exact: true }).first().click();
    await win.getByPlaceholder(L.pw).fill('demo1234');
    await win.getByRole('button', { name: L.signIn, exact: true }).click();
    await sleep(2500);
    for (const [q, title] of STEPS[lang]) {
      await win.getByRole('button', { name: lang === 'en' ? 'Help for this screen' : 'مساعدة لهذه الشاشة' }).first().click();
      await sleep(900);
      await win.getByLabel(L.search).fill(q);
      await sleep(400);
      await win.getByRole('button', { name: new RegExp(title) }).first().click();
      await sleep(900);
      const fig = win.locator('figure').first();
      await fig.scrollIntoViewIfNeeded();
      await sleep(400);
      await fig.screenshot({ path: path.join(process.env.OUT_DIR, `fig-${lang}-${q.replace(/\s/g, '_')}.png`) });
      await win.keyboard.press('Escape');
      await sleep(500);
    }
    await win.getByRole('link', { name: L.signOut }).click();
    await sleep(2500);
  }
  await app.close();
  console.log('REVIEW2 DONE');
})().catch((e) => { console.error('REVIEW2 FAILED', e.message.split('\n')[0]); process.exit(1); });
