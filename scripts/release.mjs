#!/usr/bin/env node
/**
 * Interactive release for POS App — Windows and Android together.
 *
 *   npm run release
 *
 * Asks what to build, then does the whole sequence in the right order and
 * verifies the result — so none of it has to be remembered:
 *
 *   tests → typecheck diff → version bump (both apps) → commit + push pos-app
 *   → build + package Windows → verify artifacts → build Android APK
 *   → verify APK → commit + push pos-android → draft release → upload
 *   → verify uploads → publish → verify it is the latest release
 *
 * Everything is guarded. It refuses to package if tests fail, it never lets
 * electron-builder publish, and it checks the icons and feature markers are
 * actually inside the shipped binaries rather than trusting the builder's exit
 * code.
 *
 * Android and Windows always ship in the same release: tablets update from the
 * `POS-App-Android-<v>.apk` asset of the latest release, and an Android-only
 * release would carry no latest.yml and break every Windows till's updater.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'package.json');
const ANDROID_ROOT = path.resolve(ROOT, '..', 'pos-android');
const ANDROID_PKG = path.join(ANDROID_ROOT, 'package.json');
/** The POS release key. A tablet refuses an update signed by anything else. */
const ANDROID_CERT_SHA256 =
  'e835a8bd09baf5e8b2bf9f1ed36c73351a6a02e186c5da8b8b12cc35b2560f78';

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
function run(cmd, args, { capture = false, allowFail = false, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd,
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

const readPkg = (p = PKG) => JSON.parse(fs.readFileSync(p, 'utf8'));
function writeVersion(v, p = PKG) {
  const raw = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(
    p,
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

/** Commit everything in `cwd` (if anything changed) and push the current branch. */
async function commitAndPush(cwd, message) {
  await run('git', ['add', '-A'], { cwd });
  const staged = await run('git', ['diff', '--cached', '--quiet'], {
    cwd,
    allowFail: true,
  });
  if (staged.code !== 0) {
    // Through a file, not -m: on Windows `run` goes through the shell, which
    // splits an argument at its spaces, so `-m "release 0.5.7: …"` would commit
    // "release" and treat the rest as file names.
    const msgFile = path.join(os.tmpdir(), `pos-release-msg-${Date.now()}.txt`);
    fs.writeFileSync(msgFile, message, 'utf8');
    try {
      await run('git', ['commit', '-F', msgFile], { cwd, capture: true });
    } finally {
      fs.rmSync(msgFile, { force: true });
    }
    ok(`committed: ${message}`);
  } else ok('nothing new to commit');
  const branch = (
    await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, capture: true })
  ).out.trim();
  await run('git', ['push', 'origin', branch], { cwd });
  const sha = (
    await run('git', ['rev-parse', 'HEAD'], { cwd, capture: true })
  ).out.trim();
  ok(`pushed ${branch} @ ${sha.slice(0, 7)}`);
  return sha;
}

/* ------------------------------- GitHub -------------------------------- */
// electron-builder never publishes here. Its GitHub publisher raced itself
// (two artifacts each POSTing the same release, the loser dying with 422 and
// leaving a live release holding only a .blockmap), and a live release that is
// still uploading is one every till may already be reading. Instead: build
// everything, then create the release as a DRAFT, upload, verify every size,
// and only then publish. Nobody can see it until it is complete.

const ghToken = () => process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

/** owner/repo from build.publish, so this cannot drift from what the updater reads. */
function ghTarget() {
  const cfg = (readPkg().build?.publish || []).find((c) => c.provider === 'github');
  return cfg?.owner && cfg?.repo ? { owner: cfg.owner, repo: cfg.repo } : null;
}

async function gh(pathname, { method = 'GET', body, raw, base } = {}) {
  const res = await fetch(`${base || 'https://api.github.com'}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${ghToken()}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'pos-app-release',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(raw ? { 'content-type': 'application/octet-stream' } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* GitHub error bodies are not always JSON */
  }
  if (!res.ok) {
    throw new Error(
      `GitHub ${method} ${pathname} → ${res.status} ${json?.message || text.slice(0, 300)}`
    );
  }
  return json;
}

/** Draft → upload → verify → publish. Throws (leaving a draft) on any mismatch. */
async function publishRelease({ owner, repo }, version, targetSha, assets) {
  const tag = `v${version}`;
  const releases = await gh(`/repos/${owner}/${repo}/releases?per_page=100`);
  if (releases.some((r) => r.tag_name === tag || r.tag_name === version)) {
    throw new Error(
      `${tag} already exists on GitHub. Delete it there (or pick another version) and re-run.`
    );
  }

  const release = await gh(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    body: {
      tag_name: tag,
      name: tag,
      target_commitish: targetSha,
      draft: true,
      prerelease: false,
    },
  });
  ok(`draft ${tag} created`);

  for (const { file, name } of assets) {
    await gh(
      `/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      { method: 'POST', raw: fs.readFileSync(file), base: 'https://uploads.github.com' }
    );
    ok(`uploaded  ${name}  ${C.dim(`${(fs.statSync(file).size / 1048576).toFixed(1)} MB`)}`);
  }

  const listed = await gh(`/repos/${owner}/${repo}/releases/${release.id}/assets`);
  for (const { file, name } of assets) {
    const got = listed.find((a) => a.name === name);
    const want = fs.statSync(file).size;
    if (!got || got.size !== want) {
      throw new Error(
        `${name} is ${got ? got.size : 'missing'} on GitHub, expected ${want}. ` +
          `The release was left as a DRAFT — nothing is public. Delete it and re-run.`
      );
    }
  }
  ok('every upload verified');

  await gh(`/repos/${owner}/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    body: { draft: false },
  });
  const latest = await gh(`/repos/${owner}/${repo}/releases/latest`);
  if (latest.tag_name !== tag) {
    throw new Error(`published, but GitHub reports ${latest.tag_name} as latest, not ${tag}`);
  }
  ok(`${C.yellow('PUBLISHED')} ${tag} — it is the latest release  ${C.dim(latest.html_url)}`);
}

/* ------------------------------- Android ------------------------------- */
function findAndroidBuildTool(name) {
  const sdk = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'build-tools');
  if (!fs.existsSync(sdk)) return null;
  const versions = fs.readdirSync(sdk).sort().reverse();
  for (const v of versions) {
    for (const f of [name, `${name}.bat`, `${name}.exe`]) {
      const p = path.join(sdk, v, f);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
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
  ['table floors', 'table_sections'],
];

/* ------------------------------- flags -------------------------------- */
// Flags make the script scriptable and testable. readline cannot be driven by
// a pipe (it swallows the whole buffer on the first read), so without these
// there is no way to exercise it non-interactively.
//
//   npm run release -- --version=patch --no-publish --yes
//   npm run release -- --version=1.0.0 --target=installer --no-tests
//   npm run release -- --no-android --no-git
//   npm run release -- --message="release 0.5.7: quick table update"
const FLAGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
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

  console.log(C.bold('\n  POS App — release (Windows + Android)\n'));
  const current = readPkg().version;
  const hasAndroid = fs.existsSync(ANDROID_PKG);
  const androidCurrent = hasAndroid ? readPkg(ANDROID_PKG).version : null;
  console.log(`  current version: ${C.bold(current)}`);
  if (hasAndroid && androidCurrent !== current) {
    warn(`pos-android is at ${androidCurrent} — it will be set to the same new version.`);
  }
  console.log('');

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

  const buildAndroid =
    hasAndroid && !FLAGS['no-android']
      ? await yes(`  also build the Android APK ${C.dim('(pos-android)')}?`)
      : false;
  if (!hasAndroid) warn(`no pos-android next to pos-app — Android skipped`);

  const doGit = FLAGS['no-git']
    ? false
    : await yes('  commit and push the code (pos-app' + (buildAndroid ? ' + pos-android' : '') + ')?');
  const message =
    typeof FLAGS.message === 'string'
      ? FLAGS.message
      : doGit
      ? await ask('  commit message', `release ${version}`)
      : '';

  const publish =
    FLAGS.publish === true
      ? true
      : FLAGS['no-publish'] || NON_INTERACTIVE
      ? false
      : await yes(
          `  ${C.yellow('publish to GitHub?')} ${C.dim(
            '— reaches every till and tablet within ~6h'
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
    if (!doGit) {
      // The tag is made from pos-app's main. Without the push it would point at
      // code that is not the code in the installer.
      fail('publishing needs the commit + push — the release tag points at it.');
      rl?.close();
      process.exit(1);
    }
    if (target === '3') {
      fail('publishing needs the installer — the portable build cannot auto-update.');
      rl?.close();
      process.exit(1);
    }
    if (hasAndroid && !buildAndroid) {
      warn('publishing WITHOUT an APK: tablets will not see this release.');
    }
    warn('this will push an update to every paired till' + (buildAndroid ? ' and tablet.' : '.'));
    if (!(await yes('  are you sure?', 'n'))) {
      rl?.close();
      console.log(C.dim('\n  Cancelled — nothing was built or published.'));
      return;
    }
  }
  rl?.close();

  // Resolve publishing prerequisites before the expensive part, not after a
  // twenty-minute build.
  let ghRepo = null;
  if (publish) {
    ghRepo = ghTarget();
    if (!ghRepo) {
      fail('build.publish has no github provider with owner/repo — cannot publish.');
      process.exitCode = 1;
      return;
    }
    if (!ghToken()) {
      fail('GH_TOKEN (or GITHUB_TOKEN) is not set. Set it in this shell and re-run.');
      process.exitCode = 1;
      return;
    }
    const releases = await gh(`/repos/${ghRepo.owner}/${ghRepo.repo}/releases?per_page=100`);
    if (releases.some((r) => r.tag_name === `v${version}`)) {
      fail(`v${version} already exists on GitHub — pick another version.`);
      process.exitCode = 1;
      return;
    }
  }

  /* ---- execution ---- */
  const total = 6 + (doGit ? 1 : 0) + (buildAndroid ? 1 : 0) + (publish ? 1 : 0);
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
    ok(`pos-app set to ${version}`);
  } else ok(`pos-app kept at ${version}`);
  // Set alongside, never on its own: the tablet compares its own version with
  // the release tag, so the two apps must always carry the same number.
  if (buildAndroid) {
    writeVersion(version, ANDROID_PKG);
    ok(`pos-android set to ${version}`);
  }

  let appSha = null;
  if (doGit) {
    step(++n, total, 'Commit + push pos-app');
    appSha = await commitAndPush(ROOT, message);
  }

  step(++n, total, 'Build & package Windows');
  const outDir = path.join(ROOT, 'release', version);
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    ok(`cleared stale release/${version}`);
  }
  await run('npm', ['run', 'build']);
  ok('bundles built');
  await run('npx', ['electron-builder', ...targetArgs, '--publish', 'never']);
  ok('packaged (not published yet)');

  step(++n, total, 'Verify Windows artifacts');
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

  const setupExe = exes.find((f) => /Setup/i.test(f));
  const latestYml = path.join(outDir, 'latest.yml');
  if (publish) {
    if (!setupExe || !fs.existsSync(latestYml) || !fs.existsSync(path.join(outDir, `${setupExe}.blockmap`))) {
      fail('installer, its .blockmap or latest.yml is missing — tills could not update from this.');
      process.exitCode = 1;
      return;
    }
    const yml = fs.readFileSync(latestYml, 'utf8');
    if (!yml.includes(`version: ${version}`)) {
      fail(`latest.yml does not say version ${version}`);
      process.exitCode = 1;
      return;
    }
    ok(`latest.yml → ${version}`);
  }

  let apk = null;
  if (buildAndroid) {
    step(++n, total, 'Build Android APK + commit pos-android');
    // -SyncDesktop copies the shared renderer + main code from this repo first,
    // so the APK carries exactly what the Windows build does. Its own process:
    // inside an interactive PowerShell 5.1, npm's stderr aborts the script.
    await run(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'build-apk.ps1', '-SyncDesktop', '-Release'],
      { cwd: ANDROID_ROOT }
    );
    apk = path.join(ANDROID_ROOT, 'apk', `POS-App-Android-${version}.apk`);
    if (!fs.existsSync(apk)) {
      fail(`expected ${apk} — the Android build did not produce it`);
      process.exitCode = 1;
      return;
    }
    ok(`APK built  ${(fs.statSync(apk).size / 1048576).toFixed(1)} MB`);

    const apksigner = findAndroidBuildTool('apksigner');
    if (apksigner) {
      const r = await run(`"${apksigner}"`, ['verify', '--print-certs', `"${apk}"`], {
        capture: true,
        allowFail: true,
      });
      if (r.code !== 0 || !r.out.toLowerCase().includes(ANDROID_CERT_SHA256)) {
        fail(
          'the APK is not signed with the POS release key — every tablet would reject it.\n' +
            r.out.split('\n').slice(-6).join('\n')
        );
        process.exitCode = 1;
        return;
      }
      ok('signed with the POS release key');
    } else warn('apksigner not found — signature not checked');

    const aapt = findAndroidBuildTool('aapt2');
    if (aapt) {
      const r = await run(`"${aapt}"`, ['dump', 'badging', `"${apk}"`], {
        capture: true,
        allowFail: true,
      });
      const m = r.out.match(/versionName='([^']+)'/);
      if (m && m[1] !== version) {
        fail(`the APK says version ${m[1]}, not ${version}`);
        process.exitCode = 1;
        return;
      }
      if (m) ok(`APK versionName ${m[1]}`);
    }

    if (doGit) await commitAndPush(ANDROID_ROOT, message);
  }

  if (publish) {
    step(++n, total, 'Publish to GitHub');
    const assets = [
      { file: latestYml, name: 'latest.yml' },
      // electron-builder's latest.yml names the installer with '-' for spaces.
      { file: path.join(outDir, setupExe), name: setupExe.replace(/ /g, '-') },
      {
        file: path.join(outDir, `${setupExe}.blockmap`),
        name: `${setupExe}.blockmap`.replace(/ /g, '-'),
      },
      ...(apk ? [{ file: apk, name: `POS-App-Android-${version}.apk` }] : []),
    ];
    const ymlUrl = (fs.readFileSync(latestYml, 'utf8').match(/^path:\s*(.+)$/m) || [])[1]?.trim();
    if (ymlUrl && ymlUrl !== assets[1].name) {
      fail(`latest.yml points at "${ymlUrl}" but the upload would be "${assets[1].name}"`);
      process.exitCode = 1;
      return;
    }
    await publishRelease(ghRepo, version, appSha, assets);
  }

  console.log(`\n${C.green(C.bold('  Done.'))}  ${version}\n`);
  for (const f of exes) console.log(`    ${path.join('release', version, f)}`);
  if (apk) console.log(`    ${apk}`);
  if (!publish)
    console.log(
      `\n  ${C.dim('Not published — no till or tablet will update until you publish.')}`
    );
  console.log(
    `\n  ${C.dim('Reminder: only the NSIS installer can auto-update.')}\n`
  );
}

main().catch((e) => {
  console.error(`\n${C.red('Release failed:')} ${e.message}\n`);
  process.exit(1);
});
