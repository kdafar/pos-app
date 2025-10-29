// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

const nativeExternal = [
  /better-sqlite3(?:\/.*)?/,
  /node-gyp-build(?:\/.*)?/,
  /node-gyp-build-optional-packages(?:\/.*)?/,
  /bindings(?:\/.*)?/,
  /keytar(?:\/.*)?/,            // ⬅️ add this line
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { external: nativeExternal },
      commonjsOptions: { ignoreDynamicRequires: true, transformMixedEsModules: true },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { external: nativeExternal },
      commonjsOptions: { ignoreDynamicRequires: true, transformMixedEsModules: true },
    },
  },
  renderer: {
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    // prevent Vite from prebundling keytar into the renderer deps
    optimizeDeps: { exclude: ['keytar'] },   // ⬅️ add this block
  },
})
