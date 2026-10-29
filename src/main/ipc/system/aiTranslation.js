import store from '../../storage/store/index.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import {
  getAiTranslationCacheBatch,
  upsertAiTranslationCacheBatch,
  upsertAiTranslationCacheScopeBatch
} from '../../db/cache/aiTranslationCache.js'
import {
  buildAiTranslationCacheDescriptor,
  getAiTranslationPipelineExecutionDescriptor,
  normalizeAiTranslationConfig
} from '../../../shared/translation/ai-translation-config.js'
import {
  buildTranslationCacheDescriptor,
  normalizeTranslationConfig,
  normalizeTranslationLanguage,
  resolveTranslationConfig
} from '../../../shared/translation/translation-config.js'
import { translateItemsByEdge } from '../../services/translation/edgeTranslateProvider.js'
import {
  markEdgeTranslateAvailable,
  markEdgeTranslateUnavailable
} from '../../services/translation/translationRuntime.js'

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function toSafeText(value = '') {
  return String(value || '').trim()
}

function normalizeTranslationItem(item = {}, index = 0) {
  const source = item && typeof item === 'object' ? item : {}
  const id = String(source.id || `item-${index}`).trim() || `item-${index}`
  const text = String(source.text || '').trim()
  if (!text) {
    return null
  }

  return {
    id,
    text: text.slice(0, 4000),
    kind: String(source.kind || 'text').trim() || 'text',
    context: String(source.context || '').trim()
  }
}

function normalizeScopeKey(value = '') {
  return toSafeText(value).toLowerCase().replace(/\s+/g, ' ')
}

function extractScopeLabelFromContext(context = '', source = '') {
  const safeContext = toSafeText(context)
  const safeSource = toSafeText(source).toLowerCase()

  if (!safeContext) {
    return {
      scopeType: '',
      scopeKey: '',
      scopeLabel: ''
    }
  }

  if (safeSource === 'thunderstore') {
    const match = safeContext.match(/社区：([^；]+)/)
    const label = toSafeText(match?.[1])
    return {
      scopeType: label ? 'community' : '',
      scopeKey: normalizeScopeKey(label),
      scopeLabel: label
    }
  }

  if (safeSource === 'nexus' || safeSource === 'ficsit') {
    const match = safeContext.match(/游戏：([^；]+)/)
    const label = toSafeText(match?.[1])
    return {
      scopeType: label ? 'game' : '',
      scopeKey: normalizeScopeKey(label),
      scopeLabel: label
    }
  }

  const genericMatch = safeContext.match(/(?:游戏|社区)：([^；]+)/)
  const genericLabel = toSafeText(genericMatch?.[1])
  return {
    scopeType: genericLabel ? 'group' : '',
    scopeKey: normalizeScopeKey(genericLabel),
    scopeLabel: genericLabel
  }
}

function buildCacheScopeRecords(requestItems = [], source = '', scene = '') {
  return requestItems
    .map((item) => {
      const scopeMeta = extractScopeLabelFromContext(item.context, source)
      return {
        cacheKey: item.cacheKey,
        source,
        scene,
        itemKind: item.kind,
        contextText: item.context,
        scopeType: scopeMeta.scopeType,
        scopeKey: scopeMeta.scopeKey,
        scopeLabel: scopeMeta.scopeLabel
      }
    })
    .filter((item) => item.cacheKey)
}

function resolveNormalizedRequest(payload = {}) {
  const savedSettings = sanitizeUserSystemConfig(store.get('systemConfig.settings') || {})
  const settings = sanitizeUserSystemConfig(payload.systemConfig || savedSettings)
  const baseConfig = resolveTranslationConfig(settings)
  const config = normalizeTranslationConfig({
    ...baseConfig,
    targetLanguage: payload.targetLanguage || baseConfig.targetLanguage
  })
  const sourceLanguage = toSafeText(payload.sourceLanguage)
  const source = toSafeText(payload.source).toLowerCase()
  const scene = toSafeText(payload.scene)
  const execution = getAiTranslationPipelineExecutionDescriptor()
  // 仅兼容读取旧的纯微软缓存；历史混合 AI 缓存保留在数据库中，不再用于翻译。
  const legacyConfig = normalizeAiTranslationConfig(
    settings.aiTranslation || savedSettings.aiTranslation
  )
  const legacyTarget =
    normalizeTranslationLanguage(legacyConfig.targetLanguage) === config.targetLanguage
      ? legacyConfig.targetLanguage
      : config.targetLanguage
  const items = toSafeArray(payload.items)
    .map(normalizeTranslationItem)
    .filter(Boolean)
    .map((item) => ({
      ...item,
      ...buildTranslationCacheDescriptor(item, {
        ...execution,
        ...config,
        sourceLanguage,
        source,
        scene
      }),
      legacyCacheKeys: sourceLanguage
        ? []
        : [...new Set([legacyTarget, config.targetLanguage])].map(
            (targetLanguage) =>
              buildAiTranslationCacheDescriptor(item, {
                ...execution,
                targetLanguage,
                promptTemplate: legacyConfig.promptTemplate,
                source,
                scene
              }).cacheKey
          )
    }))
  return { config, sourceLanguage, source, scene, execution, items }
}

function buildCachedResultItems(items = []) {
  const keys = items.flatMap((item) => [item.cacheKey, ...item.legacyCacheKeys])
  const rows = new Map(
    getAiTranslationCacheBatch(keys).map((row) => [row.cacheKey, row.translatedText])
  )
  return items
    .map((item) => ({
      id: item.id,
      text:
        [item.cacheKey, ...item.legacyCacheKeys]
          .map((key) => rows.get(key))
          .find((text) => String(text || '').trim()) || ''
    }))
    .filter((item) => item.text)
}

function recordCacheScopes(items, translatedItems, source, scene) {
  const ids = new Set(translatedItems.map((item) => item.id))
  upsertAiTranslationCacheScopeBatch(
    buildCacheScopeRecords(
      items.filter((item) => ids.has(item.id)),
      source,
      scene
    )
  )
}

export async function queryTranslationCacheBatch(payload = {}) {
  const request = resolveNormalizedRequest(payload)
  const items = buildCachedResultItems(request.items)
  return { enabled: true, items }
}

export async function translateTextBatch(payload = {}) {
  const { config, sourceLanguage, source, scene, execution, items } =
    resolveNormalizedRequest(payload)
  const cachedItems = buildCachedResultItems(items)
  const cachedIds = new Set(cachedItems.map((item) => item.id))
  const missingItems = items.filter((item) => !cachedIds.has(item.id))
  if (!missingItems.length) return { enabled: true, items: cachedItems }

  const startedAt = Date.now()
  let translatedItems
  try {
    translatedItems = await translateItemsByEdge(missingItems, {
      sourceLanguage,
      targetLanguage: config.targetLanguage,
      timeoutMs: 10000
    })
    markEdgeTranslateAvailable({ latencyMs: Date.now() - startedAt })
  } catch (error) {
    markEdgeTranslateUnavailable({
      latencyMs: Date.now() - startedAt,
      errorMessage: error?.message
    })
    // 缓存与已完成的分块仍可展示；失败条目保留原文，绝不向模型服务发送内容。
    if (cachedItems.length) return { enabled: true, items: cachedItems }
    throw error
  }

  const translatedMap = new Map(translatedItems.map((item) => [item.id, item.text]))
  const records = missingItems
    .filter((item) => translatedMap.has(item.id))
    .map((item) => ({
      cacheKey: item.cacheKey,
      textHash: item.textHash,
      promptHash: item.promptHash,
      source,
      scene,
      itemKind: item.kind,
      ...execution,
      targetLanguage: config.targetLanguage,
      sourceText: item.text,
      translatedText: translatedMap.get(item.id)
    }))
  if (records.length) {
    upsertAiTranslationCacheBatch(records)
    recordCacheScopes(missingItems, translatedItems, source, scene)
  }
  const result = new Map([...cachedItems, ...translatedItems].map((item) => [item.id, item.text]))
  return {
    enabled: true,
    items: items
      .filter((item) => result.has(item.id))
      .map((item) => ({ id: item.id, text: result.get(item.id) }))
  }
}
