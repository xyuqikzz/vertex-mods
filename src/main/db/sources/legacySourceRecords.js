import path from 'node:path'
import {
  getSourcePlatformDefinition,
  normalizeSourcePlatform
} from '../../../shared/sources/source-platform-registry.js'

// 别名可共存，但不同安装目录不能仅因 app_id 相同而被批量管理。
function legacyGameIdentity(game) {
  const normalizePath = (value) => value ? path.win32.normalize(String(value)).toLowerCase() : ''
  const roots = [game.client_root_path, game.client_exe_path, game.server_exe_path].map(normalizePath)
  return roots.some(Boolean) ? JSON.stringify(roots) : 'source:' + String(game.source_id || '')
}

export function listLegacySourceMods(db, appId, endpointType, profileName = '', selection = {}) {
  const id = String(appId || '').trim()
  if (!id) return []
  const definition = getSourcePlatformDefinition('vertex')
  const aliases = [definition.key, ...definition.aliases]
  const games = db.all(
    `SELECT * FROM games WHERE lower(source) IN (${aliases.map(() => '?').join(',')}) AND app_id = ?`,
    [...aliases, id]
  )
  if (!games.length) return []
  const selected = selection.gameRowId ? games.find((game) => Number(game.id) === Number(selection.gameRowId)) : null
  if (selection.gameRowId && !selected) return []
  const identities = new Set(games.map(legacyGameIdentity))
  if (!selected && identities.size > 1) {
    throw Object.assign(new Error('历史游戏存在多个安装目录或来源标识，请从游戏库选择对应记录后管理'), { code: 'ambiguous_legacy_game' })
  }
  const identity = selected ? legacyGameIdentity(selected) : identities.values().next().value
  const gameIds = games.filter((game) => legacyGameIdentity(game) === identity).map((game) => game.id)
  return db.all(
    `SELECT m.* FROM mods m WHERE m.game_id IN (${gameIds.map(() => '?').join(',')})
      AND m.endpoint_type = ? ${profileName ? "AND lower(COALESCE(NULLIF(m.profile_name, ''), 'default')) = ?" : ''}
      ORDER BY m.priority_order ASC, m.id ASC`,
    [...gameIds, Number(endpointType || 0), ...(profileName ? [profileName.toLowerCase()] : [])]
  )
}

export function isLegacySource(source) {
  return normalizeSourcePlatform(source) === 'vertex'
}

export function createLegacyRecordExport(records = []) {
  const keys = [
    'id',
    'game_id',
    'source',
    'mod_id',
    'option_id',
    'source_mod_key',
    'name',
    'option_name',
    'version',
    'endpoint_type',
    'profile_name',
    'install_model',
    'install_paths_json',
    'files_json',
    'dependencies_json',
    'staging_path',
    'target_path',
    'archive_path',
    'priority_order',
    'deploy_domain'
  ]
  return {
    format: 'vertex.legacy-mod-records',
    version: 1,
    records: records.map((record) =>
      Object.fromEntries(
        keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])
      )
    )
  }
}
