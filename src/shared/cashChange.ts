/**
 * Cash tendered, and the change owed back.
 *
 * A cashier who takes a 5 KD note for a 3.250 sale works the change out in
 * their head and the slip says nothing about it. That is fine until the
 * customer disputes it at the counter, or the drawer is 750 fils light at
 * close and nobody can say against which sale.
 *
 * This module is the one place the arithmetic lives, and it is deliberately in
 * `shared/`: the checkout screen shows the change as the cashier types it, and
 * the main process prints it hours later on a reprint. Two implementations of
 * one rounding rule is exactly how the slip in the customer's hand and the
 * copy in the back office end up disagreeing by a few fils.
 *
 * Server-side counterparts: `App\Order::CASH_ROUNDING_UNIT` and
 * `Order::getChangeDueAttribute()`.
 */

/**
 * The smallest coin a cashier can physically hand back: 5 fils.
 *
 * The 1 fils coin has not been minted since 1988. A slip that says 1.667
 * cannot be settled — the cashier gives 1.665 or 1.670 and the drawer is out
 * by the difference on every single sale, which they then get to explain at
 * close.
 */
export const CASH_ROUNDING_UNIT = 0.005;

/** Fils per dinar. All the arithmetic below is done in whole fils. */
const FILS_PER_KD = 1000;

/** 5 fils, expressed in the integer unit the rounding actually happens in. */
const ROUNDING_UNIT_FILS = Math.round(CASH_ROUNDING_UNIT * FILS_PER_KD);

/**
 * KD → whole fils.
 *
 * Everything here works in integers. 0.1 + 0.2 is not 0.3 in binary floating
 * point, and a change calculation that drifts by 1e-15 either prints a
 * rounding line on an exact payment or fails to print one when it matters.
 */
function toFils(amount: number): number {
  return Math.round(amount * FILS_PER_KD);
}

function toKd(fils: number): number {
  return fils / FILS_PER_KD;
}

/**
 * Whether a sale was settled in cash.
 *
 * The catalogue is global — web_payment_methods has no branch_id — so this is
 * not a per-branch question and cannot become one. Confirmed 2 September 2026:
 * eight methods, of which `cash` (legacy_code 0) is the only cash one. `cash`
 * is also the fallback slug CheckoutModal uses when no method is chosen.
 *
 * The server answers the same question differently: it keys on
 * `legacy_code == 0`, because an order row carries only the numeric code and
 * the slug never reaches it. Both rules select that one method today, and both
 * ends pin a test that fails if that stops being true. They would diverge the
 * moment a cash-shaped slug is added with a non-zero code — this till would
 * capture a tender the server discards, and print change where the web receipt
 * prints none. Adding one means widening the server's cash set in the same
 * release, not after.
 *
 * The regex stays rather than being narrowed to `=== 'cash'`: it is also the
 * cash drawer's rule, where matching too widely pops a drawer that should have
 * stayed shut, and matching too narrowly leaves a cashier unable to open it at
 * all. Both failures are visible at the counter within a shift.
 *
 * Lives here rather than in cashDrawer.ts (which owns the only other use of
 * it) because the renderer cannot import that module — it pulls in electron
 * and the SQLite handle at import time. cashDrawer re-exports this one.
 */
export function isCashPayment(slug?: string | null): boolean {
  const s = String(slug ?? '')
    .trim()
    .toLowerCase();
  if (!s) return false;
  return /(^|[_-])cash([_-]|$)/.test(s);
}

/**
 * Round an amount of change to something a drawer can actually pay out.
 *
 * Rounds the CHANGE, never the bill. The customer still owes the exact total;
 * this is a fact about which coins exist, not a discount.
 */
export function roundChange(rawChange: number): number {
  if (!Number.isFinite(rawChange)) return 0;
  const fils = toFils(rawChange);
  return toKd(Math.round(fils / ROUNDING_UNIT_FILS) * ROUNDING_UNIT_FILS);
}

/**
 * Every note and coin in circulation in Kuwait, in KD.
 *
 * Notes: 1/4, 1/2, 1, 5, 10, 20. Coins: 5, 10, 20, 50, 100 fils.
 *
 * There is no 1 or 2 fils coin — the 1 fils has not been minted since 1988 —
 * which is why the smallest step below is 5 fils and not the 1 fils the money
 * format's third decimal implies. A cashier cannot be handed 0.003, so a
 * capture field must not let one be entered.
 */
export const KWD_NOTES = [0.25, 0.5, 1, 5, 10, 20] as const;

/**
 * Is this an amount a customer could actually hand over?
 *
 * Any pile of Kuwaiti coins and notes sums to a multiple of 5 fils, so that is
 * the whole test. It is the same unit the change is rounded to, for the same
 * reason: it is the smallest thing that physically exists.
 */
export function isTenderable(amount: number | null | undefined): boolean {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return false;
  return Math.round(n * FILS_PER_KD) % ROUNDING_UNIT_FILS === 0;
}

/**
 * The amounts worth offering as one-tap buttons for a given bill.
 *
 * People pay with NOTES, not with increments. For a 0.500 bill a customer
 * hands over the exact money, or a 1, or a 5, or a 10 — never 0.510, and never
 * 4.000 for a 3.250 bill just because it is the next round number. So the
 * suggestions are built from the denominations that exist, not by stepping.
 *
 * Above the largest note there is no single thing to hand over, so the stacks
 * people actually build take over: for a 21.000 bill, 25 (20+5), 30 (20+10),
 * 40 (20+20).
 *
 * Returns exact first, then ascending, deduped, never more than `limit`.
 */
export function suggestTenders(grandTotal: number, limit = 4): number[] {
  const total = Number(grandTotal);
  if (!Number.isFinite(total) || total <= 0) return [];

  const totalFils = toFils(total);
  // The bill itself is not always payable in coins (a 3.333 total is not), so
  // "exact" means the smallest tenderable amount that covers it.
  const exactFils =
    Math.ceil(totalFils / ROUNDING_UNIT_FILS) * ROUNDING_UNIT_FILS;

  // One note, where one note is enough.
  const notes = KWD_NOTES.map(toFils).filter((n) => n > exactFils);

  // Otherwise the obvious stacks of the big notes. Below 20 KD these collapse
  // onto the note denominations themselves and dedupe away.
  const stacks = [5, 10, 20]
    .map(toFils)
    .map((unit) => Math.ceil(totalFils / unit) * unit)
    .filter((n) => n > exactFils);

  const rest = [...new Set([...notes, ...stacks])].sort((a, b) => a - b);

  return [exactFils, ...rest].slice(0, limit).map(toKd);
}

export type ChangeBlock = {
  /** What the customer handed over. */
  tendered: number;
  /** The bill, unrounded and unchanged. */
  grandTotal: number;
  /** tendered − grandTotal, before any coin exists. */
  rawChange: number;
  /**
   * What the shop keeps (positive) or pays out of its own pocket (negative)
   * because 1 and 2 fils coins do not exist. Never larger than 2 fils either
   * way. Zero when the raw change already lands on a 5 fils boundary.
   */
  rounding: number;
  /** What the cashier actually hands back. Always a multiple of 5 fils. */
  change: number;
};

export type ChangeInput = {
  grandTotal: number | null | undefined;
  amountTendered: number | null | undefined;
  /** The method the sale was settled with, as a slug. */
  paymentSlug?: string | null;
  /**
   * `branch.show_change_on_receipt`. Off on every branch by default — a shop
   * that has never asked for this must see the receipt it has always had.
   */
  enabled?: boolean;
};

/**
 * The tender/change block for one sale, or null when there is nothing to show.
 *
 * Null — meaning print nothing and capture nothing — in every one of these
 * cases, and each is deliberate:
 *
 *  - the branch has not switched the feature on;
 *  - the sale was not settled in cash (a card slip has no change, and a KNET
 *    terminal has already taken the exact amount);
 *  - no tender was recorded, which is the normal state of an order rung up
 *    before this feature existed and of every reprint of one;
 *  - the tender is below the bill. That is a partial payment, which is a
 *    different feature; the server discards it too, so accepting it here would
 *    print a slip the back office cannot reproduce;
 *  - the customer paid the exact amount. "Change 0.000" is noise on a receipt
 *    and invites a cashier to hand something back.
 */
export function computeChangeBlock(input: ChangeInput): ChangeBlock | null {
  if (!input.enabled) return null;
  if (!isCashPayment(input.paymentSlug)) return null;

  const grandTotal = Number(input.grandTotal);
  const tendered = Number(input.amountTendered);

  if (!Number.isFinite(grandTotal) || !Number.isFinite(tendered)) return null;

  // 0 is not "no tender" — but it is never a valid one either, since it can
  // only mean the customer paid nothing, and that is not a completed sale.
  if (tendered <= 0) return null;

  const grandFils = toFils(grandTotal);
  const tenderedFils = toFils(tendered);

  // Short payment: not a rounding question, a partial one.
  if (tenderedFils < grandFils) return null;

  const rawFils = tenderedFils - grandFils;
  if (rawFils === 0) return null;

  const changeFils =
    Math.round(rawFils / ROUNDING_UNIT_FILS) * ROUNDING_UNIT_FILS;

  return {
    tendered: toKd(tenderedFils),
    grandTotal: toKd(grandFils),
    rawChange: toKd(rawFils),
    // Positive when the odd fils stay in the drawer, negative when the shop
    // rounds up and pays them out. Printed with its sign so the three figures
    // on the slip actually add up.
    rounding: toKd(rawFils - changeFils),
    change: toKd(changeFils),
  };
}

/**
 * Is this tender worth sending to the server?
 *
 * The wire contract says to omit `amount_tendered` entirely rather than send
 * 0 — a zero reads as "the customer paid nothing" and would print the whole
 * bill as change owed. A short tender is dropped for the same reason it is not
 * printed: the server discards it, and a value that only one side keeps is
 * worse than no value at all.
 */
export function tenderForWire(
  amountTendered: number | null | undefined,
  grandTotal: number | null | undefined
): number | null {
  const tendered = Number(amountTendered);
  const grand = Number(grandTotal);
  if (!Number.isFinite(tendered) || tendered <= 0) return null;
  if (Number.isFinite(grand) && toFils(tendered) < toFils(grand)) return null;
  return toKd(toFils(tendered));
}
