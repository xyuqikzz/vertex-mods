export function normalizePublicGameKey(value) {
  const key = String(value || '').trim().toLowerCase().replace(/^game:/, '')
  return /^(?=.*[a-z])[a-z0-9][a-z0-9._-]{0,122}$/.test(key) ? key : ''
}

export function publicGameKey(game = {}) {
  for (const value of [game.gameKey, game.canonicalGameKey, game.nexusDomainName, game.modioNameId,
    game.nameId, game.sourceSlug, game.domainName, game.domain_name]) {
    const key = normalizePublicGameKey(value)
    if (key) return key
  }
  const english = String(game.englishTitle || '').trim().toLowerCase()
  return /^[a-z0-9 ._'’-]+$/.test(english)
    ? normalizePublicGameKey(english.replace(/[^a-z0-9._-]/g, '')) : ''
}

export function applyPublicRuleSupport(game, source, state) {
  if ((game.targetSourcePlatform || game.sourcePlatform || source) === 'thunderstore') return game
  const gameKey = publicGameKey(game)
  return { ...game, gameKey, ruleSupportStatus: state.status,
    isHasRule: state.status === 'ready' ? Number(state.gameKeys.has(gameKey)) : null }
}

// 同一次进入中的来源切换和并发加载共用一个请求；再次进入或刷新时显式强制更新。
export function createPublicRuleSupportLoader(fetchKeys) {
  let state = { status: 'idle', gameKeys: new Set(), error: '' }
  let pending = null
  return {
    getState: () => state,
    load({ force = false } = {}) {
      if (pending) return pending
      if (!force && state.status === 'ready') return Promise.resolve(state)
      state = { status: 'loading', gameKeys: new Set(), error: '' }
      pending = Promise.resolve().then(fetchKeys).then(response => {
        if (response?.schemaVersion !== 5) {
          state = { status: 'error', gameKeys: new Set(), error: '规则服务版本不兼容，暂时无法确认安装支持；仍可浏览和管理本地模组' }
          return state
        }
        if (!Array.isArray(response?.gameKeys) || response.gameKeys.some(key => !normalizePublicGameKey(key)))
          throw new Error('安装规则支持列表格式无效')
        state = { status: 'ready', gameKeys: new Set(response.gameKeys.map(normalizePublicGameKey)), error: '' }
        return state
      }).catch(() => {
        state = { status: 'error', gameKeys: new Set(), error: '规则状态获取失败，请重试' }
        return state
      }).finally(() => { pending = null })
      return pending
    }
  }
}
