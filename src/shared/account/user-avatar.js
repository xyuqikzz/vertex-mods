export function getUserAvatarInitial(nickname) {
  const name = String(nickname || '').trim()
  return new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(name)[Symbol.iterator]().next().value?.segment || '用'
}

// 头像始终从当前配置的 Java 后端读取；兼容旧账号缓存中的网盘 URL。
export function resolveUserAvatar(avatar, userId, backendUrl) {
  if (!avatar || !/^\d+$/.test(String(userId || '')) || !backendUrl) return ''
  const base = new URL(backendUrl.replace(/\/$/, '') + '/')
  const target = new URL(`user/avatar/${userId}`, base)
  const source = new URL(String(avatar), base.origin)
  if (source.pathname === target.pathname && source.searchParams.has('v')) {
    target.searchParams.set('v', source.searchParams.get('v'))
  } else {
    let version = 2166136261
    for (const char of String(avatar)) version = Math.imul(version ^ char.charCodeAt(0), 16777619)
    target.searchParams.set('v', (version >>> 0).toString(16))
  }
  return target.href
}
