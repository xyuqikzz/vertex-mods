import { load } from 'cheerio'
import { isSteamAvatarUrl, normalizeSteamProfileItemImageUrl } from '../../../shared/sources/source-network.js'

export const isSteamUserId = (value) =>
  typeof value === 'string' && /^\d{17}$/.test(value) &&
  BigInt(value) > 76561197960265728n && BigInt(value) <= 76561202255233023n

// 仅从已保存会话提取公开资料的查询标识，不以未验签的 JWT 判定登录有效性。
export function steamSessionUserId(session) {
  try {
    const token = session?.refreshToken
    if (typeof token !== 'string' || token.length > 20000) return ''
    const parts = token.split('.')
    if (parts.length !== 3) return ''
    const { sub } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return isSteamUserId(sub) ? sub : ''
  } catch {
    return ''
  }
}

export function normalizeSteamProfile(value, steamId) {
  if (!isSteamUserId(steamId) || value?.steamId !== steamId) return null
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 160) : ''
  if (!name) return null
  return { steamId, name, avatar: isSteamAvatarUrl(value.avatar) ? value.avatar : '',
    animatedAvatar: normalizeSteamProfileItemImageUrl(value.animatedAvatar),
    avatarFrame: normalizeSteamProfileItemImageUrl(value.avatarFrame),
    avatarFrameStatic: normalizeSteamProfileItemImageUrl(value.avatarFrameStatic),
    itemsLoaded: value.itemsLoaded === true }
}

export function parseSteamProfileItems(data) {
  const items = data?.response
  if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('invalid_steam_profile_items')
  for (const key of ['animated_avatar', 'avatar_frame']) {
    if (items[key] !== undefined && (!items[key] || typeof items[key] !== 'object' || Array.isArray(items[key])))
      throw new Error('invalid_steam_profile_items')
  }
  return {
    // Steam 的 image_small 是动态资源，image_large 是静态预览，不能用后者代替动图。
    animatedAvatar: normalizeSteamProfileItemImageUrl(items.animated_avatar?.image_small),
    avatarFrame: normalizeSteamProfileItemImageUrl(items.avatar_frame?.image_small) || normalizeSteamProfileItemImageUrl(items.avatar_frame?.image_large),
    avatarFrameStatic: normalizeSteamProfileItemImageUrl(items.avatar_frame?.image_large),
    itemsLoaded: true
  }
}

export function parseSteamCommunityProfile(xml, steamId) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 1024 * 1024)
    throw new Error('invalid_steam_profile')
  const $ = load(xml, { xmlMode: true })
  const profile = $('profile').first()
  const value = normalizeSteamProfile({
    steamId: profile.children('steamID64').text().trim(),
    name: profile.children('steamID').text(),
    avatar: profile.children('avatarFull').text().trim() || profile.children('avatarMedium').text().trim()
  }, steamId)
  if (!value) throw new Error('invalid_steam_profile')
  return value
}

export async function fetchSteamProfile(steamId, signal, request) {
  if (!isSteamUserId(steamId)) throw new Error('invalid_steam_profile')
  const [base, items] = await Promise.allSettled([request({
    url: `https://steamcommunity.com/profiles/${steamId}/?xml=1`,
    method: 'GET', responseType: 'text', signal,
    timeout: 20000, maxRedirects: 0, maxContentLength: 1024 * 1024
  }, { source: 'steam-workshop', purpose: 'profile' }), request({
    url: `https://api.steampowered.com/IPlayerService/GetProfileItemsEquipped/v1/?steamid=${steamId}`,
    method: 'GET', responseType: 'json', signal,
    timeout: 12000, maxRedirects: 0, maxContentLength: 1024 * 1024
  }, { source: 'steam-workshop', purpose: 'profile-items' })])
  if (signal?.aborted) throw signal.reason || new Error('steam_profile_cancelled')
  if (base.status === 'rejected') throw base.reason
  const response = base.value
  if (response.status !== 200) throw new Error('steam_profile_unavailable')
  const profile = parseSteamCommunityProfile(response.data, steamId)
  if (items.status === 'fulfilled' && items.value.status === 200) {
    try { return { ...profile, ...parseSteamProfileItems(items.value.data) } }
    catch { /* 装扮接口不可用时仍可展示基本资料，稍后重试。 */ }
  }
  return profile
}
