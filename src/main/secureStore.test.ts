import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches for electron and tries to require the native keytar
// binary at import time; neither exists under vitest. createSecretStore holds
// the whole of the policy and takes both stores as arguments, so nothing real
// is needed to drive it.
vi.mock('electron', () => ({ app: { getPath: () => '' } }));

const { createSecretStore } = await import('./secureStore');

function fakeFile(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    store: {
      get: (key: string) => data.get(key) ?? null,
      set: (key: string, secret: string) => void data.set(key, secret),
      delete: (key: string) => void data.delete(key),
    },
  };
}

function fakeKeyring(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const fail = { get: null as Error | null, set: null as Error | null };
  return {
    data,
    fail,
    ring: {
      get: async (key: string) => {
        if (fail.get) throw fail.get;
        return data.get(key) ?? null;
      },
      set: async (key: string, secret: string) => {
        if (fail.set) throw fail.set;
        data.set(key, secret);
      },
      delete: async (key: string) => void data.delete(key),
    },
  };
}

function build(
  keyring: ReturnType<typeof fakeKeyring> | null,
  file: ReturnType<typeof fakeFile> = fakeFile()
) {
  return createSecretStore({
    keyring: () => keyring?.ring ?? null,
    file: file.store,
    sleep: async () => {},
  });
}

// console.error is how the module reports a store it could not reach; these
// tests provoke that on purpose and do not want the noise.
beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));

describe('reading a secret', () => {
  it('takes the keychain copy and leaves the file alone', async () => {
    const kr = fakeKeyring({ device_token: 'from-keychain' });
    const file = fakeFile({ device_token: 'from-file' });

    expect(await build(kr, file).loadSecret('device_token')).toBe(
      'from-keychain'
    );
    expect(file.data.get('device_token')).toBe('from-file');
  });

  /**
   * The reinstall case. A build whose native keytar failed to load wrote the
   * device token to the JSON file; this build reads the keychain, finds
   * nothing, and must not conclude the till was never paired.
   */
  it('falls back to the file and migrates the secret into the keychain', async () => {
    const kr = fakeKeyring();
    const file = fakeFile({ device_token: 'paired-token' });

    expect(await build(kr, file).loadSecret('device_token')).toBe(
      'paired-token'
    );
    expect(kr.data.get('device_token')).toBe('paired-token');
    expect(file.data.has('device_token')).toBe(false);
  });

  it('still answers from the file when the keychain read fails', async () => {
    const kr = fakeKeyring();
    kr.fail.get = new Error('credential service unavailable');
    const file = fakeFile({ device_token: 'paired-token' });

    expect(await build(kr, file).loadSecret('device_token')).toBe(
      'paired-token'
    );
    // Nothing is migrated on the back of a keychain we could not read.
    expect(file.data.get('device_token')).toBe('paired-token');
  });

  /**
   * The distinction the Pair screen hangs on: a keychain that would not answer
   * is not a till without a token.
   */
  it('throws rather than reporting "no secret" when the keychain failed', async () => {
    const kr = fakeKeyring();
    kr.fail.get = new Error('credential service unavailable');

    await expect(build(kr).loadSecret('device_token')).rejects.toThrow(
      'credential service unavailable'
    );
  });

  it('answers null when both stores are genuinely empty', async () => {
    expect(await build(fakeKeyring()).loadSecret('device_token')).toBeNull();
  });

  it('works with no keychain at all', async () => {
    const file = fakeFile({ device_token: 'paired-token' });
    expect(await build(null, file).loadSecret('device_token')).toBe(
      'paired-token'
    );
  });
});

describe('writing a secret', () => {
  it('prefers the keychain and clears any stale plaintext copy', async () => {
    const kr = fakeKeyring();
    const file = fakeFile({ device_token: 'old-token' });

    await build(kr, file).saveSecret('device_token', 'new-token');

    expect(kr.data.get('device_token')).toBe('new-token');
    expect(file.data.has('device_token')).toBe(false);
  });

  it('falls back to the file when the keychain write fails', async () => {
    const kr = fakeKeyring();
    kr.fail.set = new Error('access denied');
    const file = fakeFile();

    await build(kr, file).saveSecret('device_token', 'new-token');

    expect(file.data.get('device_token')).toBe('new-token');
  });

  /**
   * auth:unpair blanks the token rather than deleting it. With reads now
   * consulting both stores, an empty write that only emptied the keychain
   * would fall through to the file copy and re-pair the till to the very
   * credential it was told to drop.
   */
  it('treats an empty secret as "forget it everywhere"', async () => {
    const kr = fakeKeyring({ device_token: 'live-token' });
    const file = fakeFile({ device_token: 'live-token' });
    const store = build(kr, file);

    await store.saveSecret('device_token', '');

    expect(kr.data.has('device_token')).toBe(false);
    expect(file.data.has('device_token')).toBe(false);
    expect(await store.loadSecret('device_token')).toBeNull();
  });
});

describe('deleting a secret', () => {
  it('clears both stores so a stale file copy cannot resurrect it', async () => {
    const kr = fakeKeyring({ device_token: 'live-token' });
    const file = fakeFile({ device_token: 'live-token' });
    const store = build(kr, file);

    await store.deleteSecret('device_token');

    expect(await store.loadSecret('device_token')).toBeNull();
  });

  it('still clears the file when the keychain delete throws', async () => {
    const file = fakeFile({ device_token: 'live-token' });
    const store = createSecretStore({
      keyring: () => ({
        get: async () => null,
        set: async () => {},
        delete: async () => {
          throw new Error('locked');
        },
      }),
      file: file.store,
      sleep: async () => {},
    });

    await store.deleteSecret('device_token');
    expect(file.data.has('device_token')).toBe(false);
  });
});

describe('retrying a read', () => {
  it('accepts a secret the keychain only reveals on a later attempt', async () => {
    const kr = fakeKeyring();
    let calls = 0;
    const store = createSecretStore({
      keyring: () => ({
        ...kr.ring,
        get: async () => (++calls < 3 ? null : 'paired-token'),
      }),
      file: fakeFile().store,
      sleep: async () => {},
    });

    expect(await store.loadSecretWithRetry('device_token')).toBe(
      'paired-token'
    );
    expect(calls).toBe(3);
  });

  it('gives up on a secret that is genuinely absent', async () => {
    expect(
      await build(fakeKeyring()).loadSecretWithRetry('device_token')
    ).toBeNull();
  });

  it('rethrows a keychain failure that never clears', async () => {
    const kr = fakeKeyring();
    kr.fail.get = new Error('credential service unavailable');

    await expect(build(kr).loadSecretWithRetry('device_token')).rejects.toThrow(
      'credential service unavailable'
    );
  });

  it('does not retry once the secret is in hand', async () => {
    const kr = fakeKeyring({ device_token: 'paired-token' });
    const get = vi.fn(kr.ring.get);
    const store = createSecretStore({
      keyring: () => ({ ...kr.ring, get }),
      file: fakeFile().store,
      sleep: async () => {},
    });

    await store.loadSecretWithRetry('device_token');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
