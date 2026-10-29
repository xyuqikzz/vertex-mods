import { resolvePreparedRepairAction } from '../repairAuthorization.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'

const AGENT_TASK_STAGE = Object.freeze({
  REPAIRING: 'repairing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed'
})
const SENSITIVE_KEY_PATTERN =
  /api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization$|auth.?header|credential|signature/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function redactRepairText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function sanitizeRepairOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeRepairOutput(item))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactRepairText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeRepairOutput(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
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

function normalizeIdList(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((id) => toSafeNumber(id))
    .filter((id) => id > 0)
}

function normalizeScope(value = {}) {
  return {
    gameId: toSafeNumber(value.gameId ?? value.game_id),
    source: toSafeText(value.source).toLowerCase(),
    endpointType: toSafeNumber(value.endpointType ?? value.endpoint_type, 0),
    deployDomain: redactRepairText(value.deployDomain ?? value.deploy_domain)
  }
}

function normalizeRepairAction(args = {}) {
  const action = toPlainJson(args.action || args.repairAction || args.executionPayload || args, {})
  const executionPayload = toPlainJson(action.executionPayload || action, {})
  const actionType = toSafeText(
    executionPayload.actionType || action.actionType || action.type
  )
  return {
    action,
    executionPayload,
    actionType
  }
}

async function getDeps(overrides = {}) {
  const deps = {
    ...overrides
  }
  if (
    typeof deps.createAgentTask !== 'function' ||
    typeof deps.updateAgentTask !== 'function' ||
    typeof deps.appendAgentTaskLog !== 'function' ||
    typeof deps.getAgentTask !== 'function'
  ) {
    const taskCenter = await import('../taskCenter.js')
    deps.createAgentTask = deps.createAgentTask || taskCenter.createAgentTask
    deps.updateAgentTask = deps.updateAgentTask || taskCenter.updateAgentTask
    deps.appendAgentTaskLog = deps.appendAgentTaskLog || taskCenter.appendAgentTaskLog
    deps.getAgentTask = deps.getAgentTask || taskCenter.getAgentTask
  }
  if (typeof deps.updateModPriorityOrders !== 'function') {
    const modDeployment = await import('../../../../db/mods/modDeployment.js')
    deps.updateModPriorityOrders = modDeployment.updateModPriorityOrders
  }
  if (typeof deps.reconcileDeploy !== 'function') {
    const deployReconciler = await import('../../../../ipc/game/deployReconcilerRuntime.js')
    deps.reconcileDeploy = deployReconciler.reconcileDeploy
  }
  if (typeof deps.getModFeatureFlags !== 'function') {
    const featureFlags = await import('../../../../ipc/game/featureFlags.js')
    deps.getModFeatureFlags = featureFlags.getModFeatureFlags
  }
  if (typeof deps.toggleModState !== 'function' || typeof deps.uninstallModById !== 'function') {
    const gameMethod = await import('../../../../ipc/game/method.js')
    deps.toggleModState = deps.toggleModState || gameMethod.toggleModState
    deps.uninstallModById = deps.uninstallModById || gameMethod.uninstallModById
  }
  return deps
}

function summarizeReconcileResults(results = []) {
  return (Array.isArray(results) ? results : []).map((result) => ({
    success: result?.success !== false,
    skipped: result?.skipped === true,
    transactionId: toSafeNumber(result?.transactionId),
    mode: toSafeText(result?.mode),
    message: redactRepairText(result?.message)
  }))
}

async function createRepairTask(normalized = {}, args = {}, ctx = {}, deps = {}) {
  const task = await deps.createAgentTask({
    sessionId: ctx?.sessionId || args.sessionId,
    type: 'conflict_repair',
    stage: AGENT_TASK_STAGE.REPAIRING,
    progress: 10,
    currentTarget: redactRepairText(
      normalized.action.targetRelativePath ||
      normalized.executionPayload.targetRelativePath ||
      normalized.action.title ||
      normalized.actionType
    ),
    cancelable: false,
    authorizationMode: ctx?.mode || args.authorizationMode,
    plan: {
      action: sanitizeRepairOutput(normalized.action) || {}
    }
  })
  await deps.appendAgentTaskLog(task.taskId, 'info', '开始执行冲突修复动作', {
    actionType: normalized.actionType
  })
  return task
}

async function completeRepairTask(taskId = '', result = {}, deps = {}) {
  const safeResult = sanitizeRepairOutput(result) || {}
  const completedTask = await deps.updateAgentTask(taskId, {
    stage: AGENT_TASK_STAGE.COMPLETED,
    progress: 100,
    linkedJobId: safeResult.linkedJobId,
    result: safeResult
  })
  await deps.appendAgentTaskLog(taskId, 'info', '冲突修复动作执行完成', safeResult)
  return completedTask || (await deps.getAgentTask(taskId))
}

async function failRepairTask(taskId = '', errorCode = '', message = '', detail = {}, deps = {}) {
  const safeMessage = redactRepairText(message, '冲突修复执行失败')
  const safeDetail = sanitizeRepairOutput(detail) || {}
  const failedTask = await deps.updateAgentTask(taskId, {
    stage: AGENT_TASK_STAGE.FAILED,
    progress: 100,
    errorCode,
    errorMessage: safeMessage,
    result: {
      success: false,
      errorCode,
      message: safeMessage,
      ...safeDetail
    }
  })
  await deps.appendAgentTaskLog(taskId, 'error', safeMessage, {
    errorCode,
    ...safeDetail
  })
  return failedTask || (await deps.getAgentTask(taskId))
}

async function executeReorderPriority(normalized = {}, task = {}, deps = {}) {
  const ids = normalizeIdList(normalized.executionPayload.ids || normalized.action.ids)
  if (!ids.length) {
    throw Object.assign(new Error('缺少需要保存的排序记录'), {
      errorCode: 'missing_priority_order_ids'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    stage: AGENT_TASK_STAGE.REPAIRING,
    progress: 35,
    currentTarget: '写入 priority_order'
  })

  const priorityResult = deps.updateModPriorityOrders(ids)
  if (!priorityResult?.success) {
    throw Object.assign(new Error(priorityResult?.message || '排序保存失败'), {
      errorCode: 'priority_order_failed'
    })
  }

  const flags = deps.getModFeatureFlags()
  const scopes =
    Array.isArray(priorityResult.scopes) && priorityResult.scopes.length
      ? priorityResult.scopes
      : [priorityResult.scope].filter(Boolean)
  let reconcileResults = [
    {
      success: true,
      skipped: true,
      message: '排序协调开关未开启'
    }
  ]

  if (flags?.enablePriorityReconcile !== false) {
    await deps.updateAgentTask(task.taskId, {
      progress: 70,
      currentTarget: '重建部署域'
    })
    reconcileResults = []
    for (const [index, scope] of scopes.entries()) {
      const reconcileTaskId = scopes.length > 1 ? `${task.taskId}:${index + 1}` : task.taskId
      reconcileResults.push(
        await deps.reconcileDeploy({
          taskId: reconcileTaskId,
          mode: 'domain_rebuild',
          scope,
          reason: normalized.executionPayload.reason || 'agent_conflict_repair_priority',
          agentTaskId: task.taskId
        })
      )
    }
  }

  const failedReconcile = reconcileResults.find((result) => result?.success === false)
  if (failedReconcile) {
    throw Object.assign(new Error(failedReconcile.message || '部署域重建失败'), {
      errorCode: 'domain_rebuild_failed',
      detail: {
        priorityResult,
        reconciles: summarizeReconcileResults(reconcileResults)
      }
    })
  }

  const linkedJobId = toSafeText(
    reconcileResults.find((result) => toSafeNumber(result?.transactionId) > 0)?.transactionId
  )
  return {
    success: true,
    actionType: 'reorder_priority',
    linkedJobId,
    priorityResult: {
      success: true,
      scope: priorityResult.scope,
      scopes: priorityResult.scopes,
      updatedCount: ids.length
    },
    reconciles: summarizeReconcileResults(reconcileResults),
    message: '冲突排序修复已执行。'
  }
}

async function executeDomainRebuild(normalized = {}, task = {}, deps = {}) {
  const scope = normalizeScope(normalized.executionPayload.scope || normalized.action.scope)
  if (!scope.gameId || !scope.source || !scope.deployDomain) {
    throw Object.assign(new Error('缺少部署域重建 scope'), {
      errorCode: 'missing_rebuild_scope'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    progress: 55,
    currentTarget: '重建部署域'
  })

  const reconcileResult = await deps.reconcileDeploy({
    taskId: task.taskId,
    mode: 'domain_rebuild',
    scope,
    reason: normalized.executionPayload.reason || 'agent_conflict_repair_rebuild',
    agentTaskId: task.taskId
  })
  if (reconcileResult?.success === false) {
    throw Object.assign(new Error(reconcileResult.message || '部署域重建失败'), {
      errorCode: 'domain_rebuild_failed',
      detail: {
        reconcile: reconcileResult
      }
    })
  }

  return {
    success: true,
    actionType: 'domain_rebuild',
    linkedJobId: toSafeText(reconcileResult?.transactionId),
    reconcile: {
      success: reconcileResult?.success !== false,
      skipped: reconcileResult?.skipped === true,
      transactionId: toSafeNumber(reconcileResult?.transactionId),
      mode: toSafeText(reconcileResult?.mode),
      message: redactRepairText(reconcileResult?.message)
    },
    message: redactRepairText(reconcileResult?.skipped ? reconcileResult.message : '部署域重建已执行。')
  }
}

async function executeDisableMod(normalized = {}, task = {}, deps = {}, ctx = {}) {
  const installedModId = toSafeNumber(
    normalized.executionPayload.installedModId ||
      normalized.executionPayload.modId ||
      normalized.action.installedModId ||
      normalized.action.modId
  )
  if (installedModId <= 0) {
    throw Object.assign(new Error('缺少需要禁用的模组 ID'), {
      errorCode: 'missing_disable_mod_id'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    progress: 45,
    currentTarget: '禁用冲突模组'
  })

  const mockEvent = ctx.event || null
  const result = await deps.toggleModState(mockEvent, {
    id: installedModId,
    isActive: false,
    agentTaskId: task.taskId
  })

  if (result?.success === false) {
    throw Object.assign(new Error(result.message || '禁用模组失败'), {
      errorCode: result.errorCode || 'disable_mod_failed',
      detail: {
        toggleResult: result
      }
    })
  }

  return {
    success: true,
    actionType: 'disable_mod',
    linkedJobId: toSafeText(result?.taskId),
    toggleResult: {
      success: result?.success !== false,
      taskId: toSafeText(result?.taskId),
      message: redactRepairText(result?.message),
      warning: result?.warning === true
    },
    message: redactRepairText(result?.message || '冲突模组已禁用。')
  }
}

async function executeInstallMissing(normalized = {}, task = {}, deps = {}, ctx = {}) {
  await deps.updateAgentTask(task.taskId, { progress: 45, currentTarget: '提交已预检的依赖安装计划' })
  const invoke = deps.invokeAgentTool || (await import('../toolRegistryRuntime.js')).invokeAgentTool
  const result = await invoke('vertex.install.execute_plan', { agentTaskId: normalized.executionPayload.agentTaskId }, {
    ...ctx, confirmedOperationScope: normalized.executionPayload.operationScope, userConfirmed: true
  })
  return { ...result, actionType: 'install_missing', linkedJobId: result.jobId || '',
    installTaskResult: { success: result.success, jobId: result.jobId, agentTaskId: result.agentTaskId, message: result.message } }
}

async function executeUninstallMod(normalized = {}, task = {}, deps = {}, ctx = {}) {
  const installedModId = toSafeNumber(
    normalized.executionPayload.installedModId ||
      normalized.executionPayload.modId ||
      normalized.executionPayload.id ||
      normalized.action.installedModId ||
      normalized.action.modId ||
      normalized.action.id
  )
  if (installedModId <= 0) {
    throw Object.assign(new Error('缺少需要卸载的模组 ID'), {
      errorCode: 'missing_uninstall_mod_id'
    })
  }

  await deps.updateAgentTask(task.taskId, {
    progress: 45,
    currentTarget: '卸载冲突模组'
  })

  const mockEvent = ctx.event || null
  const result = await deps.uninstallModById(mockEvent, {
    id: installedModId,
    force: normalized.executionPayload.force === true,
    agentTaskId: task.taskId
  })

  if (result?.success === false) {
    throw Object.assign(new Error(result.message || '卸载模组失败'), {
      errorCode: result.errorCode || 'uninstall_mod_failed',
      detail: {
        uninstallResult: result
      }
    })
  }

  return {
    success: true,
    actionType: 'uninstall_mod',
    linkedJobId: toSafeText(result?.taskId),
    uninstallResult: {
      success: result?.success !== false,
      taskId: toSafeText(result?.taskId),
      id: toSafeNumber(result?.id || installedModId),
      optionId: toSafeNumber(result?.optionId),
      endpointType: toSafeNumber(result?.endpointType, -1),
      name: redactRepairText(result?.name),
      warning: result?.warning === true,
      needRecovery: result?.needRecovery === true,
      recoveryTotal: toSafeNumber(result?.recoveryTotal),
      recoverySuccess: toSafeNumber(result?.recoverySuccess),
      recoveryFailed: toSafeNumber(result?.recoveryFailed),
      message: redactRepairText(result?.message)
    },
    message: redactRepairText(result?.message || '冲突模组已卸载。')
  }
}

export async function executeConflictRepairAction(args = {}, ctx = {}, dependencyOverrides = {}) {
  assertToolExecutionActive(ctx?.signal)
  const deps = await getDeps(dependencyOverrides)
  const normalized = normalizeRepairAction(args)
  if (!normalized.actionType) {
    return {
      success: false,
      errorCode: 'missing_action_type',
      message: '缺少冲突修复动作类型。'
    }
  }

  const task = await createRepairTask(normalized, args, ctx, deps)

  try {
    assertToolExecutionActive(ctx?.signal)
    let result
    if (normalized.actionType === 'reorder_priority') {
      result = await executeReorderPriority(normalized, task, deps)
    } else if (normalized.actionType === 'domain_rebuild') {
      result = await executeDomainRebuild(normalized, task, deps)
    } else if (normalized.actionType === 'disable_mod') {
      result = await executeDisableMod(normalized, task, deps, ctx)
    } else if (normalized.actionType === 'install_missing') {
      result = await executeInstallMissing(normalized, task, deps, ctx)
    } else if (normalized.actionType === 'uninstall_mod') {
      result = await executeUninstallMod(normalized, task, deps, ctx)
    } else {
      throw Object.assign(new Error(`暂不支持的冲突修复动作：${normalized.actionType}`), {
        errorCode: 'unsupported_repair_action'
      })
    }

    await deps.updateAgentTask(task.taskId, {
      stage: AGENT_TASK_STAGE.VERIFYING,
      progress: 90,
      currentTarget: '确认修复结果'
    })
    const safeResult = sanitizeRepairOutput(result) || {}
    const completedTask = await completeRepairTask(task.taskId, safeResult, deps)
    return {
      ...safeResult,
      taskId: task.taskId,
      task: completedTask
    }
  } catch (error) {
    const errorCode = toSafeText(error?.errorCode, 'conflict_repair_failed')
    const message = redactRepairText(error?.message, '冲突修复执行失败')
    const detail = sanitizeRepairOutput(error?.detail || {}) || {}
    const failedTask = await failRepairTask(task.taskId, errorCode, message, detail, deps)
    return {
      success: false,
      taskId: task.taskId,
      task: failedTask,
      errorCode,
      message,
      ...detail
    }
  }
}

export async function executeConflictRepairTool(args = {}, ctx = {}) {
  const prepared = await resolvePreparedRepairAction(args, ctx, { consume: true })
  if (prepared.error) return prepared.error
  return await executeConflictRepairAction(prepared.args, ctx)
}
