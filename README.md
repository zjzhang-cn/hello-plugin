# dsh-hello-plugin

面向 dsh（DeepSeek Harness，全插件化 Cordis agent 框架）的最小可运行插件示例。同时演示了插件的两个半区（宿主 + 浏览器客户端）的完整接入方式：宿主端日志、客户端 UI 组件、插槽注入。

## 结构

| 文件 | 说明 |
| --- | --- |
| `host.js` | 宿主半区：Node 端 Cordis 插件入口，导出 `name` 与 `apply(ctx)`，通过 `ctx.logger` 输出日志；注册 `/hello` RPC 通道供客户端调用，并提供事件队列，可主动向客户端推送事件 |
| `client.js` | 客户端半区：浏览器 bundle（classic script），注册一个右下角悬浮按钮 `HelloPill` 并注入 `shell.overlay` 插槽；点击按钮通过 `/hello` RPC 通道调用宿主，同时以长轮询方式接收宿主推送的事件 |
| `cordis.patch.yml` | bundle patch 层：把宿主插件行插入启动图（boot graph）的插件列表 |
| `package.json` | 包清单，声明两个半区的导出与 dsh 集成字段 |

## 架构：双面插件如何接入 dsh

dsh 采用「双面（dual-face）」插件模型：同一个包同时提供 Node 宿主半区与浏览器客户端半区，两侧由同一份 vendored Cordis Loader 治理，插件加载模型详见 deepseek-harness 中的 `2026-07-23-client-plugin-loading-model.md`。

- **宿主半区**：`exports["."]` → `host.js`。它作为普通 Cordis 插件行进入启动图，`apply(ctx)` 在 Node 进程里运行。
- **客户端半区**：`exports["./client"]` → `client.js`，由 `dsh.client.platform = "web"` 声明。`dsh-client-modules` 扫描该声明（读取 entry 最近处的 package.json，要求 `dsh.client.platform=web` 且存在 `exports["./client"]`）把插件纳入启动图；浏览器端 bundle 通过 `window.__ModuleLoader__.load({ id, factory })` 注册工厂。注册是**惰性**的：脚本到达只登记 factory，首次 `require` 时才真正执行模块体。
- **patch 层**：`dsh.bundle.patch` → `cordis.patch.yml`。profile 合成器按 `dsh.profile.bundles` 顺序把每个 bundle 的 patch 应用到启动图（空 entry 列表之上），再叠加 profile 自身 patch 与启动器层。

客户端组件走标准 Cordis 插槽机制：`inject: ['slots']` 声明依赖 slots 服务，`apply(ctx)` 里用 `ctx.effect(() => slots.inject('shell.overlay', () => slots.register({ name, id }, ...)))` 把 `HelloPill` 挂到 shell 悬浮层。所有注册都放在 `ctx.effect()` 内，保证卸载时自动回收。

## 客户端调用宿主

`dsh` 的双面插件天然支持「浏览器客户端 → Node 宿主」的 RPC 调用，走的是 client-connection 的通用通道：

- **宿主端**：`host.js` 的 `apply(ctx)` 里 `inject: ['connection']`，用 `ctx.connection.rpc.handle('/hello', handler)` 注册一条自定义通道（不能拦截 `/api` —— 那是 api-gateway 独占的共享通道）。handler 收到 `(endpoint, payload)`，返回 `{ ok: true, value }` 或 `{ ok: false, error }`。
- **客户端**：`client.js` 的插件声明 `inject: ['connection']`，点击 `HelloPill` 时用 `ctx.connection.rpc.call('/hello', 'ping', { args: { name } })` 发起调用。payload 遵循 Connection RPC 信封：必须是 `{ args: {...} }`。按钮文本会显示宿主返回的 `pong from host` 消息。

宿主机日志里会输出 `client ping: ...`，可用于确认双向链路打通。

## 宿主主动推送到客户端

`dsh` 的标准「宿主 → 客户端」事件推送走 api-gateway 的 Remote events 转发（`ctx.emit` → 网关广播 → 客户端 `ctx.remote.$on`）。但它依赖应用级 `api-remotes` 的 allowlist，且 `typertGateway.registerRemoteEvents` 是**单例**（已被 `api-remotes` 占用）—— 第三方插件的自定义事件名无法进 allowlist。

因此本插件采用**长轮询**复用已验证的 `/hello` 通道实现反向推送，不改 harness：

- **宿主端**：维护一个事件队列 `pending` + 挂起等待者 `waiters`。`emit(event, args)` 把事件入队并唤醒所有挂起的 poll。`/hello/events/poll` 端点：有事件立即返回全部，无事件则挂起等待（15 秒超时返回空数组，abort 时清理等待者）。语义是**广播**：一个事件被多个并发 poll 各自看到。
- **客户端**：`HelloPill` 挂载后启动长轮询循环，反复 `connection.rpc.call('/hello', 'events/poll', { args: {} })`。收到空数组立即发起下一次（保持一个常驻等待连接）；收到事件则展示为按钮上方的气泡条（最新一条高亮）；传输失败退避 3 秒重试。

宿主启动 5 秒后会自动 emit 一个 `hello/notice` 事件，无需任何客户端操作即可在 Web 端看到气泡 —— 这就是「host 主动触发事件到 client」。

长轮询核心逻辑已用独立脚本验证（5 场景：等待中唤醒、多 waiter 广播、超时、abort、已有事件立即返回）。

## 开发与验证

本仓库自身**没有**构建/测试设施（无 scripts、无依赖），它是被 deepseek-harness 工作区消费的插件。开发流程：

1. 语法检查（无需安装依赖）：
   ```sh
   node --check host.js client.js
   ```
2. 启动一个挂载了本 bundle 的 dsh profile，宿主端应能看到日志 `hello-plugin/host.js loaded` 与 `host loaded`；Web 端应能看到右下角的「👋 hello world」悬浮按钮。
3. 点击悬浮按钮：宿主端日志追加 `client ping: browser`，按钮文本短暂变为 `pong from host, hello browser!`，随后恢复计数 —— 表示客户端 → 宿主的 RPC 链路打通。
4. 宿主启动约 5 秒后（无需操作）Web 端按钮上方出现气泡条 `hello/notice: host is alive at ...`，宿主日志追加 `emit: hello/notice ...` —— 表示宿主 → 客户端的推送链路打通。

客户端半区在 dev 模式下由 harness 的 `scripts/dev-web.ts` watch 构建（按 `dsh.client` 扫描发现），改动后无需手动打包。

## 注意（与包名不一致处）

- `cordis.patch.yml` 中 `name` 是绝对路径 `/Users/zhangzhenjiang/dsh/hello-plugin/host.js`，仅在本机有效。若要跨机器/作为依赖安装使用，应改为可移植的引用（如包名解析）。
