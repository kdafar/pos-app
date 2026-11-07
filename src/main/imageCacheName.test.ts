import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));
vi.mock('./db', () => ({ default: {}, getMeta: () => null }));

const { hashName } = await import('./imageCache');
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
