// src/renderer/help/guide.ts
//
// Pure logic for the guide: who sees what, search, first-day paths and the
// screen → step map. No React here, so all of it is unit-tested.
import { isAdminRole, type Permission } from '../../shared/permissions';
import { TOPICS } from './topics';
import { en } from './words/en';
import { ar } from './words/ar';
import type {
  HelpJob,
  HelpLang,
  HelpRef,
  HelpScreen,
  HelpStepDef,
  HelpStepWords,
  HelpTopicDef,
  HelpWords,
} from './types';

export const WORDS: Record<HelpLang, HelpWords> = { en, ar };

/* ---------------- first-day paths ---------------- */

/** 6–9 steps per job, in order. Each needs a firstDay "why" line per language. */
export const FIRST_DAY: Record<HelpJob, HelpRef[]> = {
  cashier: [
    'start.sign-in',
    'start.check-till',
    'order.new-order',
    'order.find-dish',
    'order.options',
    'pay.place',
    'pay.cash',
    'pay.knet',
    'offline.works',
  ],
  kitchen: [
    'start.sign-in',
    'start.check-till',
    'kitchen.read',
    'kitchen.move',
    'offline.works',
    'trouble.missing-order',
  ],
  manager: [
    'start.test-print',
    'change.approve',
    'change.cancel-manager',
    'orders.find',
    'closing.read',
    'closing.print',
    'manager.update',
    'offline.waiting',
  ],
};

/* ---------------- screen → step ("?" button) ---------------- */

/**
 * The ONE place that says which step a screen's "?" opens. Keyed on the route
 * path, so no screen has to know about the guide. A screen not listed here,
 * or a step the user may not see, opens the guide home page.
 */
export const SCREEN_HELP: Record<string, HelpRef> = {
  '/': 'order.new-order',
  '/orders': 'orders.find',
  '/kitchen': 'kitchen.read',
  '/reports/closing': 'closing.read',
  '/tables': 'manager.clear-table',
  '/settings': 'printing.setup-printer',
  '/updates': 'manager.update',
  '/permissions': 'manager.permissions',
  '/categories': 'manager.lists',
  '/items': 'manager.lists',
  '/promos': 'manager.lists',
  '/payment-methods': 'manager.lists',
  '/locations': 'manager.lists',
  '/login': 'start.sign-in',
  '/pair': 'start.pair',
};

export function screenRef(pathname: string): HelpRef | null {
  return SCREEN_HELP[pathname] ?? null;
}

/* ---------------- access ---------------- */

export type HelpViewer = {
  id?: string | number | null;
  role?: string | null;
  permissions?: string[] | null;
} | null;

export type Access = { admin: boolean; perms: Set<string> };

export function accessFor(viewer: HelpViewer): Access {
  // No user id = nobody signed in. A dev build answers that with a stand-in
  // admin for convenience; the guide must not, or the sign-in screen's guide
  // would differ between a dev build and a real till.
  if (!viewer || viewer.id == null || viewer.id === '') {
    return { admin: false, perms: new Set() };
  }
  return {
    admin: isAdminRole(viewer?.role),
    perms: new Set(viewer?.permissions ?? []),
  };
}

/**
 * The permission each sidebar screen is gated on - the same one its route in
 * App.tsx checks (help.test.ts reads App.tsx to keep the two equal). The guide
 * shows a step only when its screen is in the user's sidebar, so nobody reads
 * about a screen they cannot open.
 */
export const SCREEN_PERMISSION: Record<HelpScreen, Permission> = {
  '/': 'orders.create',
  '/orders': 'orders.view_own',
  '/kitchen': 'orders.kitchen_view',
  '/reports/closing': 'reports.view',
  '/categories': 'catalog.manage',
  '/items': 'catalog.manage',
  '/promos': 'catalog.manage',
  '/tables': 'tables.manage',
  '/payment-methods': 'payments.manage',
  '/locations': 'locations.manage',
  '/settings': 'settings.manage',
  '/updates': 'updates.manage',
  '/permissions': 'users.permissions',
};

/** Same rule as the sidebar: the permission list only, no role shortcuts. */
export function stepAllowed(step: HelpStepDef, access: Access): boolean {
  const screens = step.screen ? ([] as HelpScreen[]).concat(step.screen) : [];
  if (screens.length && !screens.some((r) => access.perms.has(SCREEN_PERMISSION[r]))) return false;
  if (step.requires?.length && !step.requires.some((p) => access.perms.has(p))) return false;
  return true;
}

export function visibleSteps(topic: HelpTopicDef, access: Access): HelpStepDef[] {
  return topic.steps.filter((s) => stepAllowed(s, access));
}

export function visibleTopics(access: Access): HelpTopicDef[] {
  return TOPICS.filter((t) => visibleSteps(t, access).length > 0);
}

/**
 * The job whose first-day card is shown first — or null when none fits (an
 * accountant, or nobody signed in), rather than a wrong "Your job" card.
 */
export function jobFor(access: Access): HelpJob | null {
  if (access.admin || access.perms.has('orders.approve')) return 'manager';
  if (access.perms.has('orders.kitchen_view') && !access.perms.has('orders.create'))
    return 'kitchen';
  if (access.perms.has('orders.create')) return 'cashier';
  return null;
}

/**
 * First-day cards to show: the viewer's own job first, then any other job
 * whose WHOLE path they can open. A cashier is not shown a "Branch manager"
 * card cut down to the two steps a cashier may see.
 */
export function jobOrder(access: Access): HelpJob[] {
  const mine = jobFor(access);
  const others = (['cashier', 'kitchen', 'manager'] as HelpJob[]).filter(
    (j) => j !== mine && FIRST_DAY[j].every((ref) => canOpen(ref, access))
  );
  return mine ? [mine, ...others] : others;
}

/* ---------------- lookup ---------------- */

export function splitRef(ref: string): { topicId: string; stepId: string } {
  const i = ref.indexOf('.');
  return { topicId: ref.slice(0, i), stepId: ref.slice(i + 1) };
}

export function findTopic(id: string): HelpTopicDef | undefined {
  return TOPICS.find((t) => t.id === id);
}

/** True when the ref names a real step that this viewer may see. */
export function canOpen(ref: string, access: Access): boolean {
  const { topicId, stepId } = splitRef(ref);
  const topic = findTopic(topicId);
  if (!topic) return false;
  return visibleSteps(topic, access).some((s) => s.id === stepId);
}

export function stepWords(lang: HelpLang, ref: string): HelpStepWords | undefined {
  const { topicId, stepId } = splitRef(ref);
  return WORDS[lang].topics[topicId]?.steps[stepId];
}

/** A first-day path, cut down to the steps this viewer may open. */
export function firstDayPath(job: HelpJob, access: Access): HelpRef[] {
  return FIRST_DAY[job].filter((ref) => canOpen(ref, access));
}

/* ---------------- search ---------------- */

/**
 * Lower-case, and fold the Arabic letter forms people type interchangeably
 * (أ إ آ → ا, ة → ه, ى → ي) and drop diacritics and tatweel, so "اضافة"
 * finds "إضافة".
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

function stepText(w: HelpStepWords | undefined): { title: string; body: string } {
  if (!w) return { title: '', body: '' };
  return {
    title: w.title,
    body: [w.summary, ...w.steps, ...(w.next ?? []), ...(w.careful ?? []), ...(w.notes ?? []), ...(w.keywords ?? [])].join(' '),
  };
}

export type SearchHit = { ref: HelpRef; score: number };

/**
 * Search titles, step text and keywords in BOTH languages, so a cashier who
 * reads Arabic but types "knet" still lands on the right step. Every word of
 * the query must appear somewhere; title matches rank first.
 */
export function search(query: string, access: Access): SearchHit[] {
  const words = normalize(query).split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const topic of visibleTopics(access)) {
    for (const step of visibleSteps(topic, access)) {
      const ref = `${topic.id}.${step.id}` as HelpRef;
      const parts = (['en', 'ar'] as HelpLang[]).map((lang) => {
        const tw = WORDS[lang].topics[topic.id];
        const s = stepText(tw?.steps[step.id]);
        return {
          title: normalize(s.title),
          body: normalize(`${s.body} ${tw?.title ?? ''} ${(tw?.keywords ?? []).join(' ')}`),
        };
      });
      let score = 0;
      let all = true;
      for (const w of words) {
        const inTitle = parts.some((p) => p.title.includes(w));
        const inBody = parts.some((p) => p.body.includes(w));
        if (!inTitle && !inBody) {
          all = false;
          break;
        }
        score += inTitle ? 3 : 1;
      }
      if (all) hits.push({ ref, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Every step of a topic in order, for Previous / Next. */
export function neighbours(ref: string, access: Access): { prev: HelpRef | null; next: HelpRef | null } {
  const { topicId, stepId } = splitRef(ref);
  const topic = findTopic(topicId);
  if (!topic) return { prev: null, next: null };
  const steps = visibleSteps(topic, access);
  const i = steps.findIndex((s) => s.id === stepId);
  const at = (j: number) => (j >= 0 && j < steps.length ? (`${topicId}.${steps[j].id}` as HelpRef) : null);
  return { prev: at(i - 1), next: at(i + 1) };
}
