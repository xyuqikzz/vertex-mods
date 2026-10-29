import { sanitizeUserApiConfig } from '../account/user-config-policy.js'
export const DEFAULT_MODIO_API_BASE_URL = 'https://api.mod.io/v1'
export const DEFAULT_MODIO_PLATFORM = 'windows'

let modioApiRequestIndex = 0

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function dedupeModioApiConfigs(list = []) {
  const seen = new Set()
  return list.filter((item) => {
    const key = `${item.baseUrl}|${item.platform}|${item.apiKey}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function normalizeModioApiConfigEntry(entry = {}, fallback = {}) {
  const source =
    entry && typeof entry === 'object'
      ? entry
      : {
          apiKey: entry
        }
  if (source.enabled === false || source.disabled === true) {
    return null
  }

  const apiKey = toSafeText(source.apiKey || source.key || source.apikey)
  if (!apiKey) {
    return null
  }

  return {
    apiKey,
    baseUrl: toSafeText(
      source.baseUrl || source.url || source.apiPath || source.api_path || source.path,
      fallback.baseUrl || DEFAULT_MODIO_API_BASE_URL
    ).replace(/\/+$/, ''),
    platform: toSafeText(source.platform, fallback.platform || DEFAULT_MODIO_PLATFORM)
  }
}

function collectModioApiConfigCandidates(source = {}) {
  if (Array.isArray(source)) {
    return source
  }

  if (!source || typeof source !== 'object') {
    return source ? [source] : []
  }

  return [
    ...toSafeArray(source.modioApiConfigs),
    ...toSafeArray(source.modioApis),
    ...toSafeArray(source.modioApiList),
    ...toSafeArray(source.modioConfigs),
    ...toSafeArray(source.apiConfigs),
    ...toSafeArray(source.configs),
    ...toSafeArray(source.apiList),
    ...toSafeArray(source.apis),
    ...toSafeArray(source.items),
    ...toSafeArray(source.modioApiKeys),
    ...toSafeArray(source.modioKeys),
    ...toSafeArray(source.apiKeys),
    ...toSafeArray(source.keys),
    source
  ]
}

export function normalizeModioApiConfig(config = {}) {
  const source = sanitizeUserApiConfig(config)
  const fallback = {
    baseUrl: toSafeText(
      source.baseUrl || source.url || source.apiPath || source.api_path || source.path,
      DEFAULT_MODIO_API_BASE_URL
    ).replace(/\/+$/, ''),
    platform: toSafeText(source.platform, DEFAULT_MODIO_PLATFORM)
  }
  const apiConfigs = dedupeModioApiConfigs(
    collectModioApiConfigCandidates(source)
      .map((item) => normalizeModioApiConfigEntry(item, fallback))
      .filter(Boolean)
  )
  const primary = apiConfigs[0] || {
    apiKey: '',
    baseUrl: fallback.baseUrl,
    platform: fallback.platform
  }

  return {
    apiKey: primary.apiKey,
    baseUrl: primary.baseUrl,
    platform: primary.platform,
    apiKeys: apiConfigs.map((item) => item.apiKey),
    apiConfigs,
    apiKeySource: toSafeText(source.apiKeySource || source.source)
  }
}

export function hasModioApiKey(config = {}) {
  return normalizeModioApiConfig(config).apiConfigs.length > 0
}

export function resolveEffectiveModioApiConfig(...configs) {
  for (const config of configs) {
    const normalized = normalizeModioApiConfig(config)
    if (normalized.apiConfigs.length > 0) {
      return normalized
    }
  }

  return normalizeModioApiConfig(configs[0] || {})
}

export function resolveModioApiRequestConfig(config = {}) {
  const normalized = normalizeModioApiConfig(config)
  if (!normalized.apiConfigs.length) {
    return normalized
  }

  const target = normalized.apiConfigs[modioApiRequestIndex % normalized.apiConfigs.length]
  modioApiRequestIndex += 1
  return {
    ...normalized,
    ...target,
    apiKeys: normalized.apiKeys,
    apiConfigs: normalized.apiConfigs
  }
}
