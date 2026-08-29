import { describe, expect, it } from 'vitest';

/**
 * Mirrors toServerUserId in handlers/sync.ts. That module opens the database
 * and reaches for Electron at import time, so the rule is restated here
 * rather than imported — it is four lines, and the cost of it drifting is a
 * silent return to no staff attribution at all.
 */
function toServerUserId(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

describe('server_user_id on the push payload', () => {
  it('sends a NUMBER, not the string the TEXT column holds', () => {
    // created_by_user_id / completed_by_user_id are TEXT columns, so this is
    // the shape the raw read actually produces. The server resolves the id
    // against the branch login snapshot, and a strict comparison there would
    // never match "16" to 16.
    expect(toServerUserId('16')).toBe(16);
    expect(toServerUserId('16')).not.toBe('16');
  });

  it('passes a real integer through unchanged', () => {
    expect(toServerUserId(16)).toBe(16);
    expect(toServerUserId(1)).toBe(1);
  });

  it('nulls an absent operator rather than inventing one', () => {
    for (const raw of [null, undefined, '']) {
      expect(toServerUserId(raw), String(raw)).toBeNull();
    }
  });

  it('nulls anything that is not a positive whole id', () => {
    // A sale is not worth losing over a disputed name, and the server nulls
    // an unresolvable claim anyway — so send it nothing rather than junk.
    for (const raw of ['abc', '0', 0, -3, '1.5', 1.5, NaN, true, {}, []]) {
      expect(toServerUserId(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('resolves a zero-padded id, because padding is a live convention here', () => {
    // reference_no prints zero-padded two inches away on the same receipt,
    // so refusing "016" would be refusing the house style.
    expect(toServerUserId('016')).toBe(16);
    expect(toServerUserId('0016')).toBe(16);
  });

  it('agrees with the server on every case in its resolver table', () => {
    // Kept as one block deliberately: this is a cross-system contract, and
    // the failure it guards against is silent — a claim that nulls on
    // arrival looks identical at this end to one that was never sent.
    //
    // '16.9' is the one that matters. A cast would have resolved it to user
    // 16 — a DIFFERENT PERSON, attributed with no trace.
    expect(toServerUserId('16')).toBe(16);
    expect(toServerUserId(16)).toBe(16);
    expect(toServerUserId('016')).toBe(16);
    expect(toServerUserId('16.0')).toBeNull();
    expect(toServerUserId('16.9')).toBeNull();
    expect(toServerUserId(true)).toBeNull();
    expect(toServerUserId('')).toBeNull();
    expect(toServerUserId(null)).toBeNull();
  });
});
