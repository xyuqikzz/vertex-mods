import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { sanitizeIpcPayload } from '@renderer/utils/ipc-payload.js'

function toSafeText(value) {
  return String(value ?? '').trim()
}

function normalizeSourcePlatform(value = '') {
  const text = toSafeText(value)
    .toLowerCase()
    .replace(/[\s._-]+/g, '')

  if (text === 'modio') return 'modio'
  if (text === 'nexus') return 'nexus'
  if (text === 'thunderstore') return 'thunderstore'
  if (text === 'ficsit') return 'ficsit'
  if (text === 'steam') return 'steam'
  if (text === 'global') return 'global'
  return toSafeText(value).toLowerCase()
}

function buildCacheKey(item = {}) {
  return [
    normalizeSourcePlatform(item.sourcePlatform ?? item.source_platform ?? item.source),
    toSafeText(item.rawName ?? item.raw_name ?? item.name)
  ].join('|')
}

const localNameCache = new Map()
const localSearchNameCache = new Map()

export async function resolveGameNameDictBatch(items = []) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) {
    return []
  }

  const resultList = new Array(list.length)
  const pendingItems = []
  const pendingIndexList = []

  list.forEach((item, index) => {
    const cacheKey = buildCacheKey(item)
    if (localNameCache.has(cacheKey)) {
      resultList[index] = localNameCache.get(cacheKey)
      return
    }
    pendingItems.push(item)
    pendingIndexList.push(index)
  })

  if (pendingItems.length) {
    const response = await ipcRenderer.invoke(
      'gameNameDictResolveBatch',
      sanitizeIpcPayload({ items: pendingItems }, { items: [] })
    )
    const resolvedList = Array.isArray(response) ? response : []
    resolvedList.forEach((item, index) => {
      const originalIndex = pendingIndexList[index]
      const cacheKey = buildCacheKey(pendingItems[index])
      const resolved = item && typeof item === 'object' ? item : null
      localNameCache.set(cacheKey, resolved)
      resultList[originalIndex] = resolved
    })
  }

  return resultList.map((item, index) => {
    if (item) {
      return item
    }
    const rawName = toSafeText(list[index]?.rawName ?? list[index]?.name)
    return {
      displayName: rawName,
      chineseName: '',
      rawName,
      matched: false,
      matchType: 'fallback'
    }
  })
}

export async function resolveGameNameFromDict(input = {}) {
  const rawName = toSafeText(
    input.rawName ??
      input.raw_name ??
      input.englishTitle ??
      input.english_title ??
      input.name ??
      input.fallbackName
  )
  const fallbackName = toSafeText(input.fallbackName ?? input.fallback_name ?? rawName)

  if (!rawName && !fallbackName) {
    return {
      displayName: '',
      chineseName: '',
      rawName: '',
      matched: false,
      matchType: 'fallback'
    }
  }

  const [resolved] = await resolveGameNameDictBatch([
    {
      sourcePlatform: input.sourcePlatform ?? input.source_platform ?? input.source,
      rawName: rawName || fallbackName,
      name: rawName || fallbackName
    }
  ])

  return {
    ...(resolved || {}),
    displayName: toSafeText(resolved?.displayName) || fallbackName || rawName,
    rawName: toSafeText(resolved?.rawName) || rawName || fallbackName
  }
}

export async function resolveGameNameSearchNameFromDict(input = {}) {
  const keyword = toSafeText(
    input.keyword ??
      input.name ??
      input.chineseName ??
      input.chinese_name ??
      input.rawName ??
      input.raw_name
  )
  if (!keyword) {
    return {
      searchName: '',
      rawName: '',
      chineseName: '',
      matched: false,
      matchType: 'fallback'
    }
  }

  if (localSearchNameCache.has(keyword)) {
    return localSearchNameCache.get(keyword)
  }

  const response = await ipcRenderer.invoke(
    'gameNameDictResolveSearchNameBatch',
    sanitizeIpcPayload({ items: [{ keyword }] }, { items: [] })
  )
  const resolved = Array.isArray(response) && response[0] ? response[0] : null
  const result = {
    ...(resolved || {}),
    searchName: toSafeText(resolved?.searchName) || keyword,
    rawName: toSafeText(resolved?.rawName) || keyword,
    chineseName: toSafeText(resolved?.chineseName),
    matched: Boolean(resolved?.matched),
    matchType: toSafeText(resolved?.matchType) || 'fallback'
  }
  localSearchNameCache.set(keyword, result)
  return result
}
