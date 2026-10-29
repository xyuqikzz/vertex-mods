import { sanitizeUserSystemConfig, sanitizeUserApiConfig } from '../../../../../shared/account/user-config-policy.js'
import {
  normalizeModioApiConfig,
  resolveEffectiveModioApiConfig
} from '../../../../../shared/sources/modio-api-config.js'
import {
  getAgentSourceCredentialGuide,
  listAgentSourceCredentialSources,
  normalizeAgentSourceCredentialConfigurableSource,
  normalizeAgentSourceCredentialSource
} from '../../../../../shared/ai/installation/ai-agent-source-credential.js'

let defaultStore = null
const VAMHUB_COOKIE_KEY = 'vamhubAuthCookie'

async function resolveStore(deps = {}) {
  if (deps.store) return deps.store
  if (!defaultStore) {
    defaultStore = (await import('./runtimeStore.js')).getRuntimeStore()
  }
  return defaultStore
}

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

const SECRET_ARGUMENT_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session|credential/i

function collectSecretArgumentKeys(value, path = '') {
  if (!value || typeof value !== 'object') return []
  const keys = []
  for (const [key, entryValue] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key
    if (SECRET_ARGUMENT_KEY_PATTERN.test(key)) {
      keys.push(currentPath)
      continue
    }
    if (entryValue && typeof entryValue === 'object') {
      keys.push(...collectSecretArgumentKeys(entryValue, currentPath))
    }
  }
  return keys
}

function readStoreValue(targetStore, key = '', fallback = {}) {
  if (!targetStore || !key) return fallback
  if (typeof targetStore.getStore === 'function') {
    return targetStore.getStore(key) || fallback
  }
  if (typeof targetStore.get === 'function') {
    return targetStore.get(key) || fallback
  }
  return fallback
}

function readSettingsFromStore(targetStore) {
  return sanitizeUserSystemConfig(readStoreValue(targetStore, 'systemConfig.settings', {}))
}

function normalizeNexusApiConfig(config = {}) {
  const source = sanitizeUserApiConfig(config)
  const apiKey = toSafeText(source.apiKey)
  const apiKeySource = apiKey ? 'local' : ''

  return {
    apiKey,
    apiKeySource
  }
}

function withGuide(status = {}) {
  const guide = getAgentSourceCredentialGuide(status.source)
  return {
    ...status,
    label: guide?.label || status.source,
    credentialType: guide?.credentialType || status.credentialType || '',
    required: guide?.required === true,
    configurable: guide?.configurable === true,
    helpUrl: guide?.helpUrl || '',
    helpText: guide?.helpText || ''
  }
}

function getNexusCredentialStatus(settings = {}, account = null) {
  const config = normalizeNexusApiConfig(settings.nexusApi)
  const oauth = account?.mode === 'oauth' || account?.credentialSource === 'oauth'
  const configured = oauth ? account.connected : Boolean(config.apiKey)
  return withGuide({
    source: 'nexus',
    status: configured ? 'configured' : oauth && account?.user ? 'expired' : 'missing',
    configured,
    localConfigured: Boolean(config.apiKey && config.apiKeySource === 'local'),
    apiKeySource: config.apiKeySource || '',
    credentialSource: oauth ? 'oauth' : config.apiKey ? 'api_key' : 'none'
  })
}

function getModioCredentialStatus(settings = {}) {
  const localConfig = normalizeModioApiConfig(settings.modioApi || {})
  const effectiveConfig = resolveEffectiveModioApiConfig(localConfig)
  const localConfigured = localConfig.apiConfigs.length > 0

  return withGuide({
    source: 'modio',
    status: effectiveConfig.apiConfigs.length > 0 ? 'configured' : 'missing',
    configured: effectiveConfig.apiConfigs.length > 0,
    localConfigured,
    apiKeySource: localConfigured ? 'local' : ''
  })
}

function getPublicCredentialStatus(source = '') {
  return withGuide({
    source,
    status: 'not_required',
    configured: true,
    localConfigured: false,
    serverConfigured: false,
    apiKeySource: ''
  })
}

function getVamHubCredentialStatus(settings = {}) {
  const configured = Boolean(toSafeText(settings[VAMHUB_COOKIE_KEY]))
  return withGuide({
    source: 'vamhub',
    status: configured ? 'configured' : 'missing_cookie',
    configured,
    localConfigured: configured,
    serverConfigured: false,
    apiKeySource: ''
  })
}

function resolveStatus(source = '', settings = {}, nexusAccount = null) {
  if (source === 'nexus') return getNexusCredentialStatus(settings, nexusAccount)
  if (source === 'modio') return getModioCredentialStatus(settings)
  if (source === 'ficsit') return getPublicCredentialStatus(source)
  if (source === 'thunderstore') return getPublicCredentialStatus(source)
  if (source === 'vamhub') return getVamHubCredentialStatus(settings)
  return null
}

export async function getSourceCredentialStatusTool(args = {}, _ctx = {}, deps = {}) {
  void _ctx
  const source = normalizeAgentSourceCredentialSource(args.source)
  const rawSource = toSafeText(args.source)
  if (rawSource && !source) {
    return {
      success: false,
      errorCode: 'unsupported_source',
      message: `暂不支持读取 ${rawSource} 的来源授权状态。`
    }
  }

  if (source === 'ficsit' || source === 'thunderstore') {
    return {
      success: true,
      source,
      status: resolveStatus(source, {})
    }
  }

  const targetStore = await resolveStore(deps)
  const settings = readSettingsFromStore(targetStore)
  const nexusAccount = source && source !== 'nexus' ? null : deps.getNexusAccountStatus
    ? await deps.getNexusAccountStatus()
    : deps.store ? null : (await import('../../../nexus/account.js')).nexusAccount.snapshot()
  if (source) {
    return {
      success: true,
      source,
      status: resolveStatus(source, settings, nexusAccount)
    }
  }

  return {
    success: true,
    sources: listAgentSourceCredentialSources(),
    statuses: listAgentSourceCredentialSources().map((item) => resolveStatus(item, settings, nexusAccount))
  }
}

export async function configureSourceCredentialTool(args = {}, ctx = {}) {
  const secretArgumentKeys = collectSecretArgumentKeys(args)
  if (secretArgumentKeys.length) {
    return {
      success: false,
      errorCode: 'secret_input_rejected',
      message: '来源密钥不能通过聊天参数传入，请使用客户端确认卡的安全输入框。'
    }
  }

  const source = normalizeAgentSourceCredentialConfigurableSource(args.source)
  if (!source) {
    const statusSource = normalizeAgentSourceCredentialSource(args.source)
    if (statusSource) {
      const guide = getAgentSourceCredentialGuide(statusSource)
      return {
        success: false,
        source: statusSource,
        errorCode: 'source_capability_disabled',
        message: `${guide?.label || statusSource} 不支持通过 AI 来源 API Key 确认卡配置。`
      }
    }
    return {
      success: false,
      errorCode: 'unsupported_source',
      message: `暂不支持配置 ${toSafeText(args.source, 'unknown')} 的来源密钥。`
    }
  }

  if (ctx.userConfirmed !== true && ctx.confirmed !== true) {
    return {
      success: false,
      errorCode: 'confirmation_required',
      message: '配置来源 API Key 需要先通过客户端确认卡输入。'
    }
  }

  const secretInput = toPlainObject(ctx.secretInput, {})
  const apiKey = toSafeText(secretInput.apiKey || secretInput.key || secretInput.apikey)
  if (!apiKey) {
    return {
      success: false,
      errorCode: 'missing_api_key_secret',
      message: '没有收到 API Key，请在确认卡中输入后再保存。'
    }
  }

  const guide = getAgentSourceCredentialGuide(source)
  return {
    success: false,
    source,
    configured: false,
    errorCode: 'secure_credential_store_unavailable',
    message: `${guide?.label || source} API Key 已通过确认卡接收，但当前客户端没有可复用的安全凭证存储。为避免明文长期保存，请在设置页手动配置该来源 API Key。`
  }
}
