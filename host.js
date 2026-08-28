export const name = 'dsh-hello-plugin'

// 依赖 connection 服务（宿主端由 client-connection 提供），用它注册 RPC 通道，
// 供浏览器客户端通过 ctx.connection.rpc.call 调用。
export const inject = ['connection']

export function apply(ctx) {
  const logger = ctx.logger('hello-plugin')
  logger.info('host loaded')
  console.log('hello-plugin/host.js loaded')

  // 注册一个自定义 RPC 通道 /hello，客户端点击按钮时调用。
  // 不能拦截 /api —— 那是 api-gateway 独占的共享通道，只允许一个拦截器。
  ctx.connection.rpc.handle('/hello', async (endpoint, payload) => {
    if (endpoint !== 'ping') {
      return {
        ok: false,
        error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: {} },
      }
    }
    const name = payload?.args?.name
    console.log('client ping:', name ?? '(anonymous)')
	
    return { ok: true, value: `pong from host, hello ${name ?? 'world'}!` }
  })
}
