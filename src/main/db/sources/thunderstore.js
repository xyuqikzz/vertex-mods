import dbInstance from '../dbInstance.js'
import { insertMod } from '../mods/mods.js'
import { getGameDataByAppId } from '../games/game.js'

function normalizeCommunity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function normalizeProfileName(value) {
  const raw = String(value || 'default').trim()
  return raw || 'default'
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback
  }
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function buildInstalledRowData(row) {
  return {
    id: Number(row.id || 0),
    fullName: row.source_mod_key,
    version: row.version,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    installState: Number(row.install_state || 0),
    isActive: Number(row.is_active || 0),
    packageOwner: row.package_owner,
    packageName: row.package_name,
    dependencies: parseJson(row.dependencies_json, []),
    files: parseJson(row.files_json, []),
    metadata: parseJson(row.metadata_json, {})
  }
}

function getThunderstoreGame(community, appId = '') {
  return getGameDataByAppId(appId, {
    source: 'thunderstore',
    sourceId: community,
    sourceSlug: community,
    appId
  })
}

export function upsertThunderstoreProfile(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  if (!community) {
    throw new Error('community 不能为空')
  }

  const now = new Date().toISOString()
  const game = getThunderstoreGame(community, payload.appId || '')
  const sql = `
    INSERT INTO thunderstore_profiles (
      game_id, community, profile_name, package_loader, app_id, game_exe_path, profile_root, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(community, profile_name) DO UPDATE SET
      game_id=excluded.game_id,
      package_loader=excluded.package_loader,
      app_id=excluded.app_id,
      game_exe_path=excluded.game_exe_path,
      profile_root=excluded.profile_root,
      updated_at=excluded.updated_at
  `

  dbInstance.run(sql, [
    Number(game?.id || 0),
    community,
    profileName,
    String(payload.packageLoader || ''),
    String(payload.appId || ''),
    String(payload.gameExePath || ''),
    String(payload.profileRoot || ''),
    now,
    now
  ])
}

export function upsertThunderstoreInstalledMod(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const fullName = String(payload.packageFullName || '').trim()
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community) {
    throw new Error('community 不能为空')
  }
  if (!fullName) {
    throw new Error('packageFullName 不能为空')
  }
  if (!game?.id) {
    throw new Error('未找到对应的 Thunderstore 游戏记录')
  }

  return insertMod({
    gameRowId: Number(game.id),
    source: 'thunderstore',
    modId: fullName,
    source_mod_key: fullName,
    modName: String(payload.displayName || payload.packageName || fullName),
    name: String(payload.packageName || fullName),
    option_name: String(payload.version || payload.packageName || fullName),
    version: String(payload.version || ''),
    downloadUrl: String(payload.downloadUrl || payload.metadata?.downloadUrl || ''),
    fileSize: Number(payload.fileSize || payload.metadata?.fileSize || 0),
    cover: String(payload.cover || payload.metadata?.icon || payload.metadata?.coverImage || ''),
    dependencies: Array.isArray(payload.dependencies) ? payload.dependencies : [],
    files: Array.isArray(payload.files) ? payload.files : [],
    metadata: payload.metadata || {},
    packageOwner: String(payload.packageOwner || ''),
    packageName: String(payload.packageName || ''),
    profileName,
    archivePath: String(payload.archivePath || payload.metadata?.archivePath || ''),
    targetPath: String(payload.targetPath || payload.metadata?.targetPath || ''),
    fileMD5: String(payload.fileMD5 || payload.metadata?.fileMd5 || ''),
    modVersion: String(payload.modVersion || payload.version || ''),
    endpoint_type: 0,
    installState: payload.enabled === false ? 0 : 1,
    isActive: payload.enabled === false ? 0 : 1,
    installedAt: String(payload.installedAt || new Date().toISOString()),
    updatedAt: new Date().toISOString()
  })
}

export function getThunderstoreProfile(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  if (!community) {
    return null
  }

  const row = dbInstance.get(
    `
      SELECT
        game_id,
        community,
        profile_name,
        package_loader,
        app_id,
        game_exe_path,
        profile_root,
        created_at,
        updated_at
      FROM thunderstore_profiles
      WHERE community = ? AND profile_name = ?
      LIMIT 1
      `,
    [community, profileName]
  )

  if (!row) {
    return null
  }

  return {
    gameId: Number(row.game_id || 0),
    community: row.community,
    profileName: row.profile_name,
    packageLoader: row.package_loader,
    appId: String(row.app_id || ''),
    gameExePath: String(row.game_exe_path || ''),
    profileRoot: String(row.profile_root || ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function getThunderstoreInstalledMap(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community || !game?.id) {
    return {}
  }

  const rows = dbInstance.all(
    `
      SELECT *
      FROM mods
      WHERE game_id = ?
        AND source = 'thunderstore'
        AND profile_name = ?
      ORDER BY datetime(updated_at) DESC, id DESC
      `,
    [game.id, profileName]
  )

  const map = {}
  for (const row of rows) {
    map[row.source_mod_key] = buildInstalledRowData(row)
  }
  return map
}

export function getThunderstoreInstalledRecord(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const fullName = String(payload.packageFullName || '').trim()
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community || !fullName || !game?.id) {
    return null
  }

  const row = dbInstance.get(
    `
      SELECT *
      FROM mods
      WHERE game_id = ?
        AND source = 'thunderstore'
        AND profile_name = ?
        AND source_mod_key = ?
      LIMIT 1
      `,
    [game.id, profileName, fullName]
  )

  return row ? buildInstalledRowData(row) : null
}

export function listThunderstoreInstalledMods(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community || !game?.id) {
    return []
  }

  const rows = dbInstance.all(
    `
      SELECT *
      FROM mods
      WHERE game_id = ?
        AND source = 'thunderstore'
        AND profile_name = ?
      ORDER BY datetime(updated_at) DESC, id DESC
      `,
    [game.id, profileName]
  )

  return rows.map((row) => buildInstalledRowData(row))
}

export function removeThunderstoreInstalledMod(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const fullName = String(payload.packageFullName || '').trim()
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community || !fullName || !game?.id) {
    return 0
  }

  const result = dbInstance.run(
    `
      DELETE FROM mods
      WHERE game_id = ?
        AND source = 'thunderstore'
        AND profile_name = ?
        AND source_mod_key = ?
      `,
    [game.id, profileName, fullName]
  )

  return Number(result?.changes || 0)
}

export function removeAllThunderstoreInstalledModsByProfile(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community || !game?.id) {
    return 0
  }

  const result = dbInstance.run(
    `
      DELETE FROM mods
      WHERE game_id = ?
        AND source = 'thunderstore'
        AND profile_name = ?
      `,
    [game.id, profileName]
  )

  return Number(result?.changes || 0)
}

export function removeThunderstoreProfile(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  if (!community) {
    return 0
  }

  const result = dbInstance.run(
    `
      DELETE FROM thunderstore_profiles
      WHERE community = ?
        AND profile_name = ?
      `,
    [community, profileName]
  )

  return Number(result?.changes || 0)
}

export function updateThunderstoreInstalledModState(payload = {}) {
  const community = normalizeCommunity(payload.community)
  const profileName = normalizeProfileName(payload.profileName)
  const fullName = String(payload.packageFullName || '').trim()
  const game = getThunderstoreGame(community, payload.appId || '')

  if (!community || !fullName || !game?.id) {
    return 0
  }

  const current = getThunderstoreInstalledRecord({
    community,
    profileName,
    packageFullName: fullName,
    appId: payload.appId || ''
  })
  if (!current) {
    return 0
  }

  const nextMetadata =
    payload.metadata && typeof payload.metadata === 'object'
      ? {
          ...(current.metadata || {}),
          ...payload.metadata
        }
      : current.metadata || {}

  const result = dbInstance.run(
    `
      UPDATE mods
      SET install_state = ?,
          is_active = ?,
          metadata_json = ?,
          updated_at = ?
      WHERE game_id = ?
        AND source = 'thunderstore'
        AND profile_name = ?
        AND source_mod_key = ?
      `,
    [
      Number(payload.enabled ? 1 : 0),
      Number(payload.enabled ? 1 : 0),
      JSON.stringify(nextMetadata),
      new Date().toISOString(),
      game.id,
      profileName,
      fullName
    ]
  )

  return Number(result?.changes || 0)
}
