export function positivePlatformId(value, max = 4294967295n) {
  const text = String(value ?? '').trim()
  if (!/^[1-9]\d{0,19}$/.test(text) || BigInt(text) > max) throw new Error('来源标识无效')
  return text
}

export function normalizeWorkshopGames(records) {
  if (!Array.isArray(records)) throw new Error('Steam游戏列表格式异常')
  return records
    .filter((record) => record.enabled !== 0 && record.enabled !== false)
    .map((record) => {
      const steamAppId = positivePlatformId(record.steamAppId)
      return {
        id: steamAppId,
        steamAppId,
        gameKey: record.gameKey || '',
        sourceGameId: steamAppId,
        sourcePlatform: 'steam-workshop',
        chineseTitle: String(record.chineseTitle || ''),
        englishTitle: String(record.englishTitle || ''),
        coverImage: String(record.coverImage || ''),
        isHasRule: 0
      }
    })
}

export function gamebananaGamesPage(page) {
  return {
    ...page,
    records: page.records.map((game) => ({
      id: game.id,
      sourceGameId: game.id,
      sourcePlatform: 'gamebanana',
      englishTitle: game.name,
      chineseTitle: '',
      coverImage: game.image,
      isHasRule: 0
    }))
  }
}

export function getCommunityGameUrl(source, id) {
  const validId = positivePlatformId(id)
  if (source === 'steam-workshop')
    return `https://steamcommunity.com/workshop/browse/?appid=${validId}`
  if (source === 'gamebanana') return `https://gamebanana.com/games/${validId}`
  throw new Error('不支持的社区来源')
}

// 只从实际浏览地址提取 ID，网页标题、下载地址和本地路径均不作为可信输入。
export function parseCommunityModUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if (url.hostname === 'gamebanana.com') {
      const match = url.pathname.match(/^\/mods\/([1-9]\d*)\/?$/)
      return match ? { source: 'gamebanana', modId: positivePlatformId(match[1]) } : null
    }
    if (
      url.hostname === 'steamcommunity.com' &&
      /^\/(?:sharedfiles|workshop)\/filedetails\/?$/.test(url.pathname)
    ) {
      return {
        source: 'steam-workshop',
        modId: positivePlatformId(url.searchParams.get('id'), 18446744073709551615n)
      }
    }
  } catch {
    /* 非模组页没有下载操作 */
  }
  return null
}
