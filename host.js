export const name = 'dsh-hello-plugin'

// 依赖 connection 服务（宿主端由 client-connection 提供），用它注册 RPC 通道，
// 供浏览器客户端通过 ctx.connection.rpc.call 调用。
export const inject = ['connection']

// 长轮询超时：客户端挂起一个 poll 请求，宿主在超时内等不到新事件就返回空数组。
// 客户端收到空数组后立即发起下一次 poll —— 有事件时近乎实时，无事件时只挂一个请求。
const POLL_TIMEOUT_MS = 15_000

export function apply(ctx) {
  const logger = ctx.logger('hello-plugin')
  logger.info('host loaded')
  console.log('hello-plugin/host.js loaded')

  // ---- 宿主 → 客户端 的事件队列（长轮询）----
  // 队列持有已 emit 但尚未被客户端取走的事件；waiters 记录当前挂起的长轮询请求。
  // 语义是「广播」：一个事件被多个并发 poll（多标签页）各自看到。
  const pending = [] // 未取走的事件 { event, args }
  const waiters = [] // 挂起的 poll 解析器 { resolve, timer }

  // 宿主主动推送一个事件。任何插件代码都能调用。
  function emit(event, args = []) {
    pending.push({ event, args })
    logger.info('emit:', event, ...args)
    // 唤醒所有挂起的 poll：取一次快照，分发给每一个等待者（广播）。
    if (waiters.length > 0) {
      const snapshot = pending.splice(0)
      while (waiters.length > 0) {
        const w = waiters.shift()
        clearTimeout(w.timer)
        w.resolve(snapshot)
      }
    }
  }

  // 注册 /hello 通道：/hello/ping 请求-响应 + /hello/events/poll 长轮询。
  ctx.connection.rpc.handle('/hello', async (endpoint, payload, signal) => {
    if (endpoint === 'ping') {
      const name = payload?.args?.name
      logger.info('client ping:', name ?? '(anonymous)')
      return { ok: true, value: `pong from host, hello ${name ?? 'world'}!` }
    }

    if (endpoint === 'events/poll') {
      // 已有事件 → 立即取走全部返回；没有 → 挂起等待，超时或新事件到达时返回。
      if (pending.length > 0) {
        return { ok: true, value: pending.splice(0) }
      }
      // 等待期间新事件到达：waiter.resolve(events) 由 emit 以广播方式调用。
      // 超时：resolve(null) 表示本轮无事件。
      // abort：从 waiters 移除并立即返回空数组，避免泄漏挂起连接。
      const events = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          const index = waiters.indexOf(entry)
          if (index !== -1) waiters.splice(index, 1)
          resolve(null)
        }, POLL_TIMEOUT_MS)
        const entry = {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          timer,
        }
        waiters.push(entry)
        signal.addEventListener('abort', () => {
          const index = waiters.indexOf(entry)
          if (index !== -1) waiters.splice(index, 1)
          clearTimeout(timer)
          resolve(null)
        }, { once: true })
      })
      if (events === null) return { ok: true, value: [] }
      return { ok: true, value: events }
    }

    return {
      ok: false,
      error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} },
    }
  })

  // 暴露 emit 给宿主端其他逻辑调用；这里示例：启动 5 秒后自动发一个事件，
  // 证明「host 主动触发」不需要任何客户端请求。
  ctx.effect(() => {
    const timer = setTimeout(() => {
      emit('hello/notice', ['host is alive at ' + new Date().toLocaleTimeString()])
    }, 5_000)
    return () => clearTimeout(timer)
  })
}
