import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: ['react'],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: "window.__ModuleLoader__.load({ id: 'dsh-hello-plugin', factory: (require) => {",
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})