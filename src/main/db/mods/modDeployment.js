import dbInstance from '../dbInstance.js'
import { formatChinaTime } from '../../utils/dateTime.js'

export const MOD_LIST_ORDER_SQL = 'priority_order ASC, id ASC'
export const MOD_DEPLOY_ORDER_SQL = 'priority_order ASC, id ASC'
export const THUNDERSTORE_SOURCE = 'thunderstore'

function toSafeText(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function toSafeNumber(value, defaultValue = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : defaultValue
}

function parseJsonObject(value = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  const text = toSafeText(value)
  if (!text) {
    return {}
  }

  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringifyJson(value, fallback = '[]') {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

export function normalizeModSource(value = '') {
  return toSafeText(value).toLowerCase()
}

export function isThunderstoreSource(source = '') {
  return normalizeModSource(source) === THUNDERSTORE_SOURCE
}

export function isUnifiedDeploySource(source = '') {
  return !!normalizeModSource(source) && !isThunderstoreSource(source)
}

export function resolveModDeployDomain(data = {}) {
  const metadata = parseJsonObject(data.metadata_json || data.metadata || {})
  const explicitDomain = toSafeText(
    data.deploy_domain ??
      data.deployDomain ??
      metadata.deploy_domain ??
      metadata.deployDomain ??
      metadata.sourceGameDomain
  )
  if (explicitDomain) {
    return explicitDomain.toLowerCase()
  }

  const source = normalizeModSource(data.source || data?.sourceMeta?.source || 'server')
  if (source === 'nexus') {
    return toSafeText(
      data.sourceSlug || data?.sourceMeta?.sourceSlug || metadata.sourceGameDomain || 'nexus'
    ).toLowerCase()
  }

  if (source === 'ficsit') {
    return 'ficsit'
  }

  if (source === THUNDERSTORE_SOURCE) {
    const profile = toSafeText(data.profile_name || data.profileName || 'default').toLowerCase()
    return profile ? `thunderstore:${profile}` : THUNDERSTORE_SOURCE
  }

  return toSafeNumber(data.endpoint_type ?? data.endpointType, 0) === 1 ? 'server' : 'client'
}

export function normalizeCompatFlags(value = []) {
  if (Array.isArray(value)) {
    return value.map((item) => toSafeText(item)).filter(Boolean)
  }

  const parsed = parseJsonObject(value)
  if (Array.isArray(parsed)) {
    return parsed.map((item) => toSafeText(item)).filter(Boolean)
  }

  const text = toSafeText(value)
  return text ? [text] : []
}

export function resolveInitialModPriorityOrder(prepared = {}, sourceData = {}) {
  const targetSourceData = sourceData && typeof sourceData === 'object' ? sourceData : {}
  const hasExplicitPriority =
    Object.prototype.hasOwnProperty.call(targetSourceData, 'priority_order') ||
    Object.prototype.hasOwnProperty.call(targetSourceData, 'priorityOrder')
  const explicit = toSafeNumber(
    targetSourceData.priority_order ?? targetSourceData.priorityOrder,
    0
  )
  if (hasExplicitPriority && explicit >= 0) {
    return explicit
  }

  if (!isUnifiedDeploySource(prepared.source)) {
    return explicit
  }

  const existing = dbInstance.get(
    `SELECT priority_order
     FROM mods
     WHERE game_id = ?
       AND source_mod_key = ?
       AND endpoint_type = ?
       AND profile_name = ?
     LIMIT 1`,
    [
      toSafeNumber(prepared.game_id, 0),
      toSafeText(prepared.source_mod_key),
      toSafeNumber(prepared.endpoint_type, 0),
      toSafeText(prepared.profile_name)
    ]
  )
  const existingOrder = toSafeNumber(existing?.priority_order, 0)
  if (existing) {
    return existingOrder
  }

  const row = dbInstance.get(
    `SELECT MAX(priority_order) AS max_priority_order
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND deploy_domain = ?
       AND lower(source) <> ?`,
    [
      toSafeNumber(prepared.game_id, 0),
      toSafeNumber(prepared.endpoint_type, 0),
      toSafeText(prepared.deploy_domain),
      THUNDERSTORE_SOURCE
    ]
  )

  const maxPriorityOrder =
    row?.max_priority_order === null || row?.max_priority_order === undefined
      ? -1
      : toSafeNumber(row?.max_priority_order, -1)
  return maxPriorityOrder + 1
}

export function getModDeployScopeById(id) {
  const row = dbInstance.get(
    `SELECT id, game_id, source, endpoint_type, deploy_domain
     FROM mods
     WHERE id = ?
     LIMIT 1`,
    [toSafeNumber(id, 0)]
  )

  if (!row || !isUnifiedDeploySource(row.source)) {
    return null
  }

  return {
    gameId: toSafeNumber(row.game_id, 0),
    source: normalizeModSource(row.source),
    endpointType: toSafeNumber(row.endpoint_type, 0),
    deployDomain: toSafeText(row.deploy_domain) || resolveModDeployDomain(row)
  }
}

export function listModRecordsByDeployScope(scope = {}, options = {}) {
  const gameId = toSafeNumber(scope.gameId ?? scope.game_id, 0)
  const endpointType = toSafeNumber(scope.endpointType ?? scope.endpoint_type, 0)
  const deployDomain = toSafeText(scope.deployDomain ?? scope.deploy_domain)
  const activeOnly = options.activeOnly === true
  const orderSql = options.order === 'deploy' ? MOD_DEPLOY_ORDER_SQL : MOD_LIST_ORDER_SQL

  if (!gameId || !deployDomain) {
    return []
  }

  return dbInstance.all(
    `SELECT *
     FROM mods
     WHERE game_id = ?
       AND endpoint_type = ?
       AND deploy_domain = ?
       AND lower(source) <> ?
       ${activeOnly ? 'AND is_active = 1' : ''}
     ORDER BY ${orderSql}`,
    [gameId, endpointType, deployDomain, THUNDERSTORE_SOURCE]
  )
}

export function updateModPriorityOrders(orderList = []) {
  const ids = (Array.isArray(orderList) ? orderList : [])
    .map((item) => toSafeNumber(typeof item === 'object' ? item.id : item, 0))
    .filter((id) => id > 0)
  const uniqueIds = [...new Set(ids)]

  if (!uniqueIds.length) {
    return {
      success: false,
      message: '缺少需要保存的排序记录'
    }
  }

  const placeholders = uniqueIds.map(() => '?').join(',')
  const rows = dbInstance.all(
    `SELECT id, game_id, source, endpoint_type, deploy_domain, priority_order
     FROM mods
     WHERE id IN (${placeholders})
     ORDER BY ${MOD_LIST_ORDER_SQL}`,
    uniqueIds
  )

  if (rows.length !== uniqueIds.length) {
    return {
      success: false,
      message: '部分模组记录不存在，无法保存排序'
    }
  }

  const sourceSet = new Set(rows.map((row) => normalizeModSource(row.source)))
  if ([...sourceSet].some((source) => !isUnifiedDeploySource(source))) {
    return {
      success: false,
      message: 'Thunderstore 来源不进入统一排序保存'
    }
  }

  const normalizedScopeList = rows.map((row) => ({
    gameId: toSafeNumber(row.game_id, 0),
    source: normalizeModSource(row.source),
    endpointType: toSafeNumber(row.endpoint_type, 0),
    deployDomain: toSafeText(row.deploy_domain) || resolveModDeployDomain(row)
  }))
  const sortScopeKeySet = new Set(
    normalizedScopeList.map(
      (scope) => `${scope.gameId}:${scope.source}:${scope.endpointType}`
    )
  )

  if (sortScopeKeySet.size !== 1) {
    return {
      success: false,
      message: '排序保存必须限定在同一来源、同一终端类型内'
    }
  }

  const orderedIdSet = new Set(uniqueIds)
  const orderedRows = ids
    .map((id) => rows.find((row) => toSafeNumber(row.id, 0) === id))
    .filter(Boolean)
    .filter((row, index, list) => list.findIndex((item) => item.id === row.id) === index)
  const missingRows = rows.filter((row) => !orderedIdSet.has(toSafeNumber(row.id, 0)))
  const finalRows = [...orderedRows, ...missingRows]

  dbInstance.transaction(() => {
    finalRows.forEach((row, index) => {
      dbInstance.run(
        `UPDATE mods
         SET priority_order = ?
         WHERE id = ?`,
        [index, toSafeNumber(row.id, 0)]
      )
    })
  })

  const scopeMap = new Map()
  normalizedScopeList.forEach((scope) => {
    const key = `${scope.gameId}:${scope.source}:${scope.endpointType}:${scope.deployDomain}`
    if (!scopeMap.has(key)) {
      scopeMap.set(key, scope)
    }
  })
  const scopes = Array.from(scopeMap.values())
  const scope = scopes[0]
  return {
    success: true,
    message: '排序已保存',
    scope,
    scopes,
    records: listModRecordsByDeployScope(scope),
    recordsByScope: scopes.map((item) => ({
      scope: item,
      records: listModRecordsByDeployScope(item)
    }))
  }
}

export function createModDeployTransaction(payload = {}) {
  const now = formatChinaTime()
  const result = dbInstance.run(
    `INSERT INTO mod_deploy_transactions (
       task_id, agent_task_id, task_type, status, reconcile_type, game_id, source, endpoint_type,
       deploy_domain, mod_id, payload_json, started_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      toSafeText(payload.taskId),
      toSafeText(payload.agentTaskId || payload.agent_task_id || payload.payload?.agentTaskId),
      toSafeText(payload.taskType || payload.type || 'reconcile'),
      toSafeText(payload.status || 'running'),
      toSafeText(payload.reconcileType || payload.mode || 'incremental'),
      toSafeNumber(payload.gameId ?? payload.game_id, 0),
      normalizeModSource(payload.source || ''),
      toSafeNumber(payload.endpointType ?? payload.endpoint_type, 0),
      toSafeText(payload.deployDomain ?? payload.deploy_domain),
      toSafeNumber(payload.modId ?? payload.mod_id, 0),
      stringifyJson(payload.payload || {}, '{}'),
      now,
      now
    ]
  )
  return toSafeNumber(result?.lastInsertRowid, 0)
}

export function updateModDeployTransaction(id, payload = {}) {
  const now = formatChinaTime()
  dbInstance.run(
    `UPDATE mod_deploy_transactions
     SET status = ?,
         error_code = ?,
         error_message = ?,
         result_json = ?,
         finished_at = ?,
         updated_at = ?
     WHERE id = ?`,
    [
      toSafeText(payload.status || 'completed'),
      toSafeText(payload.errorCode || payload.error_code),
      toSafeText(payload.errorMessage || payload.error_message),
      stringifyJson(payload.result || {}, '{}'),
      payload.finished === false ? '' : now,
      now,
      toSafeNumber(id, 0)
    ]
  )
}

export function markDeployScopeReconciled(scope = {}) {
  const now = formatChinaTime()
  return dbInstance.run(
    `UPDATE mods
     SET last_reconcile_at = ?
     WHERE game_id = ?
       AND endpoint_type = ?
       AND deploy_domain = ?
       AND lower(source) <> ?`,
    [
      now,
      toSafeNumber(scope.gameId ?? scope.game_id, 0),
      toSafeNumber(scope.endpointType ?? scope.endpoint_type, 0),
      toSafeText(scope.deployDomain ?? scope.deploy_domain),
      THUNDERSTORE_SOURCE
    ]
  )
}
