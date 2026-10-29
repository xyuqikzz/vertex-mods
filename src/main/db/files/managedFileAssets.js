import dbInstance from '../dbInstance.js'
import { v4 as uuidv4 } from 'uuid'
import { deleteManagedAssetSqlRecords } from './managedFileCleanup.js'

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function normalizeAssetId(value = '') {
  return toSafeText(value) || uuidv4()
}

export function ensureManagedFileAssetTables() {
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS managed_file_assets
    (
      asset_id          TEXT PRIMARY KEY,
      asset_type        TEXT NOT NULL DEFAULT 'download',
      source_platform   TEXT NOT NULL DEFAULT 'vertex',
      game_id           TEXT NOT NULL DEFAULT '',
      steam_app_id      TEXT NOT NULL DEFAULT '',
      profile_name      TEXT NOT NULL DEFAULT '',
      file_path         TEXT NOT NULL UNIQUE,
      storage_root_type TEXT NOT NULL DEFAULT 'external_reference',
      storage_root_path TEXT NOT NULL DEFAULT '',
      size_bytes        INTEGER NOT NULL DEFAULT 0,
      hash_md5          TEXT NOT NULL DEFAULT '',
      hash_sha256       TEXT NOT NULL DEFAULT '',
      managed_mode      TEXT NOT NULL DEFAULT 'referenced',
      ref_count         INTEGER NOT NULL DEFAULT 0,
      last_used_at      TEXT NOT NULL DEFAULT '',
      delete_policy     TEXT NOT NULL DEFAULT 'manual_only',
      state             TEXT NOT NULL DEFAULT 'active',
      delete_error      TEXT NOT NULL DEFAULT '',
      created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at        TEXT NOT NULL DEFAULT ''
    );
  `)

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS managed_file_asset_owners
    (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id               TEXT NOT NULL,
      owner_type             TEXT NOT NULL DEFAULT '',
      owner_id               TEXT NOT NULL DEFAULT '',
      relation_type          TEXT NOT NULL DEFAULT 'source',
      delete_policy_override TEXT NOT NULL DEFAULT '',
      created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (asset_id, owner_type, owner_id, relation_type)
    );
  `)

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_managed_file_assets_state
    ON managed_file_assets (state, asset_type, source_platform);
  `)

  dbInstance.run(`
    CREATE INDEX IF NOT EXISTS idx_managed_file_asset_owners_owner
    ON managed_file_asset_owners (owner_type, owner_id);
  `)
}

export function upsertManagedFileAsset(asset = {}) {
  ensureManagedFileAssetTables()

  const filePath = toSafeText(asset.file_path || asset.filePath)
  if (!filePath) {
    throw new Error('缺少资产文件路径')
  }

  const now = new Date().toISOString()
  const existing = getManagedFileAssetByPath(filePath)
  const assetId = normalizeAssetId(asset.asset_id || asset.assetId || existing?.asset_id)
  const params = [
    assetId,
    toSafeText(asset.asset_type || asset.assetType) || 'download',
    toSafeText(asset.source_platform || asset.sourcePlatform) || 'vertex',
    toSafeText(asset.game_id || asset.gameId),
    toSafeText(asset.steam_app_id || asset.steamAppId),
    toSafeText(asset.profile_name || asset.profileName),
    filePath,
    toSafeText(asset.storage_root_type || asset.storageRootType) || 'external_reference',
    toSafeText(asset.storage_root_path || asset.storageRootPath),
    Math.max(0, Number(asset.size_bytes ?? asset.sizeBytes ?? asset.size ?? 0) || 0),
    toSafeText(asset.hash_md5 || asset.hashMd5 || asset.md5).toLowerCase(),
    toSafeText(asset.hash_sha256 || asset.hashSha256).toLowerCase(),
    toSafeText(asset.managed_mode || asset.managedMode) || 'referenced',
    Math.max(0, Number(asset.ref_count ?? asset.refCount ?? 0) || 0),
    toSafeText(asset.last_used_at || asset.lastUsedAt) || now,
    toSafeText(asset.delete_policy || asset.deletePolicy) || 'manual_only',
    toSafeText(asset.state) || 'active',
    toSafeText(asset.delete_error || asset.deleteError),
    now
  ]

  dbInstance.run(
    `
      INSERT INTO managed_file_assets (
        asset_id, asset_type, source_platform, game_id, steam_app_id, profile_name,
        file_path, storage_root_type, storage_root_path, size_bytes, hash_md5, hash_sha256,
        managed_mode, ref_count, last_used_at, delete_policy, state, delete_error, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        asset_type = excluded.asset_type,
        source_platform = excluded.source_platform,
        game_id = excluded.game_id,
        steam_app_id = excluded.steam_app_id,
        profile_name = excluded.profile_name,
        storage_root_type = excluded.storage_root_type,
        storage_root_path = excluded.storage_root_path,
        size_bytes = excluded.size_bytes,
        hash_md5 = COALESCE(NULLIF(excluded.hash_md5, ''), managed_file_assets.hash_md5),
        hash_sha256 = COALESCE(NULLIF(excluded.hash_sha256, ''), managed_file_assets.hash_sha256),
        managed_mode = excluded.managed_mode,
        last_used_at = excluded.last_used_at,
        delete_policy = excluded.delete_policy,
        state = excluded.state,
        delete_error = excluded.delete_error,
        updated_at = excluded.updated_at
    `,
    params
  )

  return getManagedFileAssetById(assetId) || getManagedFileAssetByPath(filePath)
}

export function getManagedFileAssetById(assetId = '') {
  ensureManagedFileAssetTables()
  const safeAssetId = toSafeText(assetId)
  if (!safeAssetId) return null
  return dbInstance.get('SELECT * FROM managed_file_assets WHERE asset_id = ? LIMIT 1', [safeAssetId])
}

export function getManagedFileAssetByPath(filePath = '') {
  ensureManagedFileAssetTables()
  const safeFilePath = toSafeText(filePath)
  if (!safeFilePath) return null
  return dbInstance.get('SELECT * FROM managed_file_assets WHERE file_path = ? LIMIT 1', [safeFilePath])
}

export function listManagedFileAssets(query = {}) {
  ensureManagedFileAssetTables()
  const states =
    Array.isArray(query.states) && query.states.length
      ? query.states
      : ['active', 'delete_failed', 'missing', 'orphaned']
  const filters = [`a.state IN (${states.map(() => '?').join(',')})`]
  const params = states.map(toSafeText)
  const appendInFilter = (column = '', values = []) => {
    const safeValues = Array.isArray(values) ? values.map(toSafeText).filter(Boolean) : []
    if (!safeValues.length) return
    filters.push(`${column} IN (${safeValues.map(() => '?').join(',')})`)
    params.push(...safeValues)
  }

  appendInFilter('a.asset_type', query.assetTypes || query.asset_types)
  appendInFilter('a.source_platform', query.sourcePlatforms || query.source_platforms)
  appendInFilter('a.storage_root_type', query.storageRootTypes || query.storage_root_types)
  appendInFilter('a.managed_mode', query.managedModes || query.managed_modes)

  const keyword = toSafeText(query.keyword)
  if (keyword) {
    filters.push(`
      (
        a.file_path LIKE ?
        OR a.asset_type LIKE ?
        OR a.source_platform LIKE ?
        OR a.game_id LIKE ?
        OR a.profile_name LIKE ?
      )
    `)
    const likeKeyword = `%${keyword}%`
    params.push(likeKeyword, likeKeyword, likeKeyword, likeKeyword, likeKeyword)
  }

  return dbInstance.all(
    `
      SELECT a.*,
             COALESCE(o.owner_count, 0) AS owner_count
      FROM managed_file_assets a
      LEFT JOIN (
        SELECT asset_id, COUNT(*) AS owner_count
        FROM managed_file_asset_owners
        GROUP BY asset_id
      ) o ON o.asset_id = a.asset_id
      WHERE ${filters.join(' AND ')}
      ORDER BY a.updated_at DESC
    `,
    params
  )
}

export function linkManagedFileAssetOwner(assetId = '', owner = {}) {
  ensureManagedFileAssetTables()
  const safeAssetId = toSafeText(assetId)
  const ownerType = toSafeText(owner.owner_type || owner.ownerType)
  const ownerId = toSafeText(owner.owner_id || owner.ownerId)
  const relationType = toSafeText(owner.relation_type || owner.relationType) || 'source'
  if (!safeAssetId || !ownerType || !ownerId) {
    return null
  }

  const now = new Date().toISOString()
  dbInstance.run(
    `
      INSERT INTO managed_file_asset_owners (
        asset_id, owner_type, owner_id, relation_type, delete_policy_override, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, owner_type, owner_id, relation_type) DO UPDATE SET
        delete_policy_override = excluded.delete_policy_override,
        updated_at = excluded.updated_at
    `,
    [
      safeAssetId,
      ownerType,
      ownerId,
      relationType,
      toSafeText(owner.delete_policy_override || owner.deletePolicyOverride),
      now
    ]
  )
  refreshManagedFileAssetRefCount(safeAssetId)
  return getManagedFileAssetById(safeAssetId)
}

export function listManagedFileAssetOwners(assetId = '') {
  ensureManagedFileAssetTables()
  const safeAssetId = toSafeText(assetId)
  if (!safeAssetId) return []
  return dbInstance.all('SELECT * FROM managed_file_asset_owners WHERE asset_id = ?', [safeAssetId])
}

export function listManagedFileAssetOwnersByOwner(owner = {}) {
  ensureManagedFileAssetTables()
  const ownerType = toSafeText(owner.owner_type || owner.ownerType)
  const ownerId = toSafeText(owner.owner_id || owner.ownerId)
  if (!ownerType || !ownerId) return []
  return dbInstance.all(
    'SELECT * FROM managed_file_asset_owners WHERE owner_type = ? AND owner_id = ?',
    [ownerType, ownerId]
  )
}

export function deleteManagedFileAssetOwnersByOwner(owner = {}) {
  ensureManagedFileAssetTables()
  const rows = listManagedFileAssetOwnersByOwner(owner)
  const ownerType = toSafeText(owner.owner_type || owner.ownerType)
  const ownerId = toSafeText(owner.owner_id || owner.ownerId)
  if (!ownerType || !ownerId) return []
  dbInstance.run('DELETE FROM managed_file_asset_owners WHERE owner_type = ? AND owner_id = ?', [
    ownerType,
    ownerId
  ])
  rows.forEach((row) => refreshManagedFileAssetRefCount(row.asset_id))
  return rows
}

export function updateManagedFileAssetState(assetId = '', state = 'active', deleteError = '') {
  ensureManagedFileAssetTables()
  const safeAssetId = toSafeText(assetId)
  if (!safeAssetId) return null
  const now = new Date().toISOString()
  dbInstance.run(
    `
      UPDATE managed_file_assets
      SET state = ?,
          delete_error = ?,
          deleted_at = CASE WHEN ? = 'deleted' THEN ? ELSE deleted_at END,
          updated_at = ?
      WHERE asset_id = ?
    `,
    [state, toSafeText(deleteError), state, now, now, safeAssetId]
  )
  return getManagedFileAssetById(safeAssetId)
}

export function deleteManagedFileAssetById(assetId = '') {
  return deleteManagedAssetSqlRecords(dbInstance, assetId)
}

export function refreshManagedFileAssetRefCount(assetId = '') {
  ensureManagedFileAssetTables()
  const safeAssetId = toSafeText(assetId)
  if (!safeAssetId) return 0
  const row = dbInstance.get(
    'SELECT COUNT(*) AS count FROM managed_file_asset_owners WHERE asset_id = ?',
    [safeAssetId]
  )
  const count = Number(row?.count || 0)
  dbInstance.run(
    'UPDATE managed_file_assets SET ref_count = ?, updated_at = ? WHERE asset_id = ?',
    [count, new Date().toISOString(), safeAssetId]
  )
  return count
}
