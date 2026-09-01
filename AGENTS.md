# AGENTS.md

hello-plugin 是 dsh（DeepSeek Harness）的最小可运行插件示例，演示「双面插件」完整接入：Node 宿主半区 + 浏览器客户端半区 + 双向通信。

阅读 [CLAUDE.md](CLAUDE.md) 了解完整机制与踩坑记录；阅读 [README.md](README.md) 了解功能与验证步骤。

## Repository layout

```
src/host/                  宿主半区（Node Cordis 插件）
  index.ts                 入口：注册 /hello RPC 通道，整合各功能模块
  types.ts                 共享类型（PendingEvent、JiraSettings、LlmConfig 等）
  constants.ts             常量（name、inject、POLL_TIMEOUT_MS、颜色映射）
  errors.ts                错误类（JiraConfigError、rpcFailure）
  config.ts                工程配置文件加载（jira.config.json / llm.config.json）
  jira.ts                  Jira API 工具（fetchJiraTodos、fetchJiraIssueDetail、addJiraComment）
  llm.ts                   LLM 分析（generateLlmAnalysis）
  news.ts                  Google News 工具（fetchGoogleNews、installGoogleNewsTool）
src/client/                客户端半区（浏览器）
  index.ts                 入口：注册 HelloPill 到 shell.overlay 插槽
  types.ts                 共享类型（HelloEvent、JiraTodo、JiraAnalysis）
  components/              UI 组件（HelloPill、Panel、TodoCard、AnalysisPanel、EventBubbles 等）
lib/host.js                pnpm build 生成的宿主 bundle（Node ESM）
lib/client.js              pnpm build 生成的客户端 bundle（ModuleLoader 工厂）
tsdown.config.ts           双半区 bundle 配置（host: node ESM；client: ModuleLoader 工厂）
cordis.patch.yml           bundle patch 层：宿主插件行插入启动图
dev.patch.yml              开发用 patch（绝对路径，已 gitignore）
docs/dev-log.md            开发日志（每次功能/修复必记，最新在上）
```

## Commands

```sh
pnpm build                         # TypeScript 检查 + 双半区打包
node --check lib/host.js           # 宿主 bundle 语法检查
```

启动挂载本 bundle 的 dsh profile 验证（详见 README.md「开发与验证」）。客户端在 dev 模式下由 harness 的 `scripts/dev-web.ts` watch 构建，改动后通常无需手动打包。

## Conventions

- **ESM only**。`"type": "module"`；内部模块相对导入用 `.ts`（`moduleResolution: Bundler`）。
- **双面插件**：同一个包同时导出宿主半区（`exports["."]`）和客户端半区（`exports["./client"]`），由 `dsh.client.platform = "web"` 声明。
- **宿主 bundle**：schemastery 内联；`@deepseek-ai/dsh-llm` 标记为 external（其内部用 `createRequire` 读自身 package.json，内联会路径错位）。
- **Registrations are effects**：所有注册通过 `ctx.effect()` / `ctx.on()`，保证卸载时自动回收。
- **组件只靠 props 拿服务**：客户端组件通过 `slots.register` 的 inject 业务面接收 `connection` 等服务，永不引用模块级 `ctx`。
- **开发日志（强制）**：每次功能 / BUG 修改 / 实现后，先向 `docs/dev-log.md` 补写记录（最新在上），再提交。

## Defensive patterns

- `/api` 共享通道只允许一个 interceptor（api-gateway 独占）→ 自定义通道另开如 `/hello`。
- `typertGateway.registerRemoteEvents` 是单例 → 自定义事件用长轮询。
- 客户端长轮询循环里 **`inflight` 必须在 await 后复位**，否则循环只跑一轮就停。
- Jira Cloud `/rest/api/2/search` 已移除（410），须用 `/rest/api/3/search/jql`。
- 工程内配置文件（`jira.config.json`、`llm.config.json`）已 gitignore，模板文件（`*.example.json`）可提交。

## Type safety and documentation

- 宿主半区和客户端半区各自有独立的 tsconfig（`tsconfig.host.json`、`tsconfig.client.json`），不共享编译配置。
- 改动宿主/客户端任一方向后，同步更新 README.md 与 docs/ 里对应的机制描述与验证步骤。
- 本机开发的 patch（`dev.patch.yml`）用绝对路径且已 gitignore；正式 patch（`cordis.patch.yml`）用包名 `dsh-hello-plugin`，保持可移植。
