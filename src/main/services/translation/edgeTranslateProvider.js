import { EDGE_TRANSLATE_API_URL } from '../../../shared/translation/ai-translation-config.js'

const DEFAULT_EDGE_TRANSLATE_TIMEOUT_MS = 10000
const EDGE_LANGUAGE_ALIASES = Object.freeze({
  简体中文: 'zh-Hans',
  繁体中文: 'zh-Hant',
  繁體中文: 'zh-Hant'
})

function toSafeArray(value) {
  return Array.isArray(value) ? value : []
}

function toSafeText(value = '') {
  return String(value || '').trim()
}

function normalizeRequestItem(item = {}, index = 0) {
  const source = item && typeof item === 'object' ? item : {}
  const id = toSafeText(source.id || `item-${index}`) || `item-${index}`
  const text = toSafeText(source.text)
  if (!text) {
    return null
  }

  return {
    id,
    text
  }
}

export function normalizeEdgeTargetLanguage(targetLanguage = '') {
  const safeLanguage = toSafeText(targetLanguage) || 'zh-Hans'
  return EDGE_LANGUAGE_ALIASES[safeLanguage] || safeLanguage
}

function normalizeEdgeTranslateError(error = null) {
  const message = toSafeText(error?.message || error?.cause?.message) || '未知错误'
  if (error?.name === 'AbortError') {
    return new Error('Microsoft Edge Translate request timed out', { cause: error })
  }

  return new Error(`Microsoft Edge Translate failed: ${message}`, { cause: error })
}

async function parseEdgeTranslateResponse(response) {
  const rawText = await response.text()
  try {
    const parsed = JSON.parse(rawText)
    if (!Array.isArray(parsed)) {
      throw new Error('Edge translate response is not an array')
    }
    return parsed
  } catch (error) {
    throw new Error('Microsoft Edge Translate returned invalid JSON', { cause: error })
  }
}

export async function translateItemsByEdge(items = [], options = {}) {
  const requestItems = toSafeArray(items)
    .map((item, index) => normalizeRequestItem(item, index))
    .filter(Boolean)

  if (!requestItems.length) {
    return []
  }

  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('Microsoft Edge Translate fetch is unavailable')
  }

  const url = new URL(EDGE_TRANSLATE_API_URL)
  url.searchParams.set('from', toSafeText(options.sourceLanguage))
  url.searchParams.set('to', normalizeEdgeTargetLanguage(options.targetLanguage))
  url.searchParams.set('isEnterpriseClient', 'false')

  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs || DEFAULT_EDGE_TRANSLATE_TIMEOUT_MS) ||
      DEFAULT_EDGE_TRANSLATE_TIMEOUT_MS
  )
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestItems.map((item) => item.text)),
      signal: controller.signal
    })

    if (!response?.ok) {
      throw new Error(`HTTP ${response?.status || 0}`)
    }

    const data = await parseEdgeTranslateResponse(response)
    if (data.length !== requestItems.length) {
      throw new Error(
        `Edge translate response length mismatch: ${data.length}/${requestItems.length}`
      )
    }

    return requestItems
      .map((item, index) => ({
        id: item.id,
        text: toSafeText(data[index]?.translations?.[0]?.text)
      }))
      .filter((item) => item.id && item.text)
  } catch (error) {
    throw normalizeEdgeTranslateError(error)
  } finally {
    clearTimeout(timeout)
  }
}

export async function probeEdgeTranslate(options = {}) {
  const texts = toSafeArray(options.texts).length
    ? toSafeArray(options.texts)
    : ['Start Game', 'Settings', 'Exit']
  const items = texts.map((text, index) => ({
    id: `probe-${index}`,
    text
  }))
  const startedAt = Date.now()

  try {
    const translatedItems = await translateItemsByEdge(items, {
      targetLanguage: options.targetLanguage || 'zh-Hans',
      timeoutMs: options.timeoutMs || 5000,
      fetchImpl: options.fetchImpl
    })
    const latencyMs = Date.now() - startedAt
    const hasChineseText = translatedItems.some((item) => /[\u3400-\u9fff]/.test(item.text))
    const available = translatedItems.length === items.length && hasChineseText

    return {
      available,
      latencyMs,
      sample: translatedItems,
      errorMessage: available ? '' : 'Edge 翻译自检返回结果不完整'
    }
  } catch (error) {
    return {
      available: false,
      latencyMs: Date.now() - startedAt,
      sample: [],
      errorMessage: toSafeText(error?.message) || 'Edge 翻译自检失败'
    }
  }
}
