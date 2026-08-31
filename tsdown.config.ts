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
  // 单文件 ESM：schemastery（运行时用于构建设置 schema）内联进 bundle；
  // @deepseek-ai/dsh-llm 是运行时依赖（harness 核心服务，始终挂载），标记为
  // external，运行时从 node_modules 解析（其内部用 createRequire 读自己 package.json，
  // 内联会导致路径错位）。产物被 dev.patch / cordis.patch 直接加载。
  {
    entry: { host: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: ['@deepseek-ai/dsh-llm'],
    },
    outputOptions: {
      entryFileNames: 'host.js',
    },
  },
])
