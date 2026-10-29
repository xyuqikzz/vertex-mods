import dbInstance from '../../dbInstance.js'

function toSafeNumber(value, defaultValue = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : defaultValue
}

function toSafeText(value, defaultValue = '') {
  const text = String(value ?? '').trim()
  return text || defaultValue
}

function normalizeDomainName(value, defaultValue = '') {
  const text = toSafeText(value, defaultValue)
  return text ? text.toLowerCase() : defaultValue
}

function normalizeRuleJsonText(ruleJson, defaultValue = '{}') {
  if (ruleJson && typeof ruleJson === 'object') {
    try {
      return JSON.stringify(ruleJson)
    } catch (error) {
      console.warn('[NEXUS-RULE-OVERRIDE] 规则对象序列化失败，使用默认值', error)
      return defaultValue
    }
  }

  const text = String(ruleJson ?? '').trim()
  if (!text) {
    return defaultValue
  }

  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

function normalizeRuleOverrideRecord(row = null) {
  if (!row || typeof row !== 'object') {
    return null
  }

  return {
    id: toSafeNumber(row.id, 0),
    nexusGameId: toSafeNumber(row.nexus_game_id, 0),
    gameId: toSafeNumber(row.game_id, 0),
    appId: toSafeNumber(row.app_id, 0),
    domainName: normalizeDomainName(row.domain_name),
    ruleVersion: toSafeNumber(row.rule_version, 0),
    ruleJson: toSafeText(row.rule_json, '{}'),
    baseRuleVersion: toSafeNumber(row.base_rule_version, 0),
    baseRuleJson: toSafeText(row.base_rule_json),
    dismissedRuleVersion: toSafeNumber(row.dismissed_rule_version, 0),
    dismissedRuleJson: toSafeText(row.dismissed_rule_json),
    sourceType: toSafeText(row.source_type, 'local_override'),
    createdAt: toSafeText(row.created_at),
    updatedAt: toSafeText(row.updated_at)
  }
}

function resolveTargetRecordByPayload(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const domainName = normalizeDomainName(safePayload.domainName)
  const nexusGameId = toSafeNumber(safePayload.nexusGameId, 0)

  if (domainName) {
    return dbInstance.get(
      `
        SELECT *
        FROM nexus_game_rule_override
        WHERE domain_name = ?
        LIMIT 1
      `,
      [domainName]
    )
  }

  if (nexusGameId > 0) {
    return dbInstance.get(
      `
        SELECT *
        FROM nexus_game_rule_override
        WHERE nexus_game_id = ?
        ORDER BY datetime(updated_at) DESC, id DESC
        LIMIT 1
      `,
      [nexusGameId]
    )
  }

  return null
}

export function getNexusGameRuleOverride(payload = {}) {
  return normalizeRuleOverrideRecord(resolveTargetRecordByPayload(payload))
}

export function upsertNexusGameRuleOverride(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const domainName = normalizeDomainName(safePayload.domainName)

  if (!domainName) {
    return {
      success: false,
      reason: 'invalid_payload',
      override: null
    }
  }

  const existingRecord = resolveTargetRecordByPayload({
    domainName,
    nexusGameId: safePayload.nexusGameId
  })
  const now = new Date().toISOString()

  const ruleVersion = toSafeNumber(safePayload.ruleVersion, 0)
  const ruleJsonText = normalizeRuleJsonText(safePayload.ruleJson)
  const baseRuleVersion = toSafeNumber(safePayload.baseRuleVersion, 0)
  const baseRuleJsonText = normalizeRuleJsonText(safePayload.baseRuleJson, '')
  const dismissedRuleVersion = toSafeNumber(safePayload.dismissedRuleVersion, 0)
  const dismissedRuleJsonText = normalizeRuleJsonText(safePayload.dismissedRuleJson, '')

  if (existingRecord?.id) {
    dbInstance.run(
      `
        UPDATE nexus_game_rule_override
        SET nexus_game_id = ?,
            game_id = ?,
            app_id = ?,
            domain_name = ?,
            rule_version = ?,
            rule_json = ?,
            base_rule_version = ?,
            base_rule_json = ?,
            dismissed_rule_version = ?,
            dismissed_rule_json = ?,
            source_type = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [
        toSafeNumber(safePayload.nexusGameId, existingRecord.nexus_game_id || 0),
        toSafeNumber(safePayload.gameId, existingRecord.game_id || 0),
        toSafeNumber(safePayload.appId, existingRecord.app_id || 0),
        domainName,
        ruleVersion,
        ruleJsonText,
        baseRuleVersion,
        baseRuleJsonText,
        dismissedRuleVersion,
        dismissedRuleJsonText,
        toSafeText(safePayload.sourceType, 'local_override'),
        now,
        existingRecord.id
      ]
    )
  } else {
    dbInstance.run(
      `
        INSERT INTO nexus_game_rule_override
          (
            nexus_game_id,
            game_id,
            app_id,
            domain_name,
            rule_version,
            rule_json,
            base_rule_version,
            base_rule_json,
            dismissed_rule_version,
            dismissed_rule_json,
            source_type,
            created_at,
            updated_at
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        toSafeNumber(safePayload.nexusGameId, 0),
        toSafeNumber(safePayload.gameId, 0),
        toSafeNumber(safePayload.appId, 0),
        domainName,
        ruleVersion,
        ruleJsonText,
        baseRuleVersion,
        baseRuleJsonText,
        dismissedRuleVersion,
        dismissedRuleJsonText,
        toSafeText(safePayload.sourceType, 'local_override'),
        now,
        now
      ]
    )
  }

  return {
    success: true,
    reason: existingRecord?.id ? 'updated' : 'inserted',
    override: getNexusGameRuleOverride({
      domainName,
      nexusGameId: toSafeNumber(safePayload.nexusGameId, 0)
    })
  }
}

export function acknowledgeNexusGameRuleOverrideUpdate(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  const domainName = normalizeDomainName(safePayload.domainName)

  if (!domainName) {
    return {
      success: false,
      reason: 'invalid_payload',
      override: null
    }
  }

  const existingRecord = resolveTargetRecordByPayload({
    domainName,
    nexusGameId: safePayload.nexusGameId
  })

  if (!existingRecord?.id) {
    return {
      success: false,
      reason: 'override_not_found',
      override: null
    }
  }

  const now = new Date().toISOString()
  dbInstance.run(
    `
      UPDATE nexus_game_rule_override
      SET dismissed_rule_version = ?,
          dismissed_rule_json = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [
      toSafeNumber(safePayload.dismissedRuleVersion, 0),
      normalizeRuleJsonText(safePayload.dismissedRuleJson, ''),
      now,
      existingRecord.id
    ]
  )

  return {
    success: true,
    reason: 'acknowledged',
    override: getNexusGameRuleOverride({
      domainName,
      nexusGameId: toSafeNumber(safePayload.nexusGameId, 0)
    })
  }
}
