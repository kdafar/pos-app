import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Silent re-pair: the till trades the identity it still holds for a new token,
 * so nobody reads a pairing code out of the back office mid-service.
 *
 * Every refusal here has to be survivable — this runs on a till that still has
 * its catalog and, quite possibly, an unsent outbox.
 */

const meta = new Map<string, string>();
const secrets = new Map<string, string>();

vi.mock('./db', () => ({
  default: {},
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => void meta.set(k, v),
}));
vi.mock('./secureStore', () => ({
  deleteSecret: async (k: string) => void secrets.delete(k),
  loadSecret: async (k: string) => secrets.get(k) ?? null,
  saveSecret: async (k: string, v: string) => void secrets.set(k, v),
}));
vi.mock('./imageCache', () => ({ prefetchItemImages: async () => {} }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getVersion: () => '0.4.24' },
}));

const { reclaimDevice } = await import('./sync');

/** reclaimDevice builds its own unauthenticated client; intercept it there. */
function stubPost(impl: (...args: any[]) => any) {
  const post = vi.fn(impl);
  vi.spyOn(axios, 'create').mockReturnValue({ post } as any);
  return post;
}

const refusal = (status: number, data: unknown, headers: any = {}) =>
  Object.assign(
    new axios.AxiosError('refused', 'ERR_BAD_REQUEST', undefined, undefined, {
      status,
      data,
      statusText: '',
      headers,
      config: {} as any,
    } as any)
  );

beforeEach(() => {
  meta.clear();
  secrets.clear();
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('a successful reclaim', () => {
  it('stores the new token and the branch the server named', async () => {
    // We ask with branch 7; the office has since moved this till to branch 9.
    // The device row is authoritative, so 9 is what must be stored.
    stubPost(async () => ({
      data: {
        device: {
          id: 'dev-1',
          branch_id: 9,
          killswitch_after_days: 30,
          locked_at: null,
        },
        token: 'fresh-token',
      },
    }));

    const result = await reclaimDevice(
      'https://till.example/',
      'dev-1',
      'machine-abc',
      7
    );

    expect(result).toEqual({
      ok: true,
      device: expect.objectContaining({ id: 'dev-1', branch_id: 9 }),
    });
    expect(secrets.get('device_token')).toBe('fresh-token');
    expect(meta.get('device_id')).toBe('dev-1');
    expect(meta.get('branch_id')).toBe('9');
    expect(meta.get('branch.id')).toBe('9');
  });

  it('sends the identity the server checks, and no credentials', async () => {
    const post = stubPost(async () => ({
      data: { device: { id: 'dev-1', branch_id: 7 }, token: 't' },
    }));

    await reclaimDevice('https://till.example/', 'dev-1', 'machine-abc', 7);

    expect(post).toHaveBeenCalledWith('/reclaim', {
      device_id: 'dev-1',
      machine_id: 'machine-abc',
      branch_id: 7,
    });
  });
});

describe('a refused reclaim', () => {
  /** Each of these leaves the till exactly as it was and falls back to a code. */
  it.each([
    ['POS_RECLAIM_DISABLED', 403, 'disabled'],
    ['POS_RECLAIM_INPUT_MISSING', 422, 'input_missing'],
    ['POS_RECLAIM_MACHINE_MISMATCH', 403, 'mismatch'],
    ['POS_RECLAIM_DEVICE_UNKNOWN', 404, 'unknown'],
    ['POS_DEVICE_REVOKED', 401, 'revoked'],
    ['POS_DEVICE_LOCKED', 423, 'locked'],
    ['POS_DEVICE_KILLSWITCH', 423, 'locked'],
    ['POS_RECLAIM_RATE_LIMITED', 429, 'rate_limited'],
    ['POS_RECLAIM_MACHINE_IN_USE', 409, 'machine_in_use'],
    ['POS_RATE_LIMITED', 429, 'rate_limited'],
  ])('reads %s as %s', async (code, status, reason) => {
    stubPost(async () => {
      throw refusal(status, { code, message: 'refused' });
    });
    secrets.set('device_token', 'old-token');

    const result = await reclaimDevice('https://x.test/', 'dev-1', 'm-1');

    expect(result).toMatchObject({ ok: false, reason });
    // Nothing is thrown away on a refusal — not even on a revoke, which is
    // markDeviceRevoked()'s call to make, one layer up.
    expect(secrets.get('device_token')).toBe('old-token');
  });

  it('carries the wait through when it is throttled', async () => {
    stubPost(async () => {
      throw refusal(
        429,
        { code: 'POS_RECLAIM_RATE_LIMITED' },
        { 'retry-after': '3600' }
      );
    });

    const result = await reclaimDevice('https://x.test/', 'dev-1', 'm-1');

    expect(result).toEqual({
      ok: false,
      reason: 'rate_limited',
      retry_after: 3600,
    });
  });

  it('treats an unrecognised refusal as simply unavailable', async () => {
    // A proxy, a WAF, a 500, a server with no /reclaim route at all.
    stubPost(async () => {
      throw refusal(502, '<html>Bad Gateway</html>');
    });
    secrets.set('device_token', 'old-token');

    expect(await reclaimDevice('https://x.test/', 'dev-1', 'm-1')).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(secrets.get('device_token')).toBe('old-token');
  });

  it('treats an unusable 200 envelope as unavailable, and stores nothing', async () => {
    stubPost(async () => ({ data: { device: { id: 'dev-1' } } })); // no token

    expect(await reclaimDevice('https://x.test/', 'dev-1', 'm-1')).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(secrets.has('device_token')).toBe(false);
    expect(meta.has('device_id')).toBe(false);
  });
});

describe('without an identity to reclaim with', () => {
  it.each([
    { label: 'no base url', args: ['', 'dev-1', 'm-1'] },
    { label: 'no machine id', args: ['https://x.test/', 'dev-1', ''] },
  ])('refuses locally on $label, without a request', async ({ args }) => {
    const post = stubPost(async () => ({ data: {} }));

    const [base, device, machine] = args as [string, string, string];
    expect(await reclaimDevice(base, device, machine)).toEqual({
      ok: false,
      reason: 'no_identity',
    });
    expect(post).not.toHaveBeenCalled();
  });

  /**
   * A till blanked before its first sale has no meta row and no order of its
   * own to recover an id from. machine_uid is UNIQUE on the server, so the
   * machine alone identifies the device — and a server that still requires
   * both answers POS_RECLAIM_INPUT_MISSING, which falls through to the
   * pairing code exactly as before.
   */
  it('still tries with the machine alone when the device id is gone', async () => {
    const post = stubPost(async () => ({
      data: { device: { id: 'dev-1', branch_id: 7 }, token: 'fresh' },
    }));

    const result = await reclaimDevice('https://x.test/', '', 'machine-abc', 7);

    expect(result).toMatchObject({ ok: true });
    // Omitted, not sent empty: '' would claim to be a device with no id.
    expect(post).toHaveBeenCalledWith('/reclaim', {
      device_id: undefined,
      machine_id: 'machine-abc',
      branch_id: 7,
    });
  });

  it('falls through to the pairing code on a server that still needs both', async () => {
    stubPost(async () => {
      throw refusal(422, { code: 'POS_RECLAIM_INPUT_MISSING' });
    });

    expect(await reclaimDevice('https://x.test/', '', 'machine-abc')).toEqual({
      ok: false,
      reason: 'input_missing',
    });
  });
});
