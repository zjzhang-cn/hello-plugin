# dsh 插件开发 · 学习路径（由简入深）

> 把仓库里散落的文档整理成一条**按章节、由浅入深**的学习路线。每章都有：**学什么**（目标）、**读什么**（本文档的章节或源码）、**动手做**（在 hello-plugin 里实践）、**产出**（可验证的结果）。
>
> 主线是 dsh-hello-plugin 这个真实插件 —— 边读边改，每章结束都有能跑通的成果。配套文档：
>
> - 能力清单（全景地图）— [plugin-capability-catalog.md](plugin-capability-catalog.md)
> - 开发手册（过程与坑）— [plugin-dev-handbook.md](plugin-dev-handbook.md)
> - 开发日志（时间线）— [dev-log.md](dev-log.md)
> - 仓库纪律 — [CLAUDE.md](../CLAUDE.md)

---

## 阶段一 · 打地基（Cordis 与插件骨架）

### 第 1 章 认识 dsh 插件长什么样

- **学什么**：dsh 插件 = Cordis 插件；一个包同时提供「宿主半区 + 客户端半区」。
- **读什么**：开发手册 [01 认识这个仓库](plugin-dev-handbook.md#01-认识这个仓库)、[02 双面插件如何接线](plugin-dev-handbook.md#02-双面插件如何接线)；仓库 `src/host/index.ts`、`src/client/index.tsx`、`package.json`、`cordis.patch.yml`。
- **动手做**：通读四个文件，回答——宿主半区从哪个 export 进启动图？客户端半区怎么被发现？patch 层是干嘛的？
- **产出**：能在脑内画出「一个包 → 两个进程（Node + 浏览器）→ 一份 Loader」的草图。

### 第 2 章 Cordis 内核：插件其实就是 context

- **学什么**：`name` + `apply(ctx)`、`inject` 依赖注入、`ctx.effect` 生命周期、`ctx.on/emit` 事件、`ctx.logger`。
- **读什么**：能力清单 [01 Cordis 内核能力](plugin-capability-catalog.md#一cordis-内核能力所有插件的基础)；harness `docs/cordis-primer.md`、`vendor/cordis`。
- **动手做**：在 `src/host/index.ts` 的 `apply` 里加 `ctx.on('some/event', ...)` 与 `ctx.logger`，观察加载日志。
- **产出**：理解为什么「一切注册都要包进 `ctx.effect()`」。

---

## 阶段二 · 双向通信（本仓库的核心）

### 第 3 章 客户端 → 宿主：RPC 信封

- **学什么**：`connection` 服务；`rpc.call` / `rpc.handle`；信封 `{ args }`、结果 `{ ok, value } | { ok, error }`；为什么不能碰 `/api`。
- **读什么**：开发手册 [03.2-03.3](plugin-dev-handbook.md#032-定位通信机制client-connection-包)、规范 [C 客户端 → 宿主 RPC](plugin-dev-handbook.md#c-客户端--宿主-rpc)；能力清单 [04 双向通信通道](plugin-capability-catalog.md#四双向通信通道)；源码 `packages/client/connection/src/rpc.ts`、`rpc-host.ts`、`client/rpc.ts`。
- **动手做**：改 `src/host/index.ts` 加一个新端点（如 `hello/greet`），`src/client/index.tsx` 按钮调用它并显示返回值。
- **产出**：按钮点击 → 宿主日志 → 返回值上屏，链路亲手打通。

### 第 4 章 组件怎么拿到服务：inject 业务面

- **学什么**：`ctx` 只活在 `apply` 闭包；`slots.register` 的 `inject` 工厂把服务变成组件 props；组件必须直接传。
- **读什么**：开发手册 [03.5-03.7 踩坑与修复](plugin-dev-handbook.md#035-踩坑ctx-is-not-defined)、规范 [D 插槽 UI](plugin-dev-handbook.md#d-插槽ui)；源码 `packages/client/ui-renderer/src/client/scoped-slots.tsx`（`<Comp {...injected} />`）。
- **动手做**：把 `HelloPill` 改成还接收第二个注入的服务（如 `layout`），用 `ctx.layout` 做点事。
- **产出**：彻底理解「组件只靠 props，永不引用模块级 ctx」。

### 第 5 章 宿主 → 客户端：长轮询

- **学什么**：标准事件转发（`ctx.remote.$on`）为什么对自定义事件不适用；长轮询三个要点（广播、超时、abort 清理）。
- **读什么**：开发手册 [03.9 宿主主动推送](plugin-dev-handbook.md#039-第二步宿主主动推送事件到客户端)、规范 [E 宿主 → 客户端事件推送](plugin-dev-handbook.md#e-宿主--客户端事件推送)；源码 `packages/api/remotes/src/remote-events.ts`（allowlist）。
- **动手做**：改 `src/host/index.ts` 的 `emit` 内容或频率，观察客户端气泡更新；故意去掉客户端 `inflight` 复位，看循环停在哪。
- **产出**：理解为什么 hello-plugin 用长轮询而非标准事件；能解释广播语义。

### 第 6 章 通信机制对照

- **学什么**：6 种通道的适用场景：Unary RPC / Typert Remote / Remote events / 长轮询 / WebSocket mux / Fetch 路由。
- **读什么**：能力清单 [04 双向通信通道](plugin-capability-catalog.md#四双向通信通道)（含 6 通道表格）。
- **动手做**：为每个通道写一句话「什么时候用它、什么时候不用」。
- **产出**：一张自己的通道选型速查表。

---

## 阶段三 · 能力全景（广度）

### 第 7 章 宿主端能力地图

- **学什么**：宿主端 6 类服务——Agent/会话、模型/工具、文件/执行、用户交互、配置/数据、插件自省。
- **读什么**：能力清单 [02 宿主端核心服务](plugin-capability-catalog.md#二宿主端核心服务node-进程内)；harness `docs/capability-seams.md`（权威服务图）。
- **动手做**：选一个服务（如 `ctx.jobs` 或 `ctx.skills`）读它的源码入口，写一段「它怎么用」。
- **产出**：至少吃透 1 个宿主服务的完整用法。

### 第 8 章 客户端能力地图

- **学什么**：客户端服务——`remote` / `connection` / `slots` / `layout` / `theme` / `locale` / `settingsScope`。
- **读什么**：能力清单 [03 客户端核心服务](plugin-capability-catalog.md#三客户端核心服务浏览器内)。
- **动手做**：给 `HelloPill` 挂一个 `ctx.locale` 翻译的文案。
- **产出**：能在客户端插件里用上 2 个以上服务。

### 第 9 章 工具（Tools）贡献

- **学什么**：`ctx.tools.register(definition)`；工具 = name + description + JSON-Schema；模型怎么看到它。
- **读什么**：能力清单 [06 工具贡献](plugin-capability-catalog.md#六工具tools贡献)；harness `docs/tool-catalog.md`（全目录）。
- **动手做**：在宿主端 `ctx.tools.register` 一个最小工具（如 `hello_tool`），在 profile 里看它出现在工具列表。
- **产出**：一个模型可见的自定义工具。

---

## 阶段四 · 工程纪律（收尾）

### 第 10 章 踩坑与约束

- **学什么**：5 个坑——模块级引 ctx、register 传包装函数、/api 独占、waiter 单槽、广播 splice 竞态。
- **读什么**：开发手册 [05 踩坑记录](plugin-dev-handbook.md#05-踩坑记录)、能力清单 [07 关键约束](plugin-capability-catalog.md#七关键约束踩过的坑)。
- **动手做**：给每个坑写「如果再来一次，我怎么一眼识别」。
- **产出**：形成自己的排错 checklist。

### 第 11 章 验证与文档纪律

- **学什么**：验证清单；每次改动要写开发日志 + README 简述；正式 patch 用包名。
- **读什么**：开发手册 [06 验证清单](plugin-dev-handbook.md#06-验证清单)；[CLAUDE.md](../CLAUDE.md) 的「开发日志」「改动纪律」。
- **动手做**：改一个小功能，走完整流程——改码 → dev-log → README 简述 → 提交。
- **产出**：一套肌肉记忆的开发闭环。

---

## 建议节奏

| 阶段 | 章节 | 目标 | 预计 |
| --- | --- | --- | --- |
| 打地基 | 1-2 | 看懂插件骨架与 Cordis 内核 | 0.5 天 |
| 双向通信 | 3-6 | 亲手打通两条链路 | 1-2 天 |
| 能力全景 | 7-9 | 摸清宿主/客户端能力面，贡献工具 | 1-2 天 |
| 工程纪律 | 10-11 | 排错与文档闭环 | 0.5 天 |

每章结束的「产出」都能在本仓库里验证 —— 学习即开发，开发即学习。
