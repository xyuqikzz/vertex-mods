export const AI_AGENT_TOOL_LOG_LIST_CHANNEL = 'agent-tool-log:list'
export const AI_AGENT_TOOL_LOG_DEFAULT_LIMIT = 50
export const AI_AGENT_TOOL_LOG_MAX_LIMIT = 100

function toPlainObject(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    const parsed = typeof text === 'undefined' ? fallback : JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function toSafeText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function normalizeLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return AI_AGENT_TOOL_LOG_DEFAULT_LIMIT
  return Math.max(1, Math.min(AI_AGENT_TOOL_LOG_MAX_LIMIT, Math.floor(number)))
}

export function normalizeAgentToolLogListPayload(payload = {}) {
  const source = toPlainObject(payload, {})
  return {
    limit: normalizeLimit(source.limit),
    executionId: toSafeText(source.executionId, source.execution_id),
    sessionId: toSafeText(source.sessionId, source.session_id),
    taskId: toSafeText(source.taskId, source.task_id),
    toolName: toSafeText(source.toolName, source.tool_name),
    resultStatus: toSafeText(source.resultStatus, source.result_status, source.status)
  }
}

export function buildAgentToolLogListQuery(payload = {}) {
  const options = normalizeAgentToolLogListPayload(payload)
  const clauses = []
  const params = []
  const filterMap = [
    ['execution_id', options.executionId],
    ['session_id', options.sessionId],
    ['task_id', options.taskId],
    ['tool_name', options.toolName],
    ['result_status', options.resultStatus]
  ]

  for (const [column, value] of filterMap) {
    if (!value) continue
    clauses.push(`${column} = ?`)
    params.push(value)
  }

  const whereClause = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
  return {
    options,
    sql: `SELECT * FROM agent_tool_call_log${whereClause} ORDER BY id DESC LIMIT ?`,
    params: [...params, options.limit]
  }
}
