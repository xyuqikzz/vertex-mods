import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const NEXUS_OAUTH_ORIGIN = 'https://users.nexusmods.com'
const API_ORIGIN = 'https://api.nexusmods.com'
const text = (value) => String(value ?? '').trim()

export function nexusError(code, message, status = 0) {
  return Object.assign(new Error(message), { code, status })
}

export function validateNexusOAuthConfig(config = {}) {
  try {
    const callback = new URL(config.redirectUri)
    if (!text(config.clientId) || !/^[\w.-]{1,200}$/.test(config.clientId)) return false
    // Port 0 asks the OS for an available loopback port; it is never sent to Nexus.
    return (
      callback.protocol === 'http:' &&
      callback.hostname === '127.0.0.1' &&
      Boolean(callback.port) &&
      !callback.username &&
      !callback.password &&
      !callback.search &&
      !callback.hash
    )
  } catch {
    return false
  }
}

export function isNexusTokenExpiredResponse(response = {}) {
  if (response.status !== 401) return false
  const data = response.data || {}
  return (
    data.error === 'invalid_token' ||
    /invalid_token/i.test(String(response.headers?.['www-authenticate'] || '')) ||
    /(?:oauth|access|bearer|jwt).*(?:expired|revoked|invalid)|(?:expired|invalid).*token/i.test(
      text(data.message || data.error_description)
    )
  )
}

function publicUser(data = {}) {
  const user = data.user || data
  const id = text(user.sub || user.user_id || user.id)
  if (!id) throw nexusError('nexus_profile_invalid', '无法确认 Nexus 账号身份，请重新授权')
  let avatar = ''
  try {
    const url = new URL(user.avatar || user.profile_url || '')
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (url.hostname === 'nexusmods.com' || url.hostname.endsWith('.nexusmods.com'))
    )
      avatar = url.href
  } catch {
    /* Avatar is optional. */
  }
  const roles = Array.isArray(user.membership_roles) ? user.membership_roles : []
  return {
    id,
    name: text(user.name || user.username).slice(0, 160) || `Nexus 用户 ${id}`,
    avatar,
    accountType:
      user.is_premium || roles.includes('premium')
        ? 'Premium'
        : user.is_supporter || roles.includes('supporter')
          ? 'Supporter'
          : '普通账号'
  }
}

// All credentials and pending exchanges stay behind this main-process boundary.
export function createNexusAccountService({
  vault,
  transport,
  config = {},
  getApiKey = () => '',
  getAuthMode = () => '',
  saveAuthMode = () => {},
  appVersion = '2.0.0',
  openAuthorization,
  onIdentityChanged = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let epoch = 0
  let pending = null
  let refreshFlight = null
  let lastError = ''
  let phase = 'idle'
  // 系统凭据只能在 Electron 就绪后读取，首次请求时再建立身份快照。
  let lastApiKey = null
  const changed = () => {
    epoch += 1
    onIdentityChanged()
  }
  const credentials = () => vault.read()
  let selectedMode = getAuthMode()
  function authMode() {
    if (['oauth', 'api_key'].includes(selectedMode)) return selectedMode
    return credentials()?.accessToken || !text(getApiKey()) ? 'oauth' : 'api_key'
  }
  function revision() {
    const key = text(getApiKey())
    if (lastApiKey === null) lastApiKey = key
    if (key !== lastApiKey) {
      lastApiKey = key
      changed()
    }
    return String(epoch)
  }
  function assertCurrent(value) {
    if (String(value) !== revision())
      throw nexusError('nexus_account_changed', 'Nexus 账号已变化，请重新操作')
  }
  function snapshot() {
    const currentRevision = revision()
    const saved = credentials()
    const connected = Boolean(saved?.accessToken && !saved.invalid)
    const mode = authMode()
    const hasApiKey = Boolean(text(getApiKey()))
    return {
      configured: validateNexusOAuthConfig(config),
      connected,
      mode,
      available: mode === 'oauth' ? connected : hasApiKey,
      phase: pending ? 'authorizing' : saved?.invalid ? 'expired' : phase,
      user: saved?.user || null,
      revision: currentRevision,
      credentialSource:
        mode === 'oauth' ? (saved?.accessToken ? 'oauth' : 'none') : hasApiKey ? 'api_key' : 'none',
      hasApiKey,
      browserMode: config.embeddedAuthorizationAllowed === true ? 'embedded' : 'external',
      message: lastError
    }
  }
  async function send(request) {
    try {
      return await transport({
        ...request,
        maxRedirects: 0,
        timeout: 30000,
        maxContentLength: 32 * 1024 * 1024,
        maxBodyLength: 4 * 1024 * 1024,
        validateStatus: () => true
      })
    } catch {
      throw nexusError('nexus_network_failed', '连接 Nexus 失败，请检查网络后重试')
    }
  }
  function responseError(response, tokenRequest = false) {
    const status = Number(response?.status || 0)
    if (status === 429)
      return nexusError('nexus_rate_limited', 'Nexus 请求过于频繁，请稍后重试', status)
    if (tokenRequest && ['invalid_grant', 'invalid_token'].includes(response?.data?.error))
      return nexusError('nexus_auth_expired', 'Nexus 授权已失效，请在 API 配置中重新授权', status)
    return nexusError(
      tokenRequest ? 'nexus_token_exchange_failed' : 'nexus_request_failed',
      `Nexus 请求失败（HTTP ${status}），请稍后重试`,
      status
    )
  }
  function tokenRecord(response, previous = {}) {
    const data = response.data || {}
    if (response.status !== 200) throw responseError(response, true)
    const expires = Number(data.expires_in)
    if (
      !text(data.access_token) ||
      !Number.isFinite(expires) ||
      expires <= 0 ||
      (data.token_type && text(data.token_type).toLowerCase() !== 'bearer')
    )
      throw nexusError('nexus_token_invalid', 'Nexus 返回的授权信息不完整，请重新授权')
    return {
      accessToken: data.access_token,
      refreshToken: text(data.refresh_token) || previous.refreshToken || '',
      expiresAt: now() + expires * 1000,
      user: previous.user || null,
      invalid: false
    }
  }
  function finishLogin(session, error = null) {
    if (pending !== session) return
    pending = null
    clearTimer(session.timer)
    session.controller.abort()
    session.handle?.close?.()
    phase = error ? (error.code === 'nexus_login_cancelled' ? 'cancelled' : 'error') : 'connected'
    lastError = error?.message || ''
    if (error) session.reject(error)
    else session.resolve(snapshot())
  }
  function cancelLogin(reason = 'cancelled') {
    if (!pending) return snapshot()
    changed()
    const errors = {
      cancelled: ['nexus_login_cancelled', '已取消 Nexus 授权'],
      closed: ['nexus_login_closed', '授权窗口已关闭，可重新授权'],
      timeout: ['nexus_login_timeout', 'Nexus 授权超时，请重试']
    }
    const [code, message] = errors[reason] || errors.cancelled
    finishLogin(pending, nexusError(code, message))
    return snapshot()
  }
  async function acceptCallback(rawUrl) {
    const session = pending
    if (!session || !session.redirectUri || session.exchanging) return false
    let url
    try {
      url = new URL(rawUrl)
    } catch {
      return false
    }
    const expected = new URL(session.redirectUri)
    if (
      url.origin !== expected.origin ||
      url.pathname !== expected.pathname ||
      url.hash ||
      url.username ||
      url.password
    )
      return false
    const state = Buffer.from(url.searchParams.get('state') || '')
    const validState =
      state.length === session.state.length && timingSafeEqual(state, session.state)
    if (
      !validState ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.getAll('code').length > 1
    ) {
      finishLogin(session, nexusError('nexus_callback_invalid', 'Nexus 回调校验失败，请重新授权'))
      return false
    }
    if (url.searchParams.has('error')) {
      cancelLogin()
      return false
    }
    const code = url.searchParams.get('code')
    if (!code || code.length > 4096) {
      finishLogin(session, nexusError('nexus_callback_invalid', 'Nexus 回调缺少有效授权码'))
      return false
    }
    session.exchanging = true
    try {
      const response = await send({
        url: `${NEXUS_OAUTH_ORIGIN}/oauth/token`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          redirect_uri: session.redirectUri,
          code,
          code_verifier: session.verifier
        }).toString()
      })
      assertCurrent(session.revision)
      const saved = tokenRecord(response)
      const profile = await send({
        url: `${NEXUS_OAUTH_ORIGIN}/oauth/userinfo`,
        method: 'GET',
        headers: { Authorization: `Bearer ${saved.accessToken}` }
      })
      if (profile.status !== 200) throw responseError(profile)
      saved.user = publicUser(profile.data)
      assertCurrent(session.revision)
      if (pending !== session) return false
      vault.write(saved)
      changed()
      finishLogin(session)
      return true
    } catch (error) {
      finishLogin(session, error)
      return false
    }
  }
  function login() {
    if (pending) return pending.promise
    if (!validateNexusOAuthConfig(config))
      return Promise.reject(
        nexusError('nexus_registration_required', '账号登录暂不可用，请使用 API Key')
      )
    setMode('oauth')
    changed()
    lastError = ''
    const verifier = randomBytes(48).toString('base64url')
    const session = {
      verifier,
      redirectUri: '',
      revision: revision(),
      state: Buffer.from(randomBytes(32).toString('base64url')),
      controller: new AbortController()
    }
    session.promise = new Promise((resolve, reject) => {
      session.resolve = resolve
      session.reject = reject
    })
    pending = session
    session.timer = setTimer(() => cancelLogin('timeout'), 5 * 60 * 1000)
    const buildAuthorizeUrl = (redirectUri) => {
      assertCurrent(session.revision)
      if (pending !== session || session.redirectUri)
        throw nexusError('nexus_login_cancelled', '当前授权会话已结束')
      const actual = new URL(redirectUri)
      const configured = new URL(config.redirectUri)
      if (
        !validateNexusOAuthConfig({ ...config, redirectUri }) ||
        actual.port === '0' ||
        actual.pathname !== configured.pathname ||
        (configured.port !== '0' && actual.port !== configured.port)
      )
        throw nexusError('nexus_callback_invalid', '无法建立有效的本地授权回调')
      session.redirectUri = redirectUri
      const url = new URL(`${NEXUS_OAUTH_ORIGIN}/oauth/authorize`)
      url.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: session.redirectUri,
        response_type: 'code',
        scope: text(config.scope) || 'public openid',
        state: session.state.toString(),
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url')
      }).toString()
      return url.href
    }
    Promise.resolve()
      .then(() =>
        openAuthorization({
          buildAuthorizeUrl,
          redirectUri: config.redirectUri,
          signal: session.controller.signal,
          embedded: config.embeddedAuthorizationAllowed === true,
          onCallback: acceptCallback,
          onClosed: () => {
            if (pending === session) cancelLogin('closed')
          }
        })
      )
      .then((handle) => {
        if (pending === session) session.handle = handle
        else handle?.close?.()
      })
      .catch(() =>
        finishLogin(
          session,
          nexusError('nexus_browser_failed', '无法打开授权窗口或绑定回调端口，请重试')
        )
      )
    return session.promise
  }
  async function refresh(expectedRevision, sentToken = '') {
    assertCurrent(expectedRevision)
    const saved = credentials()
    if (sentToken && saved?.accessToken !== sentToken) return saved
    if (refreshFlight?.revision === expectedRevision) return refreshFlight.promise
    if (!saved?.refreshToken || saved.invalid) {
      if (saved?.accessToken && !saved.invalid) {
        vault.write({ ...saved, invalid: true })
        lastError = 'Nexus 授权已过期且无法自动刷新，请重新授权'
        changed()
      }
      throw nexusError('nexus_auth_expired', 'Nexus 授权已失效，请重新授权')
    }
    const flight = { revision: expectedRevision }
    flight.promise = (async () => {
      try {
        const response = await send({
          url: `${NEXUS_OAUTH_ORIGIN}/oauth/token`,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: config.clientId,
            refresh_token: saved.refreshToken
          }).toString()
        })
        assertCurrent(expectedRevision)
        const updated = tokenRecord(response, saved)
        vault.write(updated)
        return updated
      } catch (error) {
        if (revision() === expectedRevision && error.code === 'nexus_auth_expired') {
          vault.write({ ...saved, invalid: true })
          lastError = error.message
          changed()
        }
        throw error
      } finally {
        if (refreshFlight === flight) refreshFlight = null
      }
    })()
    refreshFlight = flight
    return flight.promise
  }
  async function request(input = {}) {
    if (input.expectedRevision !== undefined) assertCurrent(input.expectedRevision)
    const url = new URL(input.url)
    if (
      url.origin !== API_ORIGIN ||
      url.username ||
      url.password ||
      url.hash ||
      !(url.pathname.startsWith('/v1/') || url.pathname === '/v2/graphql')
    )
      throw nexusError('nexus_target_invalid', '不支持的 Nexus 请求目标')
    const current = revision()
    const mode = authMode()
    let saved = mode === 'oauth' ? credentials() : null
    if (saved?.accessToken && saved.invalid)
      throw nexusError('nexus_auth_expired', 'Nexus 授权已失效，请重新授权或切换到 API Key')
    if (saved?.accessToken && saved.expiresAt <= now() + 60000) saved = await refresh(current)
    assertCurrent(current)
    const key = mode === 'api_key' ? text(getApiKey()) : ''
    if (!saved?.accessToken && !key)
      throw nexusError(
        'nexus_api_key_invalid',
        mode === 'oauth' ? '请先登录 Nexus 账号，或切换到 API Key' : '请填写 Nexus API Key'
      )
    const perform = (token) =>
      send({
        url: url.href,
        method: input.method || 'GET',
        params: input.params,
        data: input.data,
        signal: input.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Application-Name': 'Vertex',
          'Application-Version': appVersion,
          ...(token ? { Authorization: `Bearer ${token}` } : { apikey: key })
        }
      })
    let response = await perform(saved?.accessToken)
    assertCurrent(current)
    if (saved?.accessToken && isNexusTokenExpiredResponse(response)) {
      saved = await refresh(current, saved.accessToken)
      response = await perform(saved.accessToken)
      assertCurrent(current)
      if (isNexusTokenExpiredResponse(response)) {
        vault.write({ ...saved, invalid: true })
        changed()
        throw nexusError('nexus_auth_expired', 'Nexus 授权已失效，请重新授权')
      }
    }
    if (response.status === 429) throw responseError(response)
    return response
  }
  function logout() {
    changed()
    if (pending) finishLogin(pending, nexusError('nexus_login_cancelled', '已退出 Nexus 账号'))
    vault.clear()
    lastError = ''
    phase = 'idle'
    return snapshot()
  }
  function setMode(mode) {
    if (!['oauth', 'api_key'].includes(mode))
      throw nexusError('nexus_mode_invalid', '请选择有效的授权方式')
    const previousMode = authMode()
    saveAuthMode(mode)
    selectedMode = mode
    if (previousMode !== mode) {
      changed()
      if (pending) finishLogin(pending, nexusError('nexus_login_cancelled', '已切换授权方式'))
      lastError = ''
    }
    return snapshot()
  }
  return Object.freeze({
    snapshot,
    revision,
    login,
    cancelLogin,
    acceptCallback,
    request,
    logout,
    setMode
  })
}
