// src/main/tableHolds.ts
//
// Table holds (docs/POS-TABLE-HOLDS-WIRE-CONTRACT.md in the server repo).
//
// A dine-in draft is never sent to the server, so without a hold every other
// till saw its table as free and could seat someone there. While a draft sits
// on a table this till holds it: POST /tables/{id}/hold, renewed every few
// minutes, released when the draft leaves the table. Placing the order turns
// the hold into the order on the server; nothing to do here.
import type { AxiosInstance } from 'axios';
import { posError } from '../shared/errorCodes';

export type HoldDeps = {
  api: () => AxiosInstance | null;
  isLive: () => boolean;
  /** Store the table object a reply carries. */
  applyTable: (table: any) => void;
};

/** Renew a hold this often; the server lets one lapse after 30 minutes. */
export const HOLD_REFRESH_MS = 5 * 60 * 1000;

export type HoldResult =
  | { held: true }
  /** No connection or a server fault: try again on a later sync. */
  | { held: false; unsent: true };

function whoHolds(data: any): string {
  const h = data?.held_by;
  const parts = [h?.device_name, h?.user_name].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  if (data?.order_number) return `#${data.order_number}`;
  return '';
}

/**
 * Hold a table for a draft. Throws POS_TABLE_TAKEN (with who has it) when
 * another till or an open order is on it, and the other refusals as their own
 * codes. A network failure is not a refusal: the caller keeps the draft on the
 * table and the next sync tries again.
 */
export async function holdTable(
  deps: HoldDeps,
  tableId: string,
  body: { temp_id: string; covers?: number | null; by?: number | null }
): Promise<HoldResult> {
  const api = deps.api();
  if (!api || !deps.isLive()) return { held: false, unsent: true };
  try {
    const { data } = await api.post(`/tables/${encodeURIComponent(tableId)}/hold`, {
      temp_id: body.temp_id,
      ...(body.covers ? { covers: body.covers } : {}),
      ...(body.by != null ? { by: body.by } : {}),
    });
    if (data?.table) deps.applyTable(data.table);
    return { held: true };
  } catch (err: any) {
    const status = Number(err?.response?.status ?? 0);
    const data = err?.response?.data ?? {};
    const code = String(data?.code ?? '');
    if (!status || status === 408 || status === 429 || status >= 500) {
      return { held: false, unsent: true };
    }
    if (data?.table) deps.applyTable(data.table);
    if (code === 'POS_TABLE_TAKEN') {
      throw posError('POS_TABLE_TAKEN', { params: { held_by: whoHolds(data) } });
    }
    if (code === 'POS_TABLE_NOT_FOUND') throw posError('POS_TABLE_NOT_FOUND');
    if (code === 'POS_TABLE_HOLD_INPUT') throw posError('POS_TABLE_HOLD_INPUT');
    // A server without holds answers a bare 404: behave as before holds existed.
    if (status === 404) return { held: false, unsent: true };
    throw err;
  }
}

/** Release a hold. Best effort: a hold this till cannot release lapses by itself. */
export async function releaseHold(
  deps: HoldDeps,
  tableId: string,
  body: { temp_id: string; by?: number | null }
): Promise<void> {
  const api = deps.api();
  if (!api || !deps.isLive()) return;
  try {
    const { data } = await api.delete(`/tables/${encodeURIComponent(tableId)}/hold`, {
      data: { temp_id: body.temp_id, ...(body.by != null ? { by: body.by } : {}) },
    });
    if (data?.table) deps.applyTable(data.table);
  } catch (err: any) {
    console.warn('[holds] release failed; it lapses on its own', tableId, err?.response?.data?.code ?? err?.message);
  }
}
