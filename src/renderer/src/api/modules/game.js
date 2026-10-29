import { normalizePublicGameKey } from '../../../../shared/games/game-rule-support.js'
import { Request } from '../index.js'
import { verifySharedRuleDocument, sharedRuleCacheKey } from '../../../../shared/installation/shared-install-rule.js'

const http = new Request()
const sharedRuleCache = new Map()

export function GET_STEAM_WORKSHOP_GAMES() {
  return http.get('/steam-workshop/game/list', { hideLoading: true })
}

export function GET_SOURCE_GAME_LIST(params) {
  return http.get('/source-game/list', {
    params,
    hideLoading: true
  })
}

export function GET_GAME_DETAILS(id) {
  return http.get(`/game/details/${id}`, {})
}

export function GET_GAME_DETAILS_BY_LIST(ids, hideLoading = false) {
  return http.post(
    `/game/getGameDetailsByList`,
    { ids },
    {
      hideLoading
    }
  )
}

export function GET_NEXUS_BACKEND_GAME_LIST() {
  return http.get('/nexus/game/list')
}

export function GET_NEXUS_BACKEND_GAME_INFO(nexusGameId) {
  return http.get(`/nexus/game/info/${nexusGameId}`)
}


export function GET_MODIO_BACKEND_GAME_LIST() {
  return http.get('/modio/game/list', {
    hideLoading: true
  })
}


export function REPORT_RULE_ISSUE(data) {
  return http.post('/rule-issue/report', JSON.parse(JSON.stringify(data || {})), {
    hideLoading: true
  })
}

export function GET_INSTALL_CONFIG_OFFICIAL_LIST(params) {
  return http.get('/install-config/official/list', {
    params,
    hideLoading: true
  })
}

export function GET_INSTALL_CONFIG_PLAYER_LIST(params) {
  return http.get('/install-config/player/list', {
    params,
    hideLoading: true
  })
}

export function GET_INSTALL_CONFIG_DETAIL(id, includeContent = false) {
  return http.get(`/install-config/detail/${id}`, {
    params: {
      includeContent
    },
    hideLoading: true
  })
}

export async function GET_SHARED_INSTALL_RULE(params) {
  const sourcePlatform = String(params?.sourcePlatform || '').toLowerCase()
  const gameKey = String(params?.gameKey || '')
  const sourceGameId = params?.sourceGameId || (gameKey.startsWith(sourcePlatform + ':')
    ? gameKey.slice(sourcePlatform.length + 1) : undefined)
  const document = await http.get('/install-config/shared/match', {
    params: normalizePublicGameKey(gameKey)
      ? { gameKey: normalizePublicGameKey(gameKey), sourcePlatform }
      : { ...params, sourceGameId },
    hideLoading: true
  })
  // 缓存仅用于显示与去重，业务失败和断网均不得回退到缓存。
  for (const [cacheKey, cached] of sharedRuleCache) {
    if (cached.documentId === document?.documentId) sharedRuleCache.delete(cacheKey)
  }
  const verified = await verifySharedRuleDocument(document)
  if (sharedRuleCache.size >= 100) sharedRuleCache.delete(sharedRuleCache.keys().next().value)
  sharedRuleCache.set(sharedRuleCacheKey(verified), verified)
  const aliases = verified.aliases || []
  const alias = (type) => aliases.find((item) => item.sourcePlatform === sourcePlatform && item.aliasType === type)?.aliasValue
  return {
    ...verified,
    nexusGameId: sourcePlatform === 'nexus' ? Number(alias('nexus_game_id') || alias('source_game_id') || params?.nexusGameId || 0) : undefined,
    gameId: Number(alias('game_id') || params?.gameId || 0),
    domainName: alias('domain_name') || params?.domainName || '',
    appId: Number(params?.appId || aliases.find((item) => item.sourcePlatform === 'steam' && item.aliasType === 'app_id')?.aliasValue || 0)
  }
}

export function GET_MY_INSTALL_CONFIG_STATUS(params) {
  return http.get('/install-config/my/status', {
    params,
    hideLoading: true
  })
}

export function GET_MY_INSTALL_CONFIG_LIST(params) {
  return http.get('/install-config/my/list', {
    params,
    hideLoading: true
  })
}

export function GET_MY_INSTALL_CONFIG_DETAIL(id) {
  return http.get(`/install-config/my/detail/${id}`, {
    hideLoading: true
  })
}

export function CREATE_PLAYER_INSTALL_CONFIG(data) {
  return http.post('/install-config/player', data)
}

export function UPDATE_PLAYER_INSTALL_CONFIG(id, data) {
  return http.put(`/install-config/player/${id}`, data)
}

export function CLONE_PLAYER_INSTALL_CONFIG(id, data = {}) {
  return http.post(`/install-config/player/${id}/clone`, data)
}

export function DELETE_PLAYER_INSTALL_CONFIG(id) {
  return http.delete(`/install-config/player/${id}`)
}

export function USE_INSTALL_CONFIG_PROFILE(id) {
  return http.post(`/install-config/use/${id}`, {})
}

export function VALIDATE_INSTALL_CONFIG(data) {
  return http.post('/install-config/validate', data, {
    hideLoading: true
  })
}

export function PREVIEW_INSTALL_CONFIG_SUMMARY(data) {
  return http.post('/install-config/preview-summary', data, {
    hideLoading: true
  })
}

export function GET_INSTALL_CONFIG_SUPPORT_RULES(params) {
  return http.get('/install-config/support/rules', {
    params,
    hideLoading: true
  })
}

export function GET_INSTALL_CONFIG_SUPPORT_GAMES(params) {
  return http.get('/install-config/support/games', {
    params,
    hideLoading: true
  })
}

export function GET_SHARED_RULE_GAME_KEYS() {
  return http.get('/install-config/shared/games', { hideLoading: true })
}

export function GET_INSTALL_CONFIG_RULE_SUPPORTED_GAMES(params) {
  return http.get('/install-config/rule-supported/games', {
    params,
    hideLoading: true
  })
}
