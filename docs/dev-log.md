# 开发日志（Development Log）

> 规则：**每次功能 / BUG 修改 / 实现都要记录开发日志。** 记录在 `docs/dev-log.md`，一次功能或修复一条记录。按时间倒序（最新在上）。

## 2026-08-31 — 客户端迁移为 TypeScript 并提供浏览器构建

**类型**：重构
**涉及**：删除 `client.js`、`src/client/index.tsx`、`tsconfig.client.json`、`tsdown.config.ts`、`package.json`、`.gitignore`、`README.md`、`CLAUDE.md`
**背景 / 问题**：客户端代码以手写经典脚本维护，缺少静态类型检查和可重复的浏览器 bundle 构建入口。
**改动**：将 `HelloPill`、RPC 与长轮询逻辑迁移为严格 TypeScript；新增 `tsc` + `tsdown` 两阶段构建，产物为保留 ModuleLoader 协议的 `lib/client.js`；包导出改为指向构建产物。
**验证**：`pnpm build`。
>
> **更新开发日志时，同时将一条简述更新到 `README.md` 的「开发日志」章节**（最新在上，一句话概括标题与要点，指向本文件）。
>
> 记录格式（简版即可，保留关键信息）：
> ```markdown
> ## YYYY-MM-DD — 标题
>
> **类型**：功能 / BUG 修复 / 文档 / 重构
> **涉及**：文件清单
> **背景 / 问题**：一句话说明为什么
> **改动**：关键点
> **验证**：如何确认生效（node --check / 实测 / 脚本断言）
> ```

---

## 2026-08-28 — 整理学习路径并按章节由简入深，移除 HTML 手册

**类型**：文档
**涉及**：`docs/learning-path.md`（新增）、删除 `docs/dsh-plugin-handbook.html`、`docs/plugin-capability-catalog.html`、`CLAUDE.md`
**背景 / 问题**：学习材料散落且无顺序；HTML 手册冗余（与 Markdown 重复），决定全部用 Markdown。
**改动**：
- 新增 `docs/learning-path.md`：按 4 阶段 11 章组织学习路径（打地基 / 双向通信 / 能力全景 / 工程纪律），每章含「学什么 / 读什么 / 动手做 / 产出」，并链接现有 Markdown 文档。
- 删除两份 HTML 手册（`dsh-plugin-handbook.html`、`plugin-capability-catalog.html`），docs 全部为 Markdown。
- CLAUDE.md 仓库布局同步更新。
**验证**：docs 目录仅剩 `.md` 文件；grep 确认无残留 HTML 引用（历史 dev-log 条目除外，已一并清理）。

## 2026-08-28 — README 增加开发日志简述章节

**类型**：文档
**涉及**：`README.md`、`CLAUDE.md`、`docs/dev-log.md`
**背景 / 问题**：开发日志集中在 `docs/dev-log.md`，但 README 是仓库入口，读者需要能在 README 里快速看到最近改了什么。
**改动**：README 新增「开发日志」章节（最新在上，一句话简述 + 指向完整日志）；CLAUDE.md 与 dev-log.md 的规则补充「更新开发日志时，同时将简述更新到 README」。
**验证**：README「开发日志」章节显示全部历史简述，与 dev-log.md 对应。

## 2026-08-28 — 修复客户端长轮询循环只跑一轮的 bug

**类型**：BUG 修复
**涉及**：`client.js`
**背景 / 问题**：客户端 `events/poll` 长轮询只拉取一次就停止，之后不再更新宿主推送的消息。根因：`poll()` 内 `inflight` 置 `true` 后**从未复位**，第二轮 `poll()` 被 `if (cancelled || inflight) return` 挡死，循环终止。用独立脚本复现确认（10ms 内只执行 1 次）。
**改动**：在 `await connection.rpc.call(...)` 结束后（含 try 成功与 catch 两条路径）都加 `inflight = false`，使循环能持续拉取；失败路径保持 3 秒退避。
**验证**：`node --check client.js` 通过；复现脚本显示修复后循环持续执行。

## 2026-08-28 — hello/notice 示例事件改为每 5 秒推送

**类型**：功能
**涉及**：`host.js`、`README.md`、`docs/plugin-dev-handbook.md`
**背景 / 问题**：原实现「启动 5 秒后自动发一次事件」，无法持续演示「host 主动推送 → client 持续更新」。
**改动**：`host.js` 用 `setInterval` 替代一次性 `setTimeout`，每 5 秒 emit 一次 `hello/notice`（带当前时间戳）；同步更新 README 与手册的验证描述。
**验证**：`node --check` 通过；文档描述同步为「每 5 秒出现新的气泡条」。

## 2026-08-28 — 新增 dsh 插件能力清单（学习文档）

**类型**：文档
**涉及**：`docs/plugin-capability-catalog.md`、`cordis.patch.yml`
**背景 / 问题**：需要一份 dsh 对 plugin 开放的所有能力面的清单，供后续学习。
**改动**：基于 harness 源码与 `capability-seams.md` 权威目录整理：Cordis 内核、宿主端服务 6 类 52 项、客户端服务、双向通信通道 6 种、插槽体系、工具贡献、关键约束、源码地图。同时把 `cordis.patch.yml` 的宿主插件 `name` 改为可移植包名。
**验证**：Markdown 表格结构检查通过。

## 2026-08-28 — 宿主主动推送事件到客户端（长轮询）

**类型**：功能
**涉及**：`host.js`、`client.js`、`README.md`、`docs/plugin-dev-handbook.md`
**背景 / 问题**：第二步开发 —— 让 host 主动触发事件、client 收到。调研发现 dsh 标准事件转发（`ctx.remote.$on`）对自定义事件不适用：`registerRemoteEvents` 是单例（api-remotes 占用），事件名须进 allowlist。
**改动**：
- 宿主维护 `pending` 队列 + `waiters` 挂起表，`emit(event, args)` 广播唤醒所有 waiter；`/hello/events/poll` 端点挂起等待（15 秒超时 / abort 清理）。
- 客户端挂载后跑长轮询循环，事件渲染为按钮上方气泡条。
- 并发审查：waiter 从单槽改数组；广播改为先 splice 快照再分发，避免第一个 waiter 拿光。
**验证**：长轮询核心逻辑独立脚本验证 5 场景 10 断言全过。

## 2026-08-28 — 客户端点击调用宿主（接通 /hello RPC）

**类型**：功能
**涉及**：`host.js`、`client.js`、`README.md`、`docs/plugin-dev-handbook.md`、`.gitignore`
**背景 / 问题**：第一步开发 —— client 点击调用 host。
**改动**：
- 宿主 `inject: ['connection']`，`ctx.connection.rpc.handle('/hello', handler)` 注册通道。
- 客户端 `HelloPill` 点击时 `connection.rpc.call('/hello', 'ping', { args })`。
- 修复：`HelloPill` 从模块级组件引用 `ctx` 报 `ReferenceError: ctx is not defined` → 改为通过 `slots.register` 的 `inject` 业务面把 `connection` 传成组件 prop；组件直接传（非 `() => createElement(...)`）。
**验证**：`node --check` 通过；注册 id 与包名一致。

## 2026-08-28 — 修正插件 ID 与包名一致

**类型**：BUG 修复
**涉及**：`client.js`
**背景 / 问题**：`load({ id })` 注册的 id 与包名不一致，模块系统以包名为图行 id，factory-presence 校验会拒绝产物。
**改动**：注册 id 统一为 `dsh-hello-plugin`。
**验证**：`node --check` 通过。

## 2026-08-28 — 添加 dsh-hello-plugin 插件初始代码

**类型**：实现
**涉及**：`host.js`、`client.js`、`cordis.patch.yml`、`package.json`、`README.md`
**背景 / 问题**：仓库初始化 —— 最小可运行的双面插件骨架。
**改动**：宿主半区打日志；客户端半区渲染悬浮按钮并注入 `shell.overlay` 插槽；patch 层插入宿主插件行。
**验证**：`node --check` 通过。
