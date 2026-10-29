import OpenAI from 'openai'
import store from '../../storage/store/index.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import {
  getAiAgentExecutionDescriptor,
  resolveAiAgentRuntimeConfig
} from '../../../shared/ai/config/ai-agent-config.js'

const AI_AGENT_REQUEST_TIMEOUT_MS = 90000

function getCompatibleAiConfig() {
  const settings = sanitizeUserSystemConfig(store.get('systemConfig.settings') || {})
  return resolveAiAgentRuntimeConfig(settings)
}

export function getCompatibleAiConfigStatus() {
  const runtime = getCompatibleAiConfig()
  const descriptor = runtime.config ? getAiAgentExecutionDescriptor(runtime.config) : {}

  return {
    configured: Boolean(runtime.config),
    providerType: descriptor.providerType || '',
    model: descriptor.model || '',
    baseURLConfigured: Boolean(descriptor.baseURL),
    configSource: runtime.source,
    reason: runtime.config ? '' : 'ai_api_unconfigured'
  }
}

export function getCompatibleAiRuntimeConfig() {
  const runtime = getCompatibleAiConfig()
  if (!runtime.config) {
    return null
  }

  return runtime
}

function normalizeCompatibleAiModelRecord(record = {}) {
  const id = String(record?.id || record?.name || record?.model || '').trim()
  if (!id) {
    return null
  }
  return {
    id,
    name: String(record?.name || record?.id || id).trim() || id
  }
}

export function createCompatibleAiClient() {
  const config = getCompatibleAiRuntimeConfig()
  if (!config) {
    return null
  }

  return {
    config: config.config,
    configSource: config.source,
    client: new OpenAI({
      apiKey: config.config.apiKey,
      baseURL: config.config.baseURL,
      timeout: AI_AGENT_REQUEST_TIMEOUT_MS
    })
  }
}

export async function listCompatibleAiModels() {
  const runtime = createCompatibleAiClient()
  if (!runtime) {
    return {
      success: false,
      configured: false,
      models: [],
      message: 'AI API 未配置。'
    }
  }

  const response = await runtime.client.models.list()
  const modelList = Array.isArray(response?.data)
    ? response.data
    : typeof response?.[Symbol.iterator] === 'function'
      ? [...response]
      : []
  const modelIdSet = new Set()
  const models = modelList
    .map((item) => normalizeCompatibleAiModelRecord(item))
    .filter(Boolean)
    .filter((item) => {
      if (modelIdSet.has(item.id)) {
        return false
      }
      modelIdSet.add(item.id)
      return true
    })
    .sort((left, right) => left.id.localeCompare(right.id))

  return {
    success: true,
    configured: true,
    models
  }
}
