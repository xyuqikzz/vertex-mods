import { buildAgentToolLogListQuery } from '../../../../shared/ai/tools/ai-agent-tool-log.js'

const MAX_DIGEST_LENGTH = 2000
const SENSITIVE_KEY_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session(?!_?ids?$))/i
const SENSITIVE_URL_PARAM_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session|access.?token|refresh.?token|signature|credential|policy|expires|key.?pair.?id|^key$|^sig$)/i
const INLINE_URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/gi
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi
const PRIVATE_PATH_LIST_KEY_PATTERN = /(private.?paths?|path.?list|paths?)/i
const readyDatabases = new WeakSet()

function assertDatabase(database) {
  if (!database || typeof database !== 'object' || typeof database.run !== 'function') {
    throw new Error('agent_tool_call_log database is not available')
  }
}

function clearStatementCache(database) {
  if (typeof database.clearStatementCache === 'function') {
    database.clearStatementCache()
  }
}

function runSchema(database, sql, params = []) {
  clearStatementCache(database)
  const result = database.run(sql, params)
  clearStatementCache(database)
  return result
}

function sanitizeUrlHashValue(hash = '') {
  const text = String(hash || '')
  if (!text || !SENSITIVE_URL_PARAM_PATTERN.test(text)) return hash

  const body = text.startsWith('#') ? text.slice(1) : text
  if (!body) return '#[redacted]'

  const questionIndex = body.indexOf('?')
  if (questionIndex < 0 && body.startsWith('/')) return '#[redacted]'

  const prefix = questionIndex >= 0 ? body.slice(0, questionIndex) : ''
  const queryText = questionIndex >= 0 ? body.slice(questionIndex + 1) : body
  if (!queryText || (!queryText.includes('=') && !queryText.includes('&'))) {
    return '#[redacted]'
  }

  const params = new URLSearchParams(queryText)
  let changed = false
  for (const key of [...params.keys()]) {
    const value = params.get(key)
    if (SENSITIVE_URL_PARAM_PATTERN.test(key) || SENSITIVE_URL_PARAM_PATTERN.test(value || '')) {
      params.set(key, '[redacted]')
      changed = true
    }
  }
  if (!changed) return '#[redacted]'

  const nextQuery = params.toString()
  return `#${prefix ? `${prefix}?` : ''}${nextQuery}`
}

function sanitizeUrlText(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl)
    let changed = false
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAM_PATTERN.test(key)) {
        parsed.searchParams.set(key, '[redacted]')
        changed = true
      }
    }
    if (parsed.hash && SENSITIVE_URL_PARAM_PATTERN.test(parsed.hash)) {
      parsed.hash = sanitizeUrlHashValue(parsed.hash)
      changed = true
    }
    return changed ? parsed.toString() : rawUrl
  } catch {
    return rawUrl
  }
}

function stripSensitiveText(value = '') {
  const text = String(value ?? '')
  if (/^https?:\/\//i.test(text)) {
    return sanitizeUrlText(text)
  }

  const urlReplacements = []
  let sanitized = text.replace(INLINE_URL_PATTERN, (matched) => {
    const placeholder = `__VERTEX_SAFE_LOG_URL_${urlReplacements.length}__`
    urlReplacements.push([placeholder, sanitizeUrlText(matched)])
    return placeholder
  })
  sanitized = sanitized
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
  for (const [placeholder, sanitizedUrl] of urlReplacements) {
    sanitized = sanitized.replace(placeholder, sanitizedUrl)
  }
  return sanitized
}

function stripSensitive(value, depth = 0) {
  if (depth > 4) return undefined
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => stripSensitive(item, depth + 1))
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      return stripSensitiveText(value)
    }
    return value
  }
  return Object.entries(value).reduce((result, [key, item]) => {
    if (key === 'scriptContent' || SENSITIVE_KEY_PATTERN.test(key) || PRIVATE_PATH_LIST_KEY_PATTERN.test(key)) {
      return result
    }
    const normalized = stripSensitive(item, depth + 1)
    if (typeof normalized !== 'undefined') {
      result[key] = normalized
    }
    return result
  }, {})
}

function toDigest(value) {
  try {
    const text = JSON.stringify(stripSensitive(value)) || ''
    return text.length > MAX_DIGEST_LENGTH ? `${text.slice(0, MAX_DIGEST_LENGTH)}...` : text
  } catch {
    return ''
  }
}

function toDurationMs(value) {
  const duration = Number(value)
  return Number.isFinite(duration) ? Math.max(0, Math.floor(duration)) : 0
}

function toLogText(value = '') {
  return String(value ?? '').trim().slice(0, 200)
}

function toLogFlag(value) {
  return value === true ? 1 : 0
}

function readTableColumns(database) {
  if (!database || typeof database.all !== 'function') return new Set()
  return new Set(database.all(`PRAGMA table_info(agent_tool_call_log)`).map((column) => column.name))
}

function ensureColumn(database, columns, name, definition) {
  if (columns.has(name)) return
  runSchema(database, `ALTER TABLE agent_tool_call_log ADD COLUMN ${name} ${definition}`)
  columns.add(name)
}

export function ensureAgentToolCallLogTable(database) {
  assertDatabase(database)
  if (readyDatabases.has(database)) return

  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS agent_tool_call_log
    (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       TEXT NOT NULL DEFAULT '',
      execution_id     TEXT NOT NULL DEFAULT '',
      task_id          TEXT NOT NULL DEFAULT '',
      tool_name        TEXT NOT NULL,
      permission_level TEXT NOT NULL DEFAULT '',
      dangerous        INTEGER NOT NULL DEFAULT 0,
      permission_mode  TEXT NOT NULL DEFAULT '',
      requires_confirmation TEXT NOT NULL DEFAULT '',
      permission_reason TEXT NOT NULL DEFAULT '',
      confirmation_required INTEGER NOT NULL DEFAULT 0,
      args_digest      TEXT NOT NULL DEFAULT '',
      result_status    TEXT NOT NULL DEFAULT '',
      result_digest    TEXT NOT NULL DEFAULT '',
      duration_ms      INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL
    );
  `
  )

  const columns = readTableColumns(database)
  ensureColumn(database, columns, 'permission_mode', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, columns, 'requires_confirmation', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, columns, 'permission_reason', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, columns, 'confirmation_required', `INTEGER NOT NULL DEFAULT 0`)

  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_agent_tool_call_log_execution
    ON agent_tool_call_log (execution_id, id);
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_agent_tool_call_log_tool
    ON agent_tool_call_log (tool_name, created_at);
  `
  )

  readyDatabases.add(database)
}

export function logAgentToolCallToDatabase(database, entry = {}) {
  ensureAgentToolCallLogTable(database)
  return database.run(
    `INSERT INTO agent_tool_call_log
      (session_id, execution_id, task_id, tool_name, permission_level, dangerous,
       permission_mode, requires_confirmation, permission_reason, confirmation_required,
       args_digest, result_status, result_digest, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(entry.sessionId || ''),
      String(entry.executionId || ''),
      String(entry.taskId || ''),
      String(entry.toolName || ''),
      String(entry.permissionLevel || ''),
      entry.dangerous ? 1 : 0,
      toLogText(entry.permissionMode || entry.mode),
      toLogText(entry.requiresConfirmation),
      toLogText(entry.permissionReason || entry.reason),
      toLogFlag(entry.confirmationRequired),
      toDigest(entry.args),
      String(entry.resultStatus || ''),
      toDigest(entry.result),
      toDurationMs(entry.durationMs),
      new Date().toISOString()
    ]
  )
}

export function listAgentToolCallLogsFromDatabase(database, options = {}) {
  ensureAgentToolCallLogTable(database)
  const query = buildAgentToolLogListQuery(options)
  return database.all(query.sql, query.params)
}
