import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { name } from './constants'
import type { LlmConfig, JiraIssueDetail } from './types'

/** 用 ctx.llm 对一段内容生成分析文本。 */
export async function generateLlmAnalysis(
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
