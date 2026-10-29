import {
  deleteAiTranslationDataByCacheKey,
  deleteAiTranslationDataByScope,
  deleteAiTranslationDataBySource,
  deleteAllAiTranslationData,
  getAiTranslationDataManagerOverview,
  listAiTranslationDataRecords
} from '../../db/cache/aiTranslationCache.js'

function toSafeText(value = '') {
  return String(value || '').trim()
}

function normalizeManagerFilters(payload = {}) {
  return {
    source: toSafeText(payload?.source).toLowerCase(),
    scopeKey: toSafeText(payload?.scopeKey).toLowerCase(),
    keyword: toSafeText(payload?.keyword),
    page: Math.max(1, Number(payload?.page || 1)),
    pageSize: Math.max(1, Math.min(100, Number(payload?.pageSize || 20)))
  }
}

function buildManagerState(filters = {}) {
  const normalizedFilters = normalizeManagerFilters(filters)
  const overview = getAiTranslationDataManagerOverview(normalizedFilters)
  let records = listAiTranslationDataRecords(normalizedFilters)

  if (records.total > 0 && records.page > Math.ceil(records.total / records.pageSize)) {
    records = listAiTranslationDataRecords({
      ...normalizedFilters,
      page: Math.max(1, Math.ceil(records.total / records.pageSize))
    })
  }

  return {
    filters: {
      ...normalizedFilters,
      page: records.page,
      pageSize: records.pageSize
    },
    overview,
    records
  }
}

export async function getAiTranslationDataManagerState(payload = {}) {
  return buildManagerState(payload)
}

export async function deleteAiTranslationData(payload = {}) {
  const deleteType = toSafeText(payload?.type).toLowerCase()
  const normalizedFilters = normalizeManagerFilters(payload)
  let result = {
    deletedCacheCount: 0
  }
  let message = ''

  if (deleteType === 'all') {
    result = deleteAllAiTranslationData()
    message = `已删除全部翻译数据，共 ${Number(result.deletedCacheCount || 0)} 条。`
  } else if (deleteType === 'source') {
    result = deleteAiTranslationDataBySource(normalizedFilters.source)
    message = `已删除平台 ${normalizedFilters.source || '--'} 的翻译数据，共 ${Number(result.deletedCacheCount || 0)} 条。`
  } else if (deleteType === 'scope') {
    result = deleteAiTranslationDataByScope(normalizedFilters.source, normalizedFilters.scopeKey)
    message = `已删除指定平台与游戏范围下的翻译数据，共 ${Number(result.deletedCacheCount || 0)} 条缓存。`
  } else if (deleteType === 'cachekey') {
    result = deleteAiTranslationDataByCacheKey(toSafeText(payload?.cacheKey))
    message = `已删除该条翻译数据。`
  } else {
    throw new Error('不支持的翻译数据删除类型。')
  }

  return {
    ...result,
    message,
    state: buildManagerState(normalizedFilters)
  }
}
