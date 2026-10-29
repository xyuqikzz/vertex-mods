export const STANDARD_PREFLIGHT_AUTHORIZATION_FIELD = 'standardPreflightAuthorization'
export const STANDARD_PREFLIGHT_AUTHORIZATION_TYPE = 'standard_preflight'

const RUNTIME_INSTALL_FIELD_SET = new Set([
  STANDARD_PREFLIGHT_AUTHORIZATION_FIELD,
  'agentAuthorization',
  'standardInspectToken',
  'inspectToken',
  'payloadHash',
  'stagingToken',
  'legacyStagingToken',
  'nexusPreviewToken',
  'previewToken',
  'nexus_preview_token'
])

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickPlainObject(...values) {
  for (const value of values) {
    if (isPlainObject(value)) {
      return toPlainJson(value, {})
    }
  }
  return {}
}

function normalizeAuthorization(value = null) {
  if (!isPlainObject(value)) return null
  const payloadHash = toSafeText(value.payloadHash)
  if (!payloadHash) return null
  return {
    type: toSafeText(value.type, STANDARD_PREFLIGHT_AUTHORIZATION_TYPE),
    source: toSafeText(value.source).toLowerCase(),
    payloadHash,
    inspectToken: toSafeText(value.inspectToken),
    authorizedAt: toSafeText(value.authorizedAt),
    agentTaskId: toSafeText(value.agentTaskId),
    standardTaskId: toSafeText(value.standardTaskId),
    metadataSchemaVersion: toSafeText(value.metadataSchemaVersion),
    itemIndex: Math.max(0, toSafeNumber(value.itemIndex, 0)),
    scope: toSafeText(value.scope, 'first_item')
  }
}

function resolveEntryInstallPayload(entry = {}) {
  const source = isPlainObject(entry) ? entry : {}
  const item = isPlainObject(source.item) ? source.item : source
  const meta = isPlainObject(source.meta) ? source.meta : {}
  return pickPlainObject(meta.installPayload, source.installPayload, item.installPayload)
}

function attachAuthorizationToEntry(entry = {}, authorization = null) {
  if (!isPlainObject(entry)) {
    return entry
  }
  const nextEntry = toPlainJson(entry, {})
  const nextMeta = isPlainObject(nextEntry.meta) ? toPlainJson(nextEntry.meta, {}) : {}
  const installPayload = resolveEntryInstallPayload(nextEntry)
  nextMeta.installPayload = {
    ...installPayload,
    [STANDARD_PREFLIGHT_AUTHORIZATION_FIELD]: authorization
  }
  nextMeta[STANDARD_PREFLIGHT_AUTHORIZATION_FIELD] = authorization
  nextEntry.meta = nextMeta
  return nextEntry
}

function stripRuntimeFields(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripRuntimeFields(item))
  }
  if (isPlainObject(value)) {
    return Object.keys(value).reduce((result, key) => {
      if (RUNTIME_INSTALL_FIELD_SET.has(key)) {
        return result
      }
      const normalized = stripRuntimeFields(value[key])
      if (typeof normalized !== 'undefined') {
        result[key] = normalized
      }
      return result
    }, {})
  }
  if (typeof value === 'undefined') return undefined
  return value
}

export function createStandardPreflightAuthorization(plan = {}, options = {}) {
  const safePlan = toPlainJson(plan, {})
  const standardPreflight = isPlainObject(safePlan.standardPreflight)
    ? safePlan.standardPreflight
    : null
  if (!standardPreflight || standardPreflight.status !== 'completed') {
    return null
  }

  return normalizeAuthorization({
    type: STANDARD_PREFLIGHT_AUTHORIZATION_TYPE,
    source: standardPreflight.source || safePlan.source,
    payloadHash: standardPreflight.payloadHash,
    inspectToken: '',
    authorizedAt: toSafeText(options.authorizedAt) || new Date().toISOString(),
    agentTaskId: safePlan.agentTaskId || safePlan.taskId,
    standardTaskId: standardPreflight.standardTaskId,
    metadataSchemaVersion: standardPreflight.metadataSchemaVersion,
    itemIndex: 0,
    scope: 'first_item'
  })
}

export function attachStandardPreflightAuthorizationToPayload(payload = {}, authorization = null) {
  const nextPayload = toPlainJson(payload, {})
  const normalizedAuthorization = normalizeAuthorization(authorization)
  if (!normalizedAuthorization || !Array.isArray(nextPayload.items)) {
    return nextPayload
  }

  const targetIndex = normalizedAuthorization.itemIndex
  nextPayload.items = nextPayload.items.map((entry, index) =>
    index === targetIndex ? attachAuthorizationToEntry(entry, normalizedAuthorization) : entry
  )
  return nextPayload
}

export function getStandardPreflightAuthorization(payload = {}) {
  const safePayload = isPlainObject(payload) ? payload : {}
  return normalizeAuthorization(
    safePayload[STANDARD_PREFLIGHT_AUTHORIZATION_FIELD] ||
      safePayload.agentAuthorization?.standardPreflight ||
      null
  )
}

export function stripStandardPreflightAuthorizationFromPayload(payload = {}) {
  return stripRuntimeFields(toPlainJson(payload, {}))
}

export function verifyStandardPreflightAuthorization(previewResult = {}, authorization = null) {
  const normalizedAuthorization = normalizeAuthorization(authorization)
  if (!normalizedAuthorization) {
    return {
      valid: true,
      verified: false,
      reason: 'not_required'
    }
  }

  const actualPayloadHash = toSafeText(previewResult?.payloadHash)
  if (!actualPayloadHash) {
    return {
      valid: false,
      verified: false,
      errorCode: 'standard_preflight_hash_missing',
      message: '安装预检授权已失效：执行前预检未返回 payloadHash，请重新确认安装计划。',
      expectedPayloadHash: normalizedAuthorization.payloadHash,
      actualPayloadHash: ''
    }
  }

  const expectedSource = toSafeText(normalizedAuthorization.source).toLowerCase()
  const actualSource = toSafeText(previewResult?.standardSource || previewResult?.source).toLowerCase()
  if (expectedSource && actualSource && expectedSource !== actualSource) {
    return {
      valid: false,
      verified: false,
      errorCode: 'standard_preflight_source_mismatch',
      message: '安装预检授权已失效：安装来源与用户确认的预检来源不一致，请重新生成并确认安装计划。',
      expectedPayloadHash: normalizedAuthorization.payloadHash,
      actualPayloadHash,
      expectedSource,
      actualSource
    }
  }

  if (actualPayloadHash !== normalizedAuthorization.payloadHash) {
    return {
      valid: false,
      verified: false,
      errorCode: 'standard_preflight_hash_mismatch',
      message: '安装预检授权已失效：执行参数与用户确认的预检不一致，请重新生成并确认安装计划。',
      expectedPayloadHash: normalizedAuthorization.payloadHash,
      actualPayloadHash
    }
  }

  return {
    valid: true,
    verified: true,
    expectedPayloadHash: normalizedAuthorization.payloadHash,
    actualPayloadHash,
    source: actualSource || expectedSource
  }
}
