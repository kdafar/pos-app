// src/shared/platformOnly.ts
//
// Dishes sold only on Talabat or Keeta (PLATFORM-ONLY-ITEMS-WIRE-CONTRACT.md).
//
// The back office marks a dish "only on Keeta". The till then sells it only on
// an order paid with Keeta. A platform here is a price list from
// catalog.price_lists, and its payment methods are that list's
// payment_method_ids.
//
// This till does not have the Talabat & Keeta prices themselves (channel
// prices) yet. It keeps the price lists only to know which payment method
// belongs to which platform, and what the platform is called. Prices are
// unchanged, and push is unchanged: the server matches a sale on the list of
// its payment method.
//
// Pure functions only, so the main process (the last-guard refusal) and the
// screen (tags, the specials button, checkout) use the same rule.

import { ERROR_CATALOG, interpolate, type PosErrorCode } from './errorCatalog';

export type PlatformOnlyItem = { item_id: string; price_list_ids: string[] };

/** catalog.platform_only / the platform_only pull row. */
export type PlatformOnly = { enabled: boolean; items: PlatformOnlyItem[] };

/** A price list the till knows about. Only switched-on lists are "active". */
export type PriceList = {
  id: string;
  name: string;
  name_ar: string | null;
  payment_method_ids: string[];
};

export type PlatformLine = {
  item_id: string | number | null | undefined;
  name?: string | null;
  name_ar?: string | null;
};

export type PlatformMethod = { id: string | number };

export const PLATFORM_ONLY_OFF: PlatformOnly = { enabled: false, items: [] };

const S = (v: unknown) => (v == null ? '' : String(v).trim());

/**
 * Read catalog.platform_only. Null when the server sent nothing usable, so the
 * caller can keep its last copy rather than switch the rule off by accident.
 */
export function normalizePlatformOnly(raw: unknown): PlatformOnly | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as any;
  if (!('enabled' in r) && !('items' in r)) return null;
  const enabled = r.enabled === true || r.enabled === 1 || r.enabled === '1';
  if (!enabled) return { ...PLATFORM_ONLY_OFF };
  const byItem = new Map<string, Set<string>>();
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const itemId = S(it?.item_id);
    if (!itemId) continue;
    const lists = byItem.get(itemId) ?? new Set<string>();
    for (const l of Array.isArray(it?.price_list_ids) ? it.price_list_ids : []) {
      const id = S(l);
      if (id) lists.add(id);
    }
    byItem.set(itemId, lists);
  }
  return {
    enabled: true,
    items: [...byItem].map(([item_id, lists]) => ({
      item_id,
      price_list_ids: [...lists],
    })),
  };
}

/** One price list row from catalog.price_lists or a price_list pull row. */
export function normalizePriceList(raw: unknown): PriceList | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  const id = S(r.id);
  if (!id) return null;
  const methods = Array.isArray(r.payment_method_ids)
    ? r.payment_method_ids
    : Array.isArray(r.payment_methods)
      ? r.payment_methods.map((m: any) => (m && typeof m === 'object' ? m.id : m))
      : [];
  return {
    id,
    name: S(r.name ?? r.name_en) || id,
    name_ar: S(r.name_ar) || null,
    payment_method_ids: methods.map(S).filter(Boolean),
  };
}

export function normalizePriceLists(raw: unknown): PriceList[] {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizePriceList)
    .filter((l): l is PriceList => !!l);
}

/** item id → the lists it may be sold on. Empty when the rule is off. */
export function restrictedItemMap(po: PlatformOnly | null): Map<string, string[]> {
  const m = new Map<string, string[]>();
  if (!po?.enabled) return m;
  for (const it of po.items) m.set(S(it.item_id), it.price_list_ids.map(S));
  return m;
}

export type PlatformTag = { en: string; ar: string };

/**
 * The tile tag: "Keeta", or "Talabat + Keeta" for two platforms. Lists the
 * till has no name for (never seen switched on) are left out; a dish with no
 * named list still gets a tag, so the cashier is warned.
 */
export function platformTag(
  listIds: string[],
  names: Map<string, { name: string; name_ar: string | null }>
): PlatformTag {
  const named = listIds.map((id) => names.get(id)).filter(Boolean) as {
    name: string;
    name_ar: string | null;
  }[];
  if (!named.length) return { en: 'Delivery app only', ar: 'تطبيق توصيل فقط' };
  return {
    en: named.map((n) => n.name).join(' + '),
    ar: named.map((n) => n.name_ar || n.name).join(' + '),
  };
}

/* ───────────────────────── the rule on an order ───────────────────────── */

export type PlatformVerdict =
  /** Rule off, or nothing restricted in the order: every method as today. */
  | { kind: 'none' }
  /** Only these methods may take the order; the first is picked. */
  | {
      kind: 'ok';
      allowedMethodIds: string[];
      /** The platforms those methods belong to, for "{list}". */
      lists: PriceList[];
      dishes: { name: string; name_ar: string }[];
    }
  /** Restricted dishes from different platforms in one order. */
  | { kind: 'mixed'; dishes: { name: string; name_ar: string }[] }
  /** The dish's platforms are all switched off, or none of their methods is on this till. */
  | {
      kind: 'off';
      dishes: { name: string; name_ar: string }[];
      lists: { name: string; name_ar: string | null }[];
    };

/**
 * §4 of the contract. `methods` are the till's active payment methods in the
 * order the screen shows them; `knownNames` covers lists that are switched off
 * now but were seen before, so the message can still name them.
 */
export function evaluatePlatformOnly(input: {
  lines: PlatformLine[];
  platformOnly: PlatformOnly | null;
  priceLists: PriceList[];
  methods: PlatformMethod[];
  knownNames?: Map<string, { name: string; name_ar: string | null }>;
}): PlatformVerdict {
  const restricted = restrictedItemMap(input.platformOnly);
  if (!restricted.size) return { kind: 'none' };

  const seen = new Set<string>();
  const dishes: { name: string; name_ar: string; lists: string[] }[] = [];
  for (const l of input.lines) {
    const id = S(l.item_id);
    if (!id || seen.has(id) || !restricted.has(id)) continue;
    seen.add(id);
    const name = S(l.name) || id;
    dishes.push({ name, name_ar: S(l.name_ar) || name, lists: restricted.get(id)! });
  }
  if (!dishes.length) return { kind: 'none' };
  const plain = dishes.map(({ name, name_ar }) => ({ name, name_ar }));

  // A list every restricted dish may be sold on.
  let common = new Set(dishes[0].lists);
  for (const d of dishes.slice(1)) {
    common = new Set(d.lists.filter((x) => common.has(x)));
  }
  if (!common.size && dishes.length > 1) return { kind: 'mixed', dishes: plain };

  const active = input.priceLists.filter((pl) => common.has(pl.id));
  const listOfMethod = new Map<string, PriceList>();
  for (const pl of active) {
    for (const m of pl.payment_method_ids) if (!listOfMethod.has(m)) listOfMethod.set(m, pl);
  }
  const allowedMethodIds = input.methods
    .map((m) => S(m.id))
    .filter((id) => listOfMethod.has(id));

  if (!allowedMethodIds.length) {
    const names = input.knownNames ?? new Map();
    const lists = [...common]
      .map((id) => active.find((a) => a.id === id) ?? names.get(id))
      .filter(Boolean) as { name: string; name_ar: string | null }[];
    return { kind: 'off', dishes: plain, lists };
  }

  // The platforms in the order the methods appear, each once.
  const lists: PriceList[] = [];
  for (const id of allowedMethodIds) {
    const pl = listOfMethod.get(id)!;
    if (!lists.includes(pl)) lists.push(pl);
  }
  return { kind: 'ok', allowedMethodIds, lists, dishes: plain };
}

/* ─────────────────────────────── messages ─────────────────────────────── */

/** "A", "A and B", "A, B and C" — AR "أ و ب". */
export function joinNames(names: string[], lang: 'en' | 'ar'): string {
  if (names.length <= 1) return names[0] ?? '';
  const [sep, and] = lang === 'ar' ? ['، ', ' و '] : [', ', ' and '];
  return names.slice(0, -1).join(sep) + and + names[names.length - 1];
}

/** "Keeta", or "Talabat or Keeta" when more than one platform is allowed. */
export function joinLists(
  lists: { name: string; name_ar: string | null }[],
  lang: 'en' | 'ar'
): string {
  const names = lists.map((l) => (lang === 'ar' ? l.name_ar || l.name : l.name));
  if (!names.length) return lang === 'ar' ? 'منصة توصيل' : 'a delivery app';
  if (names.length === 1) return names[0];
  const or = lang === 'ar' ? ' أو ' : ' or ';
  return names.slice(0, -1).join(lang === 'ar' ? '، ' : ', ') + or + names[names.length - 1];
}

export type PlatformRefusal = {
  code: PosErrorCode;
  /** `{x}` in English, `{x_ar}` for Arabic — see localizeParams. */
  params: Record<string, string>;
};

/**
 * Why `methodId` cannot take this order, or null when it can. A verdict of
 * 'mixed' or 'off' refuses every method: the order has to be fixed first.
 */
export function platformRefusal(
  verdict: PlatformVerdict,
  methodId: string | number | null | undefined
): PlatformRefusal | null {
  if (verdict.kind === 'none') return null;
  const names = (lang: 'en' | 'ar') =>
    joinNames(
      verdict.dishes.map((d) => (lang === 'ar' ? d.name_ar : d.name)),
      lang
    );
  if (verdict.kind === 'mixed') {
    return {
      code: 'POS_VAL_PLATFORM_ONLY_MIXED',
      params: { names: names('en'), names_ar: names('ar') },
    };
  }
  if (verdict.kind === 'off') {
    return {
      code: 'POS_VAL_PLATFORM_ONLY_LIST_OFF',
      params: {
        name: names('en'),
        name_ar: names('ar'),
        list: joinLists(verdict.lists, 'en'),
        list_ar: joinLists(verdict.lists, 'ar'),
      },
    };
  }
  if (verdict.allowedMethodIds.includes(S(methodId))) return null;
  const one = verdict.dishes.length === 1;
  return {
    code: one ? 'POS_VAL_PLATFORM_ONLY_ONE' : 'POS_VAL_PLATFORM_ONLY_MANY',
    params: {
      [one ? 'name' : 'names']: names('en'),
      [one ? 'name_ar' : 'names_ar']: names('ar'),
      list: joinLists(verdict.lists, 'en'),
      list_ar: joinLists(verdict.lists, 'ar'),
    },
  };
}

/**
 * Params carry `{x}` for English and `{x_ar}` for Arabic, because a dish and a
 * platform have a name in each language while a catalogue row must take the
 * same placeholders in both. For Arabic, `x_ar` stands in for `x`.
 */
export function localizeParams<T extends Record<string, unknown>>(
  params: T | undefined | null,
  lang: 'en' | 'ar'
): T | undefined {
  if (!params || lang !== 'ar') return params ?? undefined;
  const out: Record<string, unknown> = { ...params };
  for (const [k, v] of Object.entries(params)) {
    if (k.endsWith('_ar') && v != null && v !== '') out[k.slice(0, -3)] = v;
  }
  return out as T;
}

/** The sentence for a refusal, in the till's language. */
export function refusalText(r: PlatformRefusal, lang: 'en' | 'ar'): string {
  return interpolate(ERROR_CATALOG[r.code][lang].body, localizeParams(r.params, lang));
}
