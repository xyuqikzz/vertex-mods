import {
  getAiAgentToolDescriptor,
  listAiAgentToolDescriptors,
  normalizeAiAgentToolName,
  validateAiAgentToolArgs
} from '../../../../shared/ai/tools/ai-agent-tool-schemas.js'
import { sanitizeAiAgentConfirmationArgsPreview } from '../../../../shared/ai/permissions/ai-agent-confirmation-preview.js'
import { saveAgentConfirmation } from './confirmationService.js'
import { resolveAgentPermissionGrantContext } from '../../../../shared/ai/permissions/ai-agent-permission-grant.js'
import {
  evaluateAgentToolPermission,
  formatAgentPermissionReasonMessage
} from './permissionPolicy.js'
import { findActiveAgentPermissionGrant } from './permissionGrantStore.js'
import { resolveOperationAuthorizationTarget, hasOperationAuthorization, rememberOperationAuthorization } from './operationAuthorization.js'
import { logAgentToolCall } from './toolCallLogger.js'
import { getModSourceDetail, searchModSource } from '../../mod-source/index.js'
import {
  getSourceInstallTaskSummary,
  listSourceInstallTasks
} from '../../../ipc/game/source-install-task/orchestrator.js'
import { getGameContextTool, getInstalledGamesTool } from './tools/gameContextTool.js'
import { bindGameRootTool, detectGameRootTool } from './tools/gameRootTool.js'
import { getInstalledModDetailTool, listInstalledModsTool } from './tools/installedModsTool.js'
import { detectModConflictsTool } from './tools/conflictDetectorTool.js'
import { executeConflictRepairTool } from './tools/conflictRepairTool.js'
import { createConflictRepairPlanTool } from './tools/conflictRepairPlanTool.js'
import { inspectInstallPlanTool } from './tools/installPreflightTool.js'
import { resolveDependenciesTool } from './tools/dependencyResolverTool.js'
import { auditInstallContextTool } from './tools/installContextAuditTool.js'
import { inspectInstallArchiveTool } from './tools/installArchiveInspectTool.js'
import { getInstallLocationHintsTool } from './tools/installLocationHintsTool.js'
import { matchInstallRulePreviewTool } from './tools/installRuleMatchPreviewTool.js'
import { executeInstallPlanTool } from './tools/installExecutorTool.js'
import { controlInstallTaskTool } from './tools/installTaskControlTool.js'
import { getInstallFailureDiagnoseTool } from './tools/installFailureDiagnoseTool.js'
import { getInstallTaskTimelineTool } from './tools/installTaskTimelineTool.js'
import { getInstallTaskEvidenceTool } from './tools/installTaskEvidenceTool.js'
import { analyzeLocalModTool } from './tools/localModAnalyzeTool.js'
import { createModLifecyclePlanTool, executeModLifecycleTool } from './tools/modLifecycleTool.js'
import { checkModUpdateTool } from './tools/modUpdateCheckTool.js'
import { analyzeLogsTool } from './tools/logAnalyzerTool.js'
import { createRollbackPlanTool, executeRollbackTool } from './tools/rollbackTool.js'
import { getInstallRuleReferenceDocsTool } from './tools/installRuleReferenceDocsTool.js'
import { saveInstallRuleConfigTool } from './tools/installRuleConfigWriterTool.js'
import {
  configureSourceCredentialTool,
  getSourceCredentialStatusTool
} from './tools/sourceCredentialTool.js'
import { getSourceCapabilitiesTool } from './tools/sourceCapabilitiesTool.js'
import { getPageContextTool } from './tools/pageContextTool.js'
import { readAgentSkillTool } from './tools/skillTool.js'
import { prepareAgentScriptTool, runAgentScriptTool, getAgentScriptPreview } from './tools/scriptTool.js'
import { listDlssGamesTool, inspectDlssGameTool, prepareDlssTool, executeDlssTool, checkDlssRuntimeTool, getDlssPlanPreview } from './tools/dlssTool.js'
import {
  downloadFlingTrainerTool,
  getFlingTrainerDetailTool,
  listFlingTrainerLocalRecordsTool,
  runFlingTrainerTool,
  searchFlingTrainerTool
} from './tools/flingTrainerTool.js'

/**
 * AgentToolRegistry V2
 * 统一调用入口 invokeAgentTool：schema 校验 → 权限裁决 → 执行 → 审计日志。
 * 工具元数据（schema/权限等级/危险标记）定义在 shared/ai/tools/ai-agent-tool-schemas.js。
 */

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

function normalizeListTasksResult(result = {}) {
  const safeResult = toPlainJson(result, {})
  if (Array.isArray(safeResult)) {
    return { success: true, tasks: safeResult.slice(0, 10) }
  }
  const tasks = Array.isArray(safeResult?.records)
    ? safeResult.records
    : Array.isArray(safeResult?.list)
      ? safeResult.list
      : Array.isArray(safeResult?.tasks)
        ? safeResult.tasks
        : []
  return {
    success: safeResult?.success !== false,
    ...safeResult,
    tasks: tasks.slice(0, 10)
  }
}

function createToolPermissionMeta(descriptor = {}, permission = {}) {
  return {
    permissionLevel: toSafeText(descriptor.permissionLevel),
    dangerous: descriptor.dangerous === true,
    requiresConfirmation: toSafeText(descriptor.requiresConfirmation),
    mode: toSafeText(permission.mode),
    reason: toSafeText(permission.reason),
    reasonMessage: toSafeText(
      permission.reasonMessage,
      formatAgentPermissionReasonMessage(permission.reason)
    ),
    errorCode: toSafeText(permission.errorCode, permission.reason),
    allowed: permission.allowed === true,
    confirmationRequired: permission.confirmationRequired === true
  }
}

function createToolConfirmationResult(descriptor = {}, args = {}, permission = {}, ctx = {}) {
  const grantContext = resolveAgentPermissionGrantContext({
    descriptor,
    args,
    grantContext: ctx?.grantContext
  })
  const permissionMeta = createToolPermissionMeta(descriptor, permission)
  const permissionErrorCode = toSafeText(permission.errorCode, permission.reason)
  const permissionReasonMessage = toSafeText(
    permission.reasonMessage,
    formatAgentPermissionReasonMessage(permission.reason)
  )
  const confirmation = {
    id: '',
    toolName: toSafeText(descriptor.name),
    title: toSafeText(descriptor.title, descriptor.name),
    description: toSafeText(descriptor.description),
    permissionLevel: toSafeText(descriptor.permissionLevel),
    dangerous: descriptor.dangerous === true,
    mode: toSafeText(permission.mode),
    requiresConfirmation: toSafeText(descriptor.requiresConfirmation),
    reason: toSafeText(permission.reason),
    reasonMessage: permissionReasonMessage,
    permissionErrorCode,
    permission: permissionMeta,
    allowGrant: descriptor.allowGrant !== false && ctx.boundedOperation === true,
    args: toPlainJson(args, {}),
    argsPreview: sanitizeAiAgentConfirmationArgsPreview(args),
    confirmationInput: descriptor.confirmationInput
      ? toPlainJson(descriptor.confirmationInput, {})
      : null,
    grantContext,
    sessionId: toSafeText(ctx?.sessionId),
    executionId: toSafeText(ctx?.executionId),
    createdAt: new Date().toISOString()
  }
  if (descriptor.name === 'vertex.script.run') {
    confirmation.scriptPreview = getAgentScriptPreview(args.scriptId, ctx)
  }
  if (descriptor.name === 'vertex.dlss.execute') {
    confirmation.argsPreview = getDlssPlanPreview(args.planId, ctx)
  }
  confirmation.id = saveAgentConfirmation(confirmation, args, ctx)

  return {
    success: false,
    errorCode: 'confirmation_required',
    permissionErrorCode,
    permissionReasonMessage,
    confirmationRequired: true,
    confirmation,
    permission: permissionMeta,
    message: `${confirmation.title} 需要用户确认后才能执行。`
  }
}

const TOOL_HANDLERS = Object.freeze({
  'vertex.skill.read': (args, ctx) => readAgentSkillTool(args, ctx),
  'vertex.dlss.list': (args, ctx) => listDlssGamesTool(args, ctx),
  'vertex.dlss.inspect': (args, ctx) => inspectDlssGameTool(args, ctx),
  'vertex.dlss.prepare': (args, ctx) => prepareDlssTool(args, ctx),
  'vertex.dlss.execute': (args, ctx) => executeDlssTool(args, ctx),
  'vertex.dlss.check_runtime': (args, ctx) => checkDlssRuntimeTool(args, ctx),
  'vertex.script.prepare': (args, ctx) => prepareAgentScriptTool(args, ctx),
  'vertex.script.run': (args, ctx) => runAgentScriptTool(args, ctx),
  'vertex.game.list': (args) => getInstalledGamesTool(args),
  'vertex.game.context': (args, ctx) => getGameContextTool(args, {}, ctx),
  'vertex.game.detect_root': (args, ctx) => detectGameRootTool(args, ctx),
  'vertex.game.bind_root': (args, ctx) => bindGameRootTool(args, ctx),
  'vertex.mod.installed_list': (args) => listInstalledModsTool(args),
  'vertex.mod.installed_detail': (args) => getInstalledModDetailTool(args),
  'vertex.mod.search': (args, ctx) =>
    searchModSource({
      ...args,
      context: ctx?.pageContext || {}
    }),
  'vertex.mod.detail': (args, ctx) =>
    getModSourceDetail({
      ...args,
      fileLimit: args.fileLimit ?? 20,
      context: ctx?.pageContext || {}
    }),
  'vertex.install.tasks': async (args) => {
    const summary = getSourceInstallTaskSummary()
    const tasks = normalizeListTasksResult(
      listSourceInstallTasks({
        ...args,
        limit: Math.min(Number(args.limit || 10), 10)
      })
    )
    return {
      success: true,
      summary,
      tasks: tasks.tasks
    }
  },
  'vertex.install.task_detail': (args, ctx) => getInstallTaskEvidenceTool(args, ctx),
  'vertex.install.task_timeline': (args) => getInstallTaskTimelineTool(args),
  'vertex.install.failure_diagnose': (args, ctx) => getInstallFailureDiagnoseTool(args, ctx),
  'vertex.page.context': (args, ctx) => getPageContextTool(args, ctx),
  'vertex.source.capabilities': (args) => getSourceCapabilitiesTool(args),
  'vertex.source_credential.status': (args, ctx) => getSourceCredentialStatusTool(args, ctx),
  'vertex.source_credential.configure': (args, ctx) => configureSourceCredentialTool(args, ctx),
  'vertex.install.control_task': (args, ctx) => controlInstallTaskTool(args, ctx),
  'vertex.install_rule.reference_docs': (args) => getInstallRuleReferenceDocsTool(args),
  'vertex.install_rule.save_config': (args, ctx) => saveInstallRuleConfigTool(args, ctx),
  'vertex.install.resolve_dependencies': (args, ctx) => resolveDependenciesTool(args, ctx),
  'vertex.install.context_audit': (args, ctx) => auditInstallContextTool(args, ctx),
  'vertex.install.archive.inspect': (args, ctx) => inspectInstallArchiveTool(args, ctx),
  'vertex.install.location_hints': (args, ctx) => getInstallLocationHintsTool(args, ctx),
  'vertex.install.rule.match_preview': (args, ctx) => matchInstallRulePreviewTool(args, ctx),
  'vertex.install.inspect_plan': (args, ctx) => inspectInstallPlanTool(args, ctx),
  'vertex.install.execute_plan': (args, ctx) => executeInstallPlanTool(args, ctx),
  'vertex.local_mod.analyze': (args, ctx) => analyzeLocalModTool(args, ctx),
  'vertex.mod.update_check': (args, ctx) => checkModUpdateTool(args, ctx),
  'vertex.mod.lifecycle_plan': (args) => createModLifecyclePlanTool(args),
  'vertex.mod.lifecycle_execute': (args, ctx) => executeModLifecycleTool(args, ctx),
  'vertex.conflict.detect': (args) => detectModConflictsTool(args),
  'vertex.conflict.repair_plan': (args, ctx) => createConflictRepairPlanTool(args, ctx),
  'vertex.conflict.execute_repair': (args, ctx) => executeConflictRepairTool(args, ctx),
  'vertex.log.analyze': (args, ctx) => analyzeLogsTool(args, ctx),
  'vertex.rollback.plan': (args, ctx) => createRollbackPlanTool(args, ctx),
  'vertex.rollback.execute': (args, ctx) => executeRollbackTool(args, ctx),
  'vertex.trainer.fling.search': (args, ctx) => searchFlingTrainerTool(args, ctx),
  'vertex.trainer.fling.detail': (args, ctx) => getFlingTrainerDetailTool(args, ctx),
  'vertex.trainer.fling.download': (args, ctx) => downloadFlingTrainerTool(args, ctx),
  'vertex.trainer.fling.local_records': (args, ctx) =>
    listFlingTrainerLocalRecordsTool(args, ctx),
  'vertex.trainer.fling.run': (args, ctx) => runFlingTrainerTool(args, ctx)
})

export function listAgentV2Tools(definition) {
  return listAiAgentToolDescriptors(definition)
    .filter((item) => TOOL_HANDLERS[item.name])
    .map((item) => ({
      name: item.name,
      title: item.title,
      description: item.description,
      argsHint: item.argsHint,
      permissionLevel: item.permissionLevel,
      dangerous: item.dangerous === true,
      requiresConfirmation: item.requiresConfirmation,
      readonly: item.readonly !== false,
      enabled: item.enabled !== false,
      taskized: item.taskized === true
    }))
}

/**
 * 统一工具调用入口。
 * @param {string} name 工具名
 * @param {object} args 模型给出的入参
 * @param {object} ctx { sessionId, executionId, pageContext, mode }
 * @returns 纯 JSON 结果，永远包含 success 字段
 */
export async function invokeAgentTool(name = '', args = {}, ctx = {}) {
  const requestedToolName = toSafeText(name)
  const toolName = normalizeAiAgentToolName(requestedToolName)
  const startedAt = Date.now()
  const baseLog = {
    sessionId: toSafeText(ctx?.sessionId),
    executionId: toSafeText(ctx?.executionId),
    toolName
  }

  const descriptor = getAiAgentToolDescriptor(toolName)
  const handler = TOOL_HANDLERS[toolName]
  if (!descriptor || !handler || !descriptor.enabled) {
    const result = {
      success: false,
      errorCode: descriptor && !descriptor.enabled ? 'tool_disabled' : 'tool_not_found',
      message: descriptor && !descriptor.enabled
        ? `${descriptor.title} 已在智能体配置中停用。`
        : `${requestedToolName || toolName || '未知工具'} 不在 Agent 工具白名单内。`
    }
    logAgentToolCall({
      ...baseLog,
      args,
      resultStatus: 'denied',
      result,
      durationMs: Date.now() - startedAt
    })
    return result
  }

  const logMeta = {
    ...baseLog,
    permissionLevel: descriptor.permissionLevel,
    dangerous: descriptor.dangerous === true,
    requiresConfirmation: descriptor.requiresConfirmation
  }

  const validation = validateAiAgentToolArgs(descriptor, toPlainJson(args, {}))
  const scriptUnavailable = toolName === 'vertex.script.run' && validation.valid &&
    !getAgentScriptPreview(validation.value.scriptId, ctx)
  const planUnavailable = toolName === 'vertex.dlss.execute' && validation.valid &&
    !getDlssPlanPreview(validation.value.planId, ctx)
  if (!validation.valid || scriptUnavailable || planUnavailable) {
    const result = {
      success: false,
      errorCode: planUnavailable ? 'dlss_plan_expired' : scriptUnavailable ? 'script_expired' : 'invalid_arguments',
      message: planUnavailable ? '安装方案已执行、已过期或不属于当前会话，请重新准备。' : scriptUnavailable ? '脚本已执行、已过期或不属于当前会话，请重新准备。' : `参数校验失败：${validation.errors.join('；')}`,
      argsHint: descriptor.argsHint
    }
    logAgentToolCall({
      ...logMeta,
      args,
      resultStatus: scriptUnavailable ? 'denied' : 'invalid_arguments',
      result,
      durationMs: Date.now() - startedAt
    })
    return result
  }

  let operationTarget
  try {
    operationTarget = await resolveOperationAuthorizationTarget(toolName, validation.value, ctx)
  } catch (error) {
    return { success: false, errorCode: 'operation_target_unavailable', message: `无法核对操作目标：${toSafeText(error.message)}` }
  }
  if (operationTarget.error) return operationTarget.error
  if (ctx.confirmedOperationScope && ctx.confirmedOperationScope !== operationTarget.scope) {
    return { success: false, errorCode: 'operation_target_changed', message: '确认后的操作目标已变化，请重新准备并确认。' }
  }
  const executionArgs = operationTarget.args || validation.value
  const permissionContext = {
    ...ctx,
    args: executionArgs,
    boundedOperation: operationTarget.bounded === true,
    operationScope: operationTarget.scope || '',
    expandsAutomaticScope: Boolean(operationTarget.scope && ctx.automaticOperationScopes?.size && !ctx.automaticOperationScopes.has(operationTarget.scope)),
    operationAuthorized: hasOperationAuthorization(ctx.sessionId, operationTarget.scope),
    grantContext: resolveAgentPermissionGrantContext({
      descriptor,
      args: executionArgs,
      grantContext: ctx?.grantContext
    })
  }
  permissionContext.permissionGrant = findActiveAgentPermissionGrant({
    grantContext: permissionContext.grantContext
  })
  const permission = evaluateAgentToolPermission(descriptor, permissionContext)
  if (!permission.allowed) {
    if (permission.confirmationRequired) {
      const result = createToolConfirmationResult(
        descriptor,
        executionArgs,
        permission,
        permissionContext
      )
      if (operationTarget.bounded && toolName === 'vertex.install.execute_plan') {
        // Keep the executable reference intact through model redaction and history.
        result.confirmation.args = { agentTaskId: validation.value.agentTaskId }
      }
      logAgentToolCall({
        ...logMeta,
        args: validation.value,
        permissionMode: permission.mode,
        permissionReason: permission.reason,
        confirmationRequired: true,
        resultStatus: 'confirmation_required',
        result: {
          success: false,
          errorCode: result.errorCode,
          message: result.message
        },
        durationMs: Date.now() - startedAt
      })
      return result
    }

    const permissionErrorCode = toSafeText(permission.errorCode, permission.reason)
    const permissionReasonMessage = toSafeText(
      permission.reasonMessage,
      formatAgentPermissionReasonMessage(permission.reason)
    )
    const result = {
      success: false,
      errorCode: 'permission_denied',
      permissionErrorCode,
      permissionReasonMessage,
      message: `当前 Agent 策略不允许调用 ${toolName}：${permissionReasonMessage}（${permissionErrorCode}）。`,
      permission: createToolPermissionMeta(descriptor, permission)
    }
    logAgentToolCall({
      ...logMeta,
      args: validation.value,
      permissionMode: permission.mode,
      permissionReason: permission.reason,
      confirmationRequired: permission.confirmationRequired === true,
      resultStatus: 'denied',
      result,
      durationMs: Date.now() - startedAt
    })
    return result
  }

  try {
    if (descriptor.permissionLevel === 'destructive' && permission.reason === 'auto_allowed' && operationTarget.scope) {
      ctx.automaticOperationScopes?.add(operationTarget.scope)
    }
    if (ctx.userConfirmed === true || ctx.confirmed === true) {
      rememberOperationAuthorization(ctx.sessionId, operationTarget.scope)
    }
    const rawResult = operationTarget.existingJobId
      ? { success: true, accepted: true, reused: true, agentTaskId: executionArgs.agentTaskId, jobId: operationTarget.existingJobId, message: '此计划已有安装任务，已复用原任务；重试或续跑请使用任务控制。' }
      : await handler(executionArgs, {
      ...ctx,
      permission,
      enforcedBackupPolicy: permission.enforcedBackupPolicy
      })
    const result = toPlainJson(rawResult, {
      success: false,
      errorCode: 'invalid_tool_result',
      message: '工具返回结果无法序列化。'
    })
    if (typeof result.success === 'undefined') {
      result.success = true
    }
    result.permission = createToolPermissionMeta(descriptor, permission)
    if (toolName === 'vertex.install.execute_plan' && result.accepted && result.jobId) {
      const verification = await invokeAgentTool('vertex.install.task_detail', { jobId: result.jobId }, ctx)
      result.verification = verification
      result.verified = verification.verified === true
      result.completionState = verification.completionState || 'submitted'
    }
    logAgentToolCall({
      ...logMeta,
      args: validation.value,
      permissionMode: permission.mode,
      permissionReason: permission.reason,
      confirmationRequired: false,
      resultStatus: result.success === false ? 'error' : 'ok',
      result: {
        success: result.success,
        errorCode: result.errorCode,
        message: result.message
      },
      durationMs: Date.now() - startedAt
    })
    return result
  } catch (error) {
    const aborted = error?.name === 'AbortError'
    const result = {
      success: false,
      errorCode: aborted ? 'cancelled' : 'tool_execution_failed',
      message: aborted
        ? '工具调用已取消。'
        : `工具执行失败：${toSafeText(error?.message) || '未知错误'}`
    }
    logAgentToolCall({
      ...logMeta,
      args: validation.value,
      permissionMode: permission.mode,
      permissionReason: permission.reason,
      confirmationRequired: false,
      resultStatus: aborted ? 'cancelled' : 'error',
      result,
      durationMs: Date.now() - startedAt
    })
    return result
  }
}
