import { sanitizeUserSystemConfig, sanitizeUserApiConfig } from '../account/user-config-policy.js'
// 以下提示词仅用于识别旧微软缓存的指纹，不再发送给模型。
export const AI_TRANSLATION_TEMPLATE_VARIABLES = Object.freeze([
  Object.freeze({
    key: 'targetLanguage',
    label: '{{targetLanguage}}',
    description: '目标翻译语言'
  }),
  Object.freeze({
    key: 'source',
    label: '{{source}}',
    description: '当前模组来源'
  }),
  Object.freeze({
    key: 'scene',
    label: '{{scene}}',
    description: '当前翻译场景'
  })
])

const LEGACY_AI_TRANSLATION_PROMPT_TEMPLATE = [
  '你是游戏模组平台翻译助手。',
  '来源：{{source}}；场景：{{scene}}；目标语言：{{targetLanguage}}。',
  '任务：把输入翻译为{{targetLanguage}}，用于游戏模组平台展示。',
  '只输出 JSON：{ "items": [{ "id": "原ID", "text": "翻译结果" }] }',
  '不解释，不输出额外内容。',
  '保留以下内容不翻译：版本号、数字、品牌名、作者名、路径、URL、扩展名、缩写、API 名称。',
  '正式名称（模组、整合包、加载器、插件、库、项目名）优先保留原名；如已有常见中文叫法，可写“中文名（原名）”。',
  '普通描述、功能说明、界面文本应自然翻译，符合中文模组社区习惯。',
  '英文复合词按语义拆分后翻译。',
  '文件名只翻译语义部分，保留原结构、分隔符和后缀。',
  '术语映射：Mod=模组，Mods=模组，Modpack=整合包，Manager=管理器，Config=配置，Plugin=插件，Plugins=插件，Loader=加载器，Library=库，Dependency=依赖，Patch=补丁。',
  '名称处理优先级：正式名称优先保留；功能短语正常翻译；不要硬翻项目名；描述可意译但不能改变原意。'
].join('\n')

export const DEFAULT_AI_TRANSLATION_PROMPT_TEMPLATE = [
  '你是游戏模组平台翻译助手。',
  '来源：{{source}}；场景：{{scene}}；目标语言：{{targetLanguage}}。',
  '任务：把输入翻译为{{targetLanguage}}，用于游戏模组平台展示。',
  '只输出 JSON：{ "items": [{ "id": "原ID", "text": "翻译结果" }] }',
  '不解释，不输出额外内容。',
  '保留以下内容不翻译：版本号、数字、品牌名、作者名、路径、URL、扩展名、缩写、API 名称。',
  '当条目 kind=mod_name 时，必须返回适合中文界面展示的名称。',
  '若名称是英文组合词、功能短语或可直译名称，应直接翻译为自然中文，不要只返回原名。',
  '若名称是专有项目名、作者命名或社区常用原名，也要补充中文释义，优先使用“中文名（原名）”格式，而不是仅保留原文。',
  '普通描述、功能说明、界面文本应自然翻译，符合中文模组社区习惯。',
  '英文复合词按语义拆分后翻译。',
  '文件名只翻译语义部分，保留原结构、分隔符和后缀。',
  '术语映射：Mod=模组，Mods=模组，Modpack=整合包，Manager=管理器，Config=配置，Plugin=插件，Plugins=插件，Loader=加载器，Library=库，Dependency=依赖，Patch=补丁。',
  '名称处理优先级：先保证中文用户能看懂，再决定是否附带原名；描述可意译但不能改变原意。'
].join('\n')

export const AI_TRANSLATION_CACHE_SCHEMA_VERSION = 'vertex_ai_translation_cache_v3'
export const LOCAL_AI_TRANSLATION_CACHE_MODEL_KEY = '__vertex_local_translation__'

export const AI_TRANSLATION_PROVIDER_PRESETS = Object.freeze({
  deepseek: Object.freeze({
    key: 'deepseek',
    label: 'DeepSeek',
    description: '适合作为默认 OpenAI 兼容翻译入口',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: Object.freeze(['deepseek-chat', 'deepseek-reasoner'])
  }),
  openai: Object.freeze({
    key: 'openai',
    label: 'ChatGPT / OpenAI',
    description: 'OpenAI 官方兼容接口',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    models: Object.freeze(['gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini'])
  }),
  zhipu: Object.freeze({
    key: 'zhipu',
    label: '智谱 AI',
    description: '智谱开放平台兼容接口',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: Object.freeze(['glm-4-flash', 'glm-4-plus', 'glm-4-air'])
  }),
  custom: Object.freeze({
    key: 'custom',
    label: '自定义兼容接口',
    description: '手动填写 OpenAI 兼容地址与模型',
    baseURL: '',
    defaultModel: '',
    models: Object.freeze([])
  })
})

export const AI_TRANSLATION_BATCH_SIZE_OPTIONS = Object.freeze([10, 20, 40, 60])

export const AI_API_CONFIG_SCOPES = Object.freeze({
  TRANSLATION: 'translation',
  ASSISTANT: 'assistant',
  ALL: 'all'
})

export const AI_API_CONFIG_SCOPE_OPTIONS = Object.freeze([
  Object.freeze({
    key: AI_API_CONFIG_SCOPES.TRANSLATION,
    label: '模组翻译'
  }),
  Object.freeze({
    key: AI_API_CONFIG_SCOPES.ASSISTANT,
    label: '助手'
  }),
  Object.freeze({
    key: AI_API_CONFIG_SCOPES.ALL,
    label: '全部'
  })
])

export const AI_TRANSLATION_MODE_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'remote',
    label: '远程 AI 模组翻译',
    description: '使用当前远程 AI 平台配置进行模组翻译'
  })
])

export const EDGE_TRANSLATE_API_URL = 'https://edge.microsoft.com/translate/translatetext'
export const EDGE_TRANSLATE_CACHE_PROVIDER_TYPE = 'edge-ai-auto'
export const EDGE_TRANSLATE_CACHE_MODEL_VERSION = 'edge-translate:v1'

export const DEFAULT_AI_TRANSLATION_CONFIG = Object.freeze({
  enabled: true,
  mode: 'remote',
  providerType: 'deepseek',
  baseURL: AI_TRANSLATION_PROVIDER_PRESETS.deepseek.baseURL,
  apiKey: '',
  model: AI_TRANSLATION_PROVIDER_PRESETS.deepseek.defaultModel,
  targetLanguage: '简体中文',
  showOriginalText: false,
  batchSize: 20,
  promptTemplate: DEFAULT_AI_TRANSLATION_PROMPT_TEMPLATE
})

export const AI_API_KEY_SOURCE = Object.freeze({
  LOCAL: 'local'
})

export const AI_RUNTIME_CONFIG_SOURCE = Object.freeze({
  AI_AGENT: 'aiAgent',
  AI_TRANSLATION: 'aiTranslation',
  NONE: 'none'
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

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toConfiguredText(value, fallback = '') {
  if (value === undefined || value === null) {
    return String(fallback || '').trim()
  }

  return String(value).trim()
}

function normalizePromptTemplate(value = '') {
  const safeValue = toConfiguredText(value, DEFAULT_AI_TRANSLATION_PROMPT_TEMPLATE)
  const normalizedValue = safeValue || DEFAULT_AI_TRANSLATION_PROMPT_TEMPLATE
  if (normalizedValue === LEGACY_AI_TRANSLATION_PROMPT_TEMPLATE) {
    return DEFAULT_AI_TRANSLATION_PROMPT_TEMPLATE
  }
  return normalizedValue
}

function normalizeAiTranslationMode(value = '') {
  const safeMode = String(value || '')
    .trim()
    .toLowerCase()

  return AI_TRANSLATION_MODE_OPTIONS.some((item) => item.key === safeMode) ? safeMode : 'remote'
}

function normalizeAiApiConfigScope(value = '') {
  const safeScope = String(value || '')
    .trim()
    .toLowerCase()

  return Object.values(AI_API_CONFIG_SCOPES).includes(safeScope)
    ? safeScope
    : AI_API_CONFIG_SCOPES.ALL
}

function normalizeAiApiConfigId(value = '', index = 0) {
  const safeId = String(value || '').trim()
  return safeId || `api-config-${index + 1}`
}

function normalizeAiApiConfigName(value = '', index = 0) {
  const safeName = String(value || '').trim()
  return safeName || `API 配置 ${index + 1}`
}

function normalizeAiProviderFields(source = {}, fallbackConfig = DEFAULT_AI_TRANSLATION_CONFIG) {
  const safeSource = source && typeof source === 'object' ? source : {}
  const rawProviderType = String(
    safeSource.providerType || safeSource.provider || fallbackConfig.providerType
  )
    .trim()
    .toLowerCase()
  const providerType = AI_TRANSLATION_PROVIDER_PRESETS[rawProviderType]
    ? rawProviderType
    : fallbackConfig.providerType
  const providerPreset = getAiTranslationProviderPreset(providerType)

  return {
    providerType,
    baseURL: toConfiguredText(
      safeSource.baseURL ?? safeSource.baseUrl,
      providerType === 'custom' ? '' : providerPreset.baseURL
    ),
    apiKey: String(safeSource.apiKey || safeSource.aiApiKey || '').trim(),
    model: toConfiguredText(
      safeSource.model,
      providerType === 'custom' ? '' : providerPreset.defaultModel
    )
  }
}

export function normalizeAiApiConfig(config = {}, index = 0, options = {}) {
  const source = config && typeof config === 'object' ? config : {}
  return {
    id: normalizeAiApiConfigId(source.id, index),
    name: normalizeAiApiConfigName(source.name || source.label || source.title, index),
    enabled: toSafeBoolean(source.enabled, options.enabledFallback === true),
    scope: normalizeAiApiConfigScope(source.scope || source.usageScope),
    ...normalizeAiProviderFields(source)
  }
}

export function applyAiApiConfigEnableRules(configs = []) {
  const normalizedConfigs = Array.isArray(configs) ? configs : []
  const enabledAllIndex = normalizedConfigs.findIndex(
    (item) => item.enabled && item.scope === AI_API_CONFIG_SCOPES.ALL
  )

  if (enabledAllIndex >= 0) {
    return normalizedConfigs.map((item, index) => ({
      ...item,
      enabled: index === enabledAllIndex
    }))
  }

  const enabledScopes = new Set()
  return normalizedConfigs.map((item) => {
    if (!item.enabled) {
      return item
    }

    if (enabledScopes.has(item.scope)) {
      return {
        ...item,
        enabled: false
      }
    }

    enabledScopes.add(item.scope)
    return item
  })
}

export function normalizeAiApiConfigs(configs = [], legacyConfig = {}) {
  const sourceConfigs = Array.isArray(configs) ? configs : []
  const hasSourceConfigs = sourceConfigs.length > 0
  const seedConfigs = hasSourceConfigs
    ? sourceConfigs
    : [
        {
          id: 'default',
          name: '默认配置',
          enabled: true,
          scope: AI_API_CONFIG_SCOPES.ALL,
          ...normalizeAiProviderFields(legacyConfig)
        }
      ]
  const usedIds = new Set()
  const normalizedConfigs = seedConfigs.map((item, index) => {
    const normalized = normalizeAiApiConfig(item, index, {
      enabledFallback: !hasSourceConfigs && index === 0
    })
    const baseId = normalized.id
    let nextId = baseId
    let suffix = 2

    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${suffix}`
      suffix += 1
    }

    usedIds.add(nextId)
    return {
      ...normalized,
      id: nextId
    }
  })

  return applyAiApiConfigEnableRules(normalizedConfigs)
}

export function resolveAiApiConfigForScope(config = {}, scope = AI_API_CONFIG_SCOPES.ALL) {
  const normalized = normalizeAiTranslationConfig(config)
  const safeScope = normalizeAiApiConfigScope(scope)
  const directConfig = normalized.apiConfigs.find(
    (item) => item.enabled && item.scope === safeScope
  )

  if (directConfig) {
    return directConfig
  }

  return (
    normalized.apiConfigs.find((item) => item.enabled && item.scope === AI_API_CONFIG_SCOPES.ALL) ||
    null
  )
}

export function getAiTranslationProviderPreset(providerType = '') {
  const key = String(providerType || '')
    .trim()
    .toLowerCase()

  return AI_TRANSLATION_PROVIDER_PRESETS[key] || AI_TRANSLATION_PROVIDER_PRESETS.custom
}

export function normalizeAiTranslationConfig(config = {}) {
  const source = sanitizeUserApiConfig(config)
  const mode = normalizeAiTranslationMode(source.mode ?? source.translationMode)
  const hasExplicitApiConfigs = Array.isArray(source.apiConfigs) && source.apiConfigs.length > 0
  const apiConfigs = normalizeAiApiConfigs(source.apiConfigs, source)
  const selectedTranslationApiConfig =
    apiConfigs.find((item) => item.enabled && item.scope === AI_API_CONFIG_SCOPES.TRANSLATION) ||
    apiConfigs.find((item) => item.enabled && item.scope === AI_API_CONFIG_SCOPES.ALL) ||
    null
  const providerFields =
    selectedTranslationApiConfig ||
    (hasExplicitApiConfigs
      ? {
          providerType: 'custom',
          baseURL: '',
          apiKey: '',
          model: ''
        }
      : normalizeAiProviderFields(source))
  const rawBatchSize = toSafeNumber(source.batchSize, DEFAULT_AI_TRANSLATION_CONFIG.batchSize)
  const normalizedBatchSize = AI_TRANSLATION_BATCH_SIZE_OPTIONS.includes(rawBatchSize)
    ? rawBatchSize
    : DEFAULT_AI_TRANSLATION_CONFIG.batchSize

  return {
    enabled: toSafeBoolean(source.enabled, DEFAULT_AI_TRANSLATION_CONFIG.enabled),
    mode,
    providerType: providerFields.providerType,
    baseURL: providerFields.baseURL,
    apiKey: providerFields.apiKey,
    model: providerFields.model,
    targetLanguage:
      toConfiguredText(source.targetLanguage, DEFAULT_AI_TRANSLATION_CONFIG.targetLanguage) ||
      DEFAULT_AI_TRANSLATION_CONFIG.targetLanguage,
    showOriginalText: false,
    batchSize: normalizedBatchSize,
    promptTemplate: normalizePromptTemplate(source.promptTemplate ?? source.rolePreset),
    apiConfigs
  }
}

export function applyAiTranslationProviderPreset(config = {}, providerType = '') {
  const source = config && typeof config === 'object' ? config : {}
  const normalized = normalizeAiTranslationConfig(config)
  const preset = getAiTranslationProviderPreset(providerType)
  const hasExplicitApiConfigs = Array.isArray(source.apiConfigs) && source.apiConfigs.length > 0
  const nextProviderType = AI_TRANSLATION_PROVIDER_PRESETS[
    String(providerType || '')
      .trim()
      .toLowerCase()
  ]
    ? String(providerType || '')
        .trim()
        .toLowerCase()
    : normalized.providerType
  const providerPatch =
    nextProviderType === 'custom'
      ? {
          providerType: nextProviderType
        }
      : {
          providerType: nextProviderType,
          baseURL: preset.baseURL,
          model: preset.defaultModel
        }

  if (!hasExplicitApiConfigs) {
    const nextConfig = {
      ...normalized,
      ...providerPatch
    }
    delete nextConfig.apiConfigs
    return normalizeAiTranslationConfig(nextConfig)
  }

  const selectedApiConfig =
    normalized.apiConfigs.find(
      (item) => item.enabled && item.scope === AI_API_CONFIG_SCOPES.TRANSLATION
    ) ||
    normalized.apiConfigs.find((item) => item.enabled && item.scope === AI_API_CONFIG_SCOPES.ALL) ||
    normalized.apiConfigs[0]

  return normalizeAiTranslationConfig({
    ...normalized,
    apiConfigs: normalized.apiConfigs.map((item) =>
      item.id === selectedApiConfig?.id
        ? {
            ...item,
            ...providerPatch
          }
        : item
    )
  })
}

export function isRemoteAiTranslationReady(config = {}) {
  const normalized = normalizeAiTranslationConfig(config)
  return !!(
    normalized.enabled &&
    normalized.mode === 'remote' &&
    normalized.baseURL &&
    normalized.apiKey &&
    normalized.model
  )
}

export function isAiTranslationReady(config = {}) {
  const normalized = normalizeAiTranslationConfig(config)
  if (!normalized.enabled) {
    return false
  }

  return isRemoteAiTranslationReady(normalized)
}

export function resolveAiTranslationRuntimeConfig(settings = {}) {
  const source = sanitizeUserSystemConfig(settings)
  const aiTranslation = normalizeAiTranslationConfig(source.aiTranslation ?? source)
  if (isAiTranslationReady(aiTranslation)) {
    return {
      config: {
        ...aiTranslation,
        apiKeySource: AI_API_KEY_SOURCE.LOCAL
      },
      source: AI_RUNTIME_CONFIG_SOURCE.AI_TRANSLATION
    }
  }

  return {
    config: aiTranslation,
    source: AI_RUNTIME_CONFIG_SOURCE.NONE
  }
}

export function getAiTranslationExecutionDescriptor(config = {}) {
  const normalized = normalizeAiTranslationConfig(config)

  return {
    providerType: normalized.providerType,
    baseURL: normalized.baseURL,
    model: normalized.model
  }
}

// 所有新翻译统一使用微软；参数只为旧调用方保留兼容。
export function getAiTranslationPipelineExecutionDescriptor() {
  return {
    providerType: EDGE_TRANSLATE_CACHE_PROVIDER_TYPE,
    baseURL: EDGE_TRANSLATE_API_URL,
    model: EDGE_TRANSLATE_CACHE_MODEL_VERSION
  }
}

export function renderAiTranslationSystemPrompt(template = '', options = {}) {
  const safeTemplate =
    String(template || '').trim() || String(DEFAULT_AI_TRANSLATION_PROMPT_TEMPLATE || '').trim()
  const variableMap = {
    targetLanguage: String(options?.targetLanguage || '').trim() || '简体中文',
    source: String(options?.source || '').trim() || '通用模组来源',
    scene: String(options?.scene || '').trim() || '通用文本翻译'
  }

  return safeTemplate.replace(/\{\{\s*(targetLanguage|source|scene)\s*\}\}/g, (_match, key) => {
    return variableMap[key] || ''
  })
}

export function createAiTranslationTextFingerprint(text = '') {
  let hash = 2166136261
  const source = String(text || '')

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }

  return `${(hash >>> 0).toString(36)}-${source.length}`
}

export function buildAiTranslationCacheDescriptor(item = {}, options = {}) {
  const normalizedItem = item && typeof item === 'object' ? item : {}
  const providerType = String(options?.providerType || '')
    .trim()
    .toLowerCase()
  const baseURL = String(options?.baseURL || '')
    .trim()
    .toLowerCase()
  const model = String(options?.model || '').trim()
  const targetLanguage = String(options?.targetLanguage || '').trim()
  const source = String(options?.source || '')
    .trim()
    .toLowerCase()
  const scene = String(options?.scene || '').trim()
  const kind = String(normalizedItem?.kind || 'text').trim() || 'text'
  const textHash = createAiTranslationTextFingerprint(normalizedItem?.text || '')
  const promptHash = createAiTranslationTextFingerprint(
    renderAiTranslationSystemPrompt(options?.promptTemplate, {
      targetLanguage,
      source,
      scene
    })
  )

  return {
    promptHash,
    textHash,
    cacheKey: buildAiTranslationCacheKey({
      providerType,
      baseURL,
      model,
      targetLanguage,
      source,
      scene,
      kind,
      promptHash,
      textHash
    })
  }
}

export function buildAiTranslationCacheKey(options = {}) {
  return [
    AI_TRANSLATION_CACHE_SCHEMA_VERSION,
    String(options?.providerType || '')
      .trim()
      .toLowerCase(),
    String(options?.baseURL || '')
      .trim()
      .toLowerCase(),
    String(options?.model || '').trim(),
    String(options?.targetLanguage || '').trim(),
    String(options?.source || '')
      .trim()
      .toLowerCase(),
    String(options?.scene || '').trim(),
    String(options?.kind || options?.itemKind || 'text').trim() || 'text',
    String(options?.promptHash || '').trim(),
    String(options?.textHash || '').trim()
  ].join(':')
}
