import { defineConfig } from 'tsdown'

export default defineConfig([
  // ---- 客户端半区（浏览器）----
  {
    entry: { client: 'src/client/index.tsx' },
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
  },
  // ---- 宿主半区（Node）----
  // 单文件 ESM：schemastery（运行时用于构建设置 schema）内联进 bundle，
  // 其余依赖均为 type-only import，会被类型擦除。产物被 dev.patch / cordis.patch 直接加载。
  {
    entry: { host: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    sourcemap: true,
    clean: false,
    outputOptions: {
      entryFileNames: 'host.js',
    },
  },
])
