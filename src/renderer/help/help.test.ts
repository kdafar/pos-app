import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOPICS } from './topics';
import {
  FIRST_DAY,
  SCREEN_HELP,
  SCREEN_PERMISSION,
  WORDS,
  accessFor,
  canOpen,
  firstDayPath,
  jobFor,
  jobOrder,
  normalize,
  search,
  visibleTopics,
} from './guide';
import { strings } from '../i18n/strings';
import { ERROR_CATALOG } from '../../shared/errorCatalog';
import { PERMISSIONS } from '../../shared/permissions';
import type { HelpLang, HelpMarkers, HelpStepWords } from './types';

const LANGS: HelpLang[] = ['en', 'ar'];
const IMAGES = path.join(__dirname, 'images');
const SUPPORT = '+965 2241 5093';
const MARKERS = JSON.parse(fs.readFileSync(path.join(IMAGES, 'markers.json'), 'utf8')) as HelpMarkers;

const allRefs = TOPICS.flatMap((t) => t.steps.map((s) => `${t.id}.${s.id}`));

function eachStepWords(fn: (lang: HelpLang, ref: string, w: HelpStepWords) => void) {
  for (const lang of LANGS)
    for (const [topicId, tw] of Object.entries(WORDS[lang].topics))
      for (const [stepId, w] of Object.entries(tw.steps)) fn(lang, `${topicId}.${stepId}`, w);
}

describe('help guide content', () => {
  it('every topic and step has EN and AR words', () => {
    for (const lang of LANGS) {
      for (const topic of TOPICS) {
        const tw = WORDS[lang].topics[topic.id];
        expect(tw, `${lang}: topic ${topic.id}`).toBeTruthy();
        expect(tw.title.trim(), `${lang}: ${topic.id} title`).not.toBe('');
        expect(tw.blurb.trim(), `${lang}: ${topic.id} blurb`).not.toBe('');
        for (const step of topic.steps) {
          const w = tw.steps[step.id];
          expect(w, `${lang}: step ${topic.id}.${step.id}`).toBeTruthy();
          expect(w.title.trim()).not.toBe('');
          expect(w.summary.trim()).not.toBe('');
          expect(w.steps.length, `${lang}: ${topic.id}.${step.id} has steps`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has no words for steps that do not exist', () => {
    eachStepWords((lang, ref) => expect(allRefs, `${lang}: orphan ${ref}`).toContain(ref));
    for (const lang of LANGS)
      for (const topicId of Object.keys(WORDS[lang].topics))
        expect(TOPICS.map((t) => t.id), `${lang}: orphan topic ${topicId}`).toContain(topicId);
  });

  it('EN and AR have the same number of lines in every box', () => {
    for (const ref of allRefs) {
      const [t, s] = [ref.slice(0, ref.indexOf('.')), ref.slice(ref.indexOf('.') + 1)];
      const e = WORDS.en.topics[t].steps[s];
      const a = WORDS.ar.topics[t].steps[s];
      expect(a.steps.length, `${ref} steps`).toBe(e.steps.length);
      expect((a.next ?? []).length, `${ref} next`).toBe((e.next ?? []).length);
      expect((a.careful ?? []).length, `${ref} careful`).toBe((e.careful ?? []).length);
    }
  });

  it('every picture note count matches its markers, and every picture file exists', () => {
    for (const topic of TOPICS) {
      for (const step of topic.steps) {
        for (const lang of LANGS) {
          const notes = WORDS[lang].topics[topic.id].steps[step.id].notes ?? [];
          const ref = `${lang}: ${topic.id}.${step.id}`;
          if (!step.picture) {
            expect(notes.length, `${ref} has notes but no picture`).toBe(0);
            continue;
          }
          const markers = MARKERS[step.picture.file]?.[lang];
          expect(markers, `${ref} has no markers in markers.json — run scripts/help-shots/shoot.cjs`).toBeTruthy();
          expect(notes.length, `${ref} notes vs markers`).toBe(markers!.length);
          for (const m of markers!) {
            expect(m.x).toBeGreaterThanOrEqual(0);
            expect(m.x).toBeLessThanOrEqual(100);
            expect(m.y).toBeGreaterThanOrEqual(0);
            expect(m.y).toBeLessThanOrEqual(100);
          }
          const file = path.join(IMAGES, `${step.picture.file}.${lang}.webp`);
          expect(fs.existsSync(file), `${ref} missing ${file}`).toBe(true);
        }
      }
    }
  });

  it('every "?" mapping points to a real step', () => {
    for (const [screen, ref] of Object.entries(SCREEN_HELP))
      expect(allRefs, `${screen} → ${ref}`).toContain(ref);
  });

  it('first-day paths are 6–9 real steps with a "why" line in both languages', () => {
    for (const [job, path] of Object.entries(FIRST_DAY)) {
      expect(path.length).toBeGreaterThanOrEqual(6);
      expect(path.length).toBeLessThanOrEqual(9);
      for (const ref of path) {
        expect(allRefs, `${job}: ${ref}`).toContain(ref);
        for (const lang of LANGS)
          expect(WORDS[lang].firstDay[job as keyof typeof FIRST_DAY][ref], `${lang} ${job} why ${ref}`).toBeTruthy();
      }
    }
  });

  it('only uses real permission names', () => {
    for (const topic of TOPICS)
      for (const p of topic.steps.flatMap((s) => s.requires ?? []))
        expect(PERMISSIONS as readonly string[]).toContain(p);
    for (const topic of TOPICS)
      for (const step of topic.steps)
        for (const screen of ([] as string[]).concat(step.screen ?? []))
          expect(Object.keys(SCREEN_PERMISSION), `${topic.id}.${step.id} screen ${screen}`).toContain(screen);
  });

  it('gates each screen on the same permission as its route in App.tsx', () => {
    const app = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
    const routes: Record<string, string> = {};
    for (const m of app.matchAll(/<Route (?:index|path="([^"]+)") element=\{<PermissionRoute permission='([^']+)'/g)) {
      const raw = m[1] ?? '';
      routes[raw === '' ? '/' : raw.startsWith('/') ? raw : `/${raw}`] = m[2];
    }
    expect(Object.keys(routes).length).toBeGreaterThan(10);
    expect(SCREEN_PERMISSION).toEqual(routes);
  });

  it('every "?" screen is a sidebar screen or a signed-out screen', () => {
    for (const screen of Object.keys(SCREEN_HELP))
      expect([...Object.keys(SCREEN_PERMISSION), '/login', '/pair']).toContain(screen);
  });

  it('puts the support number only in the one "still not working" line', () => {
    for (const lang of LANGS) {
      const ui = WORDS[lang].ui;
      expect(ui.stillNotWorking).toContain(SUPPORT);
      const everythingElse = JSON.stringify({ ...WORDS[lang], ui: { ...ui, stillNotWorking: '' } });
      // No other phone-like number anywhere in the guide.
      expect(everythingElse).not.toMatch(/\+?\d[\d\s]{6,}\d/);
    }
  });

  it('every bold name is a real on-screen label in that language', () => {
    // Collect every label the app can show, with {placeholders} as wildcards.
    const labels: Record<HelpLang, RegExp[]> = { en: [], ar: [] };
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const push = (lang: HelpLang, v: string) => {
      const pattern = v
        .trim()
        .replace(/[.:]$/, '')
        .split(/\{\w+\}/)
        .map(esc)
        .join('.+');
      if (pattern) labels[lang].push(new RegExp(`^${pattern}[.:]?$`, 'u'));
    };
    const add = (lang: HelpLang, value: string) => {
      push(lang, value.replace(/\*/g, ''));
      // A *emphasised* part of a sentence is a name on its own (for example
      // the back-office menu names quoted on the pair screen) …
      for (const m of value.matchAll(/\*(.+?)\*/g)) push(lang, m[1]);
      // … and so is the first sentence of a longer message.
      const first = value.replace(/\*/g, '').split(/(?<=[.؟?])\s/)[0];
      if (first !== value) push(lang, first);
    };
    for (const entry of Object.values(strings) as { en: string; ar: string }[]) {
      add('en', entry.en);
      add('ar', entry.ar);
    }
    for (const entry of Object.values(ERROR_CATALOG) as any[])
      for (const lang of LANGS) {
        add(lang, entry[lang].title);
      }
    // Labels drawn from data or glyphs rather than the strings files.
    const extra: Record<HelpLang, string[]> = {
      en: ['+', '−', 'English', 'العربية'],
      ar: ['+', '−', 'English', 'العربية'],
    };

    // Bold may also name another place in the guide ("see **Change or cancel**").
    for (const lang of LANGS)
      for (const tw of Object.values(WORDS[lang].topics)) {
        push(lang, tw.title);
        for (const sw of Object.values(tw.steps)) push(lang, sw.title);
      }

    const bad: string[] = [];
    eachStepWords((lang, ref, w) => {
      const lines = [w.summary, ...w.steps, ...(w.next ?? []), ...(w.careful ?? []), ...(w.notes ?? [])];
      for (const line of lines) {
        for (const m of line.matchAll(/\*\*(.+?)\*\*/g)) {
          const name = m[1];
          // "Something went wrong → Printer not printing" points at the guide itself.
          if (name.includes('→') || name.includes('←')) continue;
          const ok =
            extra[lang].includes(name) ||
            labels[lang].some((re) => re.test(name) || re.test(name.replace(/[.:]$/, '')));
          if (!ok) bad.push(`${lang} ${ref}: **${name}**`);
        }
      }
    });
    expect(bad).toEqual([]);
  });
});

describe('help guide access and search', () => {
  const cashier = accessFor({
    id: 1,
    role: 'pos',
    permissions: ['orders.create', 'orders.view_own', 'orders.edit_unpaid', 'orders.cancel', 'tables.manage', 'orders.mark_paid'],
  });
  const kitchen = accessFor({
    id: 2,
    role: 'kitchen',
    permissions: ['orders.view_all', 'orders.kitchen_view', 'orders.change_status'],
  });
  const admin = accessFor({ id: 3, role: 'admin', permissions: [...PERMISSIONS] });
  const nobody = accessFor(null);
  // What an unpackaged dev build answers when nobody is signed in.
  const devStandIn = accessFor({ id: null, role: 'admin', permissions: ['orders.create'] });

  it('follows the permission list, not the role, exactly like the sidebar', () => {
    // An admin whose Settings right was taken away does not see Settings help.
    const noSettings = accessFor({ id: 5, role: 'admin', permissions: PERMISSIONS.filter((p) => p !== 'settings.manage') });
    expect(canOpen('printing.setup-printer', noSettings)).toBe(false);
    expect(canOpen('manager.update', noSettings)).toBe(true);
    // The kitchen role has no Recent Orders in its sidebar, so no orders help.
    expect(visibleTopics(kitchen).map((t) => t.id)).not.toContain('orders');
    expect(visibleTopics(kitchen).map((t) => t.id)).not.toContain('pay');
    // A cashier has no Closing Report, Settings or Kitchen display.
    const ids = visibleTopics(cashier).map((t) => t.id);
    expect(ids).not.toContain('closing');
    expect(ids).not.toContain('kitchen');
    expect(canOpen('manager.text-size', cashier)).toBe(false);
  });

  it('a user with every permission sees every step', () => {
    for (const ref of allRefs) expect(canOpen(ref, admin), ref).toBe(true);
  });

  it('hides manager steps from cashiers and selling steps from the kitchen', () => {
    expect(canOpen('printing.setup-printer', cashier)).toBe(false);
    expect(canOpen('change.cancel-manager', cashier)).toBe(false);
    expect(canOpen('pay.knet', cashier)).toBe(true);
    expect(canOpen('kitchen.read', cashier)).toBe(false);
    expect(canOpen('kitchen.move', kitchen)).toBe(true);
    expect(canOpen('order.new-order', kitchen)).toBe(false);
  });

  it('works before sign-in with only the steps that need no permission', () => {
    const ids = visibleTopics(nobody).map((t) => t.id);
    expect(ids).toContain('trouble');
    expect(ids).toContain('start');
    expect(ids).not.toContain('order');
    expect(canOpen('start.pair', nobody)).toBe(true);
    expect(canOpen('start.test-print', devStandIn)).toBe(false);
    expect(visibleTopics(devStandIn).map((t) => t.id)).not.toContain('order');
  });

  it('shows the viewer their own job first', () => {
    expect(jobFor(cashier)).toBe('cashier');
    expect(jobFor(kitchen)).toBe('kitchen');
    expect(jobFor(admin)).toBe('manager');
    expect(firstDayPath('kitchen', kitchen).length).toBeGreaterThanOrEqual(6);
    expect(jobOrder(cashier)).toEqual(['cashier']);
    expect(jobOrder(admin)).toEqual(['manager', 'cashier', 'kitchen']);
    const accountant = accessFor({ id: 4, role: 'accountant', permissions: ['orders.view_all', 'reports.view', 'reports.export'] });
    expect(jobFor(accountant)).toBeNull();
    expect(jobOrder(accountant)).toEqual([]);
    expect(jobOrder(nobody)).toEqual([]);
  });

  it('searches both languages, whatever the screen language', () => {
    expect(search('knet', cashier)[0]?.ref).toBe('pay.knet');
    expect(search('كي نت', cashier).map((h) => h.ref)).toContain('pay.knet');
    // Hamza-less typing still matches إضافة.
    expect(search('اضافات', cashier).map((h) => h.ref)).toContain('order.options');
    expect(search('drawer', cashier).map((h) => h.ref)).not.toContain('printing.drawer');
    expect(search('zzzz-nothing', cashier)).toEqual([]);
  });

  it('normalises Arabic letter forms', () => {
    expect(normalize('إضافة')).toBe(normalize('اضافه'));
  });
});
