import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));
vi.mock('./db', () => ({ default: {}, getMeta: () => null }));

const { hashName, isShopPhotoUrl } = await import('./imageCache');
const url = 'https://shop.test/storage/a.jpg';

describe('hashName', () => {
  it('keeps the name of a normal photo', () => {
    expect(hashName(url, '107')).toMatch(/^107-[0-9a-f]{32}\.jpg$/);
  });
  it('cannot leave the images folder whatever the id says', () => {
    for (const id of ['../../evil', '..\\..\\evil', '/etc/x', 'C:\\x']) {
      const name = hashName(url, id);
      expect(name).not.toMatch(/[/\\:]/);
      expect(path.dirname(path.join('images', name))).toBe('images');
    }
  });
  it('allows only image extensions', () => {
    expect(hashName('https://shop.test/a.exe', '1')).toMatch(/\.jpg$/);
    expect(hashName('https://shop.test/a.WEBP', '1')).toMatch(/\.WEBP$/);
  });
});

describe('isShopPhotoUrl', () => {
  const base = 'https://dev.trebianco.com/';
  it('accepts the shop server, with or without www', () => {
    expect(isShopPhotoUrl('https://dev.trebianco.com/storage/a.jpg', base)).toBe(true);
    expect(isShopPhotoUrl('https://www.dev.trebianco.com/a.jpg', base)).toBe(true);
  });
  it('refuses anything else', () => {
    for (const u of [
      'https://evil.test/a.jpg',
      'https://dev.trebianco.com.evil.test/a.jpg',
      'https://evil.test/dev.trebianco.com/a.jpg',
      'http://192.168.1.1/a.jpg',
      'http://localhost/a.jpg',
      'file:///etc/passwd',
    ]) {
      expect(isShopPhotoUrl(u, base)).toBe(false);
    }
  });
  it('refuses when the shop address is unknown', () => {
    expect(isShopPhotoUrl('https://dev.trebianco.com/a.jpg', null)).toBe(false);
  });
});
