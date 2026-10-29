import { discover } from './dlss/swapper/library.js'
import { gameLibraryKey } from '../../shared/games/game-library.js'

let cached = null
let scannedAt = 0
const localProviders = new Map()
export function registerLocalGameProvider(key, readRecords) { localProviders.set(key, readRecords) }
// Reuse launcher discovery for the home page, game library and DLSS. Never write launcher data.
export function discoverLocalGames({ force = false } = {}) {
  if (!cached || force || Date.now() - scannedAt > 60000) {
    cached = discover([], false).games.map(game => ({
      name: game.name, gameRoot: game.dir, sourcePlatform: game.launcher,
      steamAppId: game.launcher === 'Steam' ? String(game.id || '') : ''
    }))
    scannedAt = Date.now()
  }
  const games = new Map(cached.map(game => [gameLibraryKey(game), { ...game }]))
  for (const readRecords of localProviders.values()) {
    for (const record of readRecords()) {
      const game = {
        name: record.name,
        gameRoot: record.gameRoot || record.client_root_path,
        exePath: record.exePath || record.client_exe_path || '',
        sourcePlatform: record.sourcePlatform || record.source || '',
        steamAppId: String(record.steamAppId || record.app_id || '')
      }
      if (!game.gameRoot) continue
      const key = gameLibraryKey(game)
      const existing = games.get(key)
      games.set(key, { ...existing, ...game, name: game.name || existing?.name || '',
        exePath: game.exePath || existing?.exePath || '', steamAppId: game.steamAppId || existing?.steamAppId || '' })
    }
  }
  return [...games.values()]
}
