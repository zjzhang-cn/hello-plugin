import type { Context } from '@deepseek-ai/cordis'
import type { GoogleNewsItem } from './types'

/**
 * 抓取 Google News RSS 并解析为新闻列表（标题 + 链接 + 发布时间）。
 * Node 全局 fetch 可用（harness 无网络沙箱）；RSS 用正则做简易解析。
 */
export async function fetchGoogleNews(locale: string): Promise<GoogleNewsItem[]> {
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
  return items.slice(0, 15)
}

/**
 * 在 Agent 作用域内注册 google_news 工具。
 * 从 agentCtx 调用 ctx.tools.register 走 ScopedLayers —— 仅该会话的 Agent 可见，
 * 不污染全局工具表。agentCtx 的类型不含 tools 声明（core/tools 的模块扩展未引入），
 * 这里用结构化宽松类型直传（宿主 bundle dts: false，运行时无碍）。
 */
export function installGoogleNewsTool(agentCtx: Context): void {
  ;(agentCtx as unknown as { tools: { register(definition: object): () => void } }).tools.register({
    name: 'google_news',
    description: '获取 Google News 最新新闻列表（标题 + 链接 + 发布时间）。用于了解当前热点新闻。',
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
