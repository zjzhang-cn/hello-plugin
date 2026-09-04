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
	// 检查 llm 服务是否可用
	const llm = ctx.get('llm')
	if (llm === undefined) throw new Error('llm 服务不可用（宿主未挂载 llm）')
	if (llmConfig.provider === undefined || llmConfig.model === undefined) {
		throw new Error('llm.config.json 未配置 provider/model')
	}
	// 生成 prompt，包含 issue 的 key、summary、descriptionText 和 commentsText
	const prompt = [
		`Jira issue ${issue.key}：${issue.summary}`,
		``,
		issue.descriptionText !== '' ? `描述：\n${issue.descriptionText}` : '描述：（无）',
		issue.commentsText !== '' ? `已有评论：\n${issue.commentsText}` : '已有评论：（无）',
	].join('\n')
	// 调用 llm.stream 进行流式调用，传入 provider、model、messages、system、maxTokens 和 signal
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
	// 使用 for-await-of 循环处理 llm.stream 返回的异步迭代器，逐块推送到 assembler
	for await (const chunk of llm.stream(options)) {
		signal.throwIfAborted()
		assembler.push(chunk)
	}
	const finish = assembler.finish
	// 检查 finish.kind 是否为 'error' 或 'aborted'，如果是，则抛出错误
	if (finish.kind === 'error' || finish.kind === 'aborted') {
		throw new Error(`LLM 调用失败：${finish.failure?.message ?? String(finish.failure)}`)
	}
	// 拼装并提取文本块，
	const text = assembler.blocks()
		.filter((block) => block.type === 'text')
		.map((block) => block.type === 'text' ? block.text : '')
		.join(' ')
		.trim()
	if (text === '') throw new Error('LLM 未返回有效内容')
	return text
}
