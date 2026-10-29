import { assertNoRetiredSource } from '../../../../../shared/sources/retired-source-policy.js'
import {
  attachStandardPreflightAuthorizationToPayload,
  createStandardPreflightAuthorization,
  getStandardPreflightAuthorization,
  verifyStandardPreflightAuthorization
} from '../../../../../shared/ai/permissions/ai-agent-install-authorization.js'
import { createPayloadHash, buildLegacySourceHashRequest } from '../../../../ipc/game/standard/payloadValidator.js'
import { createStandardPreflightRequest } from './installPreflightRequest.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session|credential/i
const PRIVATE_URL_KEY_PATTERN =
  /(^|_)(url|uri|download.?url|request.?url|latest.?url|source.?url)$/i
const PRIVATE_PATH_KEY_PATTERN =
  /(^|_)(path|paths|file.?path|folder.?path|target.?path|backup.?path|game.?root|root.?path|staging.?path|install.?root)$/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function redactInstallExecutionText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function hasConfiguredInstallExecutionValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(toSafeText(value))
}

function isSensitiveInstallExecutionKey(key = '') {
  const text = toSafeText(key)
  if (/standard.?preflight.?authorization/i.test(text)) {
    return false
  }
  return SENSITIVE_KEY_PATTERN.test(text)
}

function sanitizeInstallExecutionOutput(value, key = '') {
  if (isSensitiveInstallExecutionKey(key)) {
    return '[redacted]'
  }
  if (PRIVATE_URL_KEY_PATTERN.test(key)) {
    return hasConfiguredInstallExecutionValue(value) ? '[url]' : ''
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    return hasConfiguredInstallExecutionValue(value) ? '[path]' : ''
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInstallExecutionOutput(item))
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactInstallExecutionText(value) : value
  }

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeInstallExecutionOutput(entryValue, entryKey)
  }
  return result
}

function pickPlainObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return toPlainJson(value, {})
    }
  }
  return {}
}

function hasSubmittableSourceInstallTaskPayload(payload = {}) {
  return Array.isArray(payload?.items) && payload.items.length > 0
}

function containsRedactedInstallExecutionPlaceholder(value) {
  try {
    return /\[(?:url|path|redacted)\]/i.test(JSON.stringify(value ?? {}))
  } catch {
    return false
  }
}

function resolveAgentTaskIdFromExecutionArgs(args = {}, plan = {}, payload = {}) {
  return toSafeText(
    args.agentTaskId ||
      args.taskId ||
      plan.agentTaskId ||
      plan.taskId ||
      payload.agentTaskId ||
      payload.agent_task_id
  )
}

async function resolveInstallExecutionArgs(args = {}, dependencyOverrides = {}, ctx = {}) {
  const explicitPlan = pickPlainObject(args.installPlan, args.plan)
  const explicitPayload = pickPlainObject(
    args.sourceInstallTaskPayload,
    explicitPlan.sourceInstallTaskPayload
  )
  const agentTaskId = resolveAgentTaskIdFromExecutionArgs(args, explicitPlan, explicitPayload)
  const needsStoredPlan =
    Boolean(agentTaskId) &&
    (!hasSubmittableSourceInstallTaskPayload(explicitPayload) ||
      containsRedactedInstallExecutionPlaceholder(explicitPayload))

  if (!needsStoredPlan) {
    return args
  }

  let getTask = dependencyOverrides.getAgentTask
  if (typeof getTask !== 'function') {
    const taskCenter = await import('../taskCenter.js')
    getTask = taskCenter.getAgentTask
  }

  const task = await getTask(agentTaskId)
  if (task?.sessionId && task.sessionId !== ctx.sessionId) {
    return { ...args, __rawPlanLookupError: { errorCode: 'install_plan_session_mismatch', message: '安装计划不属于当前会话，请重新预检。' } }
  }
  const storedPlan = pickPlainObject(task?.plan, task?.result?.plan, task?.result?.installPlan)
  const storedPayload = pickPlainObject(storedPlan.sourceInstallTaskPayload)
  if (!hasSubmittableSourceInstallTaskPayload(storedPayload)) {
    return {
      ...args,
      __rawPlanLookupError: {
        errorCode: 'missing_agent_task_install_plan',
        message: '未能从 Agent 任务中心读取可提交的原始安装计划，请重新生成安装预检。'
      }
    }
  }

  return {
    ...args,
    installPlan: {
      ...storedPlan,
      agentTaskId: storedPlan.agentTaskId || agentTaskId,
      taskId: storedPlan.taskId || agentTaskId
    },
    sourceInstallTaskPayload: storedPayload
  }
}

function resolveBackupPolicy(args = {}, plan = {}, payload = {}, options = {}) {
  const policy = toSafeText(
    options.enforcedBackupPolicy ||
      options.permission?.enforcedBackupPolicy ||
      args.backupPolicy ||
      plan.backupPolicy ||
      payload.backupPolicy ||
      payload.options?.backupPolicy
  ).toLowerCase()
  if (!policy || policy === 'none') {
    return ''
  }
  return policy
}

function resolveInstallPlan(args = {}) {
  const explicitPlan = pickPlainObject(args.installPlan, args.plan)
  const sourceInstallTaskPayload = pickPlainObject(
    args.sourceInstallTaskPayload,
    explicitPlan.sourceInstallTaskPayload
  )

  return {
    ...explicitPlan,
    sourceInstallTaskPayload
  }
}

function resolvePlanAuthorization(plan = {}, linkedPayload = {}, options = {}) {
  const standardPreflight =
    plan?.standardPreflight && typeof plan.standardPreflight === 'object'
      ? plan.standardPreflight
      : null
  if (!standardPreflight || standardPreflight.status !== 'completed') {
    return { authorization: null, standardPreflight: standardPreflight || null }
  }

  const storedAuthorization = getStandardPreflightAuthorization(linkedPayload) ||
    (plan?.standardPreflightAuthorization && typeof plan.standardPreflightAuthorization === 'object'
      ? plan.standardPreflightAuthorization
      : null)

  if (storedAuthorization) {
    return { authorization: storedAuthorization, standardPreflight }
  }

  if (options.requireExistingAuthorization === true) {
    return {
      authorization: null,
      standardPreflight,
      missingAuthorization: true
    }
  }

  return {
    authorization: createStandardPreflightAuthorization({
      ...plan,
      sourceInstallTaskPayload: linkedPayload,
      standardPreflight
    }),
    standardPreflight
  }
}

function buildPayloadHashPreviewResult(plan = {}, linkedPayload = {}) {
  const standardPreflight =
    plan?.standardPreflight && typeof plan.standardPreflight === 'object'
      ? plan.standardPreflight
      : null
  if (!standardPreflight) {
    return null
  }
  const requestInfo = createStandardPreflightRequest({
    plan: { ...plan, sourceInstallTaskPayload: linkedPayload },
    candidate: {},
    context: {}
  })
  if (!requestInfo?.available) {
    return {
      payloadHash: '',
      standardSource: toSafeText(standardPreflight.source || plan?.source),
      source: toSafeText(standardPreflight.source || plan?.source),
      recoverable: false,
      reason: requestInfo?.reason || 'missing_archive'
    }
  }
  const hashRequest = buildLegacySourceHashRequest(requestInfo.request)
  return {
    payloadHash: createPayloadHash(hashRequest),
    standardSource: toSafeText(
      requestInfo.request.source || standardPreflight.source || plan?.source
    ),
    source: toSafeText(
      requestInfo.request.source || standardPreflight.source || plan?.source
    )
  }
}

export function buildInstallExecutionPayload(args = {}, options = {}) {
  const plan = resolveInstallPlan(args)
  const sourceInstallTaskPayload = toPlainJson(plan.sourceInstallTaskPayload, {})
  const agentTaskId = toSafeText(
    args.agentTaskId ||
      args.taskId ||
      plan.agentTaskId ||
      plan.taskId ||
      sourceInstallTaskPayload.agentTaskId ||
      sourceInstallTaskPayload.agent_task_id
  )

  if (!Array.isArray(sourceInstallTaskPayload.items) || !sourceInstallTaskPayload.items.length) {
    return {
      valid: false,
      errorCode: 'missing_source_install_task_payload',
      message: '缺少可提交到安装任务中心的 sourceInstallTaskPayload。'
    }
  }

  const linkedPayload = {
    ...sourceInstallTaskPayload,
    agentTaskId:
      toSafeText(sourceInstallTaskPayload.agentTaskId || sourceInstallTaskPayload.agent_task_id) ||
      agentTaskId,
    agent_task_id:
      toSafeText(sourceInstallTaskPayload.agent_task_id || sourceInstallTaskPayload.agentTaskId) ||
      agentTaskId
  }
  if (plan.standardPreflight?.status === 'failed' || plan.canSubmit === false) {
    return { valid: false, errorCode: 'install_preflight_blocked', message: '原预检未通过，请先处理诊断并重新预检。' }
  }
  const backupPolicy = resolveBackupPolicy(args, plan, linkedPayload, options)
  if (backupPolicy) {
    linkedPayload.backupPolicy = backupPolicy
    linkedPayload.options = {
      ...(linkedPayload.options && typeof linkedPayload.options === 'object'
        ? linkedPayload.options
        : {}),
      backupPolicy
    }
  }

  const { authorization, standardPreflight, missingAuthorization } = resolvePlanAuthorization(
    plan,
    linkedPayload,
    options
  )

  if (missingAuthorization && standardPreflight) {
    return {
      valid: false,
      errorCode: 'missing_standard_preflight_authorization',
      message:
        '安装预检已完成，但未找到用户确认的授权。请重新生成安装计划并确认后再提交。',
      agentTaskId
    }
  }

  if (authorization && standardPreflight) {
    const expectedStandardSource = toSafeText(standardPreflight.source || plan?.source).toLowerCase()
    const authorizedSource = toSafeText(authorization.source).toLowerCase()
    if (expectedStandardSource && authorizedSource && expectedStandardSource !== authorizedSource) {
      return {
        valid: false,
        errorCode: 'standard_preflight_source_mismatch',
        message: '安装预检授权已失效：安装来源与用户确认的预检来源不一致，请重新生成并确认安装计划。',
        agentTaskId
      }
    }
    const previewResult = buildPayloadHashPreviewResult(plan, linkedPayload)
    if (!previewResult?.payloadHash) {
      return {
        valid: false,
        errorCode: 'standard_preflight_hash_missing',
        message:
          '安装预检授权已失效：执行前预检未返回 payloadHash，请重新生成并确认安装计划。',
        agentTaskId
      }
    }
    const verification = verifyStandardPreflightAuthorization(previewResult, authorization)
    if (!verification.valid) {
      return {
        valid: false,
        errorCode: verification.errorCode || 'standard_preflight_hash_mismatch',
        message: verification.message,
        agentTaskId
      }
    }
  }

  const payload = attachStandardPreflightAuthorizationToPayload(linkedPayload, authorization)

  return {
    valid: true,
    plan,
    payload,
    agentTaskId,
    backupPolicy,
    hasStandardPreflightAuthorization: Boolean(authorization)
  }
}

export async function executeInstallPlanAction(args = {}, ctx = {}, dependencyOverrides = {}) {
  assertNoRetiredSource(args)
  assertToolExecutionActive(ctx?.signal)
  const executionArgs = await resolveInstallExecutionArgs(args, dependencyOverrides, ctx)
  if (executionArgs.__rawPlanLookupError) {
    return {
      success: false,
      ...executionArgs.__rawPlanLookupError
    }
  }

  const prepared = buildInstallExecutionPayload(executionArgs, {
    enforcedBackupPolicy: ctx?.enforcedBackupPolicy,
    permission: ctx?.permission,
    requireExistingAuthorization: true
  })
  if (!prepared.valid) {
    return {
      success: false,
      errorCode: prepared.errorCode,
      message: prepared.message
    }
  }

  assertToolExecutionActive(ctx?.signal)

  let createTask = dependencyOverrides.createSourceInstallTask
  if (typeof createTask !== 'function') {
    const sourceInstallTask = await import('../../../../ipc/game/source-install-task/orchestrator.js')
    createTask = sourceInstallTask.createSourceInstallTask
  }
  const result = await createTask(ctx.event || null, prepared.payload)

  if (result?.success === false) {
    return sanitizeInstallExecutionOutput({
      success: false,
      errorCode: result.errorCode || 'source_install_task_create_failed',
      message: result.message || '提交安装任务失败。',
      installTaskResult: result
    })
  }

  const resolvedJobId = toSafeText(result?.jobId)
  const resolvedAgentTaskId = toSafeText(result?.agentTaskId || prepared.agentTaskId)

  if (resolvedJobId && resolvedAgentTaskId) {
    try {
      let updateAgentTask = dependencyOverrides.updateAgentTask
      if (typeof updateAgentTask !== 'function') {
        const taskCenter = await import('../taskCenter.js')
        updateAgentTask = taskCenter.updateAgentTask
      }
      if (typeof updateAgentTask === 'function') {
        await updateAgentTask(resolvedAgentTaskId, {
          linkedJobId: resolvedJobId,
          cancelable: true
        })
      }
    } catch (error) {
      console.warn('[AI Agent] 写入 linkedJobId 到 Agent 任务失败：', toSafeText(error?.message))
    }
  }

  // Persist an accepted task before acknowledging a late chat cancellation, so
  // the next turn can resume that job instead of submitting a duplicate.
  assertToolExecutionActive(ctx?.signal)

  return sanitizeInstallExecutionOutput({
    ...result,
    success: true,
    accepted: true,
    verified: false,
    completionState: 'submitted',
    nextVerification: { tool: 'vertex.install.task_detail', args: { jobId: resolvedJobId } },
    jobId: resolvedJobId,
    agentTaskId: resolvedAgentTaskId,
    taskId: resolvedAgentTaskId,
    state: toSafeText(result?.state),
    backupPolicy: prepared.backupPolicy,
    hasStandardPreflightAuthorization: prepared.hasStandardPreflightAuthorization,
    installTaskResult: result,
    message: result?.message || '已加入安装任务'
  })
}

export async function executeInstallPlanTool(args = {}, ctx = {}) {
  return await executeInstallPlanAction(args, ctx)
}
