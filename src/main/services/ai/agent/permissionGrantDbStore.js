import crypto from 'crypto'
import {
  DEFAULT_AGENT_PERMISSION_GRANT_TTL_MS,
  isAgentPermissionGrantActive,
  normalizeAgentPermissionGrantContext,
  resolveAgentPermissionGrantContext
} from '../../../../shared/ai/permissions/ai-agent-permission-grant.js'

const readyDatabases = new WeakSet()

function assertDatabase(database) {
  if (
    !database ||
    typeof database !== 'object' ||
    typeof database.run !== 'function' ||
    typeof database.get !== 'function' ||
    typeof database.all !== 'function'
  ) {
    throw new Error('agent_permission_grant database is not available')
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

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function nowIso() {
  return new Date().toISOString()
}

function createGrantId() {
  if (typeof crypto.randomUUID === 'function') {
    return `agent_permission_grant:${crypto.randomUUID()}`
  }
  return `agent_permission_grant:${Date.now()}:${Math.random().toString(16).slice(2)}`
}

export function normalizeAgentPermissionGrantRow(row = null) {
  if (!row) return null
  return {
    id: toSafeText(row.id),
    gameId: toSafeText(row.game_id, '*'),
    source: toSafeText(row.source, '*'),
    operationType: toSafeText(row.operation_type),
    toolName: toSafeText(row.tool_name),
    permissionLevel: toSafeText(row.permission_level),
    dangerous: Number(row.dangerous) === 1,
    scope: toSafeText(row.scope),
    expiresAt: toSafeText(row.expires_at),
    revokedAt: toSafeText(row.revoked_at),
    createdAt: toSafeText(row.created_at),
    active: isAgentPermissionGrantActive(row)
  }
}

export function ensureAgentPermissionGrantSchemaForDatabase(database) {
  assertDatabase(database)
  if (readyDatabases.has(database)) return

  runSchema(
    database,
    `
    CREATE TABLE IF NOT EXISTS agent_permission_grant (
      id TEXT PRIMARY KEY,
      game_id TEXT DEFAULT '*',
      source TEXT DEFAULT '*',
      operation_type TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      permission_level TEXT,
      dangerous INTEGER DEFAULT 0,
      scope TEXT DEFAULT 'game',
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    )
  `
  )
  runSchema(
    database,
    `
    CREATE INDEX IF NOT EXISTS idx_agent_permission_grant_lookup
    ON agent_permission_grant(operation_type, game_id, source, expires_at)
  `
  )

  readyDatabases.add(database)
}

export function createAgentPermissionGrantInDatabase(database, payload = {}) {
  ensureAgentPermissionGrantSchemaForDatabase(database)
  const context = normalizeAgentPermissionGrantContext(payload.grantContext || payload)
  if (!context.toolName || !context.operationType) {
    return {
      success: false,
      errorCode: 'missing_permission_grant_context',
      message: '缺少授权工具或操作类型。'
    }
  }

  const createdAt = nowIso()
  const ttlMs = Math.max(
    60 * 1000,
    Math.min(
      30 * 24 * 60 * 60 * 1000,
      toSafeNumber(payload.ttlMs || payload.ttl_ms, DEFAULT_AGENT_PERMISSION_GRANT_TTL_MS)
    )
  )
  const expiresAt =
    toSafeText(payload.expiresAt || payload.expires_at) ||
    new Date(Date.now() + ttlMs).toISOString()
  const grant = {
    id: createGrantId(),
    gameId: context.gameId || '*',
    source: context.source || '*',
    operationType: context.operationType,
    toolName: context.toolName,
    permissionLevel: toSafeText(payload.permissionLevel || payload.permission_level),
    dangerous: payload.dangerous === true ? 1 : 0,
    scope: toSafeText(payload.scope, 'game') || 'game',
    expiresAt,
    createdAt
  }
  if (grant.scope === 'game' && grant.gameId === '*' && grant.source === '*') {
    return {
      success: false,
      errorCode: 'missing_permission_grant_scope',
      message: '缺少游戏或来源范围，未写入自动授权。'
    }
  }

  database.run(
    `
      INSERT INTO agent_permission_grant (
        id, game_id, source, operation_type, tool_name, permission_level, dangerous,
        scope, expires_at, revoked_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
    `,
    [
      grant.id,
      grant.gameId,
      grant.source,
      grant.operationType,
      grant.toolName,
      grant.permissionLevel,
      grant.dangerous,
      grant.scope,
      grant.expiresAt,
      grant.createdAt
    ]
  )

  return {
    success: true,
    grant: normalizeAgentPermissionGrantRow({
      id: grant.id,
      game_id: grant.gameId,
      source: grant.source,
      operation_type: grant.operationType,
      tool_name: grant.toolName,
      permission_level: grant.permissionLevel,
      dangerous: grant.dangerous,
      scope: grant.scope,
      expires_at: grant.expiresAt,
      revoked_at: '',
      created_at: grant.createdAt
    }),
    message: '已写入 Agent 自动授权。'
  }
}

export function createAgentPermissionGrantFromConfirmationInDatabase(database, payload = {}) {
  const confirmation = toPlainJson(payload.confirmation, {})
  const grantContext = resolveAgentPermissionGrantContext({
    confirmation,
    args: confirmation.args
  })
  return createAgentPermissionGrantInDatabase(database, {
    grantContext,
    permissionLevel: confirmation.permissionLevel,
    dangerous: confirmation.dangerous === true,
    scope: payload.scope || 'game',
    ttlMs: payload.ttlMs || DEFAULT_AGENT_PERMISSION_GRANT_TTL_MS
  })
}

export function findActiveAgentPermissionGrantInDatabase(database, payload = {}) {
  ensureAgentPermissionGrantSchemaForDatabase(database)
  const context = normalizeAgentPermissionGrantContext(payload.grantContext || payload)
  if (!context.operationType) return null

  const row = database.get(
    `
      SELECT *
      FROM agent_permission_grant
      WHERE revoked_at = ''
        AND operation_type = ?
        AND (game_id = ? OR game_id = '*')
        AND (source = ? OR source = '*')
        AND datetime(expires_at) > datetime('now')
      ORDER BY
        CASE WHEN game_id = ? THEN 0 ELSE 1 END,
        CASE WHEN source = ? THEN 0 ELSE 1 END,
        datetime(expires_at) DESC
      LIMIT 1
    `,
    [
      context.operationType,
      context.gameId || '*',
      context.source || '*',
      context.gameId || '*',
      context.source || '*'
    ]
  )
  return normalizeAgentPermissionGrantRow(row)
}

export function listAgentPermissionGrantsFromDatabase(database, payload = {}) {
  ensureAgentPermissionGrantSchemaForDatabase(database)
  const includeExpired = payload.includeExpired === true || payload.include_expired === true
  const rows = database.all(
    `
      SELECT *
      FROM agent_permission_grant
      WHERE (? = 1 OR (revoked_at = '' AND datetime(expires_at) > datetime('now')))
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `,
    [includeExpired ? 1 : 0, Math.max(1, Math.min(100, toSafeNumber(payload.limit, 50)))]
  )
  return {
    success: true,
    grants: rows.map((row) => normalizeAgentPermissionGrantRow(row))
  }
}

export function revokeAgentPermissionGrantInDatabase(database, payload = {}) {
  ensureAgentPermissionGrantSchemaForDatabase(database)
  const id = toSafeText(payload.id || payload.grantId || payload.grant_id)
  if (!id) {
    return {
      success: false,
      errorCode: 'missing_permission_grant_id',
      message: '缺少授权记录 ID。'
    }
  }
  const revokedAt = nowIso()
  const result = database.run(
    `
      UPDATE agent_permission_grant
      SET revoked_at = ?
      WHERE id = ?
    `,
    [revokedAt, id]
  )
  return {
    success: Number(result?.changes || 0) > 0,
    grantId: id,
    revokedAt,
    message: Number(result?.changes || 0) > 0 ? '已撤销 Agent 自动授权。' : '授权记录不存在。'
  }
}
