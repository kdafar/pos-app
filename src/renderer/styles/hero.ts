// hero.ts
//
// HeroUI's theme, set to the Order Portal design (docs/DESIGN-INVENTORY.md),
// so every HeroUI control on every screen picks up the portal's neutrals,
// radii and shadows from one place.
//
// Colour rules:
//  - The restaurant's colour is the ONLY brand colour. It is applied at runtime
//    by theme/brand.ts (it rewrites --heroui-primary and its ramp), so the
//    primary below is only the pre-sync fallback. Never bake a shop's hex here.
//  - Everything else is neutral: a warm-grey canvas, white surfaces, ink text.
//  - Status colours are fixed and the same in light and dark, always with
//    white text on a solid fill (success = Paid/Done, warning = Unpaid/late,
//    danger = Cancelled/late 30+).
//
// The same values exist as plain CSS tokens (--canvas, --surface, --ink …) in
// styles/tailwind.css for hand-written markup; keep the two in step.
import { heroui } from '@heroui/react';

const STATUS = {
  success: { DEFAULT: '#047857', foreground: '#ffffff' },
  warning: { DEFAULT: '#b45309', foreground: '#ffffff' },
  danger: { DEFAULT: '#b91c1c', foreground: '#ffffff' },
};

// Brand fallback until the server's colour arrives (theme/brand.ts).
const BRAND = { DEFAULT: '#17483e', foreground: '#ffffff' };

export default heroui({
  layout: {
    // Small button 9px, buttons/inputs 11px, popups/menus/dialogs 16px.
    // Cards use 20px through the .ui-card class.
    radius: { small: '9px', medium: '11px', large: '16px' },
    borderWidth: { small: '1px', medium: '1px', large: '1px' },
    disabledOpacity: '0.5',
    fontSize: { tiny: '0.75rem', small: '0.875rem', medium: '0.9375rem', large: '1rem' },
  },
  themes: {
    light: {
      layout: {
        boxShadow: {
          small: '0 1px 2px rgb(15 15 20 / .04), 0 1px 1px rgb(15 15 20 / .02)',
          medium: '0 1px 2px rgb(15 15 20 / .05), 0 8px 24px -10px rgb(15 15 20 / .12)',
          large: '0 2px 4px rgb(15 15 20 / .05), 0 24px 56px -16px rgb(15 15 20 / .22)',
        },
      },
      colors: {
        background: '#f5f5f4', // --canvas
        foreground: '#0c0d10', // --ink
        content1: { DEFAULT: '#ffffff', foreground: '#0c0d10' }, // --surface
        content2: { DEFAULT: '#fafaf9', foreground: '#0c0d10' }, // --surface-2
        content3: { DEFAULT: '#f1f1ef', foreground: '#0c0d10' },
        content4: { DEFAULT: '#e9e9e7', foreground: '#0c0d10' },
        divider: { DEFAULT: 'rgba(15, 15, 20, 0.08)' },
        // Neutral ramp. default-700 is --ink-2 (secondary text),
        // default-500 is --ink-3 (muted text, placeholders).
        default: {
          50: '#fafaf9',
          100: '#f3f3f2',
          200: '#e8e8e6',
          300: '#d9d9d6',
          400: '#b5b6b4',
          500: '#7b7f88',
          600: '#60646c',
          700: '#4a4d55',
          800: '#26282d',
          900: '#0c0d10',
          DEFAULT: '#e8e8e6',
          foreground: '#0c0d10',
        },
        primary: BRAND,
        focus: { DEFAULT: '#17483e' },
        ...STATUS,
      },
    },
    dark: {
      layout: {
        boxShadow: {
          small: '0 1px 2px rgb(0 0 0 / .3)',
          medium: '0 1px 2px rgb(0 0 0 / .35), 0 8px 24px -10px rgb(0 0 0 / .5)',
          large: '0 2px 4px rgb(0 0 0 / .4), 0 24px 56px -16px rgb(0 0 0 / .65)',
        },
      },
      colors: {
        background: '#0b0c0e',
        foreground: '#f4f4f5',
        content1: { DEFAULT: '#141518', foreground: '#f4f4f5' },
        content2: { DEFAULT: '#1a1b1f', foreground: '#f4f4f5' },
        content3: { DEFAULT: '#212226', foreground: '#f4f4f5' },
        content4: { DEFAULT: '#2a2b30', foreground: '#f4f4f5' },
        divider: { DEFAULT: 'rgba(255, 255, 255, 0.08)' },
        // HeroUI reads its ramp the other way round on dark (50 = darkest).
        default: {
          50: '#141518',
          100: '#1c1d21',
          200: '#26272c',
          300: '#34363c',
          400: '#55585f',
          500: '#8a8d95',
          600: '#9fa2a9',
          700: '#b4b6bc',
          800: '#dcdde0',
          900: '#f4f4f5',
          DEFAULT: '#26272c',
          foreground: '#f4f4f5',
        },
        primary: BRAND,
        focus: { DEFAULT: '#17483e' },
        ...STATUS,
      },
    },
  },
});
