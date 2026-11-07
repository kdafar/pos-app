import { describe, expect, it, vi } from 'vitest';
import { holdTable, releaseHold } from './tableHolds';

const TABLE = { id: '1', is_available: false, held: true };
const refusal = (status: number, data: any) =>
  Object.assign(new Error('refused'), { response: { status, data } });
const codeOf = (e: any) => e?.code;
const paramsOf = (e: any) => e?.params;

function deps(api: any, live = true) {
  const tables: any[] = [];
  return { tables, d: { api: () => api, isLive: () => live, applyTable: (t: any) => void tables.push(t) } };
}

describe('holdTable', () => {
  it('holds and stores the table from the reply', async () => {
    const post = vi.fn(async () => ({ data: { held: true, table: TABLE } }));
    const { d, tables } = deps({ post });
    expect(await holdTable(d, '1', { temp_id: 'draft-1', covers: 3, by: 16 })).toEqual({ held: true });
    expect(post).toHaveBeenCalledWith('/tables/1/hold', { temp_id: 'draft-1', covers: 3, by: 16 });
    expect(tables).toEqual([TABLE]);
  });

  it('says who holds a taken table', async () => {
    const { d } = deps({
      post: async () => {
        throw refusal(409, { code: 'POS_TABLE_TAKEN', held_by: { device_name: 'Front till', user_name: 'Sara' }, table: TABLE });
      },
    });
    const e = await holdTable(d, '1', { temp_id: 'x' }).catch((x) => x);
    expect(codeOf(e)).toBe('POS_TABLE_TAKEN');
    expect(paramsOf(e)).toEqual({ held_by: 'Front till · Sara' });
  });

  it('names the order when one is on the table', async () => {
    const { d } = deps({ post: async () => { throw refusal(409, { code: 'POS_TABLE_TAKEN', order_number: '1042' }); } });
    const e = await holdTable(d, '1', { temp_id: 'x' }).catch((x) => x);
    expect(paramsOf(e)).toEqual({ held_by: '#1042' });
  });

  it.each([0, 429, 500])('keeps the draft on the table when unsent (%i)', async (status) => {
    const { d } = deps({ post: async () => { throw status ? refusal(status, {}) : new Error('network'); } });
    expect(await holdTable(d, '1', { temp_id: 'x' })).toEqual({ held: false, unsent: true });
  });

  it('treats a server without holds as before', async () => {
    const { d } = deps({ post: async () => { throw refusal(404, {}); } });
    expect(await holdTable(d, '1', { temp_id: 'x' })).toEqual({ held: false, unsent: true });
  });

  it('does not call the server offline', async () => {
    const post = vi.fn();
    expect(await holdTable(deps({ post }, false).d, '1', { temp_id: 'x' })).toEqual({ held: false, unsent: true });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('releaseHold', () => {
  it('releases and never throws', async () => {
    const del = vi.fn(async () => { throw refusal(403, { code: 'POS_TABLE_HOLD_NOT_YOURS' }); });
    await expect(releaseHold(deps({ delete: del }).d, '1', { temp_id: 'x', by: 16 })).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith('/tables/1/hold', { data: { temp_id: 'x', by: 16 } });
  });
});
