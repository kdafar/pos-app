import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetOrderChanges, sendOrderChange } from './orderStatusActions';

const ORDER = { id: '107790', status_code: 2 };
const SERVER_ORDER = { id: 107790, status: 4 };

function deps(post: (path: string, body: any) => Promise<any>, live = true) {
  const applied: any[] = [];
  return {
    applied,
    d: {
      api: () => ({ post }) as any,
      isLive: () => live,
      applyOrder: (id: string, o: any) => void applied.push([id, o]),
    },
  };
}
const refusal = (status: number, data: any) =>
  Object.assign(new Error('refused'), { response: { status, data } });
const codeOf = (e: any) => /"code":"([A-Z_]+)"/.exec(String(e?.message))?.[1] ?? e?.code;

describe('sendOrderChange', () => {
  beforeEach(() => resetOrderChanges());

  it('sends the contract body and replaces the local copy', async () => {
    const post = vi.fn(async () => ({ data: { applied: true, replayed: false, order: SERVER_ORDER } }));
    const { d, applied } = deps(post);
    const r = await sendOrderChange(d, ORDER, 16, { status: 4, closed_at: 1000 });
    expect(r).toEqual({ applied: true, replayed: false });
    const [path, body] = post.mock.calls[0] as unknown as [string, any];
    expect(path).toBe('/orders/107790/status');
    expect(body).toMatchObject({ by: 16, status: 4, closed_at: 1000, expected_status: 2 });
    expect(body.action_id).toBeTruthy();
    expect(applied).toEqual([['107790', SERVER_ORDER]]);
  });

  it('takes the current order when another till got there first', async () => {
    const { d, applied } = deps(async () => ({ data: { applied: false, order: SERVER_ORDER } }));
    const r = await sendOrderChange(d, ORDER, 16, { status: 4 });
    expect(r.applied).toBe(false);
    expect(applied).toHaveLength(1);
  });

  it('a payment change sends no expected_status', async () => {
    const post = vi.fn(async () => ({ data: { applied: true } }));
    await sendOrderChange(deps(post).d, ORDER, 16, { payment_method: 'cash' });
    expect((post.mock.calls[0] as any)[1].expected_status).toBeUndefined();
  });

  it('keeps the action id after no answer, so a retry cannot apply twice', async () => {
    const ids: string[] = [];
    let first = true;
    const post = async (_p: string, b: any) => {
      ids.push(b.action_id);
      if (first) {
        first = false;
        throw new Error('network');
      }
      return { data: { applied: true, replayed: true, order: SERVER_ORDER } };
    };
    const { d } = deps(post);
    await expect(sendOrderChange(d, ORDER, 16, { status: 4 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_ORDER_CHANGE_UNSENT'
    );
    const r = await sendOrderChange(d, ORDER, 16, { status: 4 });
    expect(ids[0]).toBe(ids[1]);
    expect(r.replayed).toBe(true);
  });

  it.each([429, 500, 503])('treats %i as unsent and changes nothing', async (status) => {
    const { d, applied } = deps(async () => {
      throw refusal(status, {});
    });
    await expect(sendOrderChange(d, ORDER, 16, { status: 4 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_ORDER_CHANGE_UNSENT'
    );
    expect(applied).toHaveLength(0);
  });

  it('shows the current order and the code on a conflict', async () => {
    const { d, applied } = deps(async () => {
      throw refusal(409, { applied: false, code: 'POS_ORDER_STATUS_CONFLICT', order: SERVER_ORDER });
    });
    await expect(sendOrderChange(d, ORDER, 16, { status: 3 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_ORDER_STATUS_CONFLICT'
    );
    expect(applied).toHaveLength(1);
  });

  it('asks for a manager when the server says it only needs one', async () => {
    const { d } = deps(async () => {
      throw refusal(403, { code: 'POS_PUSH_CANCEL_NOT_PERMITTED', needs_approval: 'cancel_sent_order' });
    });
    await expect(sendOrderChange(d, ORDER, 16, { status: 5 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_APPROVAL_REQUIRED'
    );
  });

  it('tells a missing order from a server without the route', async () => {
    const declared = deps(async () => {
      throw refusal(404, { code: 'POS_ORDER_NOT_FOUND' });
    });
    await expect(sendOrderChange(declared.d, ORDER, 16, { status: 4 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_VAL_ORDER_NOT_FOUND'
    );
    const bare = deps(async () => {
      throw refusal(404, {});
    });
    await expect(sendOrderChange(bare.d, ORDER, 16, { status: 4 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_ORDER_CHANGE_UNAVAILABLE'
    );
  });

  it('does not call the server offline, or with nobody signed in', async () => {
    const post = vi.fn();
    await expect(sendOrderChange(deps(post, false).d, ORDER, 16, { status: 4 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_ORDER_CHANGE_UNSENT'
    );
    await expect(sendOrderChange(deps(post).d, ORDER, null, { status: 4 })).rejects.toSatisfy(
      (e) => codeOf(e) === 'POS_ORDER_STATUS_NOT_PERMITTED'
    );
    expect(post).not.toHaveBeenCalled();
  });
});
