import { buildAiAgentToolResultSummary } from '../../../../shared/ai/tools/ai-agent-tool-loop.js'
import { AI_AGENT_DEFAULT_CONTEXT_WINDOW_TOKENS } from '../../../../shared/ai/config/ai-agent-definition.js'

export function estimateRequestTokens(request) {
  // Conservative estimate for mixed Chinese, JSON and source text; not a tokenizer claim.
  // ASCII JSON/English averages 3-4 characters per token and CJK about one token per character.
  // The previous bytes/2 rule counted the ASCII tool schemas twice over, so the default window
  // was already full before the page context was added.
  const text = JSON.stringify(request)
  let ascii = 0
  let other = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 3 + other * 1.2)
}

export function fitAgentContext(request, contextWindowTokens = AI_AGENT_DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const window =
    Number.isInteger(contextWindowTokens) && contextWindowTokens >= 4096
      ? contextWindowTokens
      : AI_AGENT_DEFAULT_CONTEXT_WINDOW_TOKENS
  const reserve = Math.min(4096, Math.floor(window / 4))
  const budget = window - reserve
  const messages = request.messages
  let tokens = estimateRequestTokens(request)
  if (tokens <= budget) return { fits: true, tokens, budget }
  // 当前用户请求和最新一整批调用/结果必须保留。只保护最后一条会丢掉同批较早的详情，
  // 导致模型反复读取刚被压缩掉的正文。原生协议的思考内容与调用配对也不能改写。
  const latestCallIndex = messages.findLastIndex(
    (message) => message.role === 'assistant' && message.tool_calls?.length
  )
  const latestFeedbackIndex = messages.findLastIndex(
    (message) => message.role === 'assistant' && /"_vertexToolResults"\s*:/.test(message.content || '')
  )
  const latestBatchStart = latestCallIndex >= 0 && latestCallIndex > latestFeedbackIndex
    ? latestCallIndex
    : latestFeedbackIndex >= 0 ? latestFeedbackIndex : messages.length - 1
  // Keep call/result pairing and identifiers; compact complete JSON, never a partial document.
  for (let index = 1; index < latestBatchStart && tokens > budget; index += 1) {
    const message = messages[index]
    if (!['tool', 'assistant'].includes(message.role) || message.content?.length < 1200) continue
    try {
      const data = JSON.parse(message.content)
      if (message.role === 'assistant') {
        if (!Array.isArray(data._vertexToolResults)) continue
        message.content = JSON.stringify({
          dataOnly: true,
          _vertexToolResults: data._vertexToolResults.map((entry) => ({
            ...buildAiAgentToolResultSummary(entry),
            name: entry.name,
            result: buildAiAgentToolResultSummary(entry.result),
            contextCompacted: true
          }))
        })
      } else {
        message.content = JSON.stringify({
          ...buildAiAgentToolResultSummary(data),
          contextCompacted: true
        })
      }
    } catch {
      continue
    }
    tokens = estimateRequestTokens(request)
  }
  // 先释放旧对话轮次，避免携带数轮重复的安装说明却丢掉当前证据。
  // 保留最早用户约束和当前请求；按完整轮次移除，不能留下孤立的 tool 消息。
  while (tokens > budget) {
    const userIndices = messages.flatMap((message, index) => message.role === 'user' ? [index] : [])
    if (userIndices.length < 3) break
    const start = userIndices[1]
    const end = userIndices[2]
    messages.splice(start, end - start)
    tokens = estimateRequestTokens(request)
  }
  return { fits: tokens <= budget, tokens, budget }
}
