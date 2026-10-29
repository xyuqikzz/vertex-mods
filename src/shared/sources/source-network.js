export function isSteamAvatarUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return false
    if (/^avatars\.(?:(?:akamai|cloudflare|fastly)\.)?steamstatic\.com$/.test(url.hostname))
      return /^\/[a-f0-9]{40}(?:_medium|_full)?\.jpg$/i.test(url.pathname)
    return ['steamcdn-a.akamaihd.net', 'cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com'].includes(url.hostname) &&
      /^\/steamcommunity\/public\/images\/avatars\/[a-f0-9]{2}\/[a-f0-9]{40}(?:_medium|_full)?\.jpg$/i.test(url.pathname)
  } catch { return false }
}

export function normalizeSteamProfileItemImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  const root = 'https://shared.fastly.steamstatic.com/community_assets/images/'
  const itemPath = /^items\/\d+\/[a-z0-9_-]+\.(?:png|gif|webp|jpe?g|avif)$/i
  if (itemPath.test(value)) return root + value
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash ||
      !['cdn.akamai.steamstatic.com', 'cdn.fastly.steamstatic.com', 'cdn.cloudflare.steamstatic.com', 'shared.fastly.steamstatic.com'].includes(url.hostname)) return ''
    const match = url.pathname.match(/^\/(?:steamcommunity\/public|community_assets)\/images\/(items\/.+)$/)
    // Steam 新装扮不再保证旧目录可用；读取旧账号缓存时也转换，避免继续使用 404 地址。
    return match && itemPath.test(match[1]) ? root + match[1] : ''
  } catch { return '' }
}

export function isSteamProfileItemImageUrl(value) {
  return typeof value === 'string' && value.startsWith('https://') && Boolean(normalizeSteamProfileItemImageUrl(value))
}

export function communityImageSource(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 4096) return ''
    // Only public preview parameters are accepted; signed download URLs are not image capabilities.
    if ([...url.searchParams.keys()].some(key => !['imw', 'imh', 'ima', 'imcolor', 'letterbox', 't', 'w', 'h', 'fit'].includes(key))) return ''
    if (isSteamAvatarUrl(value) || isSteamProfileItemImageUrl(value) || ['images.steamusercontent.com', 'steamuserimages-a.akamaihd.net', 'cdn.cloudflare.steamstatic.com', 'shared.fastly.steamstatic.com', 'cdn.akamai.steamstatic.com'].includes(url.hostname)) return 'steam-workshop'
    if (url.hostname === 'images.gamebanana.com') return 'gamebanana'
  } catch { /* Not a supported public source image. */ }
  return ''
}

export function sourceNetworkMessage(code) {
  if (code === 'ERR_SOURCE_RESPONSE_INVALID') return '来源返回了验证页面或无法识别的数据，请稍后重试或查看来源页面。'
  return ''
}
