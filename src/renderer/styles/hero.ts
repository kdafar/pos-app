// hero.ts
//
// Structure comes from the "Modernist" design system; colour does not.
//
// Modernist's shape — square corners, strong dividers, full density — is a
// build-time decision and lives here. Its palette deliberately does not: brand
// colour is per-operator, ships from the backend, and is applied at runtime by
// theme/brand.ts, which rewrites HeroUI's CSS variables. Hardcoding a hex here
// would bake one shop's identity into every till's binary.
//
// The values below are therefore only the pre-sync fallback.
import { heroui } from '@heroui/react';

export default heroui({
  layout: {
    // Modernist: radius 0. Square corners read as precise and industrial, and
    // on a dense screen they stop every control looking like a pill.
    radius: { small: '0px', medium: '0px', large: '0px' },
    borderWidth: { small: '1px', medium: '1px', large: '2px' },
  },
  themes: {
    light: {
      colors: {
        primary: { DEFAULT: '#2563eb', foreground: '#ffffff' },
        secondary: { DEFAULT: '#f97316', foreground: '#ffffff' },
      },
    },
    dark: {
      colors: {
        primary: { DEFAULT: '#2563eb', foreground: '#ffffff' },
        secondary: { DEFAULT: '#f97316', foreground: '#ffffff' },
      },
    },
  },
});
