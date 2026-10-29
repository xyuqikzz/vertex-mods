function toSafeQueryText(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim()
  }
  return String(value || '').trim()
}

export function normalizeSiteDetailQueryValue(value) {
  return toSafeQueryText(value)
}

export function resolveGameSiteDetailExternalUrl(routeLocation = {}) {
  const routeName = String(routeLocation?.name || '').trim()
  const routePath = String(routeLocation?.path || '').trim().replace(/\/$/, '')
  if (routeName !== 'GameSiteDetail' && routePath !== '/app/game/site/detail') {
    return ''
  }

  const url = toSafeQueryText(routeLocation?.query?.url)
  if (!url) return ''

  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? url : ''
  } catch {
    return ''
  }
}

export function buildGameSiteDetailRoute(payload = {}) {
  const query = Object.fromEntries(
    Object.entries({
      url: toSafeQueryText(payload.url),
      title: toSafeQueryText(payload.title),
      subtitle: toSafeQueryText(payload.subtitle),
      source: toSafeQueryText(payload.source),
      sourceKey: toSafeQueryText(payload.sourceKey),
      displaySource: toSafeQueryText(payload.displaySource),
      businessSource: toSafeQueryText(payload.businessSource),
      sourceLabel: toSafeQueryText(payload.sourceLabel),
      businessSourceLabel: toSafeQueryText(payload.businessSourceLabel),
      cover: toSafeQueryText(payload.cover),
      backPath: toSafeQueryText(payload.backPath),
      gameId: toSafeQueryText(payload.gameId),
      gameName: toSafeQueryText(payload.gameName),
      sourceGameId: toSafeQueryText(payload.sourceGameId),
      sourceSlug: toSafeQueryText(payload.sourceSlug),
      domainName: toSafeQueryText(payload.domainName),
      community: toSafeQueryText(payload.community),
      appId: toSafeQueryText(payload.appId),
      modId: toSafeQueryText(payload.modId),
      modName: toSafeQueryText(payload.modName),
      author: toSafeQueryText(payload.author),
      version: toSafeQueryText(payload.version)
    }).filter(([, value]) => value)
  )

  return {
    name: 'GameSiteDetail',
    query
  }
}
