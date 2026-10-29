import { AsyncLocalStorage } from 'node:async_hooks'

const activeScopeLocks = new Map()
const waitingLocks = []
const operationContext = new AsyncLocalStorage()

export function withDeploymentOperationContext(context, callback) {
  return operationContext.run(context, callback)
}

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function normalizeDeploymentScopeForLock(scope = {}) {
  return {
    gameId: toSafeNumber(scope.gameId ?? scope.game_id),
    source: toSafeText(scope.source).toLowerCase(),
    endpointType: toSafeNumber(scope.endpointType ?? scope.endpoint_type, 0),
    deployDomain: toSafeText(scope.deployDomain ?? scope.deploy_domain)
  }
}

export function getDeploymentScopeMutationKey(scope = {}) {
  const normalized = normalizeDeploymentScopeForLock(scope)
  if (!normalized.gameId || !normalized.deployDomain) return ''
  return [
    normalized.gameId,
    normalized.endpointType,
    normalized.deployDomain
  ].join(':')
}

function normalizeScopeList(scopes = []) {
  const result = []
  const seen = new Set()
  for (const scope of Array.isArray(scopes) ? scopes : [scopes]) {
    const normalized = normalizeDeploymentScopeForLock(scope)
    const key = getDeploymentScopeMutationKey(normalized)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({ key, scope: normalized })
  }
  return result.sort((left, right) => left.key.localeCompare(right.key))
}

export function inspectDeploymentScopeMutationLocks(scopes = [], token = null) {
  const requested = normalizeScopeList(scopes)
  const conflicts = requested
    .map((item) => ({ ...item, lock: activeScopeLocks.get(item.key) }))
    .filter((item) => item.lock && item.lock.token !== token)
    .map((item) => ({
      key: item.key,
      scope: item.scope,
      ownerId: item.lock.ownerId,
      operation: item.lock.operation,
      acquiredAt: item.lock.acquiredAt
    }))
  return {
    available: conflicts.length === 0,
    scopes: requested.map((item) => item.scope),
    scopeKeys: requested.map((item) => item.key),
    conflicts
  }
}

export async function withDeploymentScopeMutationLocks(scopes = [], callback, options = {}) {
  const inheritedOptions = operationContext.getStore() || {}
  options = { ...options,
    signal: options.signal === null ? null : options.signal || inheritedOptions.signal,
    onWait: options.onWait || inheritedOptions.onWait,
    onAcquire: options.onAcquire || inheritedOptions.onAcquire
  }
  if (typeof callback !== 'function') {
    throw new TypeError('withDeploymentScopeMutationLocks 需要 callback')
  }

  const requested = normalizeScopeList(scopes)
  if (!requested.length) {
    const error = new Error('部署 scope 不完整，无法获取写锁')
    error.code = options.errorCode || 'rollback_scope_incomplete'
    error.stage = 'planned'
    throw error
  }

  const inheritedToken = options.token || null
  if (
    inheritedToken &&
    requested.every((item) => activeScopeLocks.get(item.key)?.token === inheritedToken)
  ) {
    return await callback(inheritedToken)
  }

  // 持锁回调只允许重入已经持有的完整范围，禁止等待扩锁形成死锁。
  if (inheritedToken && [...activeScopeLocks.values()].some((lock) => lock.token === inheritedToken)) {
    throw Object.assign(new Error('部署写锁不能在持锁期间扩展范围'), {
      code: 'deployment_scope_reentry_mismatch', stage: 'scope_lock'
    })
  }

  const token = Symbol(toSafeText(options.ownerId, 'deployment-scope-mutation'))
  const lock = {
    token,
    ownerId: toSafeText(options.ownerId, 'deployment-scope-mutation'),
    operation: toSafeText(options.operation, 'deploy'),
    acquiredAt: new Date().toISOString()
  }
  const keys = requested.map((item) => item.key)
  const overlaps = (other) => other.keys.some((key) => keys.includes(key))
  const inspection = inspectDeploymentScopeMutationLocks(scopes)
  const queuedAhead = waitingLocks.some(overlaps)
  if (options.signal?.aborted) throw options.signal.reason || new Error('部署等待已取消')
  if ((!inspection.available || queuedAhead) && options.wait === false) {
    throw Object.assign(new Error('同一部署域存在正在执行的安装、部署或回滚写入'), {
      code: options.errorCode || 'deployment_scope_busy', stage: 'scope_lock', conflicts: inspection.conflicts
    })
  }
  await new Promise((resolve, reject) => {
    let timer
    const waiter = { keys, lock, grant: () => { cleanup(); resolve() } }
    const cleanup = () => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
    const fail = (error) => {
      const index = waitingLocks.indexOf(waiter)
      if (index < 0) return
      waitingLocks.splice(index, 1)
      cleanup()
      reject(error)
      drainWaitingLocks()
    }
    const abort = () => fail(options.signal.reason || new Error('部署等待已取消'))
    waitingLocks.push(waiter)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (!inspection.available || queuedAhead) {
      const timeoutMs = Math.max(1, Number(options.timeoutMs) || 120000)
      timer = setTimeout(() => fail(Object.assign(new Error('等待其他部署任务完成超时，请稍后重试'), {
        code: 'deployment_scope_timeout', stage: 'scope_lock', conflicts: inspection.conflicts
      })), timeoutMs)
      try { options.onWait?.(inspection) } catch (error) { fail(error) }
    }
    drainWaitingLocks()
  })

  try {
    if (options.signal?.aborted) throw options.signal.reason || new Error('部署等待已取消')
    options.onAcquire?.()
    return await callback(token)
  } finally {
    for (const item of requested) {
      if (activeScopeLocks.get(item.key)?.token === token) {
        activeScopeLocks.delete(item.key)
      }
    }
    drainWaitingLocks()
  }
}

function drainWaitingLocks() {
  const blockedKeys = new Set()
  for (const waiter of [...waitingLocks]) {
    if (waiter.keys.some((key) => activeScopeLocks.has(key) || blockedKeys.has(key))) {
      waiter.keys.forEach((key) => blockedKeys.add(key))
      continue
    }
    waitingLocks.splice(waitingLocks.indexOf(waiter), 1)
    for (const key of waiter.keys) activeScopeLocks.set(key, waiter.lock)
    waiter.grant()
  }
}

export function resetDeploymentScopeMutationLocksForTests() {
  if (waitingLocks.length) throw new Error('存在等待部署的任务，不能重置写锁')
  activeScopeLocks.clear()
}
