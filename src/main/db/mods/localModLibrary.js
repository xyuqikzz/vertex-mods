import dbInstance from '../dbInstance.js'
import { formatChinaTime } from '../../utils/dateTime.js'

function toSafeText(value, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function stringifyJson(value, fallback = '[]') {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return fallback
  }
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value
  const text = toSafeText(value)
  if (!text) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function normalizeLibraryRow(row = null) {
  if (!row) return null
  return {
    ...row,
    id: toSafeNumber(row.id, 0),
    game_id: toSafeNumber(row.game_id, 0),
    file_count: toSafeNumber(row.file_count, 0),
    tags: parseJson(row.tags_json, []),
    metadata: parseJson(row.metadata_json, {})
  }
}

export function getGameRowById(id = 0) {
  return dbInstance.get(
    `SELECT *
     FROM games
     WHERE id = ?
     LIMIT 1`,
    [toSafeNumber(id, 0)]
  )
}

export function resolveGameRow(payload = {}) {
  const gameId = toSafeNumber(payload.gameId ?? payload.game_id, 0)
  if (gameId > 0) {
    const row = getGameRowById(gameId)
    if (row) return row
  }

  const appId = toSafeText(payload.appId ?? payload.app_id ?? payload.steamAppId)
  const source = toSafeText(payload.source ?? payload.sourcePlatform ?? payload.source_platform)
  const sourceId = toSafeText(payload.sourceId ?? payload.source_id)
  const sourceSlug = toSafeText(payload.sourceSlug ?? payload.source_slug)
  const conditions = []
  const params = []

  if (source && sourceId) {
    conditions.push('(source = ? AND source_id = ?)')
    params.push(source, sourceId)
  }
  if (source && sourceSlug) {
    conditions.push('(source = ? AND source_slug = ?)')
    params.push(source, sourceSlug)
  }
  if (appId) {
    conditions.push('(app_id = ?)')
    params.push(appId)
  }

  if (!conditions.length) return null
  return dbInstance.get(
    `SELECT *
     FROM games
     WHERE ${conditions.join(' OR ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    params
  )
}

export function insertLocalModLibraryItem(payload = {}) {
  const now = formatChinaTime()
  const result = dbInstance.run(
    `INSERT INTO local_mod_library (
       game_id, source_platform, source_profile, display_name, file_name, version,
       author, website, description, cover_path, import_source_type, import_origin_path,
       library_root_path, fingerprint, mod_type, tags_json, metadata_json, created_at,
       updated_at, state
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      toSafeNumber(payload.gameId ?? payload.game_id, 0),
      toSafeText(payload.sourcePlatform ?? payload.source_platform, 'local'),
      toSafeText(payload.sourceProfile ?? payload.source_profile, 'default'),
      toSafeText(payload.displayName ?? payload.display_name),
      toSafeText(payload.fileName ?? payload.file_name),
      toSafeText(payload.version),
      toSafeText(payload.author),
      toSafeText(payload.website),
      toSafeText(payload.description),
      toSafeText(payload.coverPath ?? payload.cover_path),
      toSafeText(payload.importSourceType ?? payload.import_source_type, 'archive'),
      toSafeText(payload.importOriginPath ?? payload.import_origin_path),
      toSafeText(payload.libraryRootPath ?? payload.library_root_path),
      toSafeText(payload.fingerprint),
      toSafeText(payload.modType ?? payload.mod_type),
      stringifyJson(payload.tags ?? payload.tags_json ?? [], '[]'),
      stringifyJson(payload.metadata ?? payload.metadata_json ?? {}, '{}'),
      toSafeText(payload.createdAt ?? payload.created_at, now),
      toSafeText(payload.updatedAt ?? payload.updated_at, now),
      toSafeText(payload.state, 'active')
    ]
  )
  return toSafeNumber(result?.lastInsertRowid, 0)
}

export function replaceLocalModLibraryEntries(libraryId = 0, entries = []) {
  const safeLibraryId = toSafeNumber(libraryId, 0)
  dbInstance.transaction(() => {
    dbInstance.run(`DELETE FROM local_mod_library_entry WHERE library_id = ?`, [safeLibraryId])
    for (const entry of Array.isArray(entries) ? entries : []) {
      dbInstance.run(
        `INSERT INTO local_mod_library_entry (
           library_id, relative_path, entry_type, size_bytes, file_hash, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          safeLibraryId,
          toSafeText(entry.relativePath ?? entry.relative_path),
          toSafeText(entry.entryType ?? entry.entry_type, 'file'),
          toSafeNumber(entry.sizeBytes ?? entry.size_bytes, 0),
          toSafeText(entry.fileHash ?? entry.file_hash),
          toSafeText(entry.createdAt ?? entry.created_at, formatChinaTime())
        ]
      )
    }
  })
}

export function listLocalModLibrary(payload = {}) {
  const gameId = toSafeNumber(payload.gameId ?? payload.game_id, 0)
  const keyword = toSafeText(payload.keyword).toLowerCase()
  const state = toSafeText(payload.state, 'active')
  const params = []
  const where = []

  if (gameId > 0) {
    where.push('l.game_id = ?')
    params.push(gameId)
  }
  if (state) {
    where.push('l.state = ?')
    params.push(state)
  }
  if (keyword) {
    where.push(
      `(lower(l.display_name) LIKE ? OR lower(l.file_name) LIKE ? OR lower(l.author) LIKE ? OR lower(l.mod_type) LIKE ?)`
    )
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }

  const rows = dbInstance.all(
    `SELECT l.*,
            g.name AS game_name,
            COUNT(e.id) AS file_count
     FROM local_mod_library l
     LEFT JOIN games g ON g.id = l.game_id
     LEFT JOIN local_mod_library_entry e ON e.library_id = l.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY l.id
     ORDER BY datetime(l.updated_at) DESC, l.id DESC`,
    params
  )
  return rows.map(normalizeLibraryRow)
}

export function getLocalModLibraryItem(id = 0) {
  const row = dbInstance.get(
    `SELECT l.*,
            g.name AS game_name,
            COUNT(e.id) AS file_count
     FROM local_mod_library l
     LEFT JOIN games g ON g.id = l.game_id
     LEFT JOIN local_mod_library_entry e ON e.library_id = l.id
     WHERE l.id = ?
     GROUP BY l.id
     LIMIT 1`,
    [toSafeNumber(id, 0)]
  )
  const item = normalizeLibraryRow(row)
  if (!item) return null
  item.entries = listLocalModLibraryEntries(item.id)
  return item
}

export function listLocalModLibraryEntries(libraryId = 0) {
  return dbInstance.all(
    `SELECT *
     FROM local_mod_library_entry
     WHERE library_id = ?
     ORDER BY entry_type ASC, relative_path ASC`,
    [toSafeNumber(libraryId, 0)]
  )
}

export function findLocalModLibraryDuplicate(payload = {}) {
  const gameId = toSafeNumber(payload.gameId ?? payload.game_id, 0)
  const fingerprint = toSafeText(payload.fingerprint)
  if (!gameId || !fingerprint) return null
  return normalizeLibraryRow(
    dbInstance.get(
      `SELECT *
       FROM local_mod_library
       WHERE game_id = ?
         AND fingerprint = ?
         AND state = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [gameId, fingerprint]
    )
  )
}

export function updateLocalModLibraryMeta(id = 0, payload = {}) {
  const now = formatChinaTime()
  dbInstance.run(
    `UPDATE local_mod_library
     SET display_name = ?,
         version = ?,
         author = ?,
         website = ?,
         description = ?,
         cover_path = ?,
         source_platform = ?,
         source_profile = ?,
         mod_type = ?,
         tags_json = ?,
         metadata_json = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      toSafeText(payload.displayName ?? payload.display_name),
      toSafeText(payload.version),
      toSafeText(payload.author),
      toSafeText(payload.website),
      toSafeText(payload.description),
      toSafeText(payload.coverPath ?? payload.cover_path),
      toSafeText(payload.sourcePlatform ?? payload.source_platform, 'local'),
      toSafeText(payload.sourceProfile ?? payload.source_profile, 'default'),
      toSafeText(payload.modType ?? payload.mod_type),
      stringifyJson(payload.tags ?? payload.tags_json ?? [], '[]'),
      stringifyJson(payload.metadata ?? payload.metadata_json ?? {}, '{}'),
      now,
      toSafeNumber(id, 0)
    ]
  )
}

export function markLocalModLibraryDeleted(id = 0) {
  dbInstance.run(
    `UPDATE local_mod_library
     SET state = 'deleted',
         updated_at = ?
     WHERE id = ?`,
    [formatChinaTime(), toSafeNumber(id, 0)]
  )
}

export function deleteLocalModLibraryRecord(id = 0) {
  const safeId = toSafeNumber(id, 0)
  dbInstance.transaction(() => {
    dbInstance.run(`DELETE FROM local_mod_library_entry WHERE library_id = ?`, [safeId])
    dbInstance.run(`DELETE FROM local_mod_library WHERE id = ?`, [safeId])
  })
}

export function insertVxpackHistory(payload = {}) {
  return dbInstance.run(
    `INSERT INTO vxpack_history (
       game_id, operation_type, package_path, manifest_version, mod_count,
       profile_count, size_bytes, created_at, state
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      toSafeNumber(payload.gameId ?? payload.game_id, 0),
      toSafeText(payload.operationType ?? payload.operation_type),
      toSafeText(payload.packagePath ?? payload.package_path),
      toSafeNumber(payload.manifestVersion ?? payload.manifest_version, 1),
      toSafeNumber(payload.modCount ?? payload.mod_count, 0),
      toSafeNumber(payload.profileCount ?? payload.profile_count, 0),
      toSafeNumber(payload.sizeBytes ?? payload.size_bytes, 0),
      toSafeText(payload.createdAt ?? payload.created_at, formatChinaTime()),
      toSafeText(payload.state, 'completed')
    ]
  )
}

export function listVxpackHistory(payload = {}) {
  const gameId = toSafeNumber(payload.gameId ?? payload.game_id, 0)
  const params = []
  const where = []
  if (gameId > 0) {
    where.push('game_id = ?')
    params.push(gameId)
  }
  return dbInstance.all(
    `SELECT *
     FROM vxpack_history
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 50`,
    params
  )
}
