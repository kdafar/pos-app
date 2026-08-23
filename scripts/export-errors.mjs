// scripts/export-errors.mjs
//
// Writes the catalogue out in the shape the backend agreed on:
//
//   docs/pos-errors.json              — every code, both languages, for diffing
//                                       against their catalogue
//   docs/pos-app-error-inventory.json — the `app` rows only: the failures this
//                                       client raises that the backend cannot
//                                       know about, which is what they asked for
//
// Run: node scripts/export-errors.mjs
//
// src/shared/errorCatalog.ts stays the source of truth — it is what the app
// loads and what the typechecker guards. These files are generated so the two
// catalogues can be compared without either side hand-maintaining a copy.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Transpile and import the real module rather than scraping the file. Node
// cannot load TypeScript directly, and evaluating a sliced-out literal would
// both execute source text and break the first time the file is reformatted.
// esbuild is already present as a Vite dependency.
const bundled = await build({
  entryPoints: [resolve(root, 'src/shared/errorCatalog.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});

const { ERROR_CATALOG } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (...strings) => [
  ...new Set(strings.flatMap((s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]))),
];

// Where each code is actually raised. The backend asked for file, line and the
// trigger condition; all three are in the source, and reading them beats
// maintaining a hand-written list that goes stale on the first refactor.
const RAISE_SITE = /posError\(\s*'([A-Z0-9_]+)'/g;
const LINE_BREAK = /\r?\n/;
const raisedAt = new Map();
for (const file of sourceFiles(resolve(root, 'src'))) {
  const lines = readFileSync(file, 'utf8').split(LINE_BREAK);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RAISE_SITE)) {
      const rel = relative(root, file).split(sep).join('/');
      if (!raisedAt.has(m[1])) raisedAt.set(m[1], []);
      raisedAt.get(m[1]).push({ file: rel, line: i + 1, trigger: line.trim() });
    }
  });
}

const rows = Object.entries(ERROR_CATALOG).map(([code, e]) => ({
  code,
  severity: e.severity,
  retry: e.retry,
  where: e.where,
  http: e.http ?? null,
  origin: e.origin,
  // Matches the backend catalogue's own `sent` field, so drift can be checked
  // mechanically in both directions rather than by reading two documents.
  sent_by_server: e.sent,
  params: placeholders(e.en.title, e.en.body),
  // What the cashier can do, derived rather than restated: `inline` means fix a
  // field, `retry` means try again, `blocker` means call a manager.
  user_action:
    e.severity === 'inline'
      ? 'fix a field'
      : e.retry
        ? 'retry'
        : e.severity === 'blocker'
          ? 'call a manager'
          : 'nothing',
  raised_at: raisedAt.get(code) ?? [],
  en: e.en,
  ar: e.ar,
}));

mkdirSync(resolve(root, 'docs'), { recursive: true });

const write = (name, body) =>
  writeFileSync(resolve(root, name), JSON.stringify(body, null, 2) + '\n', 'utf8');

write('docs/pos-errors.json', {
  generated_from: 'src/shared/errorCatalog.ts',
  note: 'Generated. Edit the TypeScript module, then run: node scripts/export-errors.mjs',
  severities: {
    blocker: 'Centred modal, dimmed backdrop, explicit dismissal. Work stops.',
    toast: 'Bottom-centre card, auto-dismiss, optional retry.',
    inline: 'Message under the control that is wrong. The cashier can fix it now.',
    info: 'Quiet. Queues, progress, confirmations — not a failure.',
  },
  count: rows.length,
  codes: rows,
});

const appRows = rows.filter((r) => r.origin === 'app');
write('docs/pos-app-error-inventory.json', {
  note:
    'Failures raised by the POS client itself — the inventory requested in the error-contract ' +
    'reply. The backend cannot know about these: a missing Windows printer, an item with no ' +
    'price, a line already sent to the kitchen. Ready to merge into the shared catalogue.',
  order_fate:
    'A validation refusal throws before any write, so the order is untouched and stays open on ' +
    'the till. A push failure follows the outbox rule: cleared only on ack, kept under the same ' +
    'temp_id when retryable, marked permanent when not.',
  known_when:
    'Every `app` row with a raised_at under src/main is enforced in the main process. The rules ' +
    'listed in CheckoutModal validate() are also checked in the form before the call, so the ' +
    'cashier sees those before pressing Place Order rather than after.',
  count: appRows.length,
  codes: appRows,
});

const sentCount = rows.filter((r) => r.sent_by_server).length;
console.log(
  `docs/pos-errors.json: ${rows.length} codes ` +
    `(${rows.length - appRows.length} server, ${appRows.length} app; ` +
    `${sentCount} arrive as a server code)`
);
