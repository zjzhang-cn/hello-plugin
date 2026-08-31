# dsh-hello-plugin

面向 dsh（DeepSeek Harness，全插件化 Cordis agent 框架）的最小可运行插件示例。同时演示了插件的两个半区（宿主 + 浏览器客户端）的完整接入方式：宿主端日志、客户端 UI 组件、插槽注入。

## 结构

| 文件 | 说明 |
| --- | --- |
| `src/host/index.ts` | 宿主半区 TypeScript 源码：Node 端 Cordis 插件入口，导出 `name` 与 `apply(ctx)`，通过 `ctx.logger` 输出日志；注册 `/hello` RPC 通道（ping + 读取 Jira 待办列表 + 事件长轮询） |
| `src/client/index.tsx` | 客户端 TypeScript 源码：注册右下角悬浮组件 `HelloPill` 并注入 `shell.overlay` 插槽；展示「我的待办」Jira 列表（类型徽章内嵌）+ 长轮询接收宿主事件气泡；点击按钮刷新待办并 ping 宿主 |
| `lib/host.js` | 由 `pnpm build` 生成的宿主半区 bundle（Node ESM 单文件，无运行时裸 import） |
| `lib/client.js` | 由 `pnpm build` 生成的客户端浏览器 bundle（classic script），保留 ModuleLoader factory 协议 |
| `cordis.patch.yml` | bundle patch 层：把宿主插件行插入启动图（boot graph）的插件列表 |
| `.vscode/launch.json` | VS Code 调试配置：在 deepseek-harness 中以本地 `dev.patch.yml` 启动 dsh Web |
| `package.json` | 包清单，声明两个半区的导出与 dsh 集成字段 |
| `docs/dev-log.md` | 开发日志：每次功能 / BUG 修改 / 实现的记录（最新在上） |
| `docs/learning-path.md` | 学习路径：按章节由简入深的学习路线 |

## 架构：双面插件如何接入 dsh

dsh 采用「双面（dual-face）」插件模型：同一个包同时提供 Node 宿主半区与浏览器客户端半区，两侧由同一份 vendored Cordis Loader 治理，插件加载模型详见 deepseek-harness 中的 `2026-07-23-client-plugin-loading-model.md`。

- **宿主半区**：`exports["."]` → `lib/host.js`。它作为普通 Cordis 插件行进入启动图，`apply(ctx)` 在 Node 进程里运行。源码 `src/host/index.ts` 经 `pnpm build` 编译为单文件 Node ESM（schemastery 内联，其余依赖均为 type-only 被擦除）。
- **客户端半区**：`exports["./client"]` → `lib/client.js`，由 `dsh.client.platform = "web"` 声明。`dsh-client-modules` 扫描该声明（读取 entry 最近处的 package.json，要求 `dsh.client.platform=web` 且存在 `exports["./client"]`）把插件纳入启动图；浏览器端 bundle 通过 `window.__ModuleLoader__.load({ id, factory })` 注册工厂。注册是**惰性**的：脚本到达只登记 factory，首次 `require` 时才真正执行模块体。
- **patch 层**：`dsh.bundle.patch` → `cordis.patch.yml`。profile 合成器按 `dsh.profile.bundles` 顺序把每个 bundle 的 patch 应用到启动图（空 entry 列表之上），再叠加 profile 自身 patch 与启动器层。

客户端组件走标准 Cordis 插槽机制：`inject: ['slots']` 声明依赖 slots 服务，`apply(ctx)` 里用 `ctx.effect(() => slots.inject('shell.overlay', () => slots.register({ name, id }, ...)))` 把 `HelloPill` 挂到 shell 悬浮层。所有注册都放在 `ctx.effect()` 内，保证卸载时自动回收。

## 客户端调用宿主

`dsh` 的双面插件天然支持「浏览器客户端 → Node 宿主」的 RPC 调用，走的是 client-connection 的通用通道：

- **宿主端**：`src/host/index.ts` 的 `apply(ctx)` 里 `inject: ['connection']`，用 `ctx.connection.rpc.handle('/hello', handler)` 注册一条自定义通道（不能拦截 `/api` —— 那是 api-gateway 独占的共享通道）。handler 收到 `(endpoint, payload)`，返回 `{ ok: true, value }` 或 `{ ok: false, error }`。
- **客户端**：`src/client/index.tsx` 的插件声明 `inject: ['connection']`，点击 `HelloPill` 时用 `ctx.connection.rpc.call('/hello', 'ping', { args: { name } })` 发起调用。payload 遵循 Connection RPC 信封：必须是 `{ args: {...} }`。按钮文本会显示宿主返回的 `pong from host` 消息，**1 秒后恢复 `hello world x{n}` 样式并计数 +1**。

宿主机日志里会输出 `client ping: ...`，可用于确认双向链路打通。

## Jira 待办列表

宿主半区通过以下顺序解析 Jira 连接配置（**工程内 `jira.config.json` 优先，其次 `ctx.settings`**），再调用 Jira REST API 查询指派给当前用户的未解决问题，客户端以「我的待办」列表展示：

- **工程配置文件**（开发时用，已 gitignore 不提交凭据）：工程根放 `jira.config.json`，host 启动时从 bundle 所在目录向上逐级查找：
  ```json
  {
    "baseUrl": "https://your-jira.example",
    "email": "you@example.com",
    "apiToken": "<Jira API Token>"
  }
  ```
  可复制 `jira.config.example.json`（已提交，含占位符）为 `jira.config.json` 填入真实值。
- **settings 配置**（正式部署用，由 base profile 的 settings-file 提供，`$DSH_HOME/settings.yaml`）：
  ```yaml
  jira:
    baseUrl: https://your-jira.example
    email: you@example.com
    apiToken: <Jira API Token>
  ```
  两处都未配置时插件照常加载，`jira/todos` 端点返回 `jira-not-configured`，客户端显示 `Jira: jira-not-configured` 提示条。
- **宿主端点**：`/hello/jira/todos` 调用 `GET {baseUrl}/rest/api/3/search/jql`（Basic Auth，10 秒超时），JQL 为 `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`，每项映射为 `{ key, summary, typeName, typeColor, typeIconUrl, statusName }` —— 类型颜色按名称匹配常见中英文 Jira 类型，其余从色板确定性取值；相对图标路径自动拼接 baseUrl。
- **客户端**：挂载后自动加载待办，展示为悬浮卡片「我的待办」列表；头部右侧有刷新按钮（⟳），点击刷新列表；每项为类型徽章（图标或代表色圆点 + 类型名）+ 摘要 + `KEY · 状态`；点击底部 hello 按钮 ping 宿主并刷新待办；调用失败显示红色错误条。

## 宿主主动推送到客户端（长轮询）

`dsh` 的标准「宿主 → 客户端」事件推送走 api-gateway 的 Remote events 转发（`ctx.emit` → 网关广播 → 客户端 `ctx.remote.$on`）。但它依赖应用级 `api-remotes` 的 allowlist，且 `typertGateway.registerRemoteEvents` 是**单例**（已被 `api-remotes` 占用）—— 第三方插件的自定义事件名无法进 allowlist。

因此本插件采用**长轮询**复用已验证的 `/hello` 通道实现反向推送，不改 harness：

- **宿主端**：维护一个事件队列 `pending` + 挂起等待者 `waiters`。`emit(event, args)` 把事件入队并唤醒所有挂起的 poll。`/hello/events/poll` 端点：有事件立即返回全部，无事件则挂起等待（15 秒超时返回空数组，abort 时清理等待者）。语义是**广播**：一个事件被多个并发 poll 各自看到。
- **客户端**：`HelloPill` 挂载后启动长轮询循环，反复 `connection.rpc.call('/hello', 'events/poll', { args: {} })`。收到空数组立即发起下一次（保持一个常驻等待连接）；收到事件则展示为按钮上方的气泡条（**只保留最新一条**）；传输失败退避 3 秒重试。

宿主每 5 秒自动 emit 一个 `hello/notice` 事件，无需任何客户端操作即可在 Web 端持续看到气泡 —— 这就是「host 主动触发事件到 client」。

长轮询核心逻辑已用独立脚本验证（5 场景：等待中唤醒、多 waiter 广播、超时、abort、已有事件立即返回）。

## 本机 Chrome 调试远端客户端

当 VS Code 通过 Remote-SSH 连接远端主机时，DSH 服务与源码在远端，而 Chrome 在本机。先用 `DSH Web（hello-plugin patch）` 启动远端服务；再通过 VS Code 的「端口」视图将远端 `3080` 转发到本机，或在本机执行：

```sh
ssh -L 3080:127.0.0.1:3080 <remote-host>
```

在本机 Chrome 打开 `http://127.0.0.1:3080`，按 `F12` 打开 DevTools，在「Sources」中搜索 `index.tsx` 并设置断点。`pnpm build` 生成的 `lib/client.js.map` 会将该 bundle 映射回 `src/client/index.tsx`；修改客户端后需重新执行 `pnpm build` 并刷新页面。

## 开发日志

- **2026-08-31 客户端交互优化** — 长轮询气泡只保留最新一条；「我的待办」头部新增 ⟳ 刷新按钮；hello 按钮 ping 后 1 秒恢复 `hello world x{n}` 并计数 +1；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 恢复长轮询与 ping（学习项目只增不删）** — 上轮待办改动误删长轮询，已完整恢复（`events/poll` + 每 5 秒 `hello/notice` 推送 + 客户端气泡条），与待办列表、ping 共存；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 Jira 待办列表（替代类别条）** — host 改用 `/rest/api/3/search/jql` 查询指派给我的未解决 issue，新增 `/hello/jira/todos` 端点；客户端展示「我的待办」列表（类型徽章内嵌）替代类别条；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 Jira 配置支持放工程内（jira.config.json 优先）** — host 从工程根读取 `jira.config.json`（gitignore，含示例模板 `jira.config.example.json`），优先于全局 settings.yaml；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 宿主半区迁移为 TypeScript + 读取 Jira Issue Type** — `host.js` 迁为 `src/host/index.ts`（构建为 `lib/host.js` Node ESM 单文件），并通过 `ctx.settings` 注册 `jira` namespace、新增 `/hello/jira/issue-types` 端点；客户端点击按钮时渲染 Jira 类别条；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 支持本机 Chrome 调试远端客户端 TSX** — bundle source map 直接映射到 TSX，并记录 Remote-SSH 下通过端口转发使用本机 DevTools 的流程；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 增加 DeepSeek Harness Web 调试启动项** — 新增 VS Code 配置，在 `deepseek-harness` 中以 `dev.patch.yml` 运行 `pnpm dsh web`；详见 [开发日志](docs/dev-log.md)。
- **2026-08-31 客户端迁移为 TypeScript 并提供浏览器构建** — 新增 `tsc` + `tsdown` 构建，将客户端产物改为 `lib/client.js`；详见 [开发日志](docs/dev-log.md)。

完整记录见 [docs/dev-log.md](docs/dev-log.md)（每次功能 / BUG 修改 / 实现一条，最新在上）。此处为简述（最新在上）：

- **2026-08-28 整理学习路径并移除 HTML 手册** — 新增 `docs/learning-path.md`（4 阶段 11 章由简入深）；删除两份 HTML 手册，docs 全部为 Markdown。
- **2026-08-28 README 增加开发日志简述章节** — README 新增「开发日志」章节，与 dev-log.md 同步；规则：更新日志时同时更新简述。
- **2026-08-28 建立开发日志机制** — 新增 `docs/dev-log.md` 与 CLAUDE.md 的「开发日志（强制）」规则，补录全部历史条目；同 commit 修复客户端长轮询循环只跑一轮的 bug（`inflight` 未复位）。
- **2026-08-28 hello/notice 改为每 5 秒推送** — `host.js` 用 `setInterval` 替代一次性 `setTimeout`，持续演示 host 主动推送。
- **2026-08-28 新增插件能力清单** — `docs/plugin-capability-catalog.*` 整理 dsh 对 plugin 开放的全部能力面；`cordis.patch.yml` 改用可移植包名。
- **2026-08-28 宿主主动推送事件到客户端** — `/hello` 通道长轮询（广播语义、15s 超时、abort 清理），客户端常驻 poll 循环。
- **2026-08-28 客户端点击调用宿主** — 接通 `/hello` RPC；修复组件引用模块级 `ctx` 的作用域 bug（改走 slots inject 业务面）。
- **2026-08-28 插件初始化** — 双面插件骨架：宿主日志 + 客户端悬浮按钮 + 插槽注入。

## 开发与验证

构建与验证（两个半区都是 TypeScript，构建产物在 `lib/`）：

1. 构建（TypeScript 检查 + 双半区打包）：
   ```sh
   pnpm build
   node --check lib/host.js lib/client.js
   ```
2. 启动一个挂载了本 bundle 的 dsh profile（`dev.patch.yml` 指向 `lib/host.js`），宿主端应能看到日志 `hello-plugin/host.js loaded` 与 `host loaded`；Web 端右下角出现「我的待办」悬浮卡片。
3. 点击底部 hello 按钮：宿主端日志追加 `client ping: browser`，按钮文本短暂变为 `pong from host, hello browser!`，**1 秒后恢复 `hello world x{n}`（计数 +1）** —— 表示客户端 → 宿主的 RPC 链路打通。
4. 宿主每 5 秒（无需操作）Web 端按钮上方出现新的气泡条 `hello/notice: host is alive at ...`，宿主日志追加 `emit: hello/notice ...` —— 表示宿主 → 客户端的推送链路（长轮询）打通。
5. 配置 Jira 凭据（任选其一，工程文件优先）后，卡片展示「我的待办」列表（每项含类型徽章 + 摘要 + `KEY · 状态`）；未配置时显示 `Jira: jira-not-configured` 提示条。开发时在工程根放 `jira.config.json`（见 `jira.config.example.json`）即可，无需改全局 settings.yaml。

客户端半区在 dev 模式下由 harness 的 `scripts/dev-web.ts` watch 构建（按 `dsh.client` 扫描发现），改动后无需手动打包。

## 注意（与包名不一致处）

- `dev.patch.yml` 中 `name` 是绝对路径 `../hello-plugin/lib/host.js`，仅在本机有效。若要跨机器/作为依赖安装使用，应改为可移植的引用（正式 patch `cordis.patch.yml` 已用包名 `dsh-hello-plugin`，保持可移植）。
