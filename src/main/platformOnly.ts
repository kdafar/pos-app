// src/main/platformOnly.ts
//
// The till's copy of the platform-only rule (dishes sold only on Talabat or
// Keeta) and the checks that use it. The rule itself is in
// shared/platformOnly.ts; this file only stores what the server sends and
// reads an order from the database.
//
// Stored in meta, as JSON:
//   platform_only.state      catalog.platform_only, replaced whole every time
//   price_lists.active       catalog.price_lists (switched-on lists)
//   price_lists.names        id → name of every list ever seen, so a message
//                            can still name a list that is switched off now

import db, { getMeta, setMeta } from './db';
import { posError } from '../shared/errorCodes';
import {
  PLATFORM_ONLY_OFF,
  joinLists,
  joinNames,
  evaluatePlatformOnly,
  normalizePlatformOnly,
  normalizePriceList,
  normalizePriceLists,
  platformRefusal,
  type PlatformOnly,
  type PlatformVerdict,
  type PriceList,
} from '../shared/platformOnly';

const K_STATE = 'platform_only.state';
const K_LISTS = 'price_lists.active';
const K_NAMES = 'price_lists.names';

type Names = Record<string, { name: string; name_ar: string | null }>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getMeta(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function rememberNames(lists: PriceList[]) {
  if (!lists.length) return;
  const names = readJson<Names>(K_NAMES, {});
  for (const l of lists) names[l.id] = { name: l.name, name_ar: l.name_ar };
  setMeta(K_NAMES, JSON.stringify(names));
}

/**
 * catalog.platform_only from bootstrap, or the `platform_only` pull row (always
 * whole). Something unreadable leaves the last copy alone rather than
 * switching the rule off.
 */
export function storePlatformOnly(raw: unknown): boolean {
  const po = normalizePlatformOnly(raw);
  if (!po) return false;
  setMeta(K_STATE, JSON.stringify(po));
  return true;
}

/** catalog.price_lists from bootstrap: the switched-on lists, whole. */
export function storePriceLists(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  const lists = normalizePriceLists(raw);
  setMeta(K_LISTS, JSON.stringify(lists));
  rememberNames(lists);
  return true;
}

/**
 * One `price_lists` pull row. An update always carries the whole list:
 * replace the copy. A list switched off or removed always arrives as
 * op "delete" with data {id}; its name is kept for messages.
 */
export function applyPriceListChange(op: string, pk: unknown, data: any) {
  const lists = readJson<PriceList[]>(K_LISTS, []);
  const id = String(data?.id ?? pk ?? '').trim();
  if (!id) return;
  const rest = lists.filter((l) => l.id !== id);
  const row = op === 'delete' ? null : normalizePriceList({ ...data, id });
  if (row) {
    rest.push(row);
    rememberNames([row]);
  }
  setMeta(K_LISTS, JSON.stringify(rest));
}

export type PlatformState = {
  platformOnly: PlatformOnly;
  priceLists: PriceList[];
  knownNames: Map<string, { name: string; name_ar: string | null }>;
};

export function loadPlatformState(): PlatformState {
  const platformOnly = readJson<PlatformOnly>(K_STATE, PLATFORM_ONLY_OFF);
  const priceLists = readJson<PriceList[]>(K_LISTS, []);
  const names = readJson<Names>(K_NAMES, {});
  const knownNames = new Map(Object.entries(names));
  for (const l of priceLists) knownNames.set(l.id, { name: l.name, name_ar: l.name_ar });
  return { platformOnly, priceLists, knownNames };
}

/** Active methods in the order checkout lists them (payments:listMethods). */
function activeMethods(): { id: string }[] {
  return db
    .prepare(
      `SELECT CAST(id AS TEXT) AS id FROM payment_methods WHERE is_active = 1 ORDER BY legacy_code ASC`
    )
    .all() as { id: string }[];
}

function orderLines(orderId: string) {
  return db
    .prepare(`SELECT item_id, name, name_ar FROM order_lines WHERE order_id = ?`)
    .all(orderId) as { item_id: string; name: string; name_ar: string | null }[];
}

/** §4 for one order as it stands, plus optionally one dish about to be added. */
export function verdictForOrder(
  orderId: string,
  extra?: { item_id: string; name: string; name_ar: string | null }
): PlatformVerdict {
  const st = loadPlatformState();
  if (!st.platformOnly.enabled) return { kind: 'none' };
  const lines: { item_id: string; name: string; name_ar: string | null }[] =
    orderLines(orderId);
  if (extra) lines.push(extra);
  return evaluatePlatformOnly({
    lines,
    platformOnly: st.platformOnly,
    priceLists: st.priceLists,
    methods: activeMethods(),
    knownNames: st.knownNames,
  });
}

/**
 * The last guard (§1.5): an order that still reaches Pay with a method its
 * platform-only dishes do not allow is refused, and nothing is saved.
 */
export function assertPlatformPayment(orderId: string, methodId: unknown) {
  const refusal = platformRefusal(verdictForOrder(orderId), methodId as any);
  if (refusal) {
    throw posError(refusal.code, { params: refusal.params, field: 'payment_method' });
  }
}

/**
 * The checkout payload's method, or the order's own when the payload names
 * none (another till's order keeps its method). A split's cash part must pass
 * too, which is how split stays closed for these orders (§4.3).
 */
export function assertPlatformCheckout(
  orderId: string,
  customer: any,
  fallbackMethodId: unknown
) {
  const verdict = verdictForOrder(orderId);
  if (verdict.kind === 'none') return;
  const ids: unknown[] = [String(customer?.payment_method_id ?? '').trim() || fallbackMethodId];
  if (Number(customer?.split_cash_amount) > 0) {
    const cash = db
      .prepare(`SELECT CAST(id AS TEXT) AS id FROM payment_methods WHERE LOWER(slug) = 'cash' LIMIT 1`)
      .get() as { id: string } | undefined;
    ids.push(cash?.id ?? 'cash');
  }
  for (const id of ids) {
    const refusal = platformRefusal(verdict, id as any);
    if (refusal) {
      throw posError(refusal.code, { params: refusal.params, field: 'payment_method' });
    }
  }
}

/**
 * §4.4: a dish may not join an order that is already paid by another method.
 * An unpaid order is checked at Pay instead, where the method can still move.
 */
export function assertPlatformAdd(orderId: string, itemId: string) {
  const st = loadPlatformState();
  if (!st.platformOnly.enabled) return;
  if (!st.platformOnly.items.some((i) => i.item_id === String(itemId))) return;
  const order = db
    .prepare(
      `SELECT payment_method_id, paid_status, payment_link_status FROM orders WHERE id = ?`
    )
    .get(orderId) as
    | { payment_method_id: string | null; paid_status: string | null; payment_link_status: string | null }
    | undefined;
  if (!order) return;
  const paid =
    order.paid_status === 'paid' ||
    String(order.payment_link_status ?? '').toLowerCase() === 'paid';
  if (!paid || !order.payment_method_id) return;
  const item = db
    .prepare(`SELECT id, name, name_ar FROM items WHERE id = ?`)
    .get(itemId) as { id: string; name: string; name_ar: string | null } | undefined;
  const refusal = platformRefusal(
    verdictForOrder(orderId, {
      item_id: String(itemId),
      name: item?.name ?? String(itemId),
      name_ar: item?.name_ar ?? null,
    }),
    order.payment_method_id
  );
  if (refusal) throw posError(refusal.code, { params: refusal.params });
}

/**
 * {items} / {list_name} for POS_PUSH_PLATFORM_ONLY_PAYMENT, from the order
 * and this till's copies. If the copy still marks none of the order's dishes
 * (it was cleared since), every dish is named and the platform reads
 * "a delivery app" — the notice is still worth showing.
 */
export function platformNoticeParams(orderId: string): Record<string, string> {
  const st = loadPlatformState();
  const restricted = new Map(st.platformOnly.items.map((i) => [i.item_id, i.price_list_ids]));
  const lines = orderLines(orderId);
  const hit = lines.filter((l) => restricted.has(String(l.item_id)));
  const named = hit.length ? hit : lines;
  const seen = new Set<string>();
  const dishes = named.filter((l) => {
    const k = String(l.item_id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const listIds = [...new Set(hit.flatMap((l) => restricted.get(String(l.item_id)) ?? []))];
  const lists = listIds
    .map((id) => st.knownNames.get(id))
    .filter(Boolean) as { name: string; name_ar: string | null }[];
  return {
    items: joinNames(dishes.map((d) => d.name), 'en'),
    items_ar: joinNames(dishes.map((d) => d.name_ar || d.name), 'ar'),
    list_name: joinLists(lists, 'en'),
    list_name_ar: joinLists(lists, 'ar'),
  };
}

/** Flagged orders not toasted yet; marks them toasted. */
export function takePlatformNotices(): { orderId: string; params: Record<string, string> }[] {
  const rows = db
    .prepare(`SELECT id FROM orders WHERE platform_notice = 1`)
    .all() as { id: string }[];
  const done = db.prepare(`UPDATE orders SET platform_notice = 2 WHERE id = ?`);
  return rows.map((r) => {
    done.run(r.id);
    return { orderId: r.id, params: platformNoticeParams(r.id) };
  });
}

/**
 * POS_PLATFORM_ONLY_REFUSED from /paid, /status or /lines, as the cashier
 * should read it. The §5 sentence when this till's copy explains the
 * refusal for the method being used; the server's code with {items} and
 * {list_name} otherwise (its copy was stale). `method` is the slug or id
 * being tried; none means the order's own.
 */
export function platformRefusedError(orderId: string, method?: unknown) {
  const order = db
    .prepare(`SELECT payment_method_id FROM orders WHERE id = ?`)
    .get(orderId) as { payment_method_id: string | null } | undefined;
  let methodId: unknown = order?.payment_method_id ?? null;
  const m = String(method ?? '').trim();
  if (m) {
    const row = db
      .prepare(
        `SELECT CAST(id AS TEXT) AS id FROM payment_methods WHERE CAST(id AS TEXT) = ? OR slug = ? LIMIT 1`
      )
      .get(m, m) as { id: string } | undefined;
    methodId = row?.id ?? m;
  }
  const refusal = platformRefusal(verdictForOrder(orderId), methodId as any);
  if (refusal) {
    return posError(refusal.code, { params: refusal.params, field: 'payment_method' });
  }
  return posError('POS_PLATFORM_ONLY_REFUSED', {
    params: platformNoticeParams(orderId),
    field: 'payment_method',
  });
}
