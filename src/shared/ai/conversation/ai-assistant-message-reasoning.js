const THINK_OPEN_TAG_PATTERN = /^\s*<think(?:\s[^>]*)?>/i
const THINK_CLOSE_TAG_PATTERN = /<\/think\s*>/i

export function splitAiAssistantReasoningContent(value = '') {
  const content = String(value ?? '')
  const openTagMatch = content.match(THINK_OPEN_TAG_PATTERN)

  if (!openTagMatch) {
    return {
      answerContent: content.trim(),
      reasoningContent: '',
      hasReasoning: false,
      reasoningPending: false
    }
  }

  const contentAfterOpenTag = content.slice(openTagMatch[0].length)
  const closeTagMatch = contentAfterOpenTag.match(THINK_CLOSE_TAG_PATTERN)

  if (!closeTagMatch || typeof closeTagMatch.index !== 'number') {
    return {
      answerContent: '',
      reasoningContent: contentAfterOpenTag.trim(),
      hasReasoning: true,
      reasoningPending: true
    }
  }

  const closeTagStart = closeTagMatch.index
  const answerStart = closeTagStart + closeTagMatch[0].length
  return {
    answerContent: contentAfterOpenTag.slice(answerStart).trim(),
    reasoningContent: contentAfterOpenTag.slice(0, closeTagStart).trim(),
    hasReasoning: true,
    reasoningPending: false
  }
}
