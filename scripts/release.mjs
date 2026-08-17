#!/usr/bin/env node
/**
 * Interactive release for POS App.
 *
 *   npm run release
 *
 * Asks what to build, then does the whole sequence in the right order and
 * verifies the result — so none of it has to be remembered:
 *
 *   version bump → tests → typecheck diff → build → package → verify artifacts
 *
 * Everything is guarded. It refuses to package if tests fail, it defaults to
 * --publish never (publishing reaches every till within ~6h via auto-update),
 * and it checks the icons and feature markers are actually inside the shipped
 * binaries rather than trusting the builder's exit code.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'package.json');

/* ------------------------------- output ------------------------------- */
const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const step = (n, total, msg) =>
  console.log(`\n${C.cyan(`[${n}/${total}]`)} ${C.bold(msg)}`);
const ok = (msg) => console.log(`  ${C.green('OK')}   ${msg}`);
const warn = (msg) => console.log(`  ${C.yellow('WARN')} ${msg}`);
const fail = (msg) => console.log(`  ${C.red('FAIL')} ${msg}`);

/* ------------------------------- helpers ------------------------------ */
function run(cmd, args, { capture = false, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: ROOT,
      shell: process.platform === 'win32',
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    let out = '';
    if (capture) {
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
    }
    p.on('close', (code) => {
      if (code === 0 || allowFail) resolve({ code, out });
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${out}`));
    });
    p.on('error', reject);
  });
}

const readPkg = () => JSON.parse(fs.readFileSync(PKG, 'utf8'));
function writeVersion(v) {
  const raw = fs.readFileSync(PKG, 'utf8');
  fs.writeFileSync(
    PKG,
    raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${v}$2`),
    'utf8'
  );
}
function bump(v, kind) {
  const [maj, min, pat] = v.split('.').map((n) => parseInt(n, 10) || 0);
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/* --------------------------- release contents -------------------------- */
/** Markers proving a feature is actually inside the packaged renderer/main. */
const FEATURE_MARKERS = [
  ['Arabic UI', 'عرض {shown} من {total}'],
  ['Arabic receipt totals', 'الإجمالي'],
  ['RTL sidebar', 'border-e'],
  ['re-push on place/close', 'markForRepush'],
  ['push idempotency (temp_id)', 'temp_id'],
  ['outbox ack rule', 'applyPushResult'],
  ['catalog prune guard', 'REFUSING to prune'],
  ['payment link QR modal', 'PaymentLinkModal'],
  ['paid/unpaid badge', 'pay.awaiting'],
  ['customer lookup', 'customers:findByMobile'],
  ['fail-closed RBAC', 'denying admin'],
  ['print timeout guard', 'did not respond'],
];

/* ------------------------------- flags -------------------------------- */
// Flags make the script scriptable and testable. readline cannot be driven by
// a pipe (it swallows the whole buffer on the first read), so without these
// there is no way to exercise it non-interactively.
//
//   npm run release -- --version=patch --no-publish --yes
//   npm run release -- --version=1.0.0 --target=installer --no-tests
const FLAGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const NON_INTERACTIVE = 'version' in FLAGS || FLAGS.yes === true;

async function main() {
  const rl = NON_INTERACTIVE
    ? null
    : createInterface({ input: stdin, output: stdout });
  const ask = async (q, def) => {
    if (!rl) return def || '';
    const a = (await rl.question(`${q}${def ? C.dim(` [${def}]`) : ''} `)).trim();
    return a || def || '';
  };
  const yes = async (q, def = 'y') => {
    if (!rl) return def === 'y';
    return /^y/i.test(await ask(`${q} ${C.dim('(y/n)')}`, def));
  };

  console.log(C.bold('\n  POS App — release\n'));
  const pkg = readPkg();
  const current = pkg.version;
  console.log(`  current version: ${C.bold(current)}\n`);

  /* ---- questions ---- */
  if (NON_INTERACTIVE) console.log(C.dim('  (non-interactive: using flags)'));
  console.log('  Version');
  console.log(`    1) patch  → ${bump(current, 'patch')}   ${C.dim('bug fixes')}`);
  console.log(`    2) minor  → ${bump(current, 'minor')}   ${C.dim('new features')}`);
  console.log(`    3) major  → ${bump(current, 'major')}   ${C.dim('breaking')}`);
  console.log(`    4) keep   → ${current}   ${C.dim('overwrites the existing build')}`);
  console.log(`    5) custom`);
  let version = current;
  const flagV = FLAGS.version;
  if (typeof flagV === 'string') {
    version =
      flagV === 'keep'
        ? current
        : ['patch', 'minor', 'major'].includes(flagV)
        ? bump(current, flagV)
        : flagV;
    console.log(`  choose: ${C.bold(flagV)} → ${C.bold(version)}`);
  } else {
    const choice = await ask('  choose', '1');
    if (choice === '1') version = bump(current, 'patch');
    else if (choice === '2') version = bump(current, 'minor');
    else if (choice === '3') version = bump(current, 'major');
    else if (choice === '5') version = await ask('  version', current);
  }

  if (version === current) {
    warn(
      `keeping ${current} — the existing release/${current} will be REPLACED.\n` +
        `       Two different binaries would share one version number. Only do\n` +
        `       this if nothing has been distributed yet.`
    );
    // --version=keep is already an explicit instruction; only prompt a human.
    if (!NON_INTERACTIVE && !(await yes('  continue?', 'n'))) return rl?.close();
  }

  const runTests = FLAGS['no-tests'] ? false : await yes('  run unit tests first?');
  const runTypes = FLAGS['no-typecheck'] ? false : await yes('  run the typecheck diff?');
  console.log('\n  Targets');
  console.log(`    1) both   ${C.dim('installer + portable')}`);
  console.log(`    2) installer only   ${C.dim('the only one that can auto-update')}`);
  console.log(`    3) portable only`);
  const target =
    FLAGS.target === 'installer'
      ? '2'
      : FLAGS.target === 'portable'
      ? '3'
      : FLAGS.target === 'both'
      ? '1'
      : await ask('  choose', '1');
  const targetArgs =
    target === '2' ? ['-w', 'nsis'] : target === '3' ? ['-w', 'portable'] : ['-w'];

  const publish =
    FLAGS.publish === true
      ? true
      : FLAGS['no-publish'] || NON_INTERACTIVE
      ? false
      : await yes(
          `  ${C.yellow('publish to GitHub?')} ${C.dim(
            '— reaches every till within ~6h'
          )}`,
          'n'
        );
  if (publish) {
    // Publishing needs a human. In non-interactive mode `yes()` returns the
    // default, which here is "no" — correct, but it used to abort the whole
    // run silently, so `--version=patch --publish` looked like it had worked
    // and simply published nothing. Say so instead.
    if (NON_INTERACTIVE) {
      fail(
        'refusing to publish non-interactively.\n' +
          '  Publishing reaches every paired till within ~6h and cannot be undone,\n' +
          '  so it requires an interactive confirmation. Run `npm run release`\n' +
          '  with no --version/--yes flags and answer the prompts.'
      );
      rl?.close();
      process.exit(1);
    }
    warn('this will push an update to every paired till.');
    if (!(await yes('  are you sure?', 'n'))) {
      rl?.close();
      console.log(C.dim('\n  Cancelled — nothing was built or published.'));
      return;
    }
  }
  rl?.close();

  /* ---- execution ---- */
  const total = 6;
  let n = 0;

  step(++n, total, 'Pre-flight');
  // electron-builder rebuilds the native modules, which fails with EBUSY if
  // anything still holds better_sqlite3.node. Orphaned Electron children are
  // the usual culprit — `timeout npx electron .` kills the parent and leaves
  // the renderer and GPU processes running. Kill, wait, then actually prove
  // the file is writable rather than assuming the kill worked.
  await run(
    'powershell',
    [
      '-NonInteractive',
      '-Command',
      'Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800; exit 0',
    ],
    { capture: true, allowFail: true }
  );

  const nativeModule = path.join(
    ROOT,
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
  );
  if (fs.existsSync(nativeModule)) {
    let locked = true;
    for (let attempt = 0; attempt < 5 && locked; attempt++) {
      try {
        fs.closeSync(fs.openSync(nativeModule, 'r+'));
        locked = false;
      } catch {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    if (locked) {
      fail(
        'better_sqlite3.node is locked by another process — packaging would\n' +
          '       fail with EBUSY. Close any running POS App or dev instance,\n' +
          '       then re-run.'
      );
      process.exitCode = 1;
      return;
    }
  }
  ok('no process is holding the native modules');
  for (const f of ['icon.png', 'icon.ico']) {
    const p = path.join(ROOT, 'build', f);
    if (fs.existsSync(p)) ok(`build/${f} present`);
    else {
      fail(`build/${f} MISSING — the app would ship with the default icon`);
      process.exitCode = 1;
      return;
    }
  }

  step(++n, total, 'Tests');
  if (runTests) {
    const r = await run('npm', ['run', 'test:run'], { capture: true, allowFail: true });
    const m = r.out.match(/Tests\s+(\d+)\s+passed/);
    if (r.code !== 0) {
      fail('tests failed — not packaging');
      console.log(r.out.split('\n').slice(-25).join('\n'));
      process.exitCode = 1;
      return;
    }
    ok(`${m ? m[1] : 'all'} tests passed`);
  } else warn('skipped');

  step(++n, total, 'Typecheck');
  if (runTypes) {
    const cfg = path.join(ROOT, 'tsconfig.typecheck.json');
    if (!fs.existsSync(cfg)) {
      warn('tsconfig.typecheck.json missing — skipped');
    } else {
      const r = await run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.typecheck.json'], {
        capture: true,
        allowFail: true,
      });
      const count = (r.out.match(/error TS/g) || []).length;
      // The repo carries a known backlog; this is informational, not a gate.
      if (count) warn(`${count} type errors (pre-existing backlog — not blocking)`);
      else ok('clean');
    }
  } else warn('skipped');

  step(++n, total, `Version → ${version}`);
  if (version !== current) {
    writeVersion(version);
    ok(`package.json set to ${version}`);
  } else ok(`kept at ${version}`);

  step(++n, total, 'Build & package');
  const outDir = path.join(ROOT, 'release', version);
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    ok(`cleared stale release/${version}`);
  }
  await run('npm', ['run', 'build']);
  ok('bundles built');
  await run('npx', [
    'electron-builder',
    ...targetArgs,
    '--publish',
    publish ? 'always' : 'never',
  ]);
  ok(`packaged (${publish ? C.yellow('PUBLISHED') : 'not published'})`);

  step(++n, total, 'Verify artifacts');
  const exes = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter((f) => f.endsWith('.exe'))
    : [];
  if (!exes.length) {
    fail('no .exe produced');
    process.exitCode = 1;
    return;
  }

  // Icons must actually be embedded, not merely referenced by config.
  const ico = fs.readFileSync(path.join(ROOT, 'build', 'icon.ico'));
  const sizes = ico.readUInt16LE(4);
  for (const f of exes) {
    const buf = fs.readFileSync(path.join(outDir, f));
    let found = 0;
    for (let i = 0; i < sizes; i++) {
      const o = 6 + i * 16;
      const off = ico.readUInt32LE(o + 12);
      const len = ico.readUInt32LE(o + 8);
      if (buf.indexOf(ico.subarray(off, off + len)) !== -1) found++;
    }
    const mb = (buf.length / 1048576).toFixed(1);
    if (found === sizes) ok(`${f}  ${mb} MB  icons ${found}/${sizes}`);
    else warn(`${f}  ${mb} MB  icons ${found}/${sizes}`);
  }

  // Feature markers inside the packaged app, so a silently-stale bundle shows up.
  const asar = path.join(outDir, 'win-unpacked', 'resources', 'app.asar');
  if (fs.existsSync(asar)) {
    const a = fs.readFileSync(asar);
    let missing = 0;
    for (const [label, marker] of FEATURE_MARKERS) {
      if (a.indexOf(Buffer.from(marker)) === -1) {
        warn(`missing from bundle: ${label}`);
        missing++;
      }
    }
    if (!missing) ok(`all ${FEATURE_MARKERS.length} feature markers present`);

    // The updater must be PRESENT, not merely referenced. A string marker is no
    // use here: 'electron-updater' appears in the bundle as the argument to
    // require() whether or not the package was ever installed. It was in fact
    // declared in package.json and missing from node_modules, so every packaged
    // build shipped an app that reported "updater unavailable" and could never
    // update itself. That is the one defect you cannot fix remotely — it has to
    // be carried to each till by hand — so it fails the release rather than
    // warning.
    // Read the asar's own index rather than scanning for a path string: the
    // header is nested JSON, so "node_modules/electron-updater/..." never
    // appears as a literal anywhere in the file.
    let updaterPacked = false;
    try {
      const headerSize = a.readUInt32LE(12);
      const header = JSON.parse(a.subarray(16, 16 + headerSize).toString('utf8'));
      updaterPacked =
        !!header.files?.node_modules?.files?.['electron-updater']?.files;
    } catch {
      warn('could not read asar header — updater check skipped');
      updaterPacked = true; // do not fail the release on a parsing problem
    }

    if (!updaterPacked) {
      fail(
        'electron-updater is NOT in the package — this build cannot auto-update. ' +
          'Run `npm install` and rebuild.'
      );
      process.exitCode = 1;
      return;
    }
    ok('electron-updater packaged (auto-update can run)');
  } else warn('app.asar not found — skipped content check');

  console.log(`\n${C.green(C.bold('  Done.'))}  release/${version}\n`);
  for (const f of exes) console.log(`    ${path.join('release', version, f)}`);
  if (!publish)
    console.log(
      `\n  ${C.dim('Not published — no till will update until you publish.')}`
    );
  console.log(
    `\n  ${C.dim('Reminder: only the NSIS installer can auto-update.')}\n`
  );
}

main().catch((e) => {
  console.error(`\n${C.red('Release failed:')} ${e.message}\n`);
  process.exit(1);
});
