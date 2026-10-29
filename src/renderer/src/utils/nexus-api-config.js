import { sanitizeUserApiConfig, sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import { nexusAccountState, refreshNexusAccount } from '../store/nexusAccount.js'

export const NEXUS_API_KEY_SOURCE = Object.freeze({ LOCAL: 'local' })

export function normalizeNexusApiConfig(config = {}) {
  const source = sanitizeUserApiConfig(config)
  const apiKey = String(source.apiKey || '').trim()
  return {
    apiKey,
    apiKeySource: apiKey ? NEXUS_API_KEY_SOURCE.LOCAL : ''
  }
}

export function hasLocalNexusApiKey(config = {}) {
  return Boolean(normalizeNexusApiConfig(config).apiKey)
}

export function hasUsableNexusApiKey(config = {}) {
  if (nexusAccountState.mode === 'oauth') return nexusAccountState.connected
  return hasLocalNexusApiKey(config)
}

export async function resolveEffectiveNexusApiConfig(config = {}) {
  await refreshNexusAccount()
  return normalizeNexusApiConfig(config)
}

export async function applyEffectiveNexusApiConfig(systemConfig = {}) {
  const target = sanitizeUserSystemConfig(systemConfig)
  return { ...target, nexusApi: await resolveEffectiveNexusApiConfig(target.nexusApi || target) }
}
