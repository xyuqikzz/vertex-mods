import { positivePlatformId } from './community-source.js'

export function buildWorkshopListRequest({ gameId, keyword = '', page = 1 } = {}) {
  return {
    url: 'https://steamcommunity.com/workshop/browse/',
    params: {
      appid: positivePlatformId(gameId),
      section: 'readytouseitems',
      browsesort: 'trend',
      p: Math.max(1, Math.floor(Number(page) || 1)),
      numperpage: 30,
      searchtext: String(keyword).trim().slice(0, 200),
      l: 'schinese'
    }
  }
}

export function normalizeWorkshopPage(html, gameId) {
  const appId = positivePlatformId(gameId)
  const formatError = () => new Error('Steam 模组列表格式发生变化或暂不可用，请重试或打开来源页面')
  let query
  try {
    // Steam 已将 SSR 引导数据迁到 JSON 节点；同时兼容旧页面，只解析 JSON。
    const source = String(html)
    const jsonScript = source.match(
      /<script\b(?=[^>]*\sid\s*=\s*(["'])valve-ssr-data\1)[^>]*>([\s\S]*?)<\/script\s*>/i
    )
    let context
    if (jsonScript) {
      context = JSON.parse(jsonScript[2]).renderContext
    } else {
      const match = source.match(
        /window\.SSR\.renderContext\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/
      )
      if (!match) throw formatError()
      context = JSON.parse(JSON.parse(match[1]))
    }
    const cache = JSON.parse(context.queryData)
    query = cache.queries.find(
      (entry) => entry.queryKey?.[0] === 'workshop_browse' &&
        String(entry.queryKey[1]?.appid) === appId
    )
  } catch {
    throw formatError()
  }
  const data = query?.state?.data
  if (Number(data?.eresult) !== 1 || !Array.isArray(data.results)) throw formatError()
  const authors = new Map(
    (data.creator_player_link_details || []).map(({ public_data: author }) => [
      String(author?.steamid), String(author?.persona_name || '')
    ])
  )
  const records = data.results.map((item) => {
    if (String(item.consumer_appid) !== appId) throw formatError()
    const id = positivePlatformId(item.publishedfileid, 18446744073709551615n)
    let image = ''
    try {
      const url = new URL(item.preview_url)
      if (url.protocol === 'https:' && !url.username && !url.password) image = url.href
    } catch { /* 没有封面时由列表显示占位图。 */ }
    return {
      id,
      name: String(item.title || '未命名模组'),
      image,
      author: authors.get(String(item.creator)) || '',
      description: String(item.short_description || ''),
      tags: (Array.isArray(item.tags) ? item.tags : []).map((tag) => String(tag.display_name || tag.tag || '')),
      url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
    }
  })
  return {
    records,
    total: Math.max(0, Number(data.total_count) || 0),
    current: Math.max(1, Number(data.current_page) || 1),
    // Steam 对可浏览页数有上限，不能用 total / size 替代服务端页数。
    pages: Math.max(1, Number(data.total_pages) || 1),
    size: Math.max(1, Number(query.queryKey[1].num_per_page) || 30)
  }
}
