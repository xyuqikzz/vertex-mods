import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { canTranslateModContent, contentLocale } from '@renderer/i18n/content.js'
import { shouldTranslateContent } from '@renderer/i18n/content-policy.js'
import { sanitizeUserSystemConfig } from '../../../shared/account/user-config-policy.js'
import { resolveTranslationConfig } from '../../../shared/translation/translation-config.js'
import {
  normalizeEdgeSearchKeywordResult,
  resolveEdgeSearchKeywordWithProvider
} from '../../../shared/translation/edge-search-keyword.js'
import {
  ensureEdgeTranslationReady,
  ensureTranslationRuntimeStatus
} from './translation-runtime.js'

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeRequestItem(item = {}, index = 0) {
  const source = item && typeof item === 'object' ? item : {}
  const id = String(source.id || `item-${index}`).trim() || `item-${index}`
  const text = String(source.text || '').trim()
  if (!text) {
    return null
  }

  return {
    id,
    text,
    kind: String(source.kind || 'text').trim() || 'text',
    context: String(source.context || '').trim()
  }
}

function chunkArray(list = [], size = 8) {
  const safeSize = Math.max(1, Number(size || 8))
  const result = []
  for (let index = 0; index < list.length; index += safeSize) {
    result.push(list.slice(index, index + safeSize))
  }
  return result
}

function toPlainJson(data) {
  return JSON.parse(JSON.stringify(data || {}))
}

export { normalizeEdgeSearchKeywordResult }

export function resolveAiTranslationConfig(systemConfig = {}) {
  return resolveTranslationConfig(sanitizeUserSystemConfig(systemConfig))
}

export function isAiTranslationAvailable() {
  // 保留旧调用名；连接失败不应隐藏已缓存译文，也不能阻止用户再次手动重试。
  ensureTranslationRuntimeStatus()
  return canTranslateModContent()
}

async function requestTranslationBatchByIpc(ipcChannel = '', payload = {}) {
  if (!shouldTranslateContent(payload, contentLocale.value)) return new Map()
  ensureTranslationRuntimeStatus()
  const items = toSafeArray(payload?.items)
    .map((item, index) => normalizeRequestItem(item, index))
    .filter(Boolean)
  const source = String(payload?.source || '')
    .trim()
    .toLowerCase()
  const scene = String(payload?.scene || '').trim()
  const systemConfig = sanitizeUserSystemConfig(payload?.systemConfig)
  const config = resolveTranslationConfig(systemConfig)
  const onChunkSettled =
    typeof payload?.onChunkSettled === 'function' ? payload.onChunkSettled : null
  const resultMap = new Map()

  if (!items.length || !String(ipcChannel || '').trim()) {
    return resultMap
  }

  const chunks = chunkArray(items, config.batchSize)

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    if (!shouldTranslateContent(payload, contentLocale.value)) return new Map()
    const chunk = chunks[chunkIndex]
    let response

    try {
      response = await ipcRenderer.invoke(ipcChannel, {
        source,
        scene,
        systemConfig: toPlainJson({ translation: config }),
        edgeOnly: true,
        sourceLanguage: String(payload?.sourceLanguage || '').trim(),
        targetLanguage: String(payload?.targetLanguage || '').trim(),
        items: chunk.map((item) => ({
          id: item.id,
          text: item.text,
          kind: item.kind,
          context: item.context
        }))
      })
    } catch (error) {
      if (!shouldTranslateContent(payload, contentLocale.value)) return new Map()
      if (!resultMap.size) {
        throw error
      }

      console.warn('[微软翻译] 分块请求失败，返回已完成结果', {
        ipcChannel,
        source,
        scene,
        chunkIndex: chunkIndex + 1,
        chunkCount: chunks.length,
        completedItems: resultMap.size,
        error: String(error?.message || '未知错误')
      })
      break
    }

    // A request may finish after switching to English; do not publish its Chinese result.
    if (!shouldTranslateContent(payload, contentLocale.value)) return new Map()
    const translatedItems = toSafeArray(response?.items)
    const chunkResultMap = new Map()
    translatedItems.forEach((item) => {
      const id = String(item?.id || '').trim()
      const text = String(item?.text || '')
      if (!id || !text.trim() || !chunk.some((requestItem) => requestItem.id === id)) {
        return
      }
      resultMap.set(id, text)
      chunkResultMap.set(id, text)
    })

    if (onChunkSettled) {
      await onChunkSettled({
        chunkIndex: chunkIndex + 1,
        chunkCount: chunks.length,
        totalItems: items.length,
        completedItems: resultMap.size,
        chunkItems: chunk,
        chunkResultMap,
        resultMap: new Map(resultMap)
      })
    }
  }

  return shouldTranslateContent(payload, contentLocale.value) ? resultMap : new Map()
}

export async function queryCachedTextBatch(payload = {}) {
  return await requestTranslationBatchByIpc('queryAiTranslationCacheBatch', payload)
}

export async function translateTextBatch(payload = {}) {
  return await requestTranslationBatchByIpc('aiTranslateTextBatch', payload)
}

export async function translateTextBatchByEdge(payload = {}) {
  return await requestTranslationBatchByIpc('aiTranslateTextBatch', {
    ...payload,
    edgeOnly: true,
    reason: payload?.reason || 'edge_only_translation'
  })
}

export async function resolveEdgeSearchKeyword(payload = {}) {
  return await resolveEdgeSearchKeywordWithProvider(payload, {
    ensureEdgeReady: () =>
      ensureEdgeTranslationReady({
        reason: payload?.reason || 'mod_search_keyword'
      }),
    translateKeyword: async (originalKeyword) => {
      const translatedMap = await translateTextBatchByEdge({
        systemConfig: payload?.systemConfig,
        source: payload?.source,
        scene: payload?.scene || 'mod_search_keyword',
        sourceLanguage: 'zh-Hans',
        targetLanguage: 'en',
        items: [
          {
            id: 'search-keyword',
            text: originalKeyword,
            kind: 'search_keyword',
            context: payload?.context || '模组搜索关键词'
          }
        ]
      })
      return translatedMap.get('search-keyword') || ''
    },
    warn: console.warn
  })
}
