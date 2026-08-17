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
    // Modernist specifies radius 0, and taken literally it made every control
    // square while the sidebar kept its Tailwind rounded-xl rows — so the one
    // part of the app that looked right was the part the token did not reach.
    // Matched to the sidebar instead: softened, not pill-shaped.
    radius: { small: '8px', medium: '10px', large: '14px' },
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
