import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The regression this file exists for.
 *
 * configureApi's response interceptor used to answer every 401 and 403 by
 * deleting the device token and blanking device_id, then throwing an AuthError
 * that hid the status from the callers. One rejected request — an expired
 * token, a proxy, a WAF, a version gate met by the first sync after an
 * update — therefore unpaired the till permanently, which is how a shop that
 * merely re-ran the installer ended up back on the Pair screen.
 *
 * A lock or a rejection must destroy nothing (docs/BACKEND-QUESTIONS.md §6.4);
 * only markDeviceRevoked(), reached deliberately by a caller, may unpair.
 */

const deleteSecret = vi.fn(async () => {});
const meta = new Map<string, string>();

vi.mock('./db', () => ({
  default: {},
  getMeta: (k: string) => meta.get(k) ?? null,
  setMeta: (k: string, v: string) => void meta.set(k, v),
}));
// deleteSecret stays on the mock even though sync.ts no longer imports it: if
// anyone reintroduces the destructive branch, the spy below catches it.
vi.mock('./secureStore', () => ({
  deleteSecret,
  loadSecret: async () => null,
  saveSecret: async () => {},
}));
vi.mock('./imageCache', () => ({ prefetchItemImages: async () => {} }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getVersion: () => '0.4.24' },
}));

const { configureApi } = await import('./sync');

/** The instance is module-private, so take it as configureApi builds it. */
function buildRejectionHandler() {
  const create = vi.spyOn(axios, 'create');
  configureApi('https://till.example/', { id: 'dev-1', branch_id: 7 }, 'tok');
  const instance = create.mock.results[0].value as any;
  create.mockRestore();

  const handler = instance.interceptors.response.handlers[0]?.rejected;
  expect(typeof handler).toBe('function');
  return handler as (err: unknown) => Promise<never>;
}

const rejected = (status: number, data: unknown = {}) =>
  new axios.AxiosError('rejected', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: {} as any,
  } as any);

beforeEach(() => {
  meta.clear();
  meta.set('device_id', 'dev-1');
  deleteSecret.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the response interceptor', () => {
  it.each([401, 403])('keeps the pairing intact on %i', async (status) => {
    const handler = buildRejectionHandler();

    await expect(handler(rejected(status, { message: 'Invalid token.' })))
      .rejects.toBeDefined();

    expect(deleteSecret).not.toHaveBeenCalled();
    expect(meta.get('device_id')).toBe('dev-1');
  });

  it('keeps the pairing intact even when the server says revoked', async () => {
    // Unpairing on a revoke is real, but it is markDeviceRevoked()'s call to
    // make — it preserves the outbox, records a reason for the Pair screen and
    // is reached only from a caller that knows which sync it was running.
    const handler = buildRejectionHandler();

    await expect(handler(rejected(401, { message: 'Device revoked' })))
      .rejects.toBeDefined();

    expect(deleteSecret).not.toHaveBeenCalled();
    expect(meta.get('device_id')).toBe('dev-1');
  });

  it('rejects with the axios error itself, so callers can still classify it', async () => {
    const handler = buildRejectionHandler();
    const original = rejected(401, { message: 'Device revoked' });

    await expect(handler(original)).rejects.toBe(original);
    // Converting this to an AuthError is what left the callers' 401 branches
    // dead: axios.isAxiosError said no and the revoke was never acted on.
    await handler(original).catch((err) => {
      expect(axios.isAxiosError(err)).toBe(true);
      expect(err.response.status).toBe(401);
    });
  });

  it('still records when the server locks the device', async () => {
    const handler = buildRejectionHandler();

    await expect(
      handler(rejected(423, { locked_at: '2026-09-01T00:00:00Z' }))
    ).rejects.toBeDefined();

    // Stored as the server sent it. Note this is not the epoch-ms
    // `pos.locked_at` that handlers/sync.ts writes — a different key, left
    // exactly as it was.
    expect(meta.get('device.locked_at')).toBe('2026-09-01T00:00:00Z');
    expect(meta.get('device_id')).toBe('dev-1');
  });

  /**
   * The backend asked us to honour Retry-After rather than retrying straight
   * away: the /api group is throttled at 60/min per IP, shared by every till
   * behind one shop's NAT, so a branch reaches it with no till misbehaving.
   */
  it('records how long to wait when the server throttles us', async () => {
    const handler = buildRejectionHandler();
    const before = Date.now();

    await expect(
      handler(rejected(429, { retry_after: 30 })).catch((e) => {
        throw e;
      })
    ).rejects.toBeDefined();

    const waitUntil = Number(meta.get('sync.retry_after_at'));
    expect(waitUntil).toBeGreaterThanOrEqual(before + 30_000);
    expect(waitUntil).toBeLessThan(before + 31_000);
  });

  it('prefers the Retry-After header over the body', async () => {
    const handler = buildRejectionHandler();
    const err = rejected(429, { retry_after: 5 });
    (err.response as any).headers = { 'retry-after': '120' };
    const before = Date.now();

    await expect(handler(err)).rejects.toBeDefined();

    expect(Number(meta.get('sync.retry_after_at'))).toBeGreaterThanOrEqual(
      before + 120_000
    );
  });

  it('falls back to a minute when the server names no delay', async () => {
    const handler = buildRejectionHandler();
    const before = Date.now();

    await expect(handler(rejected(429, {}))).rejects.toBeDefined();

    expect(Number(meta.get('sync.retry_after_at'))).toBeGreaterThanOrEqual(
      before + 60_000
    );
  });

  it('passes an ordinary failure straight through', async () => {
    const handler = buildRejectionHandler();
    const offline = new Error('ECONNREFUSED');

    await expect(handler(offline)).rejects.toBe(offline);
    expect(deleteSecret).not.toHaveBeenCalled();
    expect(meta.get('device_id')).toBe('dev-1');
  });
});
