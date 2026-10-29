import { isLegacySource, listLegacySourceMods } from '../sources/legacySourceRecords.js'
import dbInstance from '../dbInstance.js'
import { MOD_LIST_ORDER_SQL } from '../mods/modDeployment.js'

function toSafeText(value) {
  return String(value || '').trim()
}

function normalizeSourceMeta(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  return {
    source: toSafeText(target.source).toLowerCase(),
    sourceId: toSafeText(target.sourceId ?? target.source_id ?? target.id ?? target.community),
    sourceSlug: toSafeText(target.sourceSlug ?? target.source_slug ?? target.community),
    appId: toSafeText(target.appId ?? target.app_id ?? target.steamAppId ?? target.steam_app_id)
  }
}

function findGameRow(appId, sourceMeta = {}) {
  const normalized = normalizeSourceMeta(sourceMeta)
  const appIdText = toSafeText(appId)
  const conditions = []
  const params = []
  const hasExplicitSource = !!normalized.source

  if (normalized.source && normalized.sourceId) {
    conditions.push('(source = ? AND source_id = ?)')
    params.push(normalized.source, normalized.sourceId)
  }

  if (normalized.source && normalized.sourceSlug) {
    conditions.push('(source = ? AND source_slug = ?)')
    params.push(normalized.source, normalized.sourceSlug)
  }

  if (normalized.source && (normalized.appId || appIdText)) {
    conditions.push('(source = ? AND app_id = ?)')
    params.push(normalized.source, normalized.appId || appIdText)
  }

  if (!hasExplicitSource && appIdText) {
    conditions.push('(app_id = ?)')
    params.push(appIdText)
  }

  if (!conditions.length) {
    return null
  }

  const result = dbInstance.get(
    `SELECT *
     FROM games
     WHERE ${conditions.join(' OR ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    params
  )
  // 精确身份优先；仅在没有精确记录时读取另一种历史别名，不改写数据库。
  if (!result && !sourceMeta.legacyAliasFallback && isLegacySource(normalized.source)) {
    return findGameRow(appId, { ...sourceMeta, source: normalized.source === 'server' ? 'vertex' : 'server', legacyAliasFallback: true })
  }
  return result
}

function buildGameProjectionSql(whereClause = '', params = []) {
  return dbInstance.all(
    `
      SELECT
        g.*,
        g.id AS source_row_id,
        g.name AS chineseTitle,
        g.english_name AS englishTitle,
        g.cover_image AS coverImage,
        g.background_image AS backgroundImage,
        COALESCE(SUM(CASE WHEN m.endpoint_type = 0 THEN 1 ELSE 0 END), 0) AS clientModCount,
        COALESCE(SUM(CASE WHEN m.endpoint_type = 1 THEN 1 ELSE 0 END), 0) AS serverModCount
      FROM games g
      LEFT JOIN mods m ON m.game_id = g.id
      ${whereClause}
      GROUP BY g.id
      ORDER BY datetime(g.updated_at) DESC, g.id DESC
    `,
    params
  )
}

export function updateServerPath(id, path = '', sourceMeta = {}) {
  const game = findGameRow(id, sourceMeta)
  if (!game) {
    return { changes: 0, lastInsertRowid: 0 }
  }
  const num = path === '' ? 0 : 1
  return dbInstance.run(
    `
      UPDATE games
      SET is_server_installed = ?,
          server_exe_path = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [num, String(path || ''), game.id]
  )
}

export function getGameDataByAppId(appId, sourceMeta = {}) {
  return findGameRow(appId, sourceMeta)
}

export function updateGameServerModTypeByAppId(appId, type, sourceMeta = {}) {
  const game = findGameRow(appId, sourceMeta)
  if (!game) {
    return { changes: 0, lastInsertRowid: 0 }
  }
  return dbInstance.run(
    `
      UPDATE games
      SET server_install_mod_type = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [Number(type || 0), game.id]
  )
}

export function getGameList() {
  return buildGameProjectionSql()
}

export function getModListByAppIdSql(appId, type, sourceMeta = {}) {
  if (isLegacySource(sourceMeta.source)) return listLegacySourceMods(dbInstance, appId, type, String(sourceMeta.profileName || sourceMeta.targetProfileName || ''), sourceMeta)
  const game = findGameRow(appId, sourceMeta)
  if (!game) {
    return []
  }
  const profileName = String(sourceMeta?.profileName || sourceMeta?.targetProfileName || '').trim()
  const profileClause = profileName
    ? `AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?`
    : ''

  return dbInstance.all(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       ${profileClause}
      ORDER BY ${MOD_LIST_ORDER_SQL}`,
    [game.id, Number(type || 0), ...(profileName ? [profileName.toLowerCase()] : [])]
  )
}

function parseMetadataJson(value = '') {
  try {
    const parsed = JSON.parse(String(value || '{}'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function repairUnscopedModProfileBySourceSql(appId, type, sourceMeta = {}) {
  const game = findGameRow(appId, sourceMeta)
  const targetProfileName = toSafeText(sourceMeta?.profileName || sourceMeta?.targetProfileName)
  if (!game || !targetProfileName) {
    return { changes: 0, unscopedCount: 0, migratedCount: 0, records: [] }
  }

  const normalized = normalizeSourceMeta(sourceMeta)
  const sourceClause = normalized.source ? 'AND lower(COALESCE(source, \'\')) = ?' : ''
  const endpointType = Number(type || 0)
  const configProfileName = toSafeText(
    sourceMeta?.configProfileName || sourceMeta?.installConfigProfileName
  )
  const canMigrateNexusRuleProfile =
    normalized.source === 'nexus' &&
    configProfileName &&
    configProfileName.toLowerCase() !== targetProfileName.toLowerCase()
  const profileCondition = canMigrateNexusRuleProfile
    ? `((profile_name IS NULL OR trim(profile_name) = '') OR lower(trim(profile_name)) = ?)`
    : `(profile_name IS NULL OR trim(profile_name) = '')`
  const rows =
    dbInstance.all(
      `SELECT id, source_mod_key, profile_name, metadata_json
       FROM mods
       WHERE game_id = ?
         AND endpoint_type = ?
         AND ${profileCondition}
         ${sourceClause}
       ORDER BY id ASC`,
      [
        game.id,
        endpointType,
        ...(canMigrateNexusRuleProfile ? [configProfileName.toLowerCase()] : []),
        ...(normalized.source ? [normalized.source] : [])
      ]
    ) || []

  let changes = 0
  let unscopedCount = 0
  let migratedCount = 0
  const repairedRecords = []
  const profileId = toSafeText(
    sourceMeta?.profileId || sourceMeta?.configProfileId || sourceMeta?.installConfigProfileId || ''
  )
  const ruleProfileId = sourceMeta?.ruleProfileId || null
  const profileScope = toSafeText(sourceMeta?.profileScope || sourceMeta?.installConfigProfileScope)
  const profileKey = toSafeText(sourceMeta?.profileKey)
  const configProfileId = toSafeText(
    sourceMeta?.configProfileId || sourceMeta?.installConfigProfileId || sourceMeta?.profileId || ''
  )
  const installConfigProfileId = toSafeText(
    sourceMeta?.installConfigProfileId || sourceMeta?.configProfileId || sourceMeta?.profileId || ''
  )
  const installConfigProfileName = toSafeText(
    sourceMeta?.installConfigProfileName || sourceMeta?.configProfileName || ''
  )
  const installConfigSourceType = toSafeText(sourceMeta?.installConfigSourceType)
  const ruleVersion = sourceMeta?.ruleVersion || null

  for (const row of rows) {
    const currentProfileName = toSafeText(row.profile_name)
    const duplicateSourceClause = normalized.source ? 'AND lower(COALESCE(source, \'\')) = ?' : ''
    const duplicate = dbInstance.get(
      `SELECT id
       FROM mods
       WHERE game_id = ?
         AND endpoint_type = ?
         AND source_mod_key = ?
         AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?
         ${duplicateSourceClause}
         AND id <> ?
       LIMIT 1`,
      [
        game.id,
        endpointType,
        String(row.source_mod_key || ''),
        targetProfileName.toLowerCase(),
        ...(normalized.source ? [normalized.source] : []),
        row.id
      ]
    )
    if (duplicate?.id) {
      continue
    }

    const metadata = parseMetadataJson(row.metadata_json)
    const nextConfigProfileId =
      configProfileId ||
      toSafeText(metadata.configProfileId || metadata.installConfigProfileId || metadata.profileId)
    const nextConfigProfileName =
      configProfileName || toSafeText(metadata.configProfileName || metadata.installConfigProfileName)
    const nextInstallConfigProfileId =
      installConfigProfileId ||
      toSafeText(metadata.installConfigProfileId || metadata.configProfileId || metadata.profileId)
    const nextInstallConfigProfileName =
      installConfigProfileName ||
      toSafeText(metadata.installConfigProfileName || metadata.configProfileName)
    const nextProfileId = profileId || toSafeText(metadata.profileId || nextConfigProfileId)
    const nextRuleProfileId = ruleProfileId || metadata.ruleProfileId || null
    const nextProfileScope = profileScope || toSafeText(metadata.profileScope || metadata.installConfigProfileScope)
    const nextProfileKey = profileKey || toSafeText(metadata.profileKey)
    const nextInstallConfigSourceType =
      installConfigSourceType || toSafeText(metadata.installConfigSourceType)
    const nextRuleVersion = ruleVersion || metadata.ruleVersion || null
    metadata.profileId = nextProfileId
    metadata.ruleProfileId = nextRuleProfileId
    metadata.profileName = targetProfileName
    metadata.targetProfileName = targetProfileName
    metadata.profileScope = nextProfileScope
    metadata.profileKey = nextProfileKey
    metadata.configProfileId = nextConfigProfileId
    metadata.configProfileName = nextConfigProfileName
    metadata.installConfigProfileId = nextInstallConfigProfileId
    metadata.installConfigProfileName = nextInstallConfigProfileName
    metadata.installConfigProfileScope = nextProfileScope
    metadata.installConfigSourceType = nextInstallConfigSourceType
    metadata.ruleVersion = nextRuleVersion

    const result = dbInstance.run(
      `UPDATE mods
       SET profile_name = ?,
           metadata_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [targetProfileName, JSON.stringify(metadata), row.id]
    )
    const changed = Number(result?.changes || 0)
    if (changed > 0) {
      const action =
        canMigrateNexusRuleProfile &&
        currentProfileName.toLowerCase() === configProfileName.toLowerCase()
          ? 'migrated'
          : 'unscoped'
      changes += changed
      if (action === 'migrated') {
        migratedCount += changed
      } else {
        unscopedCount += changed
      }
      repairedRecords.push({
        id: row.id,
        sourceModKey: row.source_mod_key,
        fromProfileName: currentProfileName,
        toProfileName: targetProfileName,
        action
      })
    }
  }

  return { changes, unscopedCount, migratedCount, records: repairedRecords }
}

export function getAllGames() {
  return buildGameProjectionSql()
}

export function getAllMods() {
  return dbInstance.all(
    `
      SELECT
        m.*,
        g.app_id AS app_id,
        g.source AS game_source,
        g.source_id AS game_source_id,
        g.name AS game_name
      FROM mods m
      LEFT JOIN games g ON g.id = m.game_id
      ORDER BY m.priority_order ASC, m.id ASC
    `
  )
}

export function queryServerModInstallStatus({
  game_id,
  mod_id,
  option_id,
  sourceMeta = {},
  appId = ''
}) {
  const game = findGameRow(appId || game_id, sourceMeta)
  if (!game) {
    return true
  }

  const row = dbInstance.get(
    `SELECT id
     FROM mods
     WHERE game_id = ?
       AND mod_id = ?
       AND option_id = ?
       AND endpoint_type = 1
     LIMIT 1`,
    [game.id, String(mod_id || ''), String(option_id || '')]
  )
  return !row
}

export function deleteGameById(id) {
  return dbInstance.run(
    `DELETE FROM games WHERE id = ?`,
    [Number(id || 0)]
  )
}
