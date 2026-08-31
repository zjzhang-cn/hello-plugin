import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

// ---- 类型定义 ----

interface PendingEvent {
  event: string
  args: unknown[]
}

interface JiraSettings {
  baseUrl?: string | undefined
  email?: string | undefined
  apiToken?: string | undefined
}

interface LlmConfig {
  provider?: string | undefined
  model?: string | undefined
}

/** 一条 Jira 待办（指派给当前用户的未解决问题）。 */
interface JiraTodo {
  key: string
  summary: string
  typeName: string
  typeColor: string
  typeIconUrl: string
  statusName: string
}

/** Jira issue 详情（供 LLM 分析用）。 */
interface JiraIssueDetail {
  key: string
  summary: string
  descriptionText: string
  commentsText: string
}

// ---- 常量 ----

export const name = 'dsh-hello-plugin'

// 依赖 connection 服务（宿主端由 client-connection 提供），用它注册 RPC 通道，
// 供浏览器客户端通过 ctx.connection.rpc.call 调用。settings 服务由 base profile
// 的 settings-file 提供，这里用 ctx.get 可选获取（拿不到也能加载插件）。
// agents 服务（core/agent）用于创建新会话驱动 Agent；sessionTitle 用于给会话命名。
export const inject = ['connection', 'agents', 'sessionTitle']

// 长轮询超时：客户端挂起一个 poll 请求，宿主在超时内等不到新事件就返回空数组。
// 客户端收到空数组后立即发起下一次 poll —— 有事件时近乎实时，无事件时只挂一个请求。
const POLL_TIMEOUT_MS = 15_000

// Jira 常见 Issue Type 的代表色（按名称精确匹配）；其余按名称 hash 从色板取色。
const ISSUE_TYPE_COLORS: Readonly<Record<string, string>> = {
  Bug: '#d04437',
  'Bug (Defect)': '#d04437',
  Task: '#3572b0',
  Story: '#16825d',
  Epic: '#7a3e9d',
  Improvement: '#1d8b8b',
  'Sub-task': '#8c9bac',
  SubTask: '#8c9bac',
  // 常见中文 Issue Type 名（Jira Cloud 中文界面）
  故事: '#16825d',
  任务: '#3572b0',
  缺陷: '#d04437',
  史诗: '#7a3e9d',
  改进: '#1d8b8b',
  子任务: '#8c9bac',
}

const FALLBACK_COLORS: readonly string[] = [
  '#5a67d8', '#38a169', '#dd6b20', '#d69e2e', '#e53e3e', '#319795', '#805ad5', '#d53f8c',
]

function colorForIssueType(name: string): string {
  const exact = ISSUE_TYPE_COLORS[name]
  if (exact !== undefined) return exact
  // 简单确定性 hash → 从色板取一个稳定颜色
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  const index = hash % FALLBACK_COLORS.length
  return FALLBACK_COLORS[index] ?? FALLBACK_COLORS[0] ?? '#5a67d8'
}

function resolveIconUrl(baseUrl: string, iconUrl: string | undefined): string {
  if (iconUrl === undefined || iconUrl === '') return ''
  if (/^https?:\/\//i.test(iconUrl)) return iconUrl
  // 相对路径（Jira Server 常见 /secure/viewavatar?...) → 拼上 baseUrl
  return baseUrl.replace(/\/+$/, '') + (iconUrl.startsWith('/') ? iconUrl : '/' + iconUrl)
}

// ---- Jira API 工具 ----

function jiraHeaders(settings: JiraSettings): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: 'Basic ' + Buffer.from(`${settings.email}:${settings.apiToken}`).toString('base64'),
  }
}

function assertJiraSettings(settings: JiraSettings): void {
  if (settings.baseUrl === undefined || settings.baseUrl.trim() === '') throw new JiraConfigError('jira.baseUrl 未配置')
  if (settings.email === undefined || settings.email.trim() === '') throw new JiraConfigError('jira.email 未配置')
  if (settings.apiToken === undefined || settings.apiToken.trim() === '') throw new JiraConfigError('jira.apiToken 未配置')
}

function jiraBaseUrl(settings: JiraSettings): string {
  return (settings.baseUrl as string).replace(/\/+$/, '')
}

/**
 * 把 Jira 的 ADF（Atlassian Document Format）节点递归转成纯文本。
 * ADF 形如 { type: 'paragraph', content: [{ type: 'text', text: '...' }] }。
 */
function adfToText(node: unknown): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((item) => adfToText(item)).join('\n')
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
    if (record.type === 'hardBreak') return '\n'
    // 其它节点：递归 content 与 marks 之外的字段
    if (Array.isArray(record.content)) return adfToText(record.content)
    return ''
  }
  return ''
}

/** 调用 Jira REST API 读取指派给当前用户的未解决 issue（待办）。 */
async function fetchJiraTodos(settings: JiraSettings): Promise<JiraTodo[]> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
  const jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
  const url = baseUrl + '/rest/api/3/search/jql'
    + '?jql=' + encodeURIComponent(jql)
    + '&fields=key,summary,issuetype,status&maxResults=50'
  const response = await fetch(url, { headers: jiraHeaders(settings), signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw await jiraApiError(response)
  const body = await response.json() as {
    issues?: Array<{
      key?: unknown
      fields?: {
        summary?: unknown
        issuetype?: { name?: unknown; iconUrl?: unknown }
        status?: { name?: unknown }
      }
    }>
  }
  const issues = body.issues
  if (!Array.isArray(issues)) throw new Error('Jira API 返回结构异常（期望 issues 数组）')
  return issues.filter((issue) => typeof issue.key === 'string').map((issue) => {
    const fields = issue.fields ?? {}
    const typeName = typeof fields.issuetype?.name === 'string' ? fields.issuetype.name : 'Issue'
    return {
      key: issue.key as string,
      summary: typeof fields.summary === 'string' ? fields.summary : '',
      typeName,
      typeColor: colorForIssueType(typeName),
      typeIconUrl: resolveIconUrl(baseUrl, typeof fields.issuetype?.iconUrl === 'string' ? fields.issuetype.iconUrl : undefined),
      statusName: typeof fields.status?.name === 'string' ? fields.status.name : '',
    }
  })
}

/** 读取单个 issue 详情（summary + description + comments），供 LLM 分析。 */
async function fetchJiraIssueDetail(settings: JiraSettings, key: string): Promise<JiraIssueDetail> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,comment`
  const response = await fetch(url, { headers: jiraHeaders(settings), signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw await jiraApiError(response)
  const body = await response.json() as {
    key?: unknown
    fields?: {
      summary?: unknown
      description?: unknown
      comment?: { comments?: Array<{ body?: unknown; author?: { displayName?: unknown } }> }
    }
  }
  const fields = body.fields ?? {}
  const comments = fields.comment?.comments
  const commentsText = (Array.isArray(comments) ? comments : [])
    .map((comment) => {
      const author = typeof comment.author?.displayName === 'string' ? comment.author.displayName : 'unknown'
      const text = adfToText(comment.body).trim()
      return text === '' ? '' : `${author}: ${text}`
    })
    .filter((text) => text !== '')
    .join('\n')
  return {
    key: typeof body.key === 'string' ? body.key : key,
    summary: typeof fields.summary === 'string' ? fields.summary : '',
    descriptionText: adfToText(fields.description).trim(),
    commentsText,
  }
}

/** 往指定 issue 添加一条评论（ADF 格式 body）。 */
async function addJiraComment(settings: JiraSettings, key: string, text: string): Promise<void> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/comment`
  const body = {
    body: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    },
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...jiraHeaders(settings), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw await jiraApiError(response)
}

async function jiraApiError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => '')
  return new Error(`Jira API ${response.status} ${response.statusText}: ${detail.slice(0, 200)}`)
}

// ---- 工程配置文件加载 ----

interface ConfigLoaderLogger {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

/** 从 bundle 所在目录逐级向上查找一个 JSON 配置文件。 */
function loadProjectJsonConfig<T extends Record<string, unknown>>(
  filename: string,
  logger: ConfigLoaderLogger,
): T | null {
  const bundleDir = dirname(fileURLToPath(import.meta.url))
  let dir: string | undefined = bundleDir
  while (dir !== undefined && dir !== '/') {
    const candidate = join(dir, filename)
    try {
      const raw = readFileSync(candidate, 'utf8')
      const parsed = JSON.parse(raw) as T
      logger.info('%s loaded from %s', filename, candidate)
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        dir = dirname(dir)
        continue
      }
      logger.warn('%s parse failed at %s: %s', filename, candidate, String(error))
      dir = dirname(dir)
    }
  }
  return null
}

function loadProjectJiraConfig(logger: ConfigLoaderLogger): JiraSettings | null {
  const parsed = loadProjectJsonConfig<Partial<JiraSettings>>('jira.config.json', logger)
  if (parsed === null) return null
  return {
    baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
    email: typeof parsed.email === 'string' ? parsed.email : undefined,
    apiToken: typeof parsed.apiToken === 'string' ? parsed.apiToken : undefined,
  }
}

function loadProjectLlmConfig(logger: ConfigLoaderLogger): LlmConfig | null {
  const parsed = loadProjectJsonConfig<Partial<LlmConfig>>('llm.config.json', logger)
  if (parsed === null) return null
  return {
    provider: typeof parsed.provider === 'string' && parsed.provider !== '' ? parsed.provider : undefined,
    model: typeof parsed.model === 'string' && parsed.model !== '' ? parsed.model : undefined,
  }
}

// ---- LLM 调用 ----

/** 用 ctx.llm 对一段内容生成分析文本。 */
async function generateLlmAnalysis(
  ctx: Context,
  llmConfig: LlmConfig,
  issue: JiraIssueDetail,
  signal: AbortSignal,
): Promise<string> {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm 服务不可用（宿主未挂载 llm）')
  if (llmConfig.provider === undefined || llmConfig.model === undefined) {
    throw new Error('llm.config.json 未配置 provider/model')
  }
  const prompt = [
    `Jira issue ${issue.key}：${issue.summary}`,
    ``,
    issue.descriptionText !== '' ? `描述：\n${issue.descriptionText}` : '描述：（无）',
    issue.commentsText !== '' ? `已有评论：\n${issue.commentsText}` : '已有评论：（无）',
  ].join('\n')
  const options = {
    provider: llmConfig.provider,
    model: llmConfig.model,
    messages: [createUserMessage({
      content: [{ type: 'text' as const, text: prompt }],
      source: { kind: 'plugin' as const, plugin: name },
    })],
    system: '你是 Jira 问题分析助手。请用简洁的中文总结这个 issue 的要点：它要解决什么问题、当前状态、可能的下一步。只输出分析内容本身，不要客套。',
    maxTokens: 500,
    signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`LLM 调用失败：${finish.failure?.message ?? String(finish.failure)}`)
  }
  const text = assembler.blocks()
    .filter((block) => block.type === 'text')
    .map((block) => block.type === 'text' ? block.text : '')
    .join(' ')
    .trim()
  if (text === '') throw new Error('LLM 未返回有效内容')
  return text
}

// ---- Google News 工具（新会话 Agent 使用）----

/** 一条 Google News 新闻。 */
interface GoogleNewsItem {
  title: string
  link: string
  pubDate: string
}

/**
 * 抓取 Google News RSS 并解析为新闻列表（标题 + 链接 + 发布时间）。
 * Node 全局 fetch 可用（harness 无网络沙箱）；RSS 用正则做简易解析。
 */
async function fetchGoogleNews(locale: string): Promise<GoogleNewsItem[]> {
  const region = locale.toUpperCase()
  const url = `https://news.google.com/rss?hl=${locale}&gl=${region}&ceid=${region}:${locale}`
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Google News ${response.status} ${response.statusText}`)
  const xml = await response.text()
  const items: GoogleNewsItem[] = []
  const itemPattern = /<item>([\s\S]*?)<\/item>/g
  for (const match of xml.matchAll(itemPattern)) {
    const block = match[1] ?? ''
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? ''
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? ''
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? ''
    if (title !== '') items.push({ title, link, pubDate })
  }
  return items.slice(0, 15) // 取前 15 条，避免上下文过长
}

/**
 * 在 Agent 作用域内注册 google_news 工具。
 * 从 agentCtx 调用 ctx.tools.register 走 ScopedLayers —— 仅该会话的 Agent 可见，
 * 不污染全局工具表。agentCtx 的类型不含 tools 声明（core/tools 的模块扩展未引入），
 * 这里用结构化宽松类型直传（宿主 bundle dts: false，运行时无碍）。
 */
function installGoogleNewsTool(agentCtx: Context): void {
  ;(agentCtx as unknown as { tools: { register(definition: object): () => void } }).tools.register({
    name: 'google_news',
    description: '获取 Google News 最新新闻列表（标题 + 链接 + 发布时间）。用于了解当前热点新闻。',
    // parameters 必须是完整 JSON Schema（顶层 type: 'object'）——
    // 简写 { locale: {...} } 会被模型 API 拒绝（type: null）。
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        locale: { type: 'string', description: '语言地区，如 zh-CN 或 en-US' },
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            title: { type: 'string' }, link: { type: 'string' }, pubDate: { type: 'string' },
          },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: unknown) {
      const raw = (args as { locale?: unknown } | undefined)?.locale
      const locale = typeof raw === 'string' && raw !== '' ? raw : 'zh-CN'
      return fetchGoogleNews(locale)
    },
  })
}

// ---- 错误与 RPC ----

class JiraConfigError extends Error {
  readonly code = 'jira-not-configured'
}

function rpcFailure(code: string, message: string): ConnectionRpcResult<unknown> {
  return { ok: false, error: { code, message, details: {} } }
}

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
      // 发起一个新会话：Agent 通过 google_news 工具获取最新 Google 新闻并总结。
      // LLM 交互过程都会写入该会话日志，dsh Web UI 会话列表自动出现（api-session/added）。
      if (llmConfig.provider === undefined || llmConfig.model === undefined) {
        return rpcFailure('llm-not-configured', 'llm.config.json 未配置 provider/model')
      }
      const agents = ctx.get('agents')
      if (agents === undefined) return rpcFailure('agents-unavailable', 'agents 服务不可用')
      const sessionId = 'news-' + randomUUID()
      try {
        const handle = await agents.create({
          sessionId: sessionId as never, // 类型擦除，运行时无碍
          meta: { cwd: process.cwd() },
          agentOptions: { provider: llmConfig.provider, model: llmConfig.model },
          setup: (agentCtx: Context) => { installGoogleNewsTool(agentCtx) },
        })
        // 给会话命名：「获取新闻 <时间>」。rename 追加 session/title 事件，
        // 固定标题并显示在会话列表。
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
        // 不 await whenIdle —— 会话在后台运行，用户可在 Web UI 实时查看交互过程。
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

export type { JiraTodo, JiraSettings }
