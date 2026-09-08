import { describe, expect, it } from 'vitest';
import { resolveInstallationId, type InstallationIdIo } from './installationId';

/**
 * The rule that decides whether a till keeps the identity the server already
 * knows it by, or gets a new one. Getting it backwards is not a cosmetic bug:
 * a fresh id on an existing till breaks reclaim, and a shared id on a cloned
 * PC is the reason this file exists.
 */

function io(stored: string | null, generated = 'generated-id-0123456789') {
  const writes: string[] = [];
  const impl: InstallationIdIo = {
    read: () => stored,
    write: (v) => void writes.push(v),
    generate: () => generated,
  };
  return { impl, writes };
}

describe('resolving an installation id', () => {
  it('keeps the stored id and writes nothing', () => {
    const { impl, writes } = io('a'.repeat(64));
    expect(resolveInstallationId(impl, 'b'.repeat(64))).toBe('a'.repeat(64));
    expect(writes).toEqual([]);
  });

  it('adopts the id the till already registered under', () => {
    // An upgrade must be invisible to the server: this till is known by its
    // old sha256 MachineGuid, and minting a new id here would break reclaim.
    const { impl, writes } = io(null);
    expect(resolveInstallationId(impl, 'c'.repeat(64))).toBe('c'.repeat(64));
    expect(writes).toEqual(['c'.repeat(64)]);
  });

  it('generates one for an installation that has never had an id', () => {
    const { impl, writes } = io(null);
    expect(resolveInstallationId(impl)).toBe('generated-id-0123456789');
    expect(writes).toEqual(['generated-id-0123456789']);
  });

  it('ignores a stored value that cannot be an id', () => {
    // A truncated or half-written file would otherwise become this till's
    // permanent identity, and never match anything the server holds.
    for (const junk of ['', '   ', '\n', 'short', 'has spaces in it']) {
      const { impl } = io(junk);
      expect(resolveInstallationId(impl, 'd'.repeat(64))).toBe('d'.repeat(64));
    }
  });

  it('tolerates the trailing newline the file is written with', () => {
    const { impl, writes } = io(`${'e'.repeat(64)}\n`);
    expect(resolveInstallationId(impl)).toBe('e'.repeat(64));
    expect(writes).toEqual([]);
  });

  it('does not inherit a malformed meta value', () => {
    const { impl, writes } = io(null);
    expect(resolveInstallationId(impl, '  ')).toBe('generated-id-0123456789');
    expect(writes).toEqual(['generated-id-0123456789']);
  });
});
