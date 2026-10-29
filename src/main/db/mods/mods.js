import { isLegacySource, listLegacySourceMods } from '../sources/legacySourceRecords.js'
import dbInstance from '../dbInstance.js'
import { formatChinaTime } from '../../utils/dateTime.js'
import fs from 'fs-extra'
import { getGameDataByAppId } from '../games/game.js'
import {
  MOD_LIST_ORDER_SQL,
  resolveInitialModPriorityOrder,
  resolveModDeployDomain
} from './modDeployment.js'

const STANDARD_METADATA_SCHEMA_VERSION = 1

function toSafeText(value) {
  return String(value ?? '').trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function stringifyJson(value, fallback = '[]') {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

function normalizeMetadataObject(value = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

function parseSourceMetaFromData(data = {}) {
  return data?.sourceMeta && typeof data.sourceMeta === 'object' ? data.sourceMeta : {}
}

function resolveGameRowId(data = {}) {
  if (toSafeNumber(data.gameRowId, 0) > 0) {
    return toSafeNumber(data.gameRowId, 0)
  }
  const sourceMeta = parseSourceMetaFromData(data)
  const game = getGameDataByAppId(data.appid || data.appId || data.gameAppId || '', sourceMeta)
  return toSafeNumber(game?.id, 0)
}

function buildSourceModKey(data = {}) {
  if (toSafeText(data.source_mod_key)) {
    return toSafeText(data.source_mod_key)
  }
  if (toSafeText(data.sourceModKey)) {
    return toSafeText(data.sourceModKey)
  }

  const source = toSafeText(data.source || data?.sourceMeta?.source || 'server').toLowerCase()
  if (source === 'thunderstore') {
    return (
      toSafeText(data.packageFullName) ||
      toSafeText(data.package_name) ||
      toSafeText(data.modReference) ||
      `${toSafeText(data.modId)}:${toSafeText(data.id)}`
    )
  }

  if (source === 'ficsit') {
    return toSafeText(data.modReference) || toSafeText(data.modId)
  }

  return `${toSafeText(data.modId)}:${toSafeText(data.id || data.optionId || 0)}`
}

function prepareModData(data = {}, additionalFields = {}) {
  const source = toSafeText(data.source || data?.sourceMeta?.source || 'server').toLowerCase()
  const gameRowId = resolveGameRowId(data)
  const sourceModId = toSafeText(data.modId ?? data.mod_id ?? data.modReference)
  const optionId = toSafeText(data.id ?? data.optionId ?? data.option_id)
  const now = formatChinaTime()
  const metadata = {
    metadataSchemaVersion: STANDARD_METADATA_SCHEMA_VERSION,
    ...normalizeMetadataObject(data.metadata || {}),
    ...normalizeMetadataObject(data.metadata_json || {})
  }
  const descriptionText = toSafeText(
    data.description ??
      data.summary ??
      data.modDescription ??
      data.desc ??
      metadata.description ??
      metadata.summary ??
      metadata.shortDescription ??
      metadata.fullDescription
  )

  if (descriptionText) {
    if (!toSafeText(metadata.description)) {
      metadata.description = descriptionText
    }
    if (!toSafeText(metadata.summary)) {
      metadata.summary = descriptionText
    }
  }

  if (!gameRowId) {
    throw new Error('未找到对应的游戏记录，无法写入模组')
  }

  const prepared = {
    game_id: gameRowId,
    source,
    mod_id: sourceModId,
    option_id: optionId,
    source_mod_key: buildSourceModKey(data),
    name: toSafeText(data.modName ?? data.name),
    option_name: toSafeText(data.name ?? data.option_name),
    description: descriptionText,
    version: toSafeText(data.version),
    download_url: toSafeText(data.downloadUrl ?? data.download_url ?? metadata.downloadUrl),
    file_size: toSafeNumber(data.fileSize ?? data.file_size ?? metadata.fileSize, 0),
    install_paths_json: stringifyJson(data.install_paths_json || [], '[]'),
    dependencies_json: stringifyJson(data.dependencies || data.dependencies_json || [], '[]'),
    files_json: stringifyJson(data.files || data.files_json || [], '[]'),
    metadata_json: stringifyJson(metadata, '{}'),
    install_type: toSafeNumber(data.installType ?? data.install_type, 0),
    usage_type: toSafeNumber(data.usageType ?? data.usage_type, 0),
    created_at: toSafeText(data.created_at || now),
    installed_at: toSafeText(data.installed_at || data.installedAt || now),
    updated_at: toSafeText(data.updated_at || data.updatedAt || now),
    cover: toSafeText(
      data.cover ??
        data.logo ??
        data.icon ??
        metadata.cover ??
        metadata.coverImage ??
        metadata.icon ??
        metadata.iconUrl ??
        metadata.logo ??
        metadata.logoUrl
    ),
    type_id: toSafeNumber(data.typeId ?? data.type_id, 0),
    endpoint_type: toSafeNumber(data.endpoint_type, 0),
    file_md5: toSafeText(data.fileMD5 ?? data.file_md5 ?? metadata.fileMd5),
    mod_version: toSafeText(
      data.modVersion ?? data.mod_version ?? metadata.modVersion ?? data.version
    ),
    package_owner: toSafeText(data.packageOwner ?? data.package_owner ?? metadata.packageOwner),
    package_name: toSafeText(data.packageName ?? data.package_name ?? metadata.packageName),
    profile_name: toSafeText(data.profileName ?? data.profile_name) || 'default',
    archive_path: toSafeText(data.archivePath ?? data.archive_path ?? metadata.archivePath),
    staging_path: toSafeText(data.stagingPath ?? data.staging_path ?? metadata.stagingPath),
    target_path: toSafeText(data.targetPath ?? data.target_path ?? metadata.targetPath),
    source_root_path: toSafeText(
      data.sourceRootPath ?? data.source_root_path ?? metadata.sourceRootPath
    ),
    install_state: toSafeNumber(data.installState ?? data.install_state, 1),
    is_active: toSafeNumber(data.isActive ?? data.is_active ?? 1, 1),
    priority_order: toSafeNumber(data.priorityOrder ?? data.priority_order, 0),
    deploy_domain: resolveModDeployDomain({
      ...data,
      source,
      endpoint_type: toSafeNumber(data.endpoint_type, 0),
      metadata
    }),
    install_model: toSafeText(data.installModel ?? data.install_model ?? 'managed') || 'managed',
    last_reconcile_at: toSafeText(data.lastReconcileAt ?? data.last_reconcile_at),
    compat_flags: stringifyJson(data.compatFlags ?? data.compat_flags ?? [], '[]'),
    ...additionalFields
  }

  return prepared
}

export async function insertMod(modData) {
  const prepared = prepareModData(modData)
  prepared.priority_order = resolveInitialModPriorityOrder(prepared, modData)
  const sql = `
    INSERT INTO mods (
      game_id, source, mod_id, option_id, source_mod_key, name, option_name, version,
      description,
      download_url, file_size, install_paths_json, dependencies_json, files_json, metadata_json,
      install_type, usage_type, created_at, installed_at, updated_at, cover, type_id,
      endpoint_type, file_md5, mod_version, package_owner, package_name, profile_name,
      archive_path, staging_path, target_path, source_root_path, install_state, is_active,
      priority_order, deploy_domain, install_model, last_reconcile_at, compat_flags
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_id, source_mod_key, endpoint_type, profile_name) DO UPDATE SET
      source = excluded.source,
      mod_id = excluded.mod_id,
      option_id = excluded.option_id,
      name = excluded.name,
      option_name = excluded.option_name,
      description = CASE
        WHEN trim(excluded.description) <> '' THEN excluded.description
        ELSE mods.description
      END,
      version = excluded.version,
      download_url = excluded.download_url,
      file_size = excluded.file_size,
      install_paths_json = excluded.install_paths_json,
      dependencies_json = excluded.dependencies_json,
      files_json = excluded.files_json,
      metadata_json = excluded.metadata_json,
      install_type = excluded.install_type,
      usage_type = excluded.usage_type,
      installed_at = excluded.installed_at,
      updated_at = excluded.updated_at,
      cover = excluded.cover,
      type_id = excluded.type_id,
      file_md5 = excluded.file_md5,
      mod_version = excluded.mod_version,
      package_owner = excluded.package_owner,
      package_name = excluded.package_name,
      archive_path = excluded.archive_path,
      staging_path = excluded.staging_path,
      target_path = excluded.target_path,
      source_root_path = excluded.source_root_path,
      install_state = excluded.install_state,
      is_active = excluded.is_active,
      priority_order = excluded.priority_order,
      deploy_domain = excluded.deploy_domain,
      install_model = excluded.install_model,
      compat_flags = excluded.compat_flags
  `

  return dbInstance.run(sql, [
    prepared.game_id,
    prepared.source,
    prepared.mod_id,
    prepared.option_id,
    prepared.source_mod_key,
    prepared.name,
    prepared.option_name,
    prepared.version,
    prepared.description,
    prepared.download_url,
    prepared.file_size,
    prepared.install_paths_json,
    prepared.dependencies_json,
    prepared.files_json,
    prepared.metadata_json,
    prepared.install_type,
    prepared.usage_type,
    prepared.created_at,
    prepared.installed_at,
    prepared.updated_at,
    prepared.cover,
    prepared.type_id,
    prepared.endpoint_type,
    prepared.file_md5,
    prepared.mod_version,
    prepared.package_owner,
    prepared.package_name,
    prepared.profile_name,
    prepared.archive_path,
    prepared.staging_path,
    prepared.target_path,
    prepared.source_root_path,
    prepared.install_state,
    prepared.is_active,
    prepared.priority_order,
    prepared.deploy_domain,
    prepared.install_model,
    prepared.last_reconcile_at,
    prepared.compat_flags
  ])
}

// 更新沿用已选记录的主键、档案和排序，避免 upsert 命中其他配置或级联删除部署台账。
export function replaceModById(previousMod, modData, { replaceSourceModKey = false } = {}) {
  const prepared = prepareModData(modData, {
    // 整合包按文件版本定位安装记录，换文件时同步标识，但仍保留部署台账引用的主键。
    ...(replaceSourceModKey ? {} : { source_mod_key: previousMod.source_mod_key }),
    profile_name: previousMod.profile_name,
    priority_order: previousMod.priority_order,
    created_at: previousMod.created_at,
    deploy_domain: previousMod.deploy_domain
  })
  if (prepared.game_id !== previousMod.game_id || prepared.source !== previousMod.source ||
      prepared.endpoint_type !== previousMod.endpoint_type) {
    throw new Error('更新记录的来源、游戏或端点不一致')
  }
  const columns = Object.keys(prepared)
  const result = dbInstance.run(`UPDATE mods SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((column) => prepared[column]), previousMod.id])
  if (Number(result?.changes) !== 1) throw new Error('待更新安装记录已不存在')
}

export function restoreModRecordSnapshot(snapshot) {
  const columns = Object.keys(snapshot).filter((column) => column !== 'id' && /^[a-z_][a-z0-9_]*$/.test(column))
  const result = dbInstance.run(`UPDATE mods SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
    [...columns.map((column) => snapshot[column]), snapshot.id])
  if (Number(result?.changes) !== 1) throw new Error('旧版本安装记录恢复失败')
}

export function restoreDeletedModRecordSnapshot(snapshot) {
  if (!Number.isSafeInteger(Number(snapshot?.id)) || Number(snapshot.id) <= 0) throw new Error('待恢复安装记录 ID 无效')
  const columns = Object.keys(snapshot).filter((column) => /^[a-z_][a-z0-9_]*$/.test(column))
  // INSERT deliberately refuses an occupied ID or unique source identity; never overwrite another record.
  const result = dbInstance.run(`INSERT INTO mods (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map((column) => snapshot[column]))
  if (Number(result?.changes) !== 1) throw new Error('卸载失败后的安装记录恢复失败')
}

export function getModDataById(appid, id, sourceMeta = {}) {
  const game = getGameDataByAppId(appid, sourceMeta)
  if (!game) return null
  return dbInstance.get(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND mod_id = ?
       AND endpoint_type = 1
     LIMIT 1`,
    [game.id, String(id || '')]
  )
}

export function getAllModDataByAppId(appid, type = 0, sourceMeta = {}) {
  if (isLegacySource(sourceMeta.source)) return listLegacySourceMods(dbInstance, appid, type, String(sourceMeta.profileName || ''), sourceMeta)
  const game = getGameDataByAppId(appid, sourceMeta)
  if (!game) return []
  return dbInstance.all(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
     ORDER BY ${MOD_LIST_ORDER_SQL}`,
    [game.id, Number(type || 0)]
  )
}

export async function updateMod(id, data) {
  return insertMod({
    ...data,
    id
  })
}

export function updateModActiveState(id, isActive) {
  const sql = `UPDATE mods SET is_active = ?, install_state = ?, profile_enabled = ? WHERE id = ?`
  return dbInstance.run(sql, [isActive ? 1 : 0, isActive ? 1 : 0, isActive ? 1 : 0, id])
}

export function getModDataByRowId(id) {
  return dbInstance.get(
    `SELECT *
     FROM mods
     WHERE id = ?
     LIMIT 1`,
    [toSafeNumber(id, 0)]
  )
}

export function updateLocalBoundModRecord(id, data = {}) {
  const target = data && typeof data === 'object' ? data : {}
  return dbInstance.run(
    `UPDATE mods
     SET files_json = ?,
         metadata_json = ?,
         target_path = ?,
         install_state = ?,
         is_active = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      stringifyJson(target.files || target.files_json || [], '[]'),
      stringifyJson(target.metadata || target.metadata_json || {}, '{}'),
      toSafeText(target.targetPath ?? target.target_path),
      toSafeNumber(target.installState ?? target.install_state, 1),
      toSafeNumber(target.isActive ?? target.is_active, 1),
      toSafeText(target.updatedAt ?? target.updated_at) || formatChinaTime(),
      toSafeNumber(id, 0)
    ]
  )
}

export function dbUninstallMod(id) {
  dbInstance.run(`DELETE FROM mods WHERE id = ?`, [id])
}

export function updateModSourceStatus(id, status, checkedAt = formatChinaTime()) {
  return dbInstance.run(
    `UPDATE mods SET source_status = ?, source_status_checked_at = ? WHERE id = ?`,
    [status, checkedAt, toSafeNumber(id, 0)]
  )
}

export function updateModSourceLockState(id, lockState, lockedAt = formatChinaTime()) {
  return dbInstance.run(
    `UPDATE mods SET source_lock_state = ?, source_lock_at = ? WHERE id = ?`,
    [lockState, lockedAt, toSafeNumber(id, 0)]
  )
}

export function updateModSourceRootPath(id, sourceRootPath) {
  return dbInstance.run(
    `UPDATE mods SET source_root_path = ? WHERE id = ?`,
    [toSafeText(sourceRootPath), toSafeNumber(id, 0)]
  )
}

export function getInactiveModsByAppId(appid, sourceMeta = {}) {
  const game = getGameDataByAppId(appid, sourceMeta)
  if (!game) return []
  return dbInstance.all(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND is_active = 0`,
    [game.id]
  )
}

export function getAllActiveLockableMods() {
  return dbInstance.all(
    `SELECT *
     FROM mods
     WHERE is_active = 1
       AND install_model != 'bound'
       AND (
         source_root_path != ''
         OR archive_path != ''
         OR staging_path != ''
       )`
  )
}

export function getAllInactiveLockedMods() {
  return dbInstance.all(
    `SELECT *
     FROM mods
     WHERE is_active = 0
       AND source_lock_state IN ('locked', 'repair_required', 'unlock_failed')`
  )
}

export function getModCountByAppId(appid, sourceMeta = {}) {
  const game = getGameDataByAppId(appid, sourceMeta)
  if (!game) {
    return { clientModCount: 0, serverModCount: 0, clientActiveModCount: 0 }
  }
  const clientModCount =
    dbInstance.all(`SELECT id FROM mods WHERE game_id = ? AND endpoint_type = 0`, [game.id])
      .length || 0
  const serverModCount =
    dbInstance.all(`SELECT id FROM mods WHERE game_id = ? AND endpoint_type = 1`, [game.id])
      .length || 0
  // 已启用数量供游戏库检视器展示，口径与模组管理的 is_active 一致。
  const clientActiveModCount =
    dbInstance.all(
      `SELECT id FROM mods WHERE game_id = ? AND endpoint_type = 0 AND is_active = 1`,
      [game.id]
    ).length || 0
  return { clientModCount, serverModCount, clientActiveModCount }
}

// 按游戏记录 ID 读取最近安装的客户端模组，只返回展示所需字段。
export function getRecentClientModsByGameIds(gameIds = [], limit = 3) {
  const ids = (Array.isArray(gameIds) ? gameIds : []).filter(
    (id) => Number.isSafeInteger(id) && id > 0
  )
  if (!ids.length) return []
  return dbInstance.all(
    `SELECT id, game_id, source, name, option_name, version, mod_version, is_active,
            installed_at, created_at
     FROM mods
     WHERE game_id IN (${ids.map(() => '?').join(', ')})
       AND endpoint_type = 0
     ORDER BY COALESCE(NULLIF(installed_at, ''), created_at) DESC, id DESC
     LIMIT ?`,
    [...ids, toSafeNumber(limit, 3)]
  )
}

export function cleanModData() {}

export function getModByData({
  game_id,
  mod_id,
  option_id,
  endpoint_type,
  profileName = '',
  sourceMeta = {}
}) {
  const game = getGameDataByAppId(game_id, sourceMeta)
  if (!game) return null
  const safeProfileName = toSafeText(
    profileName || sourceMeta.profileName || sourceMeta.targetProfileName
  )
  const profileClause = safeProfileName ? `AND lower(COALESCE(NULLIF(profile_name, ''), 'default')) = ?` : ''
  return dbInstance.get(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND option_id = ?
       AND mod_id = ?
       ${profileClause}
     LIMIT 1`,
    [
      game.id,
      Number(endpoint_type || 0),
      String(option_id || ''),
      String(mod_id || ''),
      ...(safeProfileName ? [safeProfileName.toLowerCase()] : [])
    ]
  )
}

export function insertBackupData(data) {
  const target = data && typeof data === 'object' ? data : {}
  const sql = `INSERT INTO mod_runtime_files (game_id, mod_id, file_path, backup_path, endpoint_type, metadata_json, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(mod_id, file_path, endpoint_type) DO UPDATE SET
                 game_id = excluded.game_id,
                 backup_path = excluded.backup_path,
                 metadata_json = excluded.metadata_json,
                 state = 'active',
                 updated_at = excluded.updated_at`
  dbInstance.run(sql, [
    toSafeNumber(target.game_id, 0),
    toSafeNumber(target.mod_id, 0),
    toSafeText(target.file_path),
    toSafeText(target.backup_path),
    toSafeNumber(target.type ?? target.endpoint_type, 0),
    stringifyJson(target.metadata || {}, '{}'),
    formatChinaTime()
  ])
}

export function deleteBackupData(id, backup_path) {
  const safeBackupPath = toSafeText(backup_path)
  if (safeBackupPath) {
    fs.rmSync(safeBackupPath, { recursive: true, force: true })
  }
  dbInstance.run(`DELETE FROM mod_runtime_files WHERE id = ?`, [id])
}

export function getBackupData(modId, endpoint_type) {
  return dbInstance.all(
    `SELECT *
     FROM mod_runtime_files
     WHERE state <> 'released' AND mod_id = ?
       AND endpoint_type = ?
     ORDER BY id DESC`,
    [toSafeNumber(modId, 0), toSafeNumber(endpoint_type, 0)]
  )
}

export function getBackupDataByPath(path, endpoint_type, gameId = 0) {
  const safeGameId = toSafeNumber(gameId, 0)
  if (safeGameId > 0) {
    return dbInstance.all(
      `SELECT *
       FROM mod_runtime_files
       WHERE state <> 'released' AND file_path = ?
         AND endpoint_type = ?
         AND game_id = ?
       ORDER BY id DESC`,
      [path, endpoint_type, safeGameId]
    )
  }

  return dbInstance.all(
    `SELECT *
     FROM mod_runtime_files
     WHERE state <> 'released' AND file_path = ?
       AND endpoint_type = ?
     ORDER BY id DESC`,
    [path, endpoint_type]
  )
}

export function markNoRecovery(id) {
  dbInstance.run(`UPDATE mod_runtime_files SET state = 'released', updated_at = ? WHERE id = ?`, [
    formatChinaTime(),
    id
  ])
}
