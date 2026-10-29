import {
  executeDeploymentRollback,
  planDeploymentRollback
} from '../../../../ipc/game/deploymentRollbackCoordinator.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'

const SENSITIVE_KEY_PATTERN =
  /api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization$|auth.?header|credential|signature/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session.?token|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    if (typeof value === 'string') {
      const text = value.trim()
      return text ? JSON.parse(text) : fallback
    }
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function redactRollbackText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function sanitizeRollbackOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) return undefined
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeRollbackOutput(item))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactRollbackText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeRollbackOutput(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') result[entryKey] = sanitized
  }
  return result
}

function normalizeRollbackAction(args = {}) {
  const action = toPlainJson(
    args.action || args.rollbackAction || args.executionPayload || args,
    {}
  )
  const executionPayload = toPlainJson(action.executionPayload || action, {})
  return {
    action,
    executionPayload,
    actionType: toSafeText(executionPayload.actionType || action.actionType || action.type)
  }
}

function createRollbackPlanArgsFromAction(normalized = {}) {
  return {
    taskId: toSafeText(normalized.executionPayload.taskId || normalized.action.taskId),
    jobId: toSafeText(normalized.executionPayload.jobId || normalized.action.jobId),
    modId:
      normalized.executionPayload.modId ||
      normalized.executionPayload.installedModId ||
      normalized.action.modId ||
      normalized.action.installedModId,
    transactionIds:
      normalized.executionPayload.transactionIds ||
      normalized.action.transactionIds ||
      normalized.executionPayload.transactionId ||
      normalized.action.transactionId,
    backupEntryIds:
      normalized.executionPayload.backupEntryIds ||
      normalized.action.backupEntryIds ||
      normalized.executionPayload.backupEntryId ||
      normalized.action.backupEntryId,
    cleanupPolicy: toSafeText(
      normalized.executionPayload.cleanupPolicy || normalized.action.cleanupPolicy,
      'disable'
    ),
    scope: normalized.executionPayload.scope || normalized.action.scope || {}
  }
}

async function getTaskDependencies(overrides = {}) {
  const deps = { ...overrides }
  if (
    typeof deps.createAgentTask !== 'function' ||
    typeof deps.updateAgentTask !== 'function' ||
    typeof deps.appendAgentTaskLog !== 'function'
  ) {
    const taskCenter = await import('../taskCenter.js')
    deps.createAgentTask = deps.createAgentTask || taskCenter.createAgentTask
    deps.updateAgentTask = deps.updateAgentTask || taskCenter.updateAgentTask
    deps.appendAgentTaskLog = deps.appendAgentTaskLog || taskCenter.appendAgentTaskLog
  }
  return deps
}

async function createRollbackTask(normalized = {}, args = {}, ctx = {}, deps = {}) {
  const task = await deps.createAgentTask({
    sessionId: ctx?.sessionId || args.sessionId,
    type: 'rollback',
    stage: 'rollbacking',
    progress: 10,
    currentTarget: redactRollbackText(
      normalized.action.title ||
        normalized.executionPayload.jobId ||
        normalized.executionPayload.taskId ||
        '回滚任务'
    ),
    cancelable: true,
    authorizationMode: ctx?.mode || args.authorizationMode,
    plan: {
      action: sanitizeRollbackOutput(normalized.action) || {}
    }
  })
  await deps.appendAgentTaskLog(task.taskId, 'info', '开始执行回滚动作', {
    actionType: normalized.actionType
  })
  return task
}

async function completeRollbackTask(taskId = '', result = {}, deps = {}) {
  const safeResult = sanitizeRollbackOutput(result) || {}
  const completedTask = await deps.updateAgentTask(taskId, {
    stage: 'completed',
    progress: 100,
    currentTarget: '回滚完成',
    result: safeResult
  })
  await deps.appendAgentTaskLog(taskId, 'info', '回滚动作执行完成', safeResult)
  return completedTask
}

async function failRollbackTask(taskId = '', error = null, deps = {}, detail = {}) {
  const message = redactRollbackText(error?.message || error, '回滚执行失败')
  const safeDetail = sanitizeRollbackOutput(detail) || {}
  const failedTask = await deps.updateAgentTask(taskId, {
    stage: 'failed',
    progress: 100,
    errorCode: toSafeText(error?.code || 'rollback_failed'),
    errorMessage: message,
    currentTarget: safeDetail.repairRequired === true ? '需要修复' : '回滚失败',
    result: safeDetail
  })
  await deps.appendAgentTaskLog(taskId, 'error', message, {
    errorCode: toSafeText(error?.code || 'rollback_failed'),
    ...safeDetail
  })
  return failedTask
}

export async function createRollbackPlan(args = {}, dependencyOverrides = {}, options = {}) {
  const result = await planDeploymentRollback(args, dependencyOverrides)
  return options.sanitizeOutput === false ? result : sanitizeRollbackOutput(result)
}

export async function executeRollbackAction(args = {}, ctx = {}, dependencyOverrides = {}) {
  assertToolExecutionActive(ctx?.signal)
  const normalized = normalizeRollbackAction(args)
  if (normalized.actionType !== 'rollback_task') {
    return {
      success: false,
      errorCode: 'unsupported_rollback_action',
      message: `暂不支持的回滚动作：${normalized.actionType || 'unknown'}`
    }
  }

  const plan = await createRollbackPlan(
    createRollbackPlanArgsFromAction(normalized),
    dependencyOverrides,
    { sanitizeOutput: false }
  )
  if (!plan.success || !plan.rollbackAvailable) {
    return sanitizeRollbackOutput({
      success: false,
      errorCode: plan.errorCode || 'rollback_not_available',
      message: plan.message || '当前回滚计划不可执行',
      plan
    })
  }

  const deps = await getTaskDependencies(dependencyOverrides)
  const task = await createRollbackTask(normalized, args, ctx, deps)
  try {
    const result = await executeDeploymentRollback(plan, {
      ...dependencyOverrides,
      rollbackTaskId: task.taskId,
      event: ctx?.event,
      uninstallAuthorized:
        ctx?.permission?.allowed === true || ctx?.userConfirmed === true || ctx?.confirmed === true,
      assertActive: () => assertToolExecutionActive(ctx?.signal),
      updateProgress: async (patch = {}) => {
        await deps.updateAgentTask(task.taskId, patch)
      }
    })
    const safeResult =
      sanitizeRollbackOutput({
        ...result,
        taskId: task.taskId
      }) || {}
    if (result?.success !== true) {
      const error = new Error(result?.message || '回滚执行失败')
      error.code = result?.errorCode || 'rollback_failed'
      error.detail = safeResult
      throw error
    }

    await completeRollbackTask(task.taskId, safeResult, deps)
    return safeResult
  } catch (error) {
    const detail = sanitizeRollbackOutput(error?.detail || {}) || {}
    await failRollbackTask(task.taskId, error, deps, detail)
    return sanitizeRollbackOutput({
      success: false,
      errorCode: toSafeText(error?.code || 'rollback_failed'),
      message: redactRollbackText(error?.message || error, '回滚执行失败'),
      taskId: task.taskId,
      ...detail
    })
  }
}

export async function createRollbackPlanTool(args = {}, ctx = {}) {
  void ctx
  return await createRollbackPlan(args)
}

export async function executeRollbackTool(args = {}, ctx = {}) {
  return await executeRollbackAction(args, ctx)
}
