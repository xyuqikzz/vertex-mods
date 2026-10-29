export const DEFAULT_TRANSLATION_RUNTIME_STATUS = Object.freeze({
  edge: Object.freeze({
    status: 'unknown',
    available: false,
    checkedAt: '',
    latencyMs: 0,
    errorMessage: ''
  })
})

export function normalizeTranslationRuntimeStatus(status = {}) {
  const edge = status && typeof status === 'object' ? status.edge || {} : {}
  const edgeStatus = String(edge.status || DEFAULT_TRANSLATION_RUNTIME_STATUS.edge.status)
    .trim()
    .toLowerCase()
  const normalizedStatus =
    edge.available === true
      ? 'available'
      : ['unknown', 'checking', 'available', 'unavailable'].includes(edgeStatus)
        ? edgeStatus
        : DEFAULT_TRANSLATION_RUNTIME_STATUS.edge.status

  return {
    edge: {
      status: normalizedStatus,
      available: normalizedStatus === 'available',
      checkedAt: String(edge.checkedAt || ''),
      latencyMs: Number.isFinite(Number(edge.latencyMs)) ? Number(edge.latencyMs) : 0,
      errorMessage: String(edge.errorMessage || '')
    }
  }
}

export function isEdgeTranslationRuntimeAvailable(runtimeStatus = {}) {
  return normalizeTranslationRuntimeStatus(runtimeStatus).edge.available === true
}

export function filterUntranslatedItems(requestItems = [], translatedItems = []) {
  const translatedIdSet = new Set(
    (Array.isArray(translatedItems) ? translatedItems : [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)
  )

  return (Array.isArray(requestItems) ? requestItems : []).filter((item) => {
    const id = String(item?.id || '').trim()
    return id && !translatedIdSet.has(id)
  })
}

export function isTranslationRuntimeConfigAvailable(_settings = {}, runtimeStatus = {}) {
  // 保留旧签名，翻译可用性不再取决于任何模型配置。
  void _settings
  return isEdgeTranslationRuntimeAvailable(runtimeStatus)
}
