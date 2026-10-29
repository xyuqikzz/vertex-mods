export const DEFAULT_AGENT_PERMISSION_GRANT_TTL_MS = 24 * 60 * 60 * 1000

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function isPlainObject(value = null) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function findNestedText(value, keys = new Set(), depth = 0) {
  if (!value || depth > 8) return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedText(item, keys, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (!isPlainObject(value)) return ''
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key)) {
      const text = toSafeText(entry)
      if (text) return text
    }
  }
  for (const entry of Object.values(value)) {
    const found = findNestedText(entry, keys, depth + 1)
    if (found) return found
  }
  return ''
}

function resolveToolName(input = {}) {
  return toSafeText(
    input.toolName ||
      input.descriptor?.name ||
      input.confirmation?.toolName ||
      input.grantContext?.toolName
  )
}

function resolveArgs(input = {}) {
  if (isPlainObject(input.args)) return toPlainJson(input.args, {})
  if (isPlainObject(input.confirmation?.args)) return toPlainJson(input.confirmation.args, {})
  return {}
}

function resolveActionType(args = {}) {
  const action = isPlainObject(args.action)
    ? args.action
    : isPlainObject(args.repairAction)
      ? args.repairAction
      : {}
  const executionPayload = isPlainObject(action.executionPayload)
    ? action.executionPayload
    : isPlainObject(args.executionPayload)
      ? args.executionPayload
      : {}
  return toSafeText(
    action.actionType ||
      action.action_type ||
      action.type ||
      executionPayload.actionType ||
      executionPayload.action_type ||
      executionPayload.type
  )
}

export function normalizeAgentPermissionGrantContext(context = {}) {
  const toolName = toSafeText(context.toolName)
  const actionType = toSafeText(context.actionType)
  const operationType = toSafeText(
    context.operationType || (actionType ? `${toolName}:${actionType}` : toolName)
  )

  return {
    toolName,
    actionType,
    operationType,
    gameId: toSafeText(context.gameId || context.game_id || '*', '*'),
    source: toSafeText(context.source || '*', '*').toLowerCase()
  }
}

export function resolveAgentPermissionGrantContext(input = {}) {
  const explicitContext = isPlainObject(input.grantContext)
    ? input.grantContext
    : isPlainObject(input.confirmation?.grantContext)
      ? input.confirmation.grantContext
      : {}
  const args = resolveArgs(input)
  const toolName = resolveToolName(input)
  const actionType = toSafeText(explicitContext.actionType || resolveActionType(args))
  const gameId =
    toSafeText(explicitContext.gameId || explicitContext.game_id) ||
    findNestedText(args, new Set(['gameId', 'game_id', 'gameKey', 'game_key', 'appId', 'appid']))
  const source =
    toSafeText(explicitContext.source) ||
    findNestedText(args, new Set(['source', 'sourceType', 'source_type', 'sourcePlatform']))

  return normalizeAgentPermissionGrantContext({
    toolName,
    actionType,
    operationType: explicitContext.operationType,
    gameId,
    source
  })
}

export function isAgentPermissionGrantActive(grant = {}, now = new Date()) {
  if (!isPlainObject(grant)) return false
  if (toSafeText(grant.revokedAt || grant.revoked_at)) return false
  const expiresAt = toSafeText(grant.expiresAt || grant.expires_at)
  if (!expiresAt) return false
  const expiresTime = new Date(expiresAt).getTime()
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(expiresTime) || !Number.isFinite(nowTime)) return false
  return expiresTime > nowTime
}
