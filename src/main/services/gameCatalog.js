import { getGameList, getModListByAppIdSql } from '../db/games/game.js'
import {
  getModCountByAppId,
  getAllModDataByAppId,
  getRecentClientModsByGameIds
} from '../db/mods/mods.js'
import { pathExistsSync } from '../ipc/tool.js'
import { discoverLocalGames, registerLocalGameProvider } from './localGameLibrary.js'
import { gameLibraryKey } from '../../shared/games/game-library.js'
import store from '../storage/store/index.js'
registerLocalGameProvider('managed-mods', getGameList)

const REMOVED_MISSING_GAME_KEYS = 'gameLibrary.removedMissingGameKeys'

function getRemovedMissingGameKeys() {
  const keys = store.get(REMOVED_MISSING_GAME_KEYS, [])
  return new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [])
}

export function removeMissingDiscoveredGame(id) {
  const game = readGameListSnapshot().find((entry) => entry.discovered && entry.id === id)
  if (!game) return { success: false, code: 'game_not_found', message: '游戏库记录已变化，请刷新后重试' }
  if (game.isGameFolderExist || game.isGameLocalPathExist) {
    return { success: false, code: 'game_directory_available', message: '游戏目录已恢复，未移除自动识别记录，请刷新后重试' }
  }
  const keys = getRemovedMissingGameKeys()
  keys.add(gameLibraryKey(game))
  store.set(REMOVED_MISSING_GAME_KEYS, [...keys])
  return { success: true, message: '已移除失效的自动识别记录' }
}

// 查询只返回快照；IPC 通道与通知由接入层决定。
export function readGameAppIds() {
  const gameList = getGameList()
  const appidList = gameList.map((game) => game.app_id)
  return appidList
}

export function readGameListSnapshot() {
  const gameList = getGameList()

  gameList.forEach((game) => {
    game.isGameLocalPathExist = Boolean(game.client_exe_path?.trim()) && pathExistsSync(game.client_exe_path)
    game.isGameFolderExist = Boolean(game.client_root_path?.trim()) && pathExistsSync(game.client_root_path)
    if (game.is_server_installed) {
      game.isServerPathExist = Boolean(game.server_exe_path?.trim()) && pathExistsSync(game.server_exe_path)
    }
    const {
      clientModCount = 0,
      serverModCount = 0,
      clientActiveModCount = clientModCount
    } = getModCountByAppId(game.app_id, {
      source: game.source,
      sourceId: game.source_id,
      appId: game.app_id
    })
    game.clientModCount = clientModCount
    game.serverModCount = serverModCount
    game.clientActiveModCount = clientActiveModCount
  })

  const knownRoots = new Set(gameList.map(gameLibraryKey))
  const removedKeys = getRemovedMissingGameKeys()
  try {
    for (const game of discoverLocalGames()) {
      const key = gameLibraryKey(game)
      if (knownRoots.has(key)) continue
      const rootExists = Boolean(game.gameRoot) && pathExistsSync(game.gameRoot)
      // 只隐藏已移除且仍失效的自动识别条目；重新安装到原目录后允许重新出现。
      if (removedKeys.has(key) && !rootExists) continue
      gameList.push({
        id: `discovered:${key}`, name: game.name, app_id: game.steamAppId,
        client_root_path: game.gameRoot, client_exe_path: game.exePath || '', source: '', source_id: '',
        launcher: game.sourcePlatform, discovered: true,
        isGameLocalPathExist: (Boolean(game.exePath) && pathExistsSync(game.exePath)) || (Boolean(game.steamAppId) && rootExists), isGameFolderExist: rootExists,
        clientModCount: 0, serverModCount: 0
      })
    }
  } catch (error) { console.warn('[游戏库] 启动器扫描失败，保留本地管理记录', error.message) }
  return gameList
}

const RECENT_MOD_MAX_GAME_IDS = 20
const RECENT_MOD_MAX_LIMIT = 10

// 游戏库检视器的“最近安装”：入参只接受游戏记录 ID，结果只含展示字段。
export function readRecentInstalledMods(payload = {}) {
  const rawIds = Array.isArray(payload?.gameRowIds) ? payload.gameRowIds : []
  const gameRowIds = [...new Set(rawIds.map(Number))]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, RECENT_MOD_MAX_GAME_IDS)
  const requestedLimit = Number(payload?.limit)
  const limit = Math.min(
    RECENT_MOD_MAX_LIMIT,
    Math.max(1, Number.isSafeInteger(requestedLimit) ? requestedLimit : 3)
  )
  if (!gameRowIds.length) return { success: true, list: [] }
  try {
    const rows = getRecentClientModsByGameIds(gameRowIds, limit) || []
    return {
      success: true,
      list: rows.map((row) => ({
        id: row.id,
        gameRowId: row.game_id,
        source: String(row.source || ''),
        name: String(row.name || row.option_name || '').trim() || '未命名模组',
        version: String(row.mod_version || row.version || '').trim(),
        isActive: Number(row.is_active) === 1,
        installedAt: String(row.installed_at || row.created_at || '')
      }))
    }
  } catch (error) {
    return { success: false, list: [], code: error?.code || 'recent_mods_read_failed' }
  }
}

export function readLegacyModLists(payload) {
  const appId = typeof payload === 'object' ? payload?.appId : payload
  const sourceMeta = { source: 'server', appId, gameRowId: payload?.gameRowId }
  try {
    const clientList = getModListByAppIdSql(appId, 0, sourceMeta)
    const serverList = getModListByAppIdSql(appId, 1, sourceMeta)
    return { clientList, serverList }
  } catch (error) {
    return {
      clientList: [],
      serverList: [],
      success: false,
      code: error.code,
      message: error.message
    }
  }
}

export function readLegacyModInstallRecords(steamAppId) {
  const data = getAllModDataByAppId(steamAppId, 0, { source: 'server', appId: steamAppId }) || []
  return data
}
