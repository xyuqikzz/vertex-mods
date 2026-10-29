import { getSourcePlatformDefinition, normalizeSourcePlatform } from '../sources/source-platform-registry.js'

export function gameLibraryKey(game = {}) {
  const root = String(game.client_root_path || game.gameRoot || game.dir || '').trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  if (root) return `path:${root}`
  const appId = String(game.steamAppId || game.app_id || '').trim()
  if (appId && appId !== '0') return `steam:${appId}`
  return `source:${normalizeSourcePlatform(game.source)}:${game.source_id || game.id || ''}`
}

// Group only the presentation. Each source record retains its own ID, paths and installed mods.
export function groupGameLibrary(records = []) {
  const groups = new Map()
  for (const record of records) {
    const key = gameLibraryKey(record)
    if (!groups.has(key)) groups.set(key, { ...record, libraryKey: key, sourceEntries: [] })
    groups.get(key).sourceEntries.push(record)
  }
  return [...groups.values()].map(game => ({ ...game,
    availableSources: [...new Set(game.sourceEntries.map(record => normalizeSourcePlatform(record.source || record.currentSource)).filter(source => getSourcePlatformDefinition(source)))],
    sourceMeta: Object.assign({}, ...game.sourceEntries.map(record => Object.fromEntries(Object.entries(record.sourceMeta || {}).filter(([, value]) => value))))
  }))
}

export function sourceLibraryMeta(game = {}) {
  return {
    sourceId: String(game.source_id || game.sourceId || ''),
    sourceSlug: String(game.source_slug || game.sourceSlug || ''),
    modioGameId: String(game.source_id || game.modioGameId || ''),
    gameId: String(game.game_id || game.gameId || ''),
    backendGameId: String(game.game_id || ''),
    nameId: String(game.source_slug || ''),
    gameName: String(game.name || game.chineseTitle || ''),
    coverImage: String(game.cover_image || game.coverImage || '')
  }
}

export function sourceLibraryRoute(game, source, action = '') {
  const meta = game.sourceMeta?.[source] || sourceLibraryMeta(game)
  const id = meta.sourceId || meta.modioGameId || game.source_id
  if (!id) return null
  const query = {
    name: game.name || game.chineseTitle || '', gameName: game.name || game.chineseTitle || '',
    englishTitle: game.english_name || game.englishTitle || '', cover: game.cover_image || game.coverImage || '',
    sourceSlug: meta.sourceSlug || '', gameKey: game.gameKey || meta.sourceSlug || '',
    nameId: meta.nameId || '', appId: String(game.app_id || game.steamAppId || ''),
    gameId: String(meta.backendGameId || ''), ...(action ? { action } : {})
  }
  if (['gamebanana', 'steam-workshop'].includes(source)) return { path: `/app/game/community/${source}/${encodeURIComponent(id)}`, query }
  if (['modio', 'vamhub'].includes(source)) return { path: `/app/game/${source}/mod/list/${encodeURIComponent(id)}`, query }
  return null
}
