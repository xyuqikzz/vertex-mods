import dbInstance from '../dbInstance.js'
import { formatChinaTime } from '../../utils/dateTime.js'
import { getParentPath } from '../../utils/filePath.js'

function toSafeText(value) {
  return String(value || '').trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

export function normalizeGameSourceMeta(payload = {}) {
  const target = payload && typeof payload === 'object' ? payload : {}
  return {
    source: toSafeText(target.source).toLowerCase(),
    sourceId: toSafeText(
      target.sourceId ??
        target.source_id ??
        target.id ??
        target.community ??
        target.communityId ??
        target.domainName ??
        target.domain_name ??
        target.nexusGameId ??
        target.nexus_game_id ??
        target.modioGameId ??
        target.modio_game_id
    ),
    sourceSlug: toSafeText(
      target.sourceSlug ??
        target.source_slug ??
        target.community ??
        target.domainName ??
        target.domain_name ??
        target.nameId ??
        target.name_id
    ),
    gameId: toSafeNumber(target.gameId ?? target.game_id, 0),
    appId: toSafeText(target.appId ?? target.app_id ?? target.steamAppId ?? target.steam_app_id),
    name: toSafeText(target.name ?? target.gameName ?? target.game_name ?? target.title),
    englishName: toSafeText(
      target.englishName ?? target.english_name ?? target.subtitle ?? target.englishTitle
    ),
    coverImage: toSafeText(
      target.coverImage ?? target.cover_image ?? target.logoUrl ?? target.logo_url ?? target.cover
    ),
    backgroundImage: toSafeText(
      target.backgroundImage ??
        target.background_image ??
        target.heroImage ??
        target.hero_image ??
        target.coverImage ??
        target.cover_image ??
        target.cover
    ),
    description: toSafeText(target.description ?? target.summary ?? target.shortDescription),
    metadata: target.metadata && typeof target.metadata === 'object' ? target.metadata : {}
  }
}

function stringifyJson(value, fallback = '{}') {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

export function findGameRecord(payload = {}) {
  const sourceMeta = normalizeGameSourceMeta(payload)
  const clauses = []
  const params = []
  const hasExplicitSource = !!sourceMeta.source

  if (sourceMeta.source && sourceMeta.sourceId) {
    clauses.push('(source = ? AND source_id = ?)')
    params.push(sourceMeta.source, sourceMeta.sourceId)
  }

  if (sourceMeta.source && sourceMeta.sourceSlug) {
    clauses.push('(source = ? AND source_slug = ?)')
    params.push(sourceMeta.source, sourceMeta.sourceSlug)
  }

  if (sourceMeta.source && sourceMeta.appId) {
    clauses.push('(source = ? AND app_id = ?)')
    params.push(sourceMeta.source, sourceMeta.appId)
  }

  if (!hasExplicitSource && sourceMeta.appId) {
    clauses.push('(app_id = ?)')
    params.push(sourceMeta.appId)
  }

  if (!clauses.length) {
    return null
  }

  return dbInstance.get(
    `SELECT *
     FROM games
     WHERE ${clauses.join(' OR ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    params
  )
}

export async function upsertGameRecord(
  appId,
  exePath,
  gameId,
  clientRootPath = '',
  sourceMeta = {}
) {
  const normalizedSourceMeta = normalizeGameSourceMeta({
    ...sourceMeta,
    appId: sourceMeta?.appId || appId,
    gameId: sourceMeta?.gameId || gameId
  })
  const safeExePath = toSafeText(exePath)
  const safeRootPath = toSafeText(clientRootPath) || getParentPath(safeExePath)
  const now = formatChinaTime()

  if (!normalizedSourceMeta.source || !normalizedSourceMeta.sourceId) {
    throw new Error('缺少来源标识，无法写入游戏记录')
  }

  const record = findGameRecord(normalizedSourceMeta)

  if (!record) {
    return dbInstance.run(
      `INSERT INTO games
       (source, source_id, source_slug, game_id, app_id, name, english_name, cover_image, background_image, description, client_root_path, client_exe_path, server_exe_path, is_server_installed, server_install_mod_type, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedSourceMeta.source,
        normalizedSourceMeta.sourceId,
        normalizedSourceMeta.sourceSlug,
        normalizedSourceMeta.gameId,
        normalizedSourceMeta.appId,
        normalizedSourceMeta.name,
        normalizedSourceMeta.englishName,
        normalizedSourceMeta.coverImage,
        normalizedSourceMeta.backgroundImage,
        normalizedSourceMeta.description,
        safeRootPath,
        safeExePath,
        '',
        0,
        0,
        stringifyJson(normalizedSourceMeta.metadata, '{}'),
        now,
        now
      ]
    )
  }

  return dbInstance.run(
    `UPDATE games
     SET source_slug             = CASE WHEN ? <> '' THEN ? ELSE source_slug END,
         game_id                 = CASE WHEN ? > 0 THEN ? ELSE game_id END,
         app_id                  = CASE WHEN ? <> '' THEN ? ELSE app_id END,
         name                    = CASE WHEN ? <> '' THEN ? ELSE name END,
         english_name            = CASE WHEN ? <> '' THEN ? ELSE english_name END,
         cover_image             = CASE WHEN ? <> '' THEN ? ELSE cover_image END,
         background_image        = CASE WHEN ? <> '' THEN ? ELSE background_image END,
         description             = CASE WHEN ? <> '' THEN ? ELSE description END,
         client_root_path        = CASE WHEN ? <> '' THEN ? ELSE client_root_path END,
         client_exe_path         = CASE WHEN ? <> '' THEN ? ELSE client_exe_path END,
         metadata_json           = CASE WHEN ? <> '{}' THEN ? ELSE metadata_json END,
         updated_at              = ?
     WHERE id = ?`,
    [
      normalizedSourceMeta.sourceSlug,
      normalizedSourceMeta.sourceSlug,
      normalizedSourceMeta.gameId,
      normalizedSourceMeta.gameId,
      normalizedSourceMeta.appId,
      normalizedSourceMeta.appId,
      normalizedSourceMeta.name,
      normalizedSourceMeta.name,
      normalizedSourceMeta.englishName,
      normalizedSourceMeta.englishName,
      normalizedSourceMeta.coverImage,
      normalizedSourceMeta.coverImage,
      normalizedSourceMeta.backgroundImage,
      normalizedSourceMeta.backgroundImage,
      normalizedSourceMeta.description,
      normalizedSourceMeta.description,
      safeRootPath,
      safeRootPath,
      safeExePath,
      safeExePath,
      stringifyJson(normalizedSourceMeta.metadata, '{}'),
      stringifyJson(normalizedSourceMeta.metadata, '{}'),
      now,
      record.id
    ]
  )
}
