import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react'; // <-- Make sure react plugin is also imported if you use it

// optional, keeps "use client" strings
let preserveDirectives: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  preserveDirectives = require('rollup-plugin-preserve-directives');
} catch {
  // Plugin not installed — provide a no-op fallback that satisfies Rollup/Vite plugin usage
  preserveDirectives = () => ({ name: 'preserve-directives-fallback' });
}

const nativeExternal = [
  /better-sqlite3(?:\/.*)?/,
  /node-gyp-build(?:\/.*)?/,
  /node-gyp-build-optional-packages(?:\/.*)?/,
  /bindings(?:\/.*)?/,
  /keytar(?:\/.*)?/,
  /bufferutil(?:\/.*)?/,
  /utf-8-validate(?:\/.*)?/,
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { external: nativeExternal },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { external: nativeExternal },
    },
  },

  renderer: {
    base: './',
    // --- THIS IS THE CORRECT SECTION for VITE PLUGINS ---
    plugins: [
      tailwindcss(),
      react(), // <-- Add the react plugin here as well
    ],

    // Tell Vite where the renderer's root is.
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        // ❷ Filter only the noisy "use client" directive warnings
        onwarn(warning, defaultHandler) {
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            /"use client"/.test(warning.message || '')
          ) {
            return; // ignore these
          }
          defaultHandler(warning);
        },
        // optional: preserve directive strings (mainly useful if you re-bundle as a lib)
        // --- tailwindcss() should NOT be in here ---
        plugins: [preserveDirectives()],
      },
    },
    // ❶ Stop pre-bundling the HeroUI packages so esbuild doesn’t touch them
    optimizeDeps: {
      exclude: [
        'keytar',
        '@heroui/aria-utils',
        '@heroui/react',
        'framer-motion', // HeroUI uses this; excluding helps reduce extra noise
      ],
    },
  },
});
