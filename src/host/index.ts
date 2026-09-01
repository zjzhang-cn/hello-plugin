import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { name, inject, POLL_TIMEOUT_MS } from './constants'
import { loadProjectJiraConfig, loadProjectLlmConfig } from './config'
import { fetchJiraTodos, fetchJiraIssueDetail, addJiraComment } from './jira'
import { registerJiraTools } from './jira-tools'
import { generateLlmAnalysis } from './llm'
import { installGoogleNewsTool } from './news'
import { JiraConfigError, rpcFailure } from './errors'
import type { PendingEvent, JiraSettings, LlmConfig, JiraIssueDetail } from './types'

export { name, inject }
export type { JiraTodo, JiraSettings } from './types'

export function apply(ctx: Context): void {
  const logger = ctx.logger('hello-plugin')
  logger.info('host loaded')
  console.log('hello-plugin/host.js loaded')

  // ---- Jira 配置：工程根 jira.config.json 优先，其次 ctx.settings ----
  const projectConfig = loadProjectJiraConfig(logger)
  const settingsService = ctx.get('settings')
  let settingsJira: JiraSettings = {}
  if (settingsService !== undefined) {
    const scope = settingsService.register('jira', z.object({
      baseUrl: z.string().required(false),
      email: z.string().required(false),
      apiToken: z.string().required(false),
    }))
    settingsJira = scope.get()
    scope.watch(() => { settingsJira = scope.get() })
  } else if (projectConfig === null) {
    logger.warn('settings 服务不可用且无 jira.config.json，jira/todos 端点将返回未配置')
  }
  const resolveJiraSettings = (): JiraSettings => projectConfig ?? settingsJira

  // ---- LLM 配置：工程根 llm.config.json（provider / model）----
  const llmConfig = loadProjectLlmConfig(logger) ?? {}
  if (llmConfig.provider === undefined || llmConfig.model === undefined) {
    logger.warn('llm.config.json 未配置或缺失，jira/analyze 端点将返回错误')
  }

  // ---- 宿主 → 客户端 的事件队列（长轮询）----
  const pending: PendingEvent[] = []
  const waiters: Array<{ resolve: (value: PendingEvent[] | null) => void; timer: NodeJS.Timeout }> = []

  function emit(event: string, args: unknown[] = []): void {
    pending.push({ event, args })
    logger.info('emit:', event, ...args)
    if (waiters.length > 0) {
      const snapshot = pending.splice(0)
      while (waiters.length > 0) {
        const w = waiters.shift()
        if (w === undefined) break
        clearTimeout(w.timer)
        w.resolve(snapshot)
      }
    }
  }

  // ---- 注册 Jira 全局工具 ----
  registerJiraTools(ctx, resolveJiraSettings)

  // 注册 /hello 通道。
  ctx.connection.rpc.handle('/hello', async (endpoint, payload, signal): Promise<ConnectionRpcResult<unknown>> => {
    const args = (payload as { args?: Record<string, unknown> } | undefined)?.args ?? {}

    if (endpoint === 'ping') {
      const nameArg = args.name
      const display = typeof nameArg === 'string' ? nameArg : '(anonymous)'
      logger.info('client ping:', display)
      return { ok: true, value: `pong from host, hello ${display}!` }
    }

    if (endpoint === 'jira/todos') {
      try {
        const todos = await fetchJiraTodos(resolveJiraSettings())
        return { ok: true, value: todos }
      } catch (error) {
        if (error instanceof JiraConfigError) return rpcFailure(error.code, error.message)
        logger.warn('jira/todos failed:', String(error))
        return rpcFailure('jira-error', `读取 Jira 待办失败：${String(error)}`)
      }
    }

    if (endpoint === 'jira/analyze') {
      const key = typeof args.key === 'string' ? args.key : ''
      if (key === '') return rpcFailure('bad-request', '缺少 key 参数')
      try {
        const settings = resolveJiraSettings()
        const issue = await fetchJiraIssueDetail(settings, key)
        const analysis = await generateLlmAnalysis(ctx, llmConfig, issue, signal)
        return { ok: true, value: { key: issue.key, summary: issue.summary, analysis } }
      } catch (error) {
        if (error instanceof JiraConfigError) return rpcFailure(error.code, error.message)
        logger.warn('jira/analyze failed:', String(error))
        return rpcFailure('jira-error', `分析 Jira issue 失败：${String(error)}`)
      }
    }

    if (endpoint === 'jira/comment') {
      const key = typeof args.key === 'string' ? args.key : ''
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (key === '') return rpcFailure('bad-request', '缺少 key 参数')
      if (text === '') return rpcFailure('bad-request', '缺少评论内容')
      try {
        await addJiraComment(resolveJiraSettings(), key, text)
        return { ok: true, value: { added: true } }
      } catch (error) {
        if (error instanceof JiraConfigError) return rpcFailure(error.code, error.message)
        logger.warn('jira/comment failed:', String(error))
        return rpcFailure('jira-error', `添加 Jira 评论失败：${String(error)}`)
      }
    }

    if (endpoint === 'news/start') {
      if (llmConfig.provider === undefined || llmConfig.model === undefined) {
        return rpcFailure('llm-not-configured', 'llm.config.json 未配置 provider/model')
      }
      const agents = ctx.get('agents')
      if (agents === undefined) return rpcFailure('agents-unavailable', 'agents 服务不可用')
      const sessionId = 'news-' + randomUUID()
      try {
        const workspaceRegistry = ctx.get('workspaceRegistry') as {
          create(path: string, title?: string): Promise<{
            readonly id: string
            readonly path: string
            readonly title: string
            setTitle(title: string): Promise<void>
            attachSession(sessionId: string): Promise<void>
          }>
        } | undefined
        const cwd = process.cwd()
        const workspace = workspaceRegistry === undefined
          ? undefined
          : await workspaceRegistry.create(cwd, '新闻头条')
        if (workspace !== undefined) await workspace.setTitle('新闻头条')
        const handle = await agents.create({
          sessionId: sessionId as never,
          meta: { cwd },
          agentOptions: { provider: llmConfig.provider, model: llmConfig.model },
          setup: (agentCtx: Context) => { installGoogleNewsTool(agentCtx) },
        })
        if (workspace !== undefined) await workspace.attachSession(sessionId)
        const now = new Date()
        const stamp = now.toLocaleTimeString('zh-CN', { hour12: false })
        ;(ctx as unknown as { sessionTitle: { rename(session: object, title: string): unknown } })
          .sessionTitle.rename(handle.agent.session, `获取新闻 ${stamp}`)
        handle.agent.followup(createUserMessage({
          content: [{
            type: 'text' as const,
            text: '请使用 google_news 工具获取最新 Google 新闻，然后用简洁的中文总结当前最重要的 5 条新闻，每条附链接。',
          }],
          source: { kind: 'plugin' as const, plugin: name },
        }))
        return { ok: true, value: { sessionId } }
      } catch (error) {
        logger.warn('news/start failed:', String(error))
        return rpcFailure('news-error', `发起新闻会话失败：${String(error)}`)
      }
    }

    if (endpoint === 'events/poll') {
      if (pending.length > 0) {
        return { ok: true, value: pending.splice(0) }
      }
      const events = await new Promise<PendingEvent[] | null>((resolve) => {
        let entry: { resolve: (value: PendingEvent[] | null) => void; timer: NodeJS.Timeout }
        const timer = setTimeout(() => {
          const index = waiters.indexOf(entry)
          if (index !== -1) waiters.splice(index, 1)
          resolve(null)
        }, POLL_TIMEOUT_MS)
        entry = {
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

    return rpcFailure('bad-request', `unknown endpoint: ${endpoint}`)
  })

  // 每 5 秒自动发一个事件，证明「host 主动触发」不需要任何客户端请求。
  ctx.effect(() => {
    const timer = setInterval(() => {
      emit('hello/notice', ['host is alive at ' + new Date().toLocaleTimeString()])
    }, 5_000)
    return () => clearInterval(timer)
  })
}
