import { normalizeSteamSession } from './sessionConfig.js'
import { normalizeSteamProfile, steamSessionUserId } from './profile.js'

const cancelled = () =>
  Object.assign(new Error('Steam 授权已取消'), { code: 'steam_login_cancelled' })

export function createSteamAccountService({ vault, fetchProfile, now = Date.now }) {
  let revision = 0
  let memory = null
  let pending = null
  let profileRequest = null
  let retryProfileAfter = 0
  const leases = new Set()
  const current = () => memory || vault.read()
  function cancelProfile() {
    profileRequest?.controller.abort()
    profileRequest = null
    retryProfileAfter = 0
  }
  async function refreshProfile() {
    const account = current()
    const steamId = steamSessionUserId(account)
    if (!fetchProfile || !steamId || !account || account.invalidated || pending) return
    if (profileRequest) return profileRequest.promise
    const profile = normalizeSteamProfile(account.profile, steamId)
    const age = now() - Number(account.profileUpdatedAt || 0)
    // 旧缓存和装扮读取失败只保留短期缓存，避免升级后六小时都看不到头像框。
    const cacheAge = profile?.itemsLoaded ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000
    const hasItemsState = typeof account.profile?.itemsLoaded === 'boolean'
    if ((profile && hasItemsState && age >= 0 && age < cacheAge) || now() < retryProfileAfter) return
    const request = { controller: new AbortController(), revision }
    profileRequest = request
    request.promise = Promise.resolve().then(() => fetchProfile(steamId, request.controller.signal)).then(value => {
      if (request.controller.signal.aborted || request.revision !== revision) return
      const profile = normalizeSteamProfile(value, steamId)
      if (!profile) throw new Error('invalid_steam_profile')
      const previous = normalizeSteamProfile(current()?.profile, steamId)
      if (!profile.itemsLoaded && previous) {
        profile.animatedAvatar = previous.animatedAvatar
        profile.avatarFrame = previous.avatarFrame
        profile.avatarFrameStatic = previous.avatarFrameStatic
      }
      const next = { ...current(), profile, profileUpdatedAt: now() }
      memory = next
      // 资料缓存不是凭据保存：缓存写入失败不改变已经完成的授权状态。
      if (next.remembered) {
        try { vault.write(next) } catch { /* 本次进程仍可使用已读取的资料。 */ }
      }
    }).catch(() => {
      if (!request.controller.signal.aborted && request.revision === revision)
        retryProfileAfter = now() + 5 * 60 * 1000
    }).finally(() => {
      if (profileRequest === request) profileRequest = null
    })
    return request.promise
  }
  function snapshot() {
    const account = current()
    const steamId = steamSessionUserId(account)
    const profile = normalizeSteamProfile(account?.profile, steamId)
    return {
      connected: Boolean(account && !account.invalidated),
      remembered: Boolean(account?.remembered),
      user: account ? { name: profile?.name || account.username, username: account.username,
        avatar: profile?.avatar || '', animatedAvatar: profile?.animatedAvatar || '',
        avatarFrame: profile?.avatarFrame || '', avatarFrameStatic: profile?.avatarFrameStatic || '', steamId } : null,
      phase: pending
        ? 'authorizing'
        : account?.invalidated
          ? 'expired'
          : account
            ? 'connected'
            : 'idle',
      message: account?.invalidated ? '登录状态已失效，请重新授权。' : ''
    }
  }
  function acquire(signal, fresh = false) {
    const stored = current()
    const session = !fresh && stored && !stored.invalidated ? normalizeSteamSession(stored) : null
    const controller = new AbortController()
    let expectedRevision = revision
    let release
    const done = new Promise((resolve) => {
      release = resolve
    })
    const lease = {
      session,
      remembered: Boolean(stored?.remembered),
      controller,
      done,
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      save(value, remember) {
        if (expectedRevision !== revision || lease.signal.aborted || (pending && !fresh)) return false
        const next = {
          ...normalizeSteamSession(value),
          remembered: remember === true,
          invalidated: false
        }
        const previous = current()
        const steamId = steamSessionUserId(next)
        if (steamId && steamId === steamSessionUserId(previous)) {
          next.profile = normalizeSteamProfile(previous?.profile, steamId)
          next.profileUpdatedAt = previous?.profileUpdatedAt || 0
        }
        if (next.remembered) vault.write(next)
        else vault.clear()
        memory = next
        cancelProfile()
        revision++
        expectedRevision = revision
        return true
      },
      invalidate() {
        if (!session || expectedRevision !== revision) return
        const next = { ...current(), ...session, remembered: lease.remembered, invalidated: true }
        if (next.remembered) vault.write(next)
        else vault.clear()
        memory = next
        cancelProfile()
        revision++
        expectedRevision = revision
      },
      close() {
        leases.delete(lease)
        release()
      }
    }
    leases.add(lease)
    return lease
  }
  async function login(ownerId, run) {
    if (pending)
      throw Object.assign(new Error('已有 Steam 授权正在进行'), { code: 'steam_login_busy' })
    const operation = { ownerId, controller: new AbortController() }
    // 手动切换账号优先；先前下载的迟到刷新不能覆盖这次授权。
    revision++
    cancelProfile()
    pending = operation
    operation.promise = Promise.resolve().then(() => run(operation.controller.signal))
    try {
      await operation.promise
      if (operation.controller.signal.aborted) throw cancelled()
    } finally {
      if (pending === operation) pending = null
    }
    return snapshot()
  }
  async function cancelLogin(ownerId) {
    if (pending) {
      if (pending.ownerId !== ownerId) throw new Error('steam_login_owner_mismatch')
      const operation = pending
      operation.controller.abort(cancelled())
      await operation.promise.catch(() => {})
    }
    return snapshot()
  }
  async function logout() {
    revision++
    vault.clear()
    memory = null
    cancelProfile()
    const operation = pending
    operation?.controller.abort(cancelled())
    const active = [...leases]
    active.forEach((lease) => lease.controller.abort(cancelled()))
    await Promise.all([...active.map((lease) => lease.done), operation?.promise.catch(() => {})])
    return snapshot()
  }
  return { snapshot, refreshProfile, acquire, login, cancelLogin, logout }
}
