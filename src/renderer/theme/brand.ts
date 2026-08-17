// src/renderer/theme/brand.ts
//
// Brand colours come from the operator, not from this repo.
//
// HeroUI compiles its palette into CSS custom properties as space-separated
// HSL ("212.5 92.31% 94.9%"), one variable per step. That means the entire
// component library can be retinted at runtime by rewriting those variables —
// no rebuild, no per-component overrides, and it reaches every HeroUI control
// on all 31 screens at once.
//
// So the brand is data: the backend ships a hex, the till applies it. The
// fallbacks below are only what a shop sees before its branding syncs, or if it
// never sets one.

/** What ships when the backend has told us nothing. */
export const FALLBACK_BRAND = {
  primary: '#2563eb', // the blue the app already used
  secondary: '#f97316', // orange
} as const;

/** Settings keys, in priority order, mirroring how the logo is resolved. */
export const BRAND_COLOR_KEYS = {
  primary: [
    'branding.primary_color',
    'branding.color_primary',
    'general.primary_color',
    'theme.primary',
  ],
  secondary: [
    'branding.secondary_color',
    'branding.color_secondary',
    'general.secondary_color',
    'theme.secondary',
  ],
} as const;

type Hsl = { h: number; s: number; l: number };

/**
 * Parse #rgb, #rrggbb, or a bare rrggbb.
 *
 * Returns null rather than throwing or guessing: a malformed value from the
 * backend must fall back to the default palette, not paint the till black.
 */
export function parseHex(input: string | null | undefined): Hsl | null {
  if (!input) return null;
  const raw = String(input).trim().replace(/^#/, '');
  const hex =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;

  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  h = h * 60;
  if (h < 0) h += 360;

  return { h, s: s * 100, l: l * 100 };
}

/** Relative luminance, for deciding what text sits on top of a colour. */
function luminance({ h, s, l }: Hsl): number {
  // Cheap but sufficient: convert back to RGB and use the sRGB coefficients.
  const c = ((1 - Math.abs((2 * l) / 100 - 1)) * s) / 100;
  const x = c * (1 - Math.abs((((h / 60) % 2) - 1)));
  const m = l / 100 - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
      ? [x, c, 0]
      : h < 180
      ? [0, c, x]
      : h < 240
      ? [0, x, c]
      : h < 300
      ? [x, 0, c]
      : [c, 0, x];
  const lin = (v: number) => {
    const n = v + m;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Lightness for each step of a HeroUI ramp.
 *
 * Anchored so that step 500 is the brand colour itself and the rest fan out
 * from it, rather than being sampled from a fixed table — a pale brand and a
 * dark one both need to end up with a usable 500.
 */
const LIGHT_STOPS: Record<string, number> = {
  '50': 95,
  '100': 90,
  '200': 80,
  '300': 69,
  '400': 58,
  '500': 48,
  '600': 40,
  '700': 32,
  '800': 24,
  '900': 16,
};

/**
 * Build the CSS variable map for one HeroUI colour role.
 *
 * `foreground` is computed from luminance rather than assumed white: a brand
 * that is yellow or pale mint gets black text on its buttons instead of white
 * on white, which is the usual way runtime theming produces an unreadable app.
 */
export function buildRamp(role: string, base: Hsl): Record<string, string> {
  const out: Record<string, string> = {};
  const sat = Math.max(20, Math.min(96, base.s));

  for (const [step, l] of Object.entries(LIGHT_STOPS)) {
    out[`--heroui-${role}-${step}`] = `${base.h.toFixed(2)} ${sat.toFixed(
      2
    )}% ${l.toFixed(2)}%`;
  }

  // The role's own value and the text that sits on it.
  out[`--heroui-${role}`] = `${base.h.toFixed(2)} ${sat.toFixed(2)}% ${
    base.l.toFixed(2)
  }%`;
  const onDark = luminance(base) < 0.45;
  out[`--heroui-${role}-foreground`] = onDark ? '0 0% 100%' : '0 0% 0%';

  return out;
}

export type BrandColors = { primary?: string | null; secondary?: string | null };

/**
 * Lightness that keeps a brand colour readable as TEXT on a given surface.
 *
 * Only the *-foreground tokens were being corrected, which covers `bg-primary
 * text-primary-foreground` but not bare `text-primary` on a neutral surface —
 * and the app uses that for sort arrows, avatar initials, active nav and
 * prices. With one ramp shared by both themes, a navy brand disappears on the
 * dark theme and a lemon one disappears on the light theme.
 *
 * The hue and saturation are the brand's; only lightness is pulled into a band
 * that contrasts with the surface, so the colour still reads as theirs.
 */
export function readableL(l: number, on: 'light' | 'dark'): number {
  return on === 'dark'
    ? Math.min(85, Math.max(58, l)) // light enough to sit on a dark surface
    : Math.min(46, Math.max(20, l)); // dark enough to sit on a light one
}

/**
 * Apply brand colours to the running app.
 *
 * The ramp goes on <html> so it cascades into portalled modals and toasts. The
 * text-safe value is emitted as a stylesheet instead, because it needs two
 * different values for `:root` and `.dark` and an inline style can only hold
 * one.
 */
export function applyBrandTheme(colors: BrandColors): void {
  const root = document.documentElement;

  const primary = parseHex(colors.primary) ?? parseHex(FALLBACK_BRAND.primary)!;
  const secondary =
    parseHex(colors.secondary) ?? parseHex(FALLBACK_BRAND.secondary)!;

  const vars = {
    ...buildRamp('primary', primary),
    // HeroUI calls it "secondary"; the app uses it for accents and highlights.
    ...buildRamp('secondary', secondary),
  };

  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

  // Per-theme override for the value `text-primary` resolves to.
  const band = (c: Hsl, on: 'light' | 'dark') =>
    `${c.h.toFixed(2)} ${Math.max(20, Math.min(96, c.s)).toFixed(2)}% ${readableL(
      c.l,
      on
    ).toFixed(2)}%`;

  const css = `
:root{--heroui-primary:${band(primary, 'light')};--heroui-secondary:${band(
    secondary,
    'light'
  )};}
.dark{--heroui-primary:${band(primary, 'dark')};--heroui-secondary:${band(
    secondary,
    'dark'
  )};}`;

  const ID = 'brand-theme-contrast';
  let el = document.getElementById(ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

/**
 * Read brand colours from synced settings and apply them.
 *
 * Deliberately never throws: theming is cosmetic, and a till that cannot reach
 * its settings must still open on the fallback palette rather than fail to
 * render.
 */
export async function loadAndApplyBrandTheme(): Promise<void> {
  const read = async (keys: readonly string[]) => {
    for (const key of keys) {
      try {
        const v = await window.api.invoke('settings:get', key);
        if (v && String(v).trim()) return String(v);
      } catch {
        /* try the next key */
      }
    }
    return null;
  };

  try {
    const [primary, secondary] = await Promise.all([
      read(BRAND_COLOR_KEYS.primary),
      read(BRAND_COLOR_KEYS.secondary),
    ]);
    applyBrandTheme({ primary, secondary });
  } catch {
    applyBrandTheme({});
  }
}
