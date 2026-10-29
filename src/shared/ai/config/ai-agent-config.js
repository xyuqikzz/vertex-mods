import { sanitizeUserSystemConfig, sanitizeUserApiConfig } from '../../account/user-config-policy.js'
import {
  AI_API_CONFIG_SCOPES,
  AI_API_KEY_SOURCE,
  AI_RUNTIME_CONFIG_SOURCE,
  AI_TRANSLATION_PROVIDER_PRESETS,
  DEFAULT_AI_TRANSLATION_CONFIG,
  applyAiTranslationProviderPreset,
  getAiTranslationExecutionDescriptor,
  isAiTranslationReady,
  normalizeAiTranslationConfig,
  resolveAiApiConfigForScope
} from '../../translation/ai-translation-config.js'

export const DEFAULT_AI_AGENT_CONFIG = Object.freeze({
  enabled: true,
  providerType: DEFAULT_AI_TRANSLATION_CONFIG.providerType,
  baseURL: DEFAULT_AI_TRANSLATION_CONFIG.baseURL,
  apiKey: '',
  model: DEFAULT_AI_TRANSLATION_CONFIG.model,
  authorizationMode: 'semi_auto',
  assistantWindow: {
    openMode: 'sidecar',
    maximizeBehavior: 'joint-maximize',
    width: 460
  }
})

export const AI_AGENT_AUTHORIZATION_MODES = Object.freeze({
  SAFE: 'safe',
  SEMI_AUTO: 'semi_auto',
  FULL_AUTO: 'full_auto'
})

export const AI_ASSISTANT_WINDOW_OPEN_MODES = Object.freeze({
  SIDECAR: 'sidecar'
})

export const AI_ASSISTANT_WINDOW_MAXIMIZE_BEHAVIORS = Object.freeze({
  JOINT_MAXIMIZE: 'joint-maximize'
})

function toSafeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 1 || value === '1' || value === 'true' || value === 'yes') {
    return true
  }
  if (value === 0 || value === '0' || value === 'false' || value === 'no') {
    return false
  }
  return fallback
}

function pickAgentFields(config = {}) {
  const normalized = normalizeAiTranslationConfig({
    ...DEFAULT_AI_TRANSLATION_CONFIG,
    ...config
  })
  return {
    providerType: normalized.providerType,
    baseURL: normalized.baseURL,
    apiKey: normalized.apiKey,
    model: normalized.model
  }
}

export function normalizeAiAgentAuthorizationMode(value) {
  if (value === undefined) return AI_AGENT_AUTHORIZATION_MODES.SEMI_AUTO
  if (typeof value !== 'string') return AI_AGENT_AUTHORIZATION_MODES.SAFE
  const mode = value
    .trim()
    .toLowerCase()
  return Object.values(AI_AGENT_AUTHORIZATION_MODES).includes(mode)
    ? mode
    : AI_AGENT_AUTHORIZATION_MODES.SAFE
}

export function normalizeAiAssistantWindowOpenMode() {
  return AI_ASSISTANT_WINDOW_OPEN_MODES.SIDECAR
}

export function normalizeAiAssistantWindowMaximizeBehavior() {
  return AI_ASSISTANT_WINDOW_MAXIMIZE_BEHAVIORS.JOINT_MAXIMIZE
}

export function normalizeAiAssistantWindowConfig(config = {}) {
  const source = config && typeof config === 'object' ? config : {}
  const defaultWindowConfig = DEFAULT_AI_AGENT_CONFIG.assistantWindow
  const width = Number(source.width)

  return {
    openMode: normalizeAiAssistantWindowOpenMode(source.openMode),
    maximizeBehavior: normalizeAiAssistantWindowMaximizeBehavior(source.maximizeBehavior),
    width: Number.isFinite(width)
      ? Math.min(Math.max(Math.round(width), 380), 500)
      : defaultWindowConfig.width
  }
}

export function normalizeAiAgentConfig(config = {}) {
  const source = sanitizeUserApiConfig(config)
  return {
    enabled: toSafeBoolean(source.enabled, DEFAULT_AI_AGENT_CONFIG.enabled),
    ...pickAgentFields(source),
    authorizationMode: normalizeAiAgentAuthorizationMode(source.authorizationMode),
    assistantWindow: normalizeAiAssistantWindowConfig(source.assistantWindow)
  }
}

export function applyAiAgentProviderPreset(config = {}, providerType = '') {
  const normalized = normalizeAiAgentConfig(config)
  const nextProviderType = String(providerType || '')
    .trim()
    .toLowerCase()
  if (!AI_TRANSLATION_PROVIDER_PRESETS[nextProviderType]) {
    return normalized
  }

  const nextConfig = applyAiTranslationProviderPreset(
    {
      ...DEFAULT_AI_TRANSLATION_CONFIG,
      ...normalized,
      enabled: true
    },
    nextProviderType
  )

  return normalizeAiAgentConfig({
    ...nextConfig,
    enabled: normalized.enabled,
    authorizationMode: normalized.authorizationMode,
    assistantWindow: normalized.assistantWindow
  })
}

export function isAiAgentConfigReady(config = {}) {
  const normalized = normalizeAiAgentConfig(config)
  return Boolean(normalized.enabled && normalized.baseURL && normalized.apiKey && normalized.model)
}

export function resolveAiAgentRuntimeConfig(settings = {}) {
  const safeSettings = sanitizeUserSystemConfig(settings)
  const aiAgent = normalizeAiAgentConfig(safeSettings.aiAgent)
  const hasApiConfigList =
    safeSettings.aiTranslation &&
    typeof safeSettings.aiTranslation === 'object' &&
    Array.isArray(safeSettings.aiTranslation.apiConfigs)
  const assistantApiConfig = hasApiConfigList
    ? resolveAiApiConfigForScope(safeSettings.aiTranslation, AI_API_CONFIG_SCOPES.ASSISTANT)
    : null
  const runtimeAgent = hasApiConfigList
    ? normalizeAiAgentConfig({
        ...aiAgent,
        ...(assistantApiConfig
          ? {
              providerType: assistantApiConfig.providerType,
              baseURL: assistantApiConfig.baseURL,
              apiKey: assistantApiConfig.apiKey,
              model: assistantApiConfig.model
            }
          : {
              providerType: 'custom',
              baseURL: '',
              apiKey: '',
              model: ''
            })
      })
    : aiAgent

  if (isAiAgentConfigReady(runtimeAgent)) {
    return {
      config: {
        ...runtimeAgent,
        apiKeySource: AI_API_KEY_SOURCE.LOCAL
      },
      source: AI_RUNTIME_CONFIG_SOURCE.AI_AGENT
    }
  }

  const aiTranslation = normalizeAiTranslationConfig(safeSettings.aiTranslation)
  if (!hasApiConfigList && isAiTranslationReady(aiTranslation)) {
    return {
      config: {
        ...aiTranslation,
        apiKeySource: AI_API_KEY_SOURCE.LOCAL
      },
      source: AI_RUNTIME_CONFIG_SOURCE.AI_TRANSLATION
    }
  }

  return {
    config: null,
    source: aiAgent.enabled ? AI_RUNTIME_CONFIG_SOURCE.AI_AGENT : AI_RUNTIME_CONFIG_SOURCE.NONE
  }
}

export function getAiAgentExecutionDescriptor(config = {}) {
  return getAiTranslationExecutionDescriptor({
    ...DEFAULT_AI_TRANSLATION_CONFIG,
    ...normalizeAiAgentConfig(config),
    enabled: true
  })
}
