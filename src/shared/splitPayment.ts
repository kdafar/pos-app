// src/shared/splitPayment.ts
//
// One bill paid two ways: cash plus exactly one other method, adding up to the
// total (docs/POS-SPLIT-PAYMENT, server contract). Shared so the checkout
// screen and the main process cannot disagree about what qualifies.
import { isCashPayment } from './cashChange';

export type PayPart = {
  method: string;
  amount: number;
  amount_tendered?: number | null;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The two parts for a cash amount against a total, or null when they do not
 * qualify: both parts above zero, the other method not cash, and the sum the
 * total (it is, by construction: the other part is whatever cash leaves).
 */
export function splitParts(
  grandTotal: number,
  cashAmount: number,
  otherSlug: string | null | undefined
): PayPart[] | null {
  const total = r3(Number(grandTotal));
  const cash = r3(Number(cashAmount));
  const other = r3(total - cash);
  const slug = String(otherSlug ?? '').trim();
  if (!Number.isFinite(total) || !Number.isFinite(cash)) return null;
  if (!(cash > 0) || !(other > 0) || !slug || isCashPayment(slug)) return null;
  return [
    { method: 'cash', amount: cash },
    { method: slug, amount: other },
  ];
}

/** The part the server files the order under: the larger one (cash on a tie). */
export function largerPart(parts: PayPart[]): PayPart {
  return parts.reduce((a, b) => (b.amount > a.amount ? b : a));
}
