# dsh 插件开发手册

> 以 `dsh-hello-plugin` 为样本，记录「双面插件」从零接通 *客户端点击 → 宿主* 的完整开发过程，以及逐步沉淀下来的插件开发规范。适合照着写第一个 dsh 插件的人。

- 编写时间：2026-08（实现之后）
- 样本仓库：`dsh-hello-plugin`
- 配套阅读：deepseek-harness 源码（`packages/client/connection` · `packages/client/ui-slots` · `packages/client/ui-renderer`）

---

## 01 认识这个仓库

一个最小可运行的 dsh（DeepSeek Harness，全插件化 Cordis agent 框架）插件。它本身不构建、不测试 —— 它是被 deepseek-harness 工作区消费的插件。开发流程只有两件事：改代码、`node --check`。

| 文件 | 角色 | 职责 |
| --- | --- | --- |
| `host.js` | 宿主半区 | Node 端 Cordis 插件入口，`name` + `apply(ctx)`；注册 `/hello` RPC 通道 |
| `client.js` | 客户端半区 | 浏览器 bundle，右下角悬浮按钮；点击经 RPC 调宿主 |
| `cordis.patch.yml` | patch 层 | 把宿主插件行插入启动图（boot graph）的插件列表 |
| `package.json` | 包清单 | 声明两个半区的导出与 dsh 集成字段 |

---

## 02 双面插件如何接线

同一个包同时提供 Node 宿主半区与浏览器客户端半区，两侧由同一份 vendored Cordis Loader 治理。关键在「线缆」：浏览器和宿主之间隔着 HTTP，消息要过一层 RPC 信封。

- **宿主半区**：`exports["."]` → host.js。作为普通 Cordis 插件行进入启动图，`apply(ctx)` 在 Node 进程里跑。
- **客户端半区**：`exports["./client"]` + `dsh.client.platform=web`。由 dsh-client-modules 扫描发现，浏览器端通过 `window.__ModuleLoader__.load` 注册。
- **线缆 connection**：浏览器↔宿主之间，客户端 `ctx.connection.rpc.call`，宿主 `ctx.connection.rpc.handle`，共用一套 RPC 信封。

这套手册的实质，就是弄懂 **connection** 这一格：客户端怎么把消息递到宿主的 `apply(ctx)` 里。

---

## 03 开发过程

以下是实现「客户端点击调用宿主」时的真实推进顺序。每一步都记下了当时发现了什么、证据在哪、结论是什么。

### 03.1 读既有结构，确认起点

仓库里已有一个最小的双面插件骨架：宿主半区打日志，客户端半区渲染一个悬浮按钮并注入 `shell.overlay` 插槽。任务是在此之上接通「点击按钮 → 宿主」。当时对 harness 一无所知，唯一可依赖的是宿主端的日志输出。

### 03.2 定位通信机制：client-connection 包

在 deepseek-harness 源码里搜「客户端如何调宿主」，命中 `packages/client/connection` —— 它是浏览器↔宿主的线缆层。三份关键文件把机制讲清楚了：

- `src/rpc.ts` 定义信封：请求 `{ type:'client-request', rpcId, method, payload }`，结果 `{ ok:true, value } | { ok:false, error }`。
- `src/rpc-host.ts` 说明宿主注册方式：`connection.rpc.handle(channel, handler)`；`/api` 是 api-gateway 独占的共享通道，**只允许一个拦截器** —— 自己的通道得另开。
- `src/client/rpc.ts` 说明客户端调用方式：`connection.rpc.call(channel, endpoint, payload, signal)` → POST `/api/<endpoint>`。

同时发现更原生的 Typert Remote（生成式 descriptor，`namespace/method` 端点），但自建通道 `rpc.handle` 对示例插件更简单直接。

### 03.3 宿主端注册通道

在 `apply(ctx)` 里声明 `inject: ['connection']`，然后注册 `/hello` 通道。handler 返回标准结果信封。

```js
export const name = 'dsh-hello-plugin'
export const inject = ['connection']

export function apply(ctx) {
  ctx.connection.rpc.handle('/hello', async (endpoint, payload) => {
    // 返回 { ok:true, value } 或 { ok:false, error:{code,message,details} }
    return { ok: true, value: 'pong from host, hello world!' }
  })
}
```

### 03.4 客户端实现（第一版，埋雷）

按直觉在组件里直接调用 `ctx.connection.rpc.call(...)`。插件声明 `inject: ['slots', 'connection']`，认为 `ctx` 在组件里也应该可用。

```js
function HelloPill() {
  const onClick = () => {
    ctx.connection.rpc.call('/hello', 'ping', { args: { name: 'browser' } })
      .then(/* … */)
  }
  // ctx 在哪里？—— 这里没有 ctx。
}
```

### 03.5 踩坑：`ctx is not defined`

点击按钮，浏览器抛 `Uncaught ReferenceError: ctx is not defined at onClick`。原因立刻清楚了：`HelloPill` 是模块级组件，而 `ctx` 只活在 `apply(ctx)` 闭包里。React 渲染组件时不会把 `ctx` 传进来 —— 组件闭包作用域里根本没有这个变量。

### 03.6 找正确姿势：inject 业务面

回到 harness 源码看真实插件怎么把业务服务传给组件。命中 `packages/client/ui-slots` 与 `packages/client/ui-renderer/src/client/scoped-slots.tsx`：

- `slots.register` 有第二个选项 `inject` —— 一个工厂函数，**闭包能捕获 `apply(ctx)` 的 ctx**，返回值会展开为组件 props。
- 渲染器证据（scoped-slots.tsx）：`<Comp {...kit} {...injected} {...} />` —— 注入的 props 直接铺到组件上。
- 真实范例（`packages/client/ui-chat/src/client/apply.ts`）：`inject: () => ({ closeDetails: () => { ctx.layout.closeDetails() } })`。

### 03.7 修复：组件收 props，服务走 inject 业务面

组件改为接收 `connection` prop；在 `register` 里通过 `inject` 把 `ctx.connection` 传下去。**同时发现一个隐藏点：组件必须直接传，不能包一层 `() => createElement(HelloPill)`** —— 包一层会让注入的 props 落在包装函数上，组件照样拿不到。

```js
function HelloPill({ connection }) {
  const onClick = () => {
    connection.rpc.call('/hello', 'ping', { args: { name: 'browser' } })
      .then(/* … */)
  }
  // ctx 不在模块作用域；connection 从 props 来。
}

function apply(ctx) {
  ctx.effect(() => ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'hello-pill',
        inject: () => ({ connection: ctx.connection }) },
      HelloPill,   // 直接传组件，别包一层
    )))
}
```

### 03.8 验证

`node --check host.js client.js` 通过；注册 id 与包名一致。链路结论：点击按钮 → 客户端 `rpc.call` → 宿主 `/hello` handler → 宿主日志输出 `client ping: browser` → 按钮显示 `pong from host`。

---

## 04 插件开发规范

把这些经验压缩成四条可复用的规范。前两条决定「插件长什么样」，后两条决定「两个半区怎么说话」。

### A. 包结构

- **宿主**走 `exports["."]`，**客户端**走 `exports["./client"]`；patch 走 `exports["./cordis.patch.yml"]`。
- 客户端半区**不写进** cordis.patch.yml —— 由 dsh-client-modules 扫描 `dsh.client.platform=web` 发现。
- `window.__ModuleLoader__.load({ id })` 的 **id 必须等于包名**（图行 id），否则 factory-presence 校验拒绝产物。
- factory 收到同步 `require`；平台模块表种子词：`react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`…

### B. Cordis 插件

- 导出 `name` + `apply(ctx)`；客户端还要 `return { inject, apply }`。
- `inject: ['服务名']` 声明依赖；激活后 `ctx.服务名` 直接可用。
- 一切副作用包进 `ctx.effect(...)`，卸载自动回收，不留悬空状态。
- 要把 `ctx` 里的值递给组件 → 走 slots 的 `inject` 业务面（见 D）。

### C. 客户端 → 宿主 RPC

- 客户端 `ctx.connection.rpc.call('/hello', 'ping', { args })` → `Promise<{ ok, value } | { ok, error }>`。
- payload 信封必须是 `{ args: {...} }`（恰好一个 plain-object 字段）。
- 端点语法：两段 `namespace/method`，每段 `[A-Za-z0-9_$.-]+`。
- 宿主 `ctx.connection.rpc.handle(channel, handler)`；handler 返回标准结果信封。
- **不要碰 `/api`**：api-gateway 独占，只允许一个 interceptor；自己开独立通道如 `/hello`。

### D. 插槽（UI）

- 悬浮小组件挂 `shell.overlay`（list 槽，叠加式）；**不要挂 `root`**（single 槽，会 shadow 掉整个 frame）。
- 标准姿势：`ctx.effect(() => slots.inject('shell.overlay', () => slots.register({…}, Comp)))`。
- inject 业务面：`inject: () => ({ connection: ctx.connection })` —— 闭包捕获 apply 的 ctx，返回值铺成 `<Comp {...injected} />`。
- **组件直接传**（传 `HelloPill`，不是 `() => createElement(HelloPill)`），否则 props 落不到组件上。
- 组件拿服务只靠 props，永不引用模块级 ctx。

---

## 05 踩坑记录

三个坑，每个都是「文档没写、源码里才有答案」的类型。前两个是同一类问题的两面：作用域。

| 坑 | 现象 | 原因 | 修法 |
| --- | --- | --- | --- |
| 模块级组件引 ctx | `ReferenceError: ctx is not defined` | `ctx` 只活在 `apply(ctx)` 闭包；React 不会把 ctx 传给模块级组件 | 服务经 inject 业务面走 props 进组件 |
| register 传了包装函数 | 注入的 props 静默丢失 | 渲染器的 `{...injected}` 铺到了包装函数上，组件本体拿不到 | 直接传组件本身 |
| 想拦截 /api | api-gateway 独占 | `/api` 共享通道只允许一个 interceptor（api-gateway 已占用） | 开独立通道 `rpc.handle('/hello', …)` |

---

## 06 验证清单

改完插件后按此逐项过一遍。前两项是静态检查，后三项要起一个挂了本 bundle 的 dsh profile 实测。

- [ ] 语法检查通过：`node --check host.js client.js`
- [ ] `load({ id })` 的 id 与包名一致（图行 id）
- [ ] 宿主日志出现 `hello-plugin/host.js loaded` 与 `host loaded`
- [ ] Web 端右下角出现「👋 hello world」悬浮按钮
- [ ] 点击按钮：宿主日志追加 `client ping: browser`，按钮短暂显示 `pong from host, hello browser!` 后恢复计数

---

*规范条目均可在 deepseek-harness 源码中找到依据：`packages/client/connection`（RPC 信封与通道）、`packages/client/ui-slots` + `packages/client/ui-renderer`（inject 业务面与渲染器展开）、`packages/api/gateway`（/api 独占）。*
