/**
 * The branch's own identity — the half of a receipt that says which shop
 * printed it.
 *
 * This used to be compiled into the app: the till only ever learned
 * `{id, name}` from /bootstrap, so the address, opening hours and invoice
 * note on a counter receipt were whatever the last release happened to
 * carry. A shop that changed its closing time kept printing the old one
 * until we shipped a build, and the same order printed from the back office
 * disagreed with the slip in the customer's hand.
 *
 * The server now sends the whole row on /bootstrap and re-sends it on the
 * /pull feed whenever the office edits it, in a byte-identical shape. This
 * module is the one parser for both, and it is deliberately pure — no db, no
 * electron — so the ordering and omission rules below can be tested directly.
 */

export type BranchProfile = {
  id: string;
  name: string;
  name_ar: string;
  phone: string;
  address: string;
  address_ar: string;
  /** null and '' are different here: "not set" vs. midnight. See below. */
  duty_time_from: string | null;
  duty_time_to: string | null;
  invoice_note: string;
  invoice_note_ar: string;
  updated_at: string;
};

/** Meta key holding the cached profile as JSON. */
export const BRANCH_PROFILE_META_KEY = 'branch.profile';

/**
 * Every string field arrives as '' rather than null when unset — the server
 * guarantees that — so a plain coalesce is right for all of them. The two
 * duty times are the exception and stay nullable, because "no hours set" and
 * "opens at midnight" have to print differently.
 */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function nullableTime(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function normalizeBranchProfile(raw: any): BranchProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  // A row with no id is not a branch we can trust to identify a receipt.
  const id = str(raw.id);
  if (!id) return null;

  return {
    id,
    name: str(raw.name),
    name_ar: str(raw.name_ar),
    phone: str(raw.phone),
    address: str(raw.address),
    address_ar: str(raw.address_ar),
    duty_time_from: nullableTime(raw.duty_time_from),
    duty_time_to: nullableTime(raw.duty_time_to),
    invoice_note: str(raw.invoice_note),
    invoice_note_ar: str(raw.invoice_note_ar),
    updated_at: str(raw.updated_at),
  };
}

export function serializeBranchProfile(p: BranchProfile): string {
  return JSON.stringify(p);
}

/**
 * Reads back what serializeBranchProfile wrote. Runs it through the same
 * normaliser rather than trusting the cache, so a profile written by an older
 * build (or a hand-edited meta row) cannot put an undefined into the template.
 */
export function parseBranchProfile(json: string | null | undefined): BranchProfile | null {
  if (!json) return null;
  try {
    return normalizeBranchProfile(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * "23:59" → "11:59 PM". Accepts "HH:MM" and "HH:MM:SS", which is what MySQL
 * TIME columns serialise to depending on the driver.
 */
export function formatClockTime(value: string | null): string {
  if (value == null) return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return '';

  const hours24 = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours24 > 23 || minutes > 59) return '';

  const suffix = hours24 < 12 ? 'AM' : 'PM';
  // 00:xx prints as 12:xx AM and 12:xx stays 12:xx PM.
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${m[2]} ${suffix}`;
}

/**
 * The duty window prints only when BOTH ends are set. A half-open window
 * ("10:00 AM -") tells a customer nothing and looks like a printing fault,
 * which is the whole reason these two fields stayed nullable.
 */
export function formatDutyWindow(
  from: string | null,
  to: string | null
): string {
  if (from == null || to == null) return '';
  const start = formatClockTime(from);
  const end = formatClockTime(to);
  if (!start || !end) return '';
  return `${start} - ${end}`;
}

/**
 * One printable line. `rtl` marks the Arabic lines that must be isolated so
 * bidi does not reorder them inside a Latin receipt; `phone` is split into
 * label and value because the number itself has to stay LTR inside an
 * otherwise bilingual label.
 */
export type IdentityLine =
  | { kind: 'text'; text: string; rtl: boolean }
  | { kind: 'phone'; label: string; value: string };

/** Bilingual, like the phone line — the receipt is read by both audiences. */
export const DUTY_TIME_LABEL = 'Duty Time / مواعيد العمل';

function text(value: string, rtl = false): IdentityLine[] {
  return value ? [{ kind: 'text' as const, text: value, rtl }] : [];
}

/**
 * Header order, centred: name → name_ar (own line, RTL) → phone.
 * The logo sits above this and is unchanged — it comes from branding.logo_url,
 * which is an operator-wide setting, not a per-branch one.
 */
export function buildBranchHeaderLines(p: BranchProfile): IdentityLine[] {
  // The server falls `name_ar` back to `name` when the Arabic name is unset,
  // so an English-only branch sends the same string twice. Printing it twice
  // is not a translation, it is a stutter — collapse it.
  const nameAr = p.name_ar === p.name ? '' : p.name_ar;

  return [...text(p.name), ...text(nameAr, true), ...text(p.phone)];
}

/**
 * Footer order, centred and small: address → address_ar (own line, RTL) →
 * the bilingual phone line → duty window → invoice_note → invoice_note_ar
 * (own line, RTL).
 *
 * This order is copied from the back office's own template. Matching it
 * exactly is the entire point of the change: a receipt reprinted from the
 * admin panel has to be the same sheet the customer was handed.
 */
export function buildBranchFooterLines(p: BranchProfile): IdentityLine[] {
  const lines: IdentityLine[] = [
    ...text(p.address),
    ...text(p.address_ar, true),
  ];

  if (p.phone) {
    lines.push({ kind: 'phone', label: 'Phone / للطلبات', value: p.phone });
  }

  // The window carries its own bilingual label, on the line above it — the
  // bare times alone read as a second phone number on a narrow roll.
  const dutyWindow = formatDutyWindow(p.duty_time_from, p.duty_time_to);
  if (dutyWindow) {
    lines.push(
      { kind: 'text', text: DUTY_TIME_LABEL, rtl: false },
      { kind: 'text', text: dutyWindow, rtl: false }
    );
  }

  lines.push(...text(p.invoice_note), ...text(p.invoice_note_ar, true));

  return lines;
}
