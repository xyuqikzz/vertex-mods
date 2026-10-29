function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = null) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function parseJsonCandidate(text = '', options = {}) {
  const source = toSafeText(text)
  const envelope = source.match(/^<vertex_tool_call>\s*([\s\S]*?)\s*<\/vertex_tool_call>$/)
  if (options.requireEnvelope && !envelope) return null
  return toPlainJson(envelope ? envelope[1] : source, null)
}

function normalizeArguments(value) {
  if (!value) return {}
  if (typeof value === 'string') {
    return toPlainJson(value, {})
  }
  return toPlainJson(value, {})
}

export function normalizeAiAgentToolCall(call = {}) {
  const source = call && typeof call === 'object' ? call : {}
  const name = toSafeText(source.name || source.tool || source.action || source.function?.name)
  if (!name) return null

  return {
    name,
    arguments: normalizeArguments(
      source.arguments || source.args || source.input || source.function?.arguments
    )
  }
}

export function parseAiAgentToolCalls(content = '', options = {}) {
  const payload = content && typeof content === 'object' ? content : parseJsonCandidate(content, options)
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.tool_calls)) return []
  return payload.tool_calls.map(normalizeAiAgentToolCall)
    .filter((call) => call && /^vertex\.[a-z0-9_.]+$/i.test(call.name))
}
