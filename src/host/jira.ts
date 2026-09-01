import { ISSUE_TYPE_COLORS, FALLBACK_COLORS } from './constants'
import { JiraConfigError } from './errors'
import type { JiraSettings, JiraTodo, JiraIssueDetail } from './types'

function colorForIssueType(name: string): string {
  const exact = ISSUE_TYPE_COLORS[name]
  if (exact !== undefined) return exact
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
  return baseUrl.replace(/\/+$/, '') + (iconUrl.startsWith('/') ? iconUrl : '/' + iconUrl)
}

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

/** 把 Jira 的 ADF（Atlassian Document Format）节点递归转成纯文本。 */
function adfToText(node: unknown): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map((item) => adfToText(item)).join('\n')
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') return record.text
    if (record.type === 'hardBreak') return '\n'
    if (Array.isArray(record.content)) return adfToText(record.content)
    return ''
  }
  return ''
}

/** 调用 Jira REST API 读取指派给当前用户的未解决 issue（待办）。 */
export async function fetchJiraTodos(settings: JiraSettings): Promise<JiraTodo[]> {
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
export async function fetchJiraIssueDetail(settings: JiraSettings, key: string): Promise<JiraIssueDetail> {
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
export async function addJiraComment(settings: JiraSettings, key: string, text: string): Promise<void> {
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

/** 通过 JQL 搜索 issues。 */
export async function searchJiraIssues(settings: JiraSettings, jql: string): Promise<JiraTodo[]> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
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

/** 创建 Jira issue。 */
export async function createJiraIssue(
  settings: JiraSettings,
  { project, summary, description, issueType }: { project: string; summary: string; description?: string; issueType?: string },
): Promise<{ key: string }> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
  const url = `${baseUrl}/rest/api/3/issue`
  const body = {
    fields: {
      project: { key: project },
      summary,
      issuetype: { name: issueType ?? 'Task' },
      description: description
        ? {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
          }
        : undefined,
    },
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...jiraHeaders(settings), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw await jiraApiError(response)
  const result = await response.json() as { key?: unknown }
  return { key: typeof result.key === 'string' ? result.key : '' }
}

/** 获取 issue 可执行的状态变更列表。 */
export async function getJiraTransitions(settings: JiraSettings, key: string): Promise<Array<{ id: string; name: string }>> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
  const response = await fetch(url, { headers: jiraHeaders(settings), signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw await jiraApiError(response)
  const body = await response.json() as {
    transitions?: Array<{ id?: unknown; name?: unknown }>
  }
  const transitions = body.transitions ?? []
  return transitions
    .filter((t) => typeof t.id === 'string' && typeof t.name === 'string')
    .map((t) => ({ id: t.id as string, name: t.name as string }))
}

/** 执行 issue 状态变更。 */
export async function transitionJiraIssue(settings: JiraSettings, key: string, transitionId: string): Promise<void> {
  assertJiraSettings(settings)
  const baseUrl = jiraBaseUrl(settings)
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
  const body = { transition: { id: transitionId } }
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...jiraHeaders(settings), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw await jiraApiError(response)
}
