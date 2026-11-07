import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));
vi.mock('./db', () => ({ default: {}, getMeta: () => null }));

const { hashName, isShopPhotoUrl, shopPhotoOrNull } = await import('./imageCache');
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
      'http://dev.trebianco.com/a.jpg',
      'https://dev.trebianco.com:8443/a.jpg',
    ]) {
      expect(isShopPhotoUrl(u, base)).toBe(false);
    }
  });
  it('refuses when the shop address is unknown', () => {
    expect(isShopPhotoUrl('https://dev.trebianco.com/a.jpg', null)).toBe(false);
  });
});

describe('shopPhotoOrNull', () => {
  const base = 'https://dev.trebianco.com/';
  it('keeps the shop server and relative paths', () => {
    expect(shopPhotoOrNull('https://dev.trebianco.com/a.jpg', base)).toBe('https://dev.trebianco.com/a.jpg');
    expect(shopPhotoOrNull('/storage/a.jpg', base)).toBe('https://dev.trebianco.com/storage/a.jpg');
    expect(shopPhotoOrNull(null, base)).toBeNull();
  });
  it('drops anything else, so the item card cannot load it', () => {
    for (const u of [
      'https://evil.test/a.jpg',
      '//evil.test/a.jpg',
      'http://192.168.1.1/a.jpg',
      'file:///etc/passwd',
      'data:image/png;base64,AA',
      '\\\\evil.test\\a.jpg',
      '/\\evil.test/a.jpg',
      ' //evil.test/a.jpg',
      '\t//evil.test/a.jpg',
      '/\t/evil.test/a.jpg',
      '/a\nb.jpg',
      '\\\\dev.trebianco.com\\a.jpg',
    ]) {
      expect(shopPhotoOrNull(u, base)).toBeNull();
    }
  });
  it('keeps a photo with a space in its name', () => {
    expect(shopPhotoOrNull('https://dev.trebianco.com/grilled chicken.jpg', base)).toBe(
      'https://dev.trebianco.com/grilled%20chicken.jpg'
    );
  });
  it('stores nothing when the shop address is unknown', () => {
    expect(shopPhotoOrNull('https://dev.trebianco.com/a.jpg', null)).toBeNull();
  });
});
