import { describe, it, expect } from 'vitest';
import { parseHex, buildRamp, readableL, FALLBACK_BRAND } from './brand';

describe('parseHex', () => {
  it('reads long, short and bare hex', () => {
    expect(parseHex('#ffffff')).toMatchObject({ s: 0, l: 100 });
    expect(parseHex('000000')).toMatchObject({ s: 0, l: 0 });
    expect(parseHex('#fff')).toMatchObject({ l: 100 });
  });

  it('finds the right hue for primaries', () => {
    expect(parseHex('#ff0000')!.h).toBeCloseTo(0, 0);
    expect(parseHex('#00ff00')!.h).toBeCloseTo(120, 0);
    expect(parseHex('#0000ff')!.h).toBeCloseTo(240, 0);
  });

  it('rejects anything malformed instead of guessing', () => {
    // A bad value from the backend must fall back to the default palette —
    // never paint the till an arbitrary colour.
    for (const bad of ['', null, undefined, 'red', '#12', '#1234567', 'zzzzzz']) {
      expect(parseHex(bad as any)).toBeNull();
    }
  });

  it('parses both shipped fallbacks', () => {
    expect(parseHex(FALLBACK_BRAND.primary)).not.toBeNull();
    expect(parseHex(FALLBACK_BRAND.secondary)).not.toBeNull();
  });
});

describe('buildRamp', () => {
  const ramp = (hex: string) => buildRamp('primary', parseHex(hex)!);

  it('emits every step HeroUI expects, in its space-separated HSL format', () => {
    const r = ramp('#2563eb');
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      expect(r[`--heroui-primary-${step}`]).toMatch(
        /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/
      );
    }
    expect(r['--heroui-primary']).toBeDefined();
    expect(r['--heroui-primary-foreground']).toBeDefined();
  });

  it('darkens monotonically from 50 to 900', () => {
    const r = ramp('#2563eb');
    const l = (step: number) =>
      Number(r[`--heroui-primary-${step}`].split(' ')[2].replace('%', ''));
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    for (let i = 1; i < steps.length; i++) {
      expect(l(steps[i])).toBeLessThan(l(steps[i - 1]));
    }
  });

  it('puts black text on a pale brand and white on a dark one', () => {
    // The usual way runtime theming produces an unreadable app is assuming
    // white text: a yellow or mint brand then renders white on near-white.
    expect(ramp('#ffee00')['--heroui-primary-foreground']).toBe('0 0% 0%');
    expect(ramp('#aaffcc')['--heroui-primary-foreground']).toBe('0 0% 0%');
    expect(ramp('#2563eb')['--heroui-primary-foreground']).toBe('0 0% 100%');
    expect(ramp('#111111')['--heroui-primary-foreground']).toBe('0 0% 100%');
  });

  it('keeps a greyscale brand usable rather than fully desaturated', () => {
    // A shop that sends #808080 should still get a visible ramp.
    const r = ramp('#808080');
    const sat = Number(r['--heroui-primary-500'].split(' ')[1].replace('%', ''));
    expect(sat).toBeGreaterThanOrEqual(20);
  });

  it('names variables for whichever role it is given', () => {
    const r = buildRamp('secondary', parseHex('#f97316')!);
    expect(r['--heroui-secondary-500']).toBeDefined();
    expect(r['--heroui-primary-500']).toBeUndefined();
  });
});

describe('readableL', () => {
  it('lifts a dark brand so it can be read on the dark theme', () => {
    // A navy brand (~20% lightness) as bare text-primary on a dark surface is
    // the failure this guards: the ramp is shared by both themes, so without
    // this it renders near-black on near-black.
    expect(readableL(20, 'dark')).toBeGreaterThanOrEqual(58);
  });

  it('darkens a pale brand so it can be read on the light theme', () => {
    expect(readableL(92, 'light')).toBeLessThanOrEqual(46);
  });

  it('leaves a mid-tone brand alone in both themes', () => {
    // 46 already sits inside the light band, so it should pass through.
    expect(readableL(46, 'light')).toBe(46);
    expect(readableL(60, 'dark')).toBe(60);
  });

  it('always separates the two themes', () => {
    for (const l of [0, 10, 35, 50, 75, 100]) {
      expect(readableL(l, 'dark')).toBeGreaterThan(readableL(l, 'light'));
    }
  });
});
