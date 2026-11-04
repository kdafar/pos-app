// src/renderer/help/types.ts
//
// The in-app guide is data, not code. A topic file says WHICH steps exist, in
// what order, who may see them and which picture they use. The words files
// (words/en.ts, words/ar.ts) say what each step SAYS. The panel only reads
// both, so adding a step never needs new UI code.
import type { Permission } from '../../shared/permissions';

export type HelpLang = 'en' | 'ar';

/** A numbered marker on a picture, as a percentage of the picture's size. */
export type HelpMarker = { x: number; y: number };

export type HelpPicture = {
  /** File base name: images/<file>.<lang>.webp. The numbered markers for it
   *  are measured by scripts/help-shots/shoot.cjs and stored in
   *  images/markers.json — one list per language, because the Arabic picture
   *  is right-to-left and its buttons sit elsewhere. Each marker has one note
   *  (words file, `notes`), in the same order. */
  file: string;
};

export type HelpMarkers = Record<string, Partial<Record<HelpLang, HelpMarker[]>>>;

/** A sidebar screen, by its route (see SCREEN_PERMISSION in guide.ts). */
export type HelpScreen =
  | '/'
  | '/orders'
  | '/kitchen'
  | '/reports/closing'
  | '/categories'
  | '/items'
  | '/promos'
  | '/tables'
  | '/payment-methods'
  | '/locations'
  | '/settings'
  | '/updates'
  | '/permissions';

export type HelpStepDef = {
  id: string;
  /** The sidebar screen(s) this step is about. The step shows only when the
   *  user has at least one of them in their sidebar. Missing = no screen
   *  (signing in, the sync box, no internet, problems) - shown to everyone. */
  screen?: HelpScreen | HelpScreen[];
  /** An extra right the action itself needs (for example Mark paid), on top
   *  of seeing the screen. The user needs ANY of these. */
  requires?: Permission[];
  picture?: HelpPicture;
};

/** Names in icons.ts — kept as strings so topic files stay plain data. */
export type HelpIconName =
  | 'start'
  | 'order'
  | 'table'
  | 'pay'
  | 'change'
  | 'orders'
  | 'kitchen'
  | 'printer'
  | 'offline'
  | 'closing'
  | 'manager'
  | 'trouble';

export type HelpTopicDef = {
  id: string;
  icon: HelpIconName;
  /** "trouble" topics end every step with the same support line. */
  kind?: 'trouble';
  steps: HelpStepDef[];
};

/** A step address: "<topic>.<step>". */
export type HelpRef = `${string}.${string}`;

export type HelpJob = 'cashier' | 'kitchen' | 'manager';

/* ---------------- words ---------------- */

export type HelpStepWords = {
  title: string;
  summary: string;
  steps: string[];
  /** "What happens next": what this action changes. */
  next?: string[];
  /** "Be careful": what can go wrong and how to avoid it. */
  careful?: string[];
  /** One note per picture marker, in marker order. */
  notes?: string[];
  /** Extra search words (other names people use for this). */
  keywords?: string[];
};

export type HelpTopicWords = {
  title: string;
  blurb: string;
  keywords?: string[];
  steps: Record<string, HelpStepWords>;
};

export type HelpUiKey =
  | 'help'
  | 'title'
  | 'subtitle'
  | 'search'
  | 'noResults'
  | 'results'
  | 'firstDay'
  | 'firstDayHint'
  | 'yourJob'
  | 'wrong'
  | 'wrongHint'
  | 'allTopics'
  | 'summary'
  | 'detailed'
  | 'prev'
  | 'next'
  | 'back'
  | 'close'
  | 'steps'
  | 'whatNext'
  | 'careful'
  | 'stepOf'
  | 'stepsCount'
  | 'stillNotWorking'
  | 'openHelp'
  | 'picture'
  | 'why'
  | 'goBack';

export type HelpWords = {
  ui: Record<HelpUiKey, string>;
  jobs: Record<HelpJob, { title: string; blurb: string }>;
  topics: Record<string, HelpTopicWords>;
  /** One "why it matters today" line per step on each first-day path. */
  firstDay: Record<HelpJob, Record<string, string>>;
};
