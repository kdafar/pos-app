// src/renderer/help/HelpPage.tsx
//
// The guide is a page of its own (/help), opened from the sidebar like
// Settings. Where you are lives in the address (?t=topic&s=step, ?day=job), so
// Back works and a "?" button can link straight to a step (?from=/screen).
// Before sign-in the same page is served at /start-help, without the sidebar.
import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Input, Spinner } from '@heroui/react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CircleAlert,
  Info,
  LifeBuoy,
  Search,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import {
  WORDS,
  accessFor,
  canOpen,
  findTopic,
  firstDayPath,
  jobFor,
  jobOrder,
  neighbours,
  screenRef,
  search,
  splitRef,
  stepWords,
  visibleSteps,
  visibleTopics,
  type Access,
  type HelpViewer,
} from './guide';
import { HELP_ICONS, pictureMarkers, pictureUrl } from './assets';
import type { HelpJob, HelpLang, HelpPicture, HelpRef, HelpUiKey } from './types';

/* ---------------- view state (from the address) ---------------- */

type Via = { kind: 'topic' } | { kind: 'path'; job: HelpJob };
type View =
  | { kind: 'home' }
  | { kind: 'topic'; id: string }
  | { kind: 'path'; job: HelpJob }
  | { kind: 'step'; ref: HelpRef; via: Via };

const JOBS: HelpJob[] = ['cashier', 'kitchen', 'manager'];

function viewFrom(params: URLSearchParams, access: Access): View {
  const t = params.get('t');
  const s = params.get('s');
  const day = params.get('day') as HelpJob | null;
  const job = day && JOBS.includes(day) ? day : null;
  if (t && s && canOpen(`${t}.${s}`, access)) {
    return { kind: 'step', ref: `${t}.${s}` as HelpRef, via: job ? { kind: 'path', job } : { kind: 'topic' } };
  }
  if (job && firstDayPath(job, access).length > 0) return { kind: 'path', job };
  if (t && findTopic(t) && visibleSteps(findTopic(t)!, access).length > 0) return { kind: 'topic', id: t };
  return { kind: 'home' };
}

type Mode = 'summary' | 'detailed';
const MODE_KEY = 'help.mode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'summary' ? 'summary' : 'detailed';
  } catch {
    return 'detailed';
  }
}
function saveMode(mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* the choice is a convenience; the guide works without it */
  }
}

/* ---------------- text helpers ---------------- */

function fill(text: string, vars: Record<string, string | number> = {}) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** `**Button**` → bold. The words files mark every on-screen name this way. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <b key={i} className='font-bold text-foreground'>
            {p}
          </b>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/* ---------------- page ---------------- */

export default function HelpPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { lang, isRTL } = useI18n();
  const L = lang as HelpLang;
  const words = WORDS[L];
  const ui = (k: HelpUiKey, vars?: Record<string, string | number>) => fill(words.ui[k], vars);

  // The same permission list the sidebar is drawn from.
  const [access, setAccess] = useState<Access | null>(null);
  useEffect(() => {
    window.api
      .invoke('auth:whoami')
      .then((who: HelpViewer) => setAccess(accessFor(who)))
      .catch(() => setAccess(accessFor(null)));
  }, []);

  const [query, setQuery] = useState('');
  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    saveMode(m);
  };

  // Where "Go back" returns to: the screen whose "?" opened the guide.
  const from = params.get('from');

  // A "?" link lands on ?from=/screen only; turn it into that screen's step.
  useEffect(() => {
    if (!access || !from || params.get('t') || params.get('day')) return;
    const ref = screenRef(from);
    if (ref && canOpen(ref, access)) {
      const { topicId, stepId } = splitRef(ref);
      setParams({ t: topicId, s: stepId, from }, { replace: true });
    }
  }, [access, from, params, setParams]);

  const view = useMemo(() => (access ? viewFrom(params, access) : { kind: 'home' as const }), [params, access]);

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [view]);

  const go = (next: Record<string, string>) => {
    setQuery('');
    setParams(from ? { ...next, from } : next);
  };
  const goHome = () => go({});
  const openStep = (ref: HelpRef, via: Via = { kind: 'topic' }) => {
    const { topicId, stepId } = splitRef(ref);
    go(via.kind === 'path' ? { t: topicId, s: stepId, day: via.job } : { t: topicId, s: stepId });
  };

  const searching = query.trim().length > 0;
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  if (!access) {
    return (
      <div className='flex justify-center py-24'>
        <Spinner size='lg' />
      </div>
    );
  }

  return (
    <div className='mx-auto w-full max-w-[72rem] p-3 sm:p-4 lg:p-6 min-w-0'>
      <header className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <button type='button' onClick={goHome} className='flex min-w-0 items-center gap-2.5 text-start'>
          <BookOpen size={24} className='shrink-0 text-primary' />
          <h1 className='truncate text-xl sm:text-2xl font-bold tracking-tight text-foreground'>{ui('title')}</h1>
        </button>
        <div className='flex shrink-0 items-center gap-2'>
          {/* Two buttons, not HeroUI Tabs: the Tabs cursor is placed by
              offsetLeft and lands on the wrong option in RTL. */}
          <div
            role='radiogroup'
            aria-label={`${ui('summary')} / ${ui('detailed')}`}
            className='flex rounded-xl bg-default-100 p-1'
          >
            {(['summary', 'detailed'] as Mode[]).map((m) => (
              <button
                key={m}
                type='button'
                role='radio'
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  mode === m ? 'bg-primary text-primary-foreground shadow-sm' : 'text-default-700 hover:text-foreground'
                }`}
              >
                {ui(m)}
              </button>
            ))}
          </div>
          {from && (
            <Button variant='flat' startContent={<Undo2 size={16} />} onPress={() => navigate(from)}>
              {ui('goBack')}
            </Button>
          )}
        </div>
      </header>

      <Input
        value={query}
        onValueChange={setQuery}
        placeholder={ui('search')}
        aria-label={ui('search')}
        startContent={<Search size={18} className='text-default-700' />}
        isClearable
        onClear={() => setQuery('')}
        size='lg'
        className='mb-5'
      />

      {searching ? (
        <SearchResults query={query} access={access} lang={L} onOpen={(r) => openStep(r)} />
      ) : view.kind === 'home' ? (
        <Home access={access} lang={L} onTopic={(id) => go({ t: id })} onPath={(job) => go({ day: job })} onStep={openStep} />
      ) : view.kind === 'topic' ? (
        <TopicPage id={view.id} access={access} lang={L} mode={mode} onStep={openStep} />
      ) : view.kind === 'path' ? (
        <PathPage job={view.job} access={access} lang={L} onStep={(r) => openStep(r, { kind: 'path', job: view.job })} />
      ) : (
        <StepPage refId={view.ref} access={access} lang={L} mode={mode} via={view.via} />
      )}

      {!searching && view.kind !== 'home' && (
        <footer className='mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-default-200 pt-4'>
          <Button variant='flat' startContent={<BackIcon size={16} />} onPress={goHome}>
            {ui('back')}
          </Button>
          {view.kind === 'step' && (
            <StepNav view={view} access={access} lang={L} onGo={(r) => openStep(r, view.via)} />
          )}
        </footer>
      )}
    </div>
  );
}

/* ---------------- home ---------------- */

function Home({
  access,
  lang,
  onTopic,
  onPath,
  onStep,
}: {
  access: Access;
  lang: HelpLang;
  onTopic: (id: string) => void;
  onPath: (job: HelpJob) => void;
  onStep: (ref: HelpRef) => void;
}) {
  const words = WORDS[lang];
  const topics = visibleTopics(access);
  const trouble = topics.find((t) => t.kind === 'trouble');
  const jobs = jobOrder(access).filter((j) => firstDayPath(j, access).length > 0);
  const mine = jobFor(access);

  return (
    <div className='space-y-6'>
      <p className='text-base font-medium text-default-700'>{words.ui.subtitle}</p>

      {/* Your first day — the viewer's own job first */}
      {jobs.length > 0 && (
        <section>
          <SectionTitle title={words.ui.firstDay} hint={words.ui.firstDayHint} />
          <div className='grid gap-3 sm:grid-cols-3'>
            {jobs.map((job) => (
              <button
                key={job}
                type='button'
                onClick={() => onPath(job)}
                className={`rounded-xl border-2 p-4 text-start transition-colors hover:bg-default-100 ${
                  job === mine ? 'border-primary bg-primary/5' : 'border-default-200 bg-content1'
                }`}
              >
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-lg font-bold text-foreground'>{words.jobs[job].title}</span>
                  {job === mine && (
                    <Chip size='sm' color='primary' variant='solid' className='font-semibold'>
                      {words.ui.yourJob}
                    </Chip>
                  )}
                </div>
                <p className='mt-1 text-sm font-medium text-default-700'>{words.jobs[job].blurb}</p>
                <p className='mt-2 text-xs font-semibold text-primary'>
                  {fill(words.ui.stepsCount, { n: firstDayPath(job, access).length })}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Something went wrong — near the top, one tap per problem */}
      {trouble && (
        <section className='rounded-xl border-2 border-danger/40 bg-danger/5 p-4'>
          <div className='mb-3 flex items-center gap-2'>
            <CircleAlert size={20} className='text-danger' />
            <div>
              <h3 className='text-lg font-bold text-foreground'>{words.ui.wrong}</h3>
              <p className='text-sm font-medium text-default-700'>{words.ui.wrongHint}</p>
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            {visibleSteps(trouble, access).map((s) => (
              <Button
                key={s.id}
                variant='flat'
                className='h-auto min-h-10 whitespace-normal py-2 text-start font-semibold'
                onPress={() => onStep(`${trouble.id}.${s.id}` as HelpRef)}
              >
                {words.topics[trouble.id].steps[s.id].title}
              </Button>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle title={words.ui.allTopics} />
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {topics
            .filter((t) => t.kind !== 'trouble')
            .map((t) => {
              const Icon = HELP_ICONS[t.icon];
              const tw = words.topics[t.id];
              return (
                <button
                  key={t.id}
                  type='button'
                  onClick={() => onTopic(t.id)}
                  className='flex items-start gap-3 rounded-xl border border-default-200 bg-content1 p-4 text-start transition-colors hover:bg-default-100'
                >
                  <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                    <Icon size={20} />
                  </span>
                  <span className='min-w-0'>
                    <span className='block text-base font-bold text-foreground'>{tw.title}</span>
                    <span className='block text-sm font-medium text-default-700'>{tw.blurb}</span>
                  </span>
                </button>
              );
            })}
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className='mb-3'>
      <h3 className='text-lg font-bold text-foreground'>{title}</h3>
      {hint && <p className='text-sm font-medium text-default-700'>{hint}</p>}
    </div>
  );
}

/* ---------------- search ---------------- */

function SearchResults({
  query,
  access,
  lang,
  onOpen,
}: {
  query: string;
  access: Access;
  lang: HelpLang;
  onOpen: (ref: HelpRef) => void;
}) {
  const words = WORDS[lang];
  const hits = search(query, access);
  if (hits.length === 0) {
    return <p className='py-10 text-center text-base font-semibold text-default-700'>{words.ui.noResults}</p>;
  }
  return (
    <div className='space-y-2'>
      <p className='text-sm font-semibold text-default-700'>{fill(words.ui.results, { n: hits.length })}</p>
      {hits.map(({ ref }) => {
        const { topicId } = splitRef(ref);
        const w = stepWords(lang, ref);
        if (!w) return null;
        return (
          <button
            key={ref}
            type='button'
            onClick={() => onOpen(ref)}
            className='block w-full rounded-xl border border-default-200 bg-content1 p-3 text-start hover:bg-default-100'
          >
            <span className='block text-xs font-semibold text-primary'>{words.topics[topicId].title}</span>
            <span className='block text-base font-bold text-foreground'>{w.title}</span>
            <span className='block text-sm font-medium text-default-700'><Rich text={w.summary} /></span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- topic ---------------- */

function TopicPage({
  id,
  access,
  lang,
  mode,
  onStep,
}: {
  id: string;
  access: Access;
  lang: HelpLang;
  mode: Mode;
  onStep: (ref: HelpRef) => void;
}) {
  const topic = findTopic(id);
  const words = WORDS[lang];
  if (!topic) return null;
  const tw = words.topics[id];
  const Icon = HELP_ICONS[topic.icon];
  const steps = visibleSteps(topic, access);
  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-3'>
        <span className='flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary'>
          <Icon size={22} />
        </span>
        <div>
          <h2 className='text-2xl font-bold text-foreground'>{tw.title}</h2>
          <p className='text-sm font-medium text-default-700'>{tw.blurb}</p>
        </div>
      </div>
      <ol className='space-y-3'>
        {steps.map((s, i) => {
          const ref = `${id}.${s.id}` as HelpRef;
          return (
            <li key={s.id} className='rounded-xl border border-default-200 bg-content1 p-4'>
              <button type='button' onClick={() => onStep(ref)} className='flex w-full items-start gap-3 text-start'>
                <StepNumber n={i + 1} />
                <span className='min-w-0'>
                  <span className='block text-lg font-bold text-foreground underline-offset-4 hover:underline'>
                    {tw.steps[s.id].title}
                  </span>
                  <span className='block text-sm font-medium text-default-700'>
                    <Rich text={tw.steps[s.id].summary} />
                  </span>
                </span>
              </button>
              {mode === 'detailed' && (
                <div className='mt-3 ps-11'>
                  <StepBody refId={ref} lang={lang} kind={topic.kind} picture={s.picture} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------- first-day path ---------------- */

function PathPage({
  job,
  access,
  lang,
  onStep,
}: {
  job: HelpJob;
  access: Access;
  lang: HelpLang;
  onStep: (ref: HelpRef) => void;
}) {
  const words = WORDS[lang];
  const path = firstDayPath(job, access);
  return (
    <div className='space-y-4'>
      <div>
        <p className='text-sm font-semibold text-primary'>{words.ui.firstDay}</p>
        <h2 className='text-2xl font-bold text-foreground'>{words.jobs[job].title}</h2>
        <p className='text-sm font-medium text-default-700'>{words.jobs[job].blurb}</p>
      </div>
      <ol className='space-y-2'>
        {path.map((ref, i) => {
          const w = stepWords(lang, ref);
          if (!w) return null;
          return (
            <li key={ref}>
              <button
                type='button'
                onClick={() => onStep(ref)}
                className='flex w-full items-start gap-3 rounded-xl border border-default-200 bg-content1 p-3 text-start hover:bg-default-100'
              >
                <StepNumber n={i + 1} />
                <span className='min-w-0'>
                  <span className='block text-base font-bold text-foreground'>{w.title}</span>
                  <span className='block text-sm font-medium text-default-700'>{words.firstDay[job][ref]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ---------------- step ---------------- */

function StepPage({
  refId,
  access,
  lang,
  mode,
  via,
}: {
  refId: HelpRef;
  access: Access;
  lang: HelpLang;
  mode: Mode;
  via: Via;
}) {
  const words = WORDS[lang];
  const { topicId, stepId } = splitRef(refId);
  const topic = findTopic(topicId);
  const w = stepWords(lang, refId);
  if (!topic || !w) return null;
  const def = topic.steps.find((s) => s.id === stepId);

  const list: string[] =
    via.kind === 'path'
      ? firstDayPath(via.job, access)
      : visibleSteps(topic, access).map((s) => `${topicId}.${s.id}`);
  const n = list.indexOf(refId) + 1;
  const why = via.kind === 'path' ? words.firstDay[via.job][refId] : undefined;

  return (
    <article className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2 text-sm font-semibold'>
        <span className='text-primary'>
          {via.kind === 'path' ? `${words.ui.firstDay} · ${words.jobs[via.job].title}` : words.topics[topicId].title}
        </span>
        {n > 0 && <span className='text-default-700'>· {fill(words.ui.stepOf, { n, total: list.length })}</span>}
      </div>
      <h2 className='text-2xl font-bold text-foreground'>{w.title}</h2>
      <p className='text-lg font-medium text-foreground'>
        <Rich text={w.summary} />
      </p>
      {why && (
        <p className='rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary'>
          {words.ui.why}: {why}
        </p>
      )}
      {mode === 'detailed' && <StepBody refId={refId} lang={lang} kind={topic.kind} picture={def?.picture} />}
    </article>
  );
}

function StepNav({
  view,
  access,
  lang,
  onGo,
}: {
  view: Extract<View, { kind: 'step' }>;
  access: Access;
  lang: HelpLang;
  onGo: (ref: HelpRef) => void;
}) {
  const { isRTL } = useI18n();
  const words = WORDS[lang];
  let prev: HelpRef | null;
  let next: HelpRef | null;
  if (view.via.kind === 'path') {
    const path = firstDayPath(view.via.job, access);
    const i = path.indexOf(view.ref);
    prev = i > 0 ? path[i - 1] : null;
    next = i >= 0 && i < path.length - 1 ? path[i + 1] : null;
  } else {
    ({ prev, next } = neighbours(view.ref, access));
  }
  const PrevIcon = isRTL ? ArrowRight : ArrowLeft;
  const NextIcon = isRTL ? ArrowLeft : ArrowRight;
  return (
    <div className='flex gap-2'>
      <Button variant='flat' isDisabled={!prev} startContent={<PrevIcon size={16} />} onPress={() => prev && onGo(prev)}>
        {words.ui.prev}
      </Button>
      <Button color='primary' isDisabled={!next} endContent={<NextIcon size={16} />} onPress={() => next && onGo(next)}>
        {words.ui.next}
      </Button>
    </div>
  );
}

/** Steps, What happens next, Be careful, picture — the "Detailed" part. */
function StepBody({
  refId,
  lang,
  kind,
  picture,
}: {
  refId: HelpRef;
  lang: HelpLang;
  kind?: 'trouble';
  picture?: HelpPicture;
}) {
  const words = WORDS[lang];
  const w = stepWords(lang, refId);
  if (!w) return null;
  return (
    <div className='space-y-4'>
      <div>
        <h4 className='mb-2 text-sm font-bold uppercase tracking-wide text-default-700'>{words.ui.steps}</h4>
        <ol className='space-y-2'>
          {w.steps.map((s, i) => (
            <li key={i} className='flex items-start gap-3 text-base font-medium text-foreground'>
              <StepNumber n={i + 1} small />
              <span className='pt-0.5'>
                <Rich text={s} />
              </span>
            </li>
          ))}
        </ol>
      </div>

      {picture && <Picture picture={picture} notes={w.notes ?? []} lang={lang} />}

      {w.next && w.next.length > 0 && (
        <Box tone='info' title={words.ui.whatNext} lines={w.next} />
      )}
      {w.careful && w.careful.length > 0 && (
        <Box tone='warning' title={words.ui.careful} lines={w.careful} />
      )}
      {kind === 'trouble' && (
        <div className='flex items-start gap-3 rounded-xl border-2 border-default-300 bg-content1 p-3'>
          <LifeBuoy size={20} className='mt-0.5 shrink-0 text-primary' />
          <p className='text-base font-semibold text-foreground'>{words.ui.stillNotWorking}</p>
        </div>
      )}
    </div>
  );
}

function Box({ tone, title, lines }: { tone: 'info' | 'warning'; title: string; lines: string[] }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  const cls =
    tone === 'info'
      ? 'border-primary/40 bg-primary/5'
      : 'border-warning bg-warning/10';
  const iconCls = tone === 'info' ? 'text-primary' : 'text-warning-600';
  return (
    <div className={`rounded-xl border-2 p-3 ${cls}`}>
      <div className='mb-1.5 flex items-center gap-2'>
        <Icon size={18} className={iconCls} />
        <h4 className='text-base font-bold text-foreground'>{title}</h4>
      </div>
      <ul className='space-y-1.5'>
        {lines.map((l, i) => (
          <li key={i} className='flex gap-2 text-base font-medium text-foreground'>
            <span aria-hidden className='mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current' />
            <span>
              <Rich text={l} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepNumber({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground ${
        small ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm'
      }`}
    >
      <span className='money'>{n}</span>
    </span>
  );
}

/** A screenshot with numbered markers. Marker positions are measured on the
 *  picture itself (each language has its own picture), so they use physical
 *  left/top — never start/end. */
function Picture({ picture, notes, lang }: { picture: HelpPicture; notes: string[]; lang: HelpLang }) {
  const words = WORDS[lang];
  const url = pictureUrl(picture.file, lang);
  const markers = pictureMarkers(picture.file, lang);
  if (!url) return null;
  return (
    <figure className='space-y-2'>
      {/* Shrink-wraps the picture so a narrow one (a side-menu crop) is not
          blown up and blurred; markers are % of this box, so they still land. */}
      <div className='relative inline-block max-w-full overflow-hidden rounded-xl border border-default-200 align-top' dir='ltr'>
        <img src={url} alt={words.ui.picture} className='block h-auto max-w-full' loading='lazy' />
        {markers.map((m, i) => (
          <span
            key={i}
            className='absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-danger text-sm font-black text-white shadow-lg ring-2 ring-white'
            style={{ left: `${m.x}%`, top: `${m.y}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {notes.length > 0 && (
        <ol className='space-y-1'>
          {notes.map((note, i) => (
            <li key={i} className='flex items-start gap-2 text-sm font-medium text-foreground'>
              <span className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[11px] font-black text-white'>
                {i + 1}
              </span>
              <span>
                <Rich text={note} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}
