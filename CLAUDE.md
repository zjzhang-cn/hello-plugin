# CLAUDE.md

dsh-hello-plugin 是 dsh（DeepSeek Harness，全插件化 Cordis agent 框架）的最小可运行插件示例，演示「双面插件」的完整接入：宿主半区（Node）+ 客户端半区（浏览器）+ 双向通信。

两个半区均以 TypeScript 编写，通过 `pnpm build` 编译为浏览器 / Node bundle，由 `deepseek-harness` 工作区消费。

## 仓库布局

```
src/host/index.ts        宿主半区 TypeScript 源码：注册 /hello RPC 通道、读取 Jira 待办
src/client/index.tsx     客户端半区 TypeScript 源码：悬浮组件展示「我的待办」Jira 列表
lib/host.js              由 pnpm build 生成的宿主半区 bundle（Node ESM，单文件无运行时依赖）
lib/client.js            由 pnpm build 生成的客户端浏览器 bundle
tsconfig.host.json       宿主半区 TypeScript 编译配置
tsconfig.client.json     客户端 TypeScript 编译配置
tsdown.config.ts         双半区 bundle 配置（host: node ESM；client: ModuleLoader 工厂）
cordis.patch.yml         bundle patch 层：把宿主插件行插入启动图（正式：包名引用）
dev.patch.yml            开发用 patch（绝对路径，已 gitignore）
jira.config.example.json Jira 配置模板（含占位符，可提交）；真实凭据放 jira.config.json（已 gitignore）
package.json             包清单：exports 两个半区 + dsh 集成字段
docs/
  dev-log.md                        开发日志（每次功能/修复必记，最新在上）
  learning-path.md                  学习路径（按章节由简入深）
  plugin-dev-handbook.md            开发手册（过程 + 规范 + 踩坑）
  plugin-capability-catalog.md       dsh 插件能力清单（服务/通道/插槽全目录）
```

## 开发日志（强制）

**每次功能、BUG 修改或实现都要记录开发日志。** 记录在 `docs/dev-log.md`，一次功能或修复一条记录，按时间倒序（最新在上）。格式见该文件顶部。改完代码后、提交前，先补写日志条目。

**同时把一条简述更新到 `README.md` 的「开发日志」章节**（最新在上，一句话概括本次改动的标题与要点，并指向完整日志 `docs/dev-log.md`）。

```markdown
## YYYY-MM-DD — 标题
**类型**：功能 / BUG 修复 / 文档 / 重构
**涉及**：文件清单
**背景 / 问题**：一句话说明为什么
**改动**：关键点
**验证**：如何确认生效
```

## 双面插件模型

同一个包同时提供 Node 宿主半区与浏览器客户端半区，两侧由同一份 vendored Cordis Loader 治理。深入理解见 [docs/plugin-dev-handbook.md](docs/plugin-dev-handbook.md)，能力全目录见 [docs/plugin-capability-catalog.md](docs/plugin-capability-catalog.md)。

- **宿主半区**：`package.json` 的 `exports["."]` → `lib/host.js`。`src/host/index.ts` 经 `pnpm build` 编译为单文件 Node ESM。作为普通 Cordis 插件行进入启动图，`apply(ctx)` 在 Node 进程里运行。导出 `name` + `apply(ctx)`。
- **客户端半区**：`exports["./client"]` → `lib/client.js`，由 `dsh.client.platform = "web"` 声明。`src/client/index.tsx` 经 `pnpm build` 编译和封装；浏览器端通过 `window.__ModuleLoader__.load({ id, factory })` 注册工厂；**id 必须等于包名**（图行 id）。
- **patch 层**：`dsh.bundle.patch` → `cordis.patch.yml`。客户端半区**不写进** patch —— 由扫描发现。

> 两个半区都已是 TypeScript：`tsconfig.host.json`（node 类型）+ `tsconfig.client.json`（DOM 类型），共用一份 `tsdown.config.ts`（数组配置：host → node ESM，client → ModuleLoader 工厂）。宿主 bundle 只内联 schemastery（运行时构建设置 schema），其余依赖均为 type-only，被擦除后产物无运行时裸 import，可直接以绝对路径加载。

## 通信机制（本仓库实现的两条链路）

### 客户端 → 宿主：Unary RPC

- 宿主：`inject: ['connection']`，`ctx.connection.rpc.handle('/hello', handler)`。handler 收 `(endpoint, payload, signal)`，返回 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`。
- 客户端：`inject: ['connection']`，`ctx.connection.rpc.call('/hello', 'ping' | 'jira/todos', { args })` → `Promise<{ ok, value } | { ok, error }>`。payload 信封必须是 `{ args: {...} }`。

### 宿主 → 客户端：长轮询

dsh 的标准事件转发（`ctx.remote.$on`）对自定义事件不适用：`registerRemoteEvents` 是**单例**（api-remotes 占用），事件名必须在 `API_REMOTE_FORWARDED_EVENTS` allowlist。因此本仓库用长轮询复用 `/hello` 通道：

- 宿主维护 `pending` 队列 + `waiters` 挂起表；`emit(event, args)` 入队并唤醒所有 waiter（**广播语义**：一次快照分发给所有 waiter，不是单消费者）。
- `/hello/events/poll` 端点：有事件立即返回全部；无事件挂起等待（15 秒超时返回空数组）；abort 清理等待者。
- 客户端挂载后跑长轮询循环，常驻一个 poll 连接；收到空数组立刻发下一次；失败退避重试。

### 外部数据：Jira 待办列表

- **配置优先级**：**工程根 `jira.config.json` 优先**（host 启动时从 bundle 目录向上逐级查找，开发时用，已 gitignore），其次 `ctx.settings` 注册的 `jira` namespace（`baseUrl` / `email` / `apiToken`，由 base profile 的 settings-file 提供，`$DSH_HOME/settings.yaml`）。两处都未配置时插件照常加载，`jira/todos` 端点返回 `jira-not-configured`。
- **端点**：`/hello/jira/todos`。调用 `GET {baseUrl}/rest/api/3/search/jql`（Basic Auth），JQL `assignee = currentUser() AND resolution = Unresolved`，每项映射为 `{ key, summary, typeName, typeColor, typeIconUrl, statusName }`（类型颜色按名称匹配常见中英文 Jira 类型，否则从色板确定性取值；相对图标路径拼 baseUrl）。**注意 Cloud 实例已移除 `/rest/api/2/search`（410），须用 api/3。**
- **客户端**：挂载后自动加载待办，展示为悬浮「我的待办」列表（每项含类型徽章）；点击按钮刷新 + ping；失败显示 `jira-error` 提示条。

### 关键约束（踩过的坑）

1. `/api` 共享通道只允许一个 interceptor（api-gateway 独占）→ 自定义通道另开如 `/hello`。
2. `typertGateway.registerRemoteEvents` 是单例 → 自定义事件用长轮询。
3. 客户端长轮询循环里 **`inflight` 必须在 await 后复位**，否则循环只跑一轮就停（曾因此 bug）。
4. 浏览器端 `rpc.open`（流式）只在 worker 隧道存在，served web app 的自建通道是请求-响应。
5. Jira Cloud `/rest/api/2/search` 已移除（410），须用 `/rest/api/3/search/jql`。

## UI 插槽（客户端）

- 悬浮小组件挂 `shell.overlay`（list 槽，叠加式）；**不要挂 `root`**（single 槽，会 shadow 掉整个 frame）。
- 把 `ctx` 里的服务传给组件，走 `slots.register` 的 **inject 业务面**：
  ```js
  ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'hello-pill', inject: () => ({ connection: ctx.connection }) },
    HelloPill,   // 直接传组件，别包一层 () => createElement(...)
  )))
  ```
- **组件只靠 props 拿服务，永不引用模块级 ctx**（`ctx` 只活在 `apply(ctx)` 闭包，React 不会传入组件）。

## 开发与验证

```sh
pnpm build                         # TypeScript 检查并生成 lib/host.js 与 lib/client.js
node --check lib/host.js            # 宿主 bundle 语法检查
```

启动挂载本 bundle 的 dsh profile 验证：

1. 宿主日志出现 `hello-plugin/host.js loaded` 与 `host loaded`。
2. Web 端右下角出现「我的待办」悬浮卡片；点击底部按钮后宿主日志追加 `client ping: browser`，按钮显示 `pong from host`。
3. 宿主每 5 秒（无需操作）Web 端按钮上方出现新的气泡条 `hello/notice: host is alive at ...` —— 长轮询推送链路打通。
4. 配置 Jira 凭据（工程根 `jira.config.json` 或 `$DSH_HOME/settings.yaml` 的 `jira:` 节）后，卡片展示「我的待办」列表（每项含类型徽章 + 摘要 + `KEY · 状态`）；未配置时出现 `Jira: jira-not-configured` 提示条。

## 改动纪律

- **开发日志（强制）**：每次功能 / BUG 修改 / 实现后，先向 `docs/dev-log.md` 补写一条记录（最新在上），**同时把一条简述更新到 `README.md` 的「开发日志」章节**，再提交。
- 改动宿主/客户端任一方向后，同步更新 [README.md](README.md) 与 [docs/](docs/) 里对应的机制描述与验证步骤（README 的「验证」、手册的「开发过程/踩坑/验证清单」都按实际行为维护）。
- 本机开发的 patch（`dev.patch.yml`）用绝对路径且已 gitignore；正式 patch（`cordis.patch.yml`）用包名 `dsh-hello-plugin`，保持可移植。
