import { describe, expect, it } from 'vitest';
import { withEmbeddedFont } from './receiptFont';

describe('embedded receipt font', () => {
  it('goes into the head, ahead of the page styles', () => {
    const out = withEmbeddedFont('<html><head lang="en"><style>b{}</style></head><body>x</body></html>');
    const font = out.indexOf('id="pos-embedded-font"');
    expect(font).toBeGreaterThan(out.indexOf('<head lang="en">'));
    expect(font).toBeLessThan(out.indexOf('<style>b{}'));
    expect(out).toContain("font-family:'Arial'");
    expect(out).toContain('format(\'woff2\')');
  });

  it('leaves Arabic to the system fonts', () => {
    const out = withEmbeddedFont('<head></head>');
    expect(out).toContain('unicode-range:U+0000-00FF');
    expect(out).not.toMatch(/U\+06/);
  });

  it('is added once, and works on a page with no head', () => {
    const once = withEmbeddedFont('<p>hi</p>');
    expect(once.startsWith('<style id="pos-embedded-font">')).toBe(true);
    expect(withEmbeddedFont(once)).toBe(once);
  });
});
