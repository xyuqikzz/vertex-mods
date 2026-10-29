import dbInstance from '../../dbInstance.js'

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function normalizeRuleJsonText(ruleJson) {
  if (ruleJson && typeof ruleJson === 'object') {
    try {
      return JSON.stringify(ruleJson)
    } catch (error) {
      console.warn('[MODIO-RULE] 规则对象序列化失败，使用空对象', error)
      return '{}'
    }
  }

  const text = toSafeText(ruleJson, '{}')
  if (!text) {
    return '{}'
  }
  return text
}

function normalizeRuleRecord(row = null) {
  if (!row || typeof row !== 'object') return null
  return {
    id: toSafeNumber(row.id, 0),
    modioGameId: toSafeNumber(row.modio_game_id, 0),
    gameId: toSafeNumber(row.game_id, 0),
    nameId: toSafeText(row.name_id),
    ruleVersion: toSafeNumber(row.rule_version, 0),
    ruleJson: toSafeText(row.rule_json, '{}'),
    sourceType: toSafeText(row.source_type),
    createdAt: toSafeText(row.created_at),
    updatedAt: toSafeText(row.updated_at)
  }
}

export function ensureModioGameRuleTable() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS modio_game_rule
    (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      modio_game_id INTEGER NOT NULL,
      game_id       INTEGER DEFAULT 0,
      name_id       TEXT    DEFAULT '',
      rule_version  INTEGER NOT NULL,
      rule_json     TEXT    NOT NULL DEFAULT '{}',
      source_type   TEXT    NOT NULL DEFAULT 'server',
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (modio_game_id, rule_version)
    );
  `)

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_modio_game_rule_latest
    ON modio_game_rule (modio_game_id, rule_version);
  `)
}

export function getLatestModioGameRuleByModioGameId(modioGameId) {
  const safeModioGameId = toSafeNumber(modioGameId, 0)
  if (!safeModioGameId) return null

  ensureModioGameRuleTable()

  const sql = `
    SELECT id,
           modio_game_id,
           game_id,
           name_id,
           rule_version,
           rule_json,
           source_type,
           created_at,
           updated_at
    FROM modio_game_rule
    WHERE modio_game_id = ?
    ORDER BY rule_version DESC, id DESC
    LIMIT 1
  `
  const row = dbInstance.get(sql, [safeModioGameId])
  return normalizeRuleRecord(row)
}

export function saveModioGameRuleIfNewer(payload = {}) {
  ensureModioGameRuleTable()

  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const modioGameId = toSafeNumber(safePayload.modioGameId, 0)
  const ruleVersion = toSafeNumber(safePayload.ruleVersion, 0)

  if (!modioGameId || !ruleVersion) {
    return {
      success: false,
      saved: false,
      reason: 'invalid_payload',
      latest: getLatestModioGameRuleByModioGameId(modioGameId)
    }
  }

  const latest = getLatestModioGameRuleByModioGameId(modioGameId)
  if (latest && toSafeNumber(latest.ruleVersion, 0) >= ruleVersion) {
    return {
      success: true,
      saved: false,
      reason: 'not_newer',
      latest
    }
  }

  const now = new Date().toISOString()
  const gameId = toSafeNumber(safePayload.gameId, 0)
  const nameId = toSafeText(safePayload.nameId)
  const ruleJsonText = normalizeRuleJsonText(safePayload.ruleJson)
  const sourceType = toSafeText(safePayload.sourceType, 'server')

  const sql = `
    INSERT INTO modio_game_rule
      (modio_game_id, game_id, name_id, rule_version, rule_json, source_type, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `
  dbInstance.run(sql, [
    modioGameId,
    gameId,
    nameId,
    ruleVersion,
    ruleJsonText,
    sourceType,
    now,
    now
  ])

  return {
    success: true,
    saved: true,
    reason: 'saved_newer',
    latest: getLatestModioGameRuleByModioGameId(modioGameId)
  }
}
