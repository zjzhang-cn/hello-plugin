import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'

// ---- 类型定义 ----

interface JiraSettings {
  baseUrl?: string | undefined
  email?: string | undefined
  apiToken?: string | undefined
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

// ---- 常量 ----

export const name = 'dsh-hello-plugin'

// 依赖 connection 服务（宿主端由 client-connection 提供），用它注册 RPC 通道，
// 供浏览器客户端通过 ctx.connection.rpc.call 调用。settings 服务由 base profile
// 的 settings-file 提供，这里用 ctx.get 可选获取（拿不到也能加载插件）。
export const inject = ['connection']

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

/**
 * 调用 Jira REST API 读取指派给当前用户的未解决 issue（待办）。
 * 接口：GET {baseUrl}/rest/api/3/search/jql，
 * JQL：assignee = currentUser() AND resolution = Unresolved。
 *
 * 注意：Cloud 实例已移除 /rest/api/2/search（410），须用 /rest/api/3/search/jql。
 */
async function fetchJiraTodos(settings: JiraSettings): Promise<JiraTodo[]> {
  const baseUrl = settings.baseUrl?.trim()
  const email = settings.email?.trim()
  const apiToken = settings.apiToken?.trim()
  if (baseUrl === '' || baseUrl === undefined) throw new JiraConfigError('jira.baseUrl 未配置')
  if (email === '' || email === undefined) throw new JiraConfigError('jira.email 未配置')
  if (apiToken === '' || apiToken === undefined) throw new JiraConfigError('jira.apiToken 未配置')

  const jql = 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
  const url = baseUrl.replace(/\/+$/, '') + '/rest/api/3/search/jql'
    + '?jql=' + encodeURIComponent(jql)
    + '&fields=key,summary,issuetype,status&maxResults=50'
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64'),
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Jira API ${response.status} ${response.statusText}: ${detail.slice(0, 200)}`)
  }
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
      typeIconUrl: resolveIconUrl(
        baseUrl,
        typeof fields.issuetype?.iconUrl === 'string' ? fields.issuetype.iconUrl : undefined,
      ),
      statusName: typeof fields.status?.name === 'string' ? fields.status.name : '',
    }
  })
}

class JiraConfigError extends Error {
  readonly code = 'jira-not-configured'
}

function rpcFailure(code: string, message: string): ConnectionRpcResult<unknown> {
  return { ok: false, error: { code, message, details: {} } }
}

/**
 * 从工程根查找 jira.config.json（优先级高于 ctx.settings）。
 *
 * bundle 位于 <工程根>/lib/host.js；从 bundle 所在目录逐级向上找 jira.config.json，
 * 命中第一个即返回。开发时把真实 Jira 凭据放工程根的 jira.config.json（已 gitignore），
 * 正式部署不提供该文件时回退到 settings.yaml。
 */
function loadProjectJiraConfig(logger: { info: (message: string, ...args: unknown[]) => void; warn: (message: string, ...args: unknown[]) => void }): JiraSettings | null {
  const bundleDir = dirname(fileURLToPath(import.meta.url))
  let dir: string | undefined = bundleDir
  while (dir !== undefined && dir !== '/') {
    const candidate = join(dir, 'jira.config.json')
    try {
      const raw = readFileSync(candidate, 'utf8')
      const parsed = JSON.parse(raw) as Partial<JiraSettings>
      const settings: JiraSettings = {
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
        email: typeof parsed.email === 'string' ? parsed.email : undefined,
        apiToken: typeof parsed.apiToken === 'string' ? parsed.apiToken : undefined,
      }
      logger.info('jira config loaded from %s', candidate)
      return settings
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        // 本目录没有，向上一级继续
        dir = dirname(dir)
        continue
      }
      // 存在但读/解析失败：记录下来，继续向上找（或最终回退 settings）
      logger.warn('jira.config.json parse failed at %s: %s', candidate, String(error))
      dir = dirname(dir)
    }
  }
  return null
}

export function apply(ctx: Context): void {
  const logger = ctx.logger('hello-plugin')
  logger.info('host loaded')
  console.log('hello-plugin/host.js loaded')

  // ---- Jira 配置：工程根 jira.config.json 优先，其次 ctx.settings ----
  // 工程文件只在本仓库开发时存在（已 gitignore）；settings 服务来自 base profile
  // （settings-file），二者都没有时 Jira 端点返回「未配置」错误，插件其余功能
  // （ping）不受影响。
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

  // 注册 /hello 通道：/hello/ping 请求-响应 + /hello/jira/todos 待办列表。
  ctx.connection.rpc.handle('/hello', async (endpoint, payload): Promise<ConnectionRpcResult<unknown>> => {
    if (endpoint === 'ping') {
      const nameArg = (payload as { args?: { name?: unknown } } | undefined)?.args?.name
      const display = typeof nameArg === 'string' ? nameArg : '(anonymous)'
      logger.info('client ping:', display)
      return { ok: true, value: `pong from host, hello ${display}!` }
    }

    if (endpoint === 'jira/todos') {
      try {
        const todos = await fetchJiraTodos(resolveJiraSettings())
        return { ok: true, value: todos }
      } catch (error) {
        if (error instanceof JiraConfigError) {
          return rpcFailure(error.code, error.message)
        }
        logger.warn('jira/todos failed:', String(error))
        return rpcFailure('jira-error', `读取 Jira 待办失败：${String(error)}`)
      }
    }

    return rpcFailure('bad-request', `unknown endpoint: ${endpoint}`)
  })
}

export type { JiraTodo, JiraSettings }
