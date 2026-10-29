import { communityImageSource } from '../../../shared/sources/source-network.js'

export function sourceError(code) {
  return Object.assign(new Error(code), { code, isSourceNetworkError: true })
}

export function assertSourceTarget(raw, source, method = 'GET', purpose = 'metadata') {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw sourceError('ERR_SOURCE_TARGET_REJECTED')
  const verb = method.toUpperCase()
  const allowed = purpose === 'image'
    ? verb === 'GET' && communityImageSource(raw) === source
    : purpose === 'profile-items'
      ? source === 'steam-workshop' && verb === 'GET' && url.hostname === 'api.steampowered.com' &&
        url.pathname === '/IPlayerService/GetProfileItemsEquipped/v1/' && /^\?steamid=\d{17}$/.test(url.search)
    : purpose === 'profile'
      ? source === 'steam-workshop' && verb === 'GET' && url.hostname === 'steamcommunity.com' &&
        /^\/profiles\/\d{17}\/$/.test(url.pathname) && url.search === '?xml=1'
    : source === 'steam-workshop'
      ? (verb === 'GET' && url.hostname === 'steamcommunity.com' && url.pathname === '/workshop/browse/') ||
        (verb === 'POST' && url.hostname === 'api.steampowered.com' && url.pathname === '/ISteamRemoteStorage/GetPublishedFileDetails/v1/')
      : source === 'gamebanana' && verb === 'GET' && url.hostname === 'gamebanana.com' && /^\/apiv11\/(?:Game\/|Mod\/|Util\/Search\/Results)/.test(url.pathname)
  if (!allowed) throw sourceError('ERR_SOURCE_TARGET_REJECTED')
  return url
}

export function verifiedImageMime(bytes, header = '') {
  const mime = String(header).split(';')[0].trim().toLowerCase()
  const hex = Buffer.from(bytes).subarray(0, 12).toString('hex')
  const valid = (['image/png', 'image/apng'].includes(mime) && hex.startsWith('89504e470d0a1a0a')) ||
    (['image/jpeg', 'image/jpg'].includes(mime) && hex.startsWith('ffd8ff')) ||
    (mime === 'image/gif' && hex.startsWith('47494638')) ||
    (mime === 'image/webp' && /^52494646[0-9a-f]{8}57454250/.test(hex)) ||
    (mime === 'image/avif' && Buffer.from(bytes).subarray(4, 12).toString() === 'ftypavif')
  if (!valid) throw sourceError('ERR_SOURCE_RESPONSE_INVALID')
  return mime === 'image/jpg' ? 'image/jpeg' : mime === 'image/apng' ? 'image/png' : mime
}
