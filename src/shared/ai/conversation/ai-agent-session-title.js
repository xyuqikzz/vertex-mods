export const DEFAULT_AI_AGENT_SESSION_TITLE = '新对话'
export const AI_AGENT_SESSION_TITLE_MAX_LENGTH = 18

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function isDefaultAiAgentSessionTitle(value = '') {
  const title = toSafeText(value)
  return !title || title === DEFAULT_AI_AGENT_SESSION_TITLE
}

export function normalizeAiAgentSessionTitle(
  value = '',
  fallback = DEFAULT_AI_AGENT_SESSION_TITLE
) {
  const safeFallback = toSafeText(fallback)
  let title = toSafeText(value)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)[0]

  title = toSafeText(title)
    .replace(/^[-*#\s]+/, '')
    .replace(/^(?:对话标题|会话标题|对话名称|会话名称|标题|名称)\s*[:：]\s*/i, '')
    .replace(/^[-*#"'“”‘’`【[(（\s]+|[-*#"'“”‘’`】\])）\s]+$/g, '')
    .replace(/[。.!！?？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!title) return safeFallback
  return title.length > AI_AGENT_SESSION_TITLE_MAX_LENGTH
    ? `${title.slice(0, AI_AGENT_SESSION_TITLE_MAX_LENGTH)}...`
    : title
}
