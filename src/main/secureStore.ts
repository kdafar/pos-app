// src/main/secureStore.ts
import { app } from 'electron';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const SERVICE = 'pos-app';

/** The OS keychain — null whenever the native keytar module did not load. */
export type Keyring = {
  get(key: string): Promise<string | null>;
  set(key: string, secret: string): Promise<void>;
  delete(key: string): Promise<void>;
} | null;

/** The plaintext JSON file used only when there is no keychain. */
export type FileStore = {
  get(key: string): string | null;
  set(key: string, secret: string): void;
  delete(key: string): void;
};

/**
 * Two stores, one secret.
 *
 * Which one a secret lands in is decided at runtime by whether the native
 * keytar binary loaded, and that answer can differ between two builds on the
 * same machine — a reinstall replaces app.asar.unpacked, so a till that wrote
 * its device token to the keychain can come back up reading only the file, or
 * the reverse. Consulting a single store made that look exactly like "this
 * device was never paired": the Pair screen, with the token still on disk.
 *
 * So a read tries both and a delete clears both. Writes still prefer the
 * keychain and clear the file copy, so the token is never left sitting in
 * plaintext once the OS is willing to hold it.
 */
export function createSecretStore(opts: {
  keyring: () => Keyring;
  file: FileStore;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { keyring, file } = opts;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function deleteSecret(key: string): Promise<boolean> {
    if (!key) return false;

    const k = keyring();
    if (k) {
      try {
        await k.delete(key);
      } catch (err) {
        console.error('[secrets] keychain delete failed:', err);
      }
    }

    // Both stores, always. Clearing only the keychain would leave a stale
    // plaintext copy that the next read happily resurrects.
    file.delete(key);
    return true;
  }

  async function saveSecret(key: string, secret: string): Promise<void> {
    if (!key) return;

    // auth:unpair blanks the token rather than deleting it. Now that a read
    // consults both stores, an empty write has to mean "forget it everywhere"
    // or the emptied keychain entry falls through to the old file copy and the
    // till quietly keeps the credential it was just told to drop.
    if (!secret) {
      await deleteSecret(key);
      return;
    }

    const k = keyring();
    if (k) {
      try {
        await k.set(key, secret);
        file.delete(key);
        return;
      } catch (err) {
        console.error('[secrets] keychain write failed; using file:', err);
      }
    }

    file.set(key, secret);
  }

  async function loadSecret(key: string): Promise<string | null> {
    if (!key) return null;

    const k = keyring();
    let keychainError: unknown = null;

    if (k) {
      try {
        const fromKeychain = await k.get(key);
        if (fromKeychain) return fromKeychain;
      } catch (err) {
        keychainError = err;
        console.error('[secrets] keychain read failed:', err);
      }
    }

    const fromFile = file.get(key);
    if (fromFile) {
      // Written by a build whose keytar was missing. This one has a working
      // keychain, so move it across and stop keeping it in the clear.
      if (k && !keychainError) {
        try {
          await k.set(key, fromFile);
          file.delete(key);
        } catch (err) {
          console.error('[secrets] could not migrate secret to keychain:', err);
        }
      }
      return fromFile;
    }

    // "The keychain would not answer" is not "this till has no token", and
    // reporting the second is what strands a paired device on the Pair screen.
    // Fail loudly so the caller can retry instead.
    if (keychainError) throw keychainError;
    return null;
  }

  /**
   * The keychain can answer null for a secret that is really there — it is an
   * IPC call to a Windows service that is not always warm on the first read
   * after boot, which is exactly when auth:status decides whether to show the
   * Pair screen. One miss must not cost a paired till its session.
   */
  async function loadSecretWithRetry(
    key: string,
    attempts = 3,
    delayMs = 100
  ): Promise<string | null> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const secret = await loadSecret(key);
        if (secret) return secret;
        lastError = null;
      } catch (err) {
        lastError = err;
      }
      if (attempt < attempts - 1) await sleep(delayMs);
    }

    if (lastError) throw lastError;
    return null;
  }

  return { deleteSecret, loadSecret, loadSecretWithRetry, saveSecret };
}

/* ---------- default wiring: keytar, with a JSON file behind it ---------- */

const requirekey = createRequire(import.meta.url);
let keytarMod: any = null;
try {
  keytarMod = requirekey('keytar');
} catch {
  keytarMod = null;
}
const KT = () => (keytarMod?.default ?? keytarMod) || null;

// Resolved on use, not at import: app.getPath throws before the app is ready.
const fallbackPath = () => path.join(app.getPath('userData'), 'secrets.json');

const readAll = (): Record<string, string> => {
  try {
    return JSON.parse(fs.readFileSync(fallbackPath(), 'utf8'));
  } catch {
    return {};
  }
};

const writeAll = (o: Record<string, string>) => {
  const target = fallbackPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(o));
};

const fileStore: FileStore = {
  get: (key) => {
    const v = readAll()[key];
    return v ? String(v) : null;
  },
  set: (key, secret) => {
    const o = readAll();
    o[key] = secret;
    writeAll(o);
  },
  delete: (key) => {
    const o = readAll();
    if (!(key in o)) return;
    delete o[key];
    writeAll(o);
  },
};

const keyring = (): Keyring => {
  const k = KT();
  if (!k?.getPassword || !k?.setPassword || !k?.deletePassword) return null;
  return {
    get: (key) => k.getPassword(SERVICE, key),
    set: (key, secret) => k.setPassword(SERVICE, key, secret),
    delete: (key) => k.deletePassword(SERVICE, key),
  };
};

const store = createSecretStore({ keyring, file: fileStore });

export const deleteSecret = store.deleteSecret;
export const loadSecret = store.loadSecret;
export const loadSecretWithRetry = store.loadSecretWithRetry;
export const saveSecret = store.saveSecret;
