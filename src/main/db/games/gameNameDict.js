import { createHash } from 'crypto'
import dbInstance from '../dbInstance.js'

const META_LAST_ALIAS_ID = 'lastAliasId'
const META_LEGACY_LAST_CHANGE_ID = 'lastChangeId'
const META_VERSION_NO = 'versionNo'
const META_SNAPSHOT_READY = 'snapshotReady'
const META_SNAPSHOT_VERSION = 'snapshotVersion'

function toSafeText(value) {
  return String(value ?? '').trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

export function normalizeGameNameDictSource(value = '') {
  const text = toSafeText(value)
    .toLowerCase()
    .replace(/[\s._-]+/g, '')

  if (text === 'modio') return 'modio'
  if (text === 'nexus') return 'nexus'
  if (text === 'thunderstore') return 'thunderstore'
  if (text === 'ficsit') return 'ficsit'
  if (text === 'steam') return 'steam'
  if (text === 'global') return 'global'
  return toSafeText(value).toLowerCase()
}

export function normalizeGameNameDictKey(value = '') {
  return toSafeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

export function createGameNameDictKeyHash(value = '') {
  const normalized = normalizeGameNameDictKey(value)
  if (!normalized) {
    return ''
  }
  return createHash('sha256').update(normalized).digest('hex')
}

function normalizeAliasRecord(record = {}) {
  const source = record && typeof record === 'object' ? record : {}
  const rawName = toSafeText(source.rawName ?? source.raw_name)
  const normalizedKey = toSafeText(source.normalizedKey ?? source.normalized_key) ||
    normalizeGameNameDictKey(rawName)

  return {
    id: Math.trunc(toSafeNumber(source.id, 0)),
    sourcePlatform: normalizeGameNameDictSource(source.sourcePlatform ?? source.source_platform),
    rawName,
    normalizedKey,
    normalizedKeyHash:
      toSafeText(source.normalizedKeyHash ?? source.normalized_key_hash) ||
      createGameNameDictKeyHash(normalizedKey),
    chineseName: toSafeText(source.chineseName ?? source.chinese_name),
    isDeleted: Math.trunc(toSafeNumber(source.isDeleted ?? source.is_deleted, 0))
  }
}

function upsertAliasRecord(record = {}) {
  const alias = normalizeAliasRecord(record)
  if (!alias.id) {
    return 0
  }

  const result = dbInstance.run(
    `
      INSERT INTO game_name_dict_alias (
        id,
        source_platform,
        raw_name,
        normalized_key,
        normalized_key_hash,
        chinese_name,
        is_deleted,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        source_platform = excluded.source_platform,
        raw_name = excluded.raw_name,
        normalized_key = excluded.normalized_key,
        normalized_key_hash = excluded.normalized_key_hash,
        chinese_name = excluded.chinese_name,
        is_deleted = excluded.is_deleted,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      alias.id,
      alias.sourcePlatform,
      alias.rawName,
      alias.normalizedKey,
      alias.normalizedKeyHash,
      alias.chineseName,
      alias.isDeleted
    ]
  )
  return Math.max(toSafeNumber(result?.changes, 0), 0)
}

export function getGameNameDictMeta(key, defaultValue = '') {
  const row = dbInstance.get(`SELECT value FROM game_name_dict_meta WHERE key = ? LIMIT 1`, [
    toSafeText(key)
  ])
  return row ? String(row.value ?? '') : defaultValue
}

export function setGameNameDictMeta(key, value) {
  dbInstance.run(
    `
      INSERT INTO game_name_dict_meta (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [toSafeText(key), toSafeText(value)]
  )
}

export function getLocalGameNameDictCursor() {
  const lastAliasId = getGameNameDictMeta(META_LAST_ALIAS_ID, '')
  if (lastAliasId) {
    return Math.max(toSafeNumber(lastAliasId, 0), 0)
  }
  return Math.max(toSafeNumber(getGameNameDictMeta(META_LEGACY_LAST_CHANGE_ID, '0'), 0), 0)
}

export function isLocalGameNameDictSnapshotReady() {
  return getGameNameDictMeta(META_SNAPSHOT_READY, '') === '1'
}

export function setLocalGameNameDictVersion(versionNo = '') {
  setGameNameDictMeta(META_VERSION_NO, versionNo)
}

export function getLocalGameNameDictSnapshotVersion() {
  return getGameNameDictMeta(META_SNAPSHOT_VERSION, '')
}

export function setLocalGameNameDictSnapshotVersion(snapshotVersion = '') {
  setGameNameDictMeta(META_SNAPSHOT_VERSION, snapshotVersion)
}

export function resetLocalGameNameDict() {
  dbInstance.transaction(() => {
    dbInstance.run(`DELETE FROM game_name_dict_alias`)
    setGameNameDictMeta(META_LAST_ALIAS_ID, '0')
    setGameNameDictMeta(META_SNAPSHOT_READY, '0')
  })
}

export function applyGameNameDictSnapshot(records = []) {
  const safeRecords = Array.isArray(records) ? records : []
  let changedCount = 0
  dbInstance.transaction(() => {
    safeRecords.forEach((record) => {
      changedCount += upsertAliasRecord({
        ...record,
        isDeleted: 0
      })
    })
  })
  return changedCount
}

export function finishGameNameDictSnapshot(serverChangeId = 0, versionNo = '', snapshotVersion = '') {
  dbInstance.transaction(() => {
    setGameNameDictMeta(META_LAST_ALIAS_ID, String(Math.max(toSafeNumber(serverChangeId, 0), 0)))
    setGameNameDictMeta(META_SNAPSHOT_READY, '1')
    if (toSafeText(versionNo)) {
      setLocalGameNameDictVersion(versionNo)
    }
    if (toSafeText(snapshotVersion)) {
      setLocalGameNameDictSnapshotVersion(snapshotVersion)
    }
  })
}

function selectBestAliasBySql(sql, params = []) {
  const row = dbInstance.get(sql, params)
  if (!row) {
    return null
  }
  return {
    id: row.id,
    chineseName: toSafeText(row.chinese_name),
    rawName: toSafeText(row.raw_name),
    sourcePlatform: toSafeText(row.source_platform),
    matchType: ''
  }
}

function mapAliasRow(row = {}) {
  return {
    id: row.id,
    chineseName: toSafeText(row.chinese_name),
    rawName: toSafeText(row.raw_name),
    sourcePlatform: toSafeText(row.source_platform),
    matchType: ''
  }
}

function selectBestAliasByChineseName(keyword = '') {
  const text = toSafeText(keyword)
  const normalizedKey = normalizeGameNameDictKey(text)
  if (!text || !normalizedKey) {
    return null
  }

  const rows = dbInstance.all(
    `
      SELECT *
      FROM game_name_dict_alias
      WHERE is_deleted = 0
        AND chinese_name <> ''
        AND (chinese_name = ? OR chinese_name LIKE ?)
      ORDER BY
        CASE WHEN source_platform = 'global' THEN 0 ELSE 1 END,
        id DESC
      LIMIT 80
    `,
    [text, `%${text}%`]
  )

  const aliases = Array.isArray(rows) ? rows.map(mapAliasRow) : []
  return (
    aliases.find((item) => normalizeGameNameDictKey(item.chineseName) === normalizedKey) ||
    aliases.find((item) => normalizeGameNameDictKey(item.chineseName).includes(normalizedKey)) ||
    null
  )
}

function buildResolvedName(input = {}, alias = null, matchType = 'fallback') {
  const rawName = toSafeText(
    input.rawName ??
      input.raw_name ??
      input.englishTitle ??
      input.english_title ??
      input.name ??
      input.chineseTitle ??
      input.chinese_title
  )

  if (!alias || !toSafeText(alias.chineseName)) {
    return {
      displayName: rawName,
      chineseName: '',
      rawName,
      matched: false,
      matchType: 'fallback'
    }
  }

  return {
    displayName: alias.chineseName,
    chineseName: alias.chineseName,
    rawName: alias.rawName || rawName,
    matched: true,
    matchType,
    aliasId: alias.id,
    sourcePlatform: alias.sourcePlatform
  }
}

export function resolveGameNameDict(input = {}) {
  const sourcePlatform = normalizeGameNameDictSource(
    input.sourcePlatform ?? input.source_platform ?? input.source ?? input.sourceType
  )
  const rawName = toSafeText(
    input.rawName ??
      input.raw_name ??
      input.englishTitle ??
      input.english_title ??
      input.name ??
      input.chineseTitle ??
      input.chinese_title
  )
  const normalizedKey = normalizeGameNameDictKey(rawName)
  const normalizedKeyHash = createGameNameDictKeyHash(normalizedKey)

  if (normalizedKeyHash && normalizedKey) {
    const alias = selectBestAliasBySql(
      `
        SELECT *
        FROM game_name_dict_alias
        WHERE is_deleted = 0
          AND source_platform = 'global'
          AND normalized_key_hash = ?
          AND normalized_key = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [normalizedKeyHash, normalizedKey]
    )
    if (alias) return buildResolvedName(input, alias, 'global_name')
  }

  if (sourcePlatform && normalizedKeyHash && normalizedKey) {
    const alias = selectBestAliasBySql(
      `
        SELECT *
        FROM game_name_dict_alias
        WHERE is_deleted = 0
          AND source_platform = ?
          AND normalized_key_hash = ?
          AND normalized_key = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [sourcePlatform, normalizedKeyHash, normalizedKey]
    )
    if (alias) return buildResolvedName(input, alias, 'normalized_name')
  }

  if (normalizedKeyHash && normalizedKey) {
    const alias = selectBestAliasBySql(
      `
        SELECT *
        FROM game_name_dict_alias
        WHERE is_deleted = 0
          AND source_platform <> 'global'
          AND normalized_key_hash = ?
          AND normalized_key = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [normalizedKeyHash, normalizedKey]
    )
    if (alias) return buildResolvedName(input, alias, 'cross_platform_name')
  }

  return buildResolvedName(input, null)
}

export function resolveGameNameDictBatch(items = []) {
  const list = Array.isArray(items) ? items : []
  return list.map((item) => resolveGameNameDict(item))
}

export function resolveGameNameDictSearchName(input = {}) {
  const keyword = toSafeText(
    input.keyword ??
      input.name ??
      input.chineseName ??
      input.chinese_name ??
      input.rawName ??
      input.raw_name
  )
  const alias = selectBestAliasByChineseName(keyword)
  if (!alias?.rawName) {
    return {
      searchName: keyword,
      rawName: keyword,
      chineseName: '',
      matched: false,
      matchType: 'fallback'
    }
  }

  return {
    searchName: alias.rawName,
    rawName: alias.rawName,
    chineseName: alias.chineseName,
    matched: true,
    matchType: 'chinese_name',
    aliasId: alias.id,
    sourcePlatform: alias.sourcePlatform
  }
}

export function resolveGameNameDictSearchNameBatch(items = []) {
  const list = Array.isArray(items) ? items : []
  return list.map((item) => resolveGameNameDictSearchName(item))
}
