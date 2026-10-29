// 首页游戏美术图：卡片优先保留来源封面，缺失或加载失败时按顺序尝试 Steam 图片。
const STEAM_ART_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps'

const STEAM_ART_FILES = Object.freeze({
  header: 'header.jpg',
  portrait: 'library_600x900.jpg',
  hero: 'library_hero.jpg'
})

export function resolveGameSteamAppId(game = {}) {
  const value = Number(game?.steamAppId || game?.app_id || game?.appId || game?.steam_app_id || 0)
  return Number.isInteger(value) && value > 0 ? value : 0
}

export function getSteamGameArtUrl(game = {}, kind = 'portrait') {
  const appId = resolveGameSteamAppId(game)
  const file = STEAM_ART_FILES[kind]
  if (!appId || !file) return ''
  return `${STEAM_ART_BASE}/${appId}/${file}`
}

export function getGameCoverUrl(game = {}) {
  return String(
    game?.displayCover || game?.coverImage || game?.cover_image || game?.backgroundImage || game?.background_image || ''
  ).trim()
}

export function getGameCoverFallbackUrls(game = {}) {
  // 横版封面适合快捷启动卡片；个别游戏未提供时再尝试轮播使用的大图。
  return ['header', 'hero'].map(kind => getSteamGameArtUrl(game, kind)).filter(Boolean)
}
