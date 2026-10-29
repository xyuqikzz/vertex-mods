import { assertSourceCapability } from '../../shared/sources/source-platform-registry.js'
import { communityImageSource } from '../../shared/sources/source-network.js'
import { normalizeModioApiConfig } from '../../shared/sources/modio-api-config.js'

const rules = {
  'steam-workshop': [['https://steamcommunity.com'], ['GET'], ['/workshop/browse/']],
  gamebanana: [['https://gamebanana.com'], ['GET'], ['/apiv11/Game/', '/apiv11/Mod/', '/apiv11/Util/Search/Results']],
  nexus: [['https://api.nexusmods.com'], ['GET', 'POST'], ['/v1/', '/v2/graphql']],
  ficsit: [['https://api.ficsit.app'], ['POST'], ['/v2/query']],
  thunderstore: [['https://thunderstore.io', 'https://gcdn.thunderstore.io'], ['GET'], ['/']],
  github: [['https://api.github.com'], ['GET'], ['/repos/']]
}

function resolveModioNetworkRule(url, config) {
  // Trust only settings read by the main process, never a base URL supplied in the request.
  for (const { baseUrl } of normalizeModioApiConfig(config).apiConfigs) {
    let base
    try {
      base = new URL(baseUrl)
    } catch {
      continue
    }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
        [...baseUrl].some(char => char.charCodeAt(0) <= 32 || char === '\\')) continue
    const prefix = base.pathname.replace(/\/+$/, '') + '/'
    if (base.origin === url.origin && url.pathname.startsWith(prefix)) {
      return [[base.origin], ['GET'], [prefix]]
    }
  }
  throw new Error('network_target_disabled')
}

export function validateNetworkRequest(input, backendUrl, modioApiConfig = {}) {
  if (!input || typeof input !== 'object') throw new Error('invalid_network_request')
  const { service, url: raw, method: verb = 'GET' } = input
  const method = String(verb).toUpperCase()
  const url = new URL(raw)
  if (url.username || url.password || url.hash || [...raw].some(char => char.charCodeAt(0) <= 32 || char === '\\')) throw new Error('invalid_network_url')
  let origins, methods, paths
  if (service === 'account') {
    const base = new URL(backendUrl)
    origins = [base.origin]
    methods = ['GET', 'POST', 'PUT', 'DELETE']
    paths = [base.pathname.replace(/\/$/, '') + '/', base.pathname.replace(/\/client\/?$/, '').replace(/\/$/, '') + '/api/statistics/events/batch']
  } else if (['steam-workshop-image', 'gamebanana-image'].includes(service)) {
    const source = service.replace(/-image$/, '')
    if (communityImageSource(raw) !== source || method !== 'GET') throw new Error('network_target_disabled')
    const result = assertSourceCapability(source, 'search')
    if (!result.ok) throw new Error(result.errorCode)
    origins = [url.origin]; methods = ['GET']; paths = ['/']
  } else {
    const rule = service === 'modio' ? resolveModioNetworkRule(url, modioApiConfig) : rules[service]
    if (!rule) throw new Error('unsupported_network_service')
    ;[origins, methods, paths] = rule
    if (service !== 'github') {
      const result = assertSourceCapability(service, 'search')
      if (!result.ok) throw new Error(result.errorCode)
    }
  }
  if (!origins.includes(url.origin) || !methods.includes(method) ||
      !paths.some((prefix) => url.pathname.startsWith(prefix))) throw new Error('network_target_disabled')
  if (service === 'steam-workshop' && url.pathname !== '/workshop/browse/')
    throw new Error('network_target_disabled')
  // Only the locally configured backend may use loopback HTTP during development.
  if (url.protocol !== 'https:' && !(service === 'account' && url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('insecure_network_target')
  const allowed = new Set(['accept', 'content-type', 'application-name', 'application-version', 'x-modio-platform'])
  if (service === 'nexus') allowed.add('apikey')
  if (service === 'github') allowed.add('authorization')
  if (service === 'account') {
    allowed.add('vertex-token')
    allowed.add('vertex-version')
  }
  const headers = {}
  for (const [key, value] of Object.entries(input.headers || {})) {
    if (!allowed.has(key.toLowerCase())) continue
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('invalid_network_header')
    if (/[\r\n]/.test(String(value))) throw new Error('invalid_network_header')
    headers[key.toLowerCase()] = String(value)
  }
  return { url: url.href, method, headers }
}
