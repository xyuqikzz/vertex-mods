import crypto from 'crypto'
import dbInstance from '../../dbInstance.js'

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

// 计算规则 JSON 的 SHA-256 校验和，用于读取时校验完整性（B1）。
function computeRuleChecksum(ruleJsonText = '') {
  return crypto.createHash('sha256').update(String(ruleJsonText || ''), 'utf8').digest('hex')
}

// 由来源类型推导信任级别：本地自定义 -> user；服务器/社区下发 -> community；暂无 official（待签名基础设施）。
function deriveRuleTrustLevel(sourceType = '') {
  const text = String(sourceType || '').trim().toLowerCase()
  if (['local', 'user', 'local_override', 'self', 'custom'].includes(text)) return 'user'
  if (['official', 'signed', 'verified', 'trusted'].includes(text)) return 'official'
  return 'community'
}

let nexusRuleTrustColumnsEnsured = false
// 幂等补齐 rule_checksum / trust_level 两列；失败必须中止，避免继续执行依赖新列的 SQL。
function ensureNexusRuleTrustColumns() {
  if (nexusRuleTrustColumnsEnsured) return
  if (!dbInstance.tableExists('nexus_game_rule')) {
    return
  }
  try {
    const columns = dbInstance.all(`PRAGMA table_info(nexus_game_rule)`).map((item) => item.name)
    let changed = false
    if (!columns.includes('rule_checksum')) {
      dbInstance.run(`ALTER TABLE nexus_game_rule ADD COLUMN rule_checksum TEXT`)
      changed = true
    }
    if (!columns.includes('trust_level')) {
      dbInstance.run(`ALTER TABLE nexus_game_rule ADD COLUMN trust_level TEXT`)
      changed = true
    }
    if (changed && typeof dbInstance.clearStatementCache === 'function') {
      dbInstance.clearStatementCache()
    }
    nexusRuleTrustColumnsEnsured = true
  } catch (error) {
    throw new Error(`nexus_game_rule 信任列初始化失败：${error?.message || error}`)
  }
}

function normalizeRuleJsonText(ruleJson) {
  if (ruleJson && typeof ruleJson === 'object') {
    try {
      return JSON.stringify(ruleJson)
    } catch (error) {
      console.warn('[NEXUS-RULE] 规则对象序列化失败，使用空对象', error)
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
  const ruleJson = toSafeText(row.rule_json, '{}')
  const storedChecksum = toSafeText(row.rule_checksum)
  const actualChecksum = computeRuleChecksum(ruleJson)
  // 完整性校验：存在历史校验和但与当前内容不一致 -> 视为被篡改，信任级别降级为 community（不可信）。
  const checksumValid = !storedChecksum || storedChecksum === actualChecksum
  const declaredTrust = toSafeText(row.trust_level) || deriveRuleTrustLevel(toSafeText(row.source_type))
  const trustLevel = checksumValid ? declaredTrust : 'community'
  return {
    id: toSafeNumber(row.id, 0),
    nexusGameId: toSafeNumber(row.nexus_game_id, 0),
    gameId: toSafeNumber(row.game_id, 0),
    domainName: toSafeText(row.domain_name),
    ruleVersion: toSafeNumber(row.rule_version, 0),
    ruleJson,
    sourceType: toSafeText(row.source_type),
    ruleChecksum: storedChecksum,
    checksumValid,
    trustLevel,
    createdAt: toSafeText(row.created_at),
    updatedAt: toSafeText(row.updated_at)
  }
}

export function getLatestNexusGameRuleByNexusGameId(nexusGameId) {
  const safeNexusGameId = toSafeNumber(nexusGameId, 0)
  if (!safeNexusGameId) return null

  ensureNexusRuleTrustColumns()
  const sql = `
    SELECT id,
           nexus_game_id,
           game_id,
           domain_name,
           rule_version,
           rule_json,
           source_type,
           rule_checksum,
           trust_level,
           created_at,
           updated_at
    FROM nexus_game_rule
    WHERE nexus_game_id = ?
    ORDER BY rule_version DESC, id DESC
    LIMIT 1
  `
  const row = dbInstance.get(sql, [safeNexusGameId])
  return normalizeRuleRecord(row)
}

export function saveNexusGameRuleIfNewer(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const nexusGameId = toSafeNumber(safePayload.nexusGameId, 0)
  const ruleVersion = toSafeNumber(safePayload.ruleVersion, 0)

  if (!nexusGameId || !ruleVersion) {
    return {
      success: false,
      saved: false,
      reason: 'invalid_payload',
      latest: getLatestNexusGameRuleByNexusGameId(nexusGameId)
    }
  }

  const latest = getLatestNexusGameRuleByNexusGameId(nexusGameId)
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
  const domainName = toSafeText(safePayload.domainName)
  const ruleJsonText = normalizeRuleJsonText(safePayload.ruleJson)
  const sourceType = toSafeText(safePayload.sourceType, 'server')
  const ruleChecksum = computeRuleChecksum(ruleJsonText)
  const trustLevel = deriveRuleTrustLevel(sourceType)

  ensureNexusRuleTrustColumns()
  const sql = `
    INSERT INTO nexus_game_rule
      (nexus_game_id, game_id, domain_name, rule_version, rule_json, source_type,
       rule_checksum, trust_level, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  dbInstance.run(sql, [
    nexusGameId,
    gameId,
    domainName,
    ruleVersion,
    ruleJsonText,
    sourceType,
    ruleChecksum,
    trustLevel,
    now,
    now
  ])

  return {
    success: true,
    saved: true,
    reason: 'saved_newer',
    latest: getLatestNexusGameRuleByNexusGameId(nexusGameId)
  }
}
