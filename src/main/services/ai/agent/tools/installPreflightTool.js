import { createAiAgentInstallPlanPreview } from '../../agentInstallPlan.js'
import {
  AGENT_TASK_STAGE,
  appendAgentTaskLog,
  createAgentTask,
  getAgentTask,
  updateAgentTask
} from '../taskCenter.js'
import { summarizeAgentInstallPlan } from '../../../../../shared/ai/installation/ai-agent-standard-preflight-refresh.js'
import { runStandardPreflightIfPossible } from './standardPreflightRunner.js'
import { assertSourceCapability } from '../../../../../shared/sources/source-platform-registry.js'
import { sanitizeInstallPreflightOutput } from './installPreflightOutputSanitizer.js'
import { createStandardPreflightAuthorization } from '../../../../../shared/ai/permissions/ai-agent-install-authorization.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'
import { resolveArchiveEvidence } from './archiveEvidence.js'

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function resolveCandidateName(candidate = {}) {
  return pickFirstText(
    candidate.name,
    candidate.modName,
    candidate.displayName,
    candidate.fullName,
    candidate.packageFullName,
    candidate.modReference,
    candidate.modId,
    candidate.id,
    '待确认模组'
  )
}

function resolveSource(candidate = {}, context = {}) {
  return toSafeText(
    candidate.source ||
      candidate.businessSource ||
      candidate.sourceType ||
      context?.businessSource ||
      context?.page?.businessSource ||
      context?.page?.source
  ).toLowerCase()
}

function toErrorMessage(error, fallback = '安装预检失败') {
  return toSafeText(error?.message || error, fallback) || fallback
}

export async function inspectInstallPlanTool(args = {}, ctx = {}) {
  assertToolExecutionActive(ctx?.signal)
  let previous = null
  if (args.agentTaskId) {
    previous = await getAgentTask(args.agentTaskId)
    if (!previous || (previous.sessionId && previous.sessionId !== ctx.sessionId)) {
      return { success: false, errorCode: 'install_plan_session_mismatch', message: '原预检不属于当前会话，请按当前目标重新预检。' }
    }
  }
  const candidate = toPlainJson(args?.candidate || previous?.plan?.candidate, {})
  const context = toPlainJson(args?.context || previous?.plan?.context || ctx?.pageContext, {})
  if (args.archiveRef) {
    try { candidate.filePath = (await resolveArchiveEvidence({ archiveRef: args.archiveRef }, ctx)).archivePath }
    catch (error) { return { success: false, errorCode: error.code, message: error.message } }
  }
  if (args.installChoices) candidate.installChoices = toPlainJson(args.installChoices)

  if (!Object.keys(candidate).length) {
    return {
      success: false,
      errorCode: 'missing_candidate',
      message: '缺少候选模组，无法生成安装预检计划。'
    }
  }

  const source = resolveSource(candidate, context)
  const currentTarget = resolveCandidateName(candidate)
  const task = await createAgentTask({
    sessionId: ctx?.sessionId,
    type: 'install_preflight',
    stage: AGENT_TASK_STAGE.ANALYZING,
    progress: 10,
    currentTarget,
    cancelable: false,
    authorizationMode: ctx?.mode,
    plan: {
      candidate,
      context
    }
  })

  await appendAgentTaskLog(task.taskId, 'info', '开始生成安装预检计划', {
    source,
    currentTarget
  })

  assertToolExecutionActive(ctx?.signal)

  const capability = assertSourceCapability(source, 'ai.installPlan')
  if (!capability.ok) {
    const message = capability.message || '当前来源尚未开启 AI 安装预检能力。'
    const failedTask = await updateAgentTask(task.taskId, {
      stage: AGENT_TASK_STAGE.FAILED,
      progress: 100,
      errorCode: capability.errorCode || 'source_capability_disabled',
      errorMessage: message,
      result: {
        success: false,
        source: capability.source || source
      }
    })
    await appendAgentTaskLog(task.taskId, 'warn', message, { source })
    return {
      success: false,
      taskId: task.taskId,
      task: failedTask,
      errorCode: capability.errorCode || 'source_capability_disabled',
      source: capability.source || source,
      message
    }
  }

  try {
    await updateAgentTask(task.taskId, {
      stage: AGENT_TASK_STAGE.INSPECTING,
      progress: 35
    })

    assertToolExecutionActive(ctx?.signal)

    const result = await createAiAgentInstallPlanPreview({
      candidate,
      context
    })
    if (result?.success === false) throw Object.assign(new Error(result.message || '安装决策未完成'), { code: result.errorCode || 'install_plan_failed' })
    const plan = toPlainJson(result?.plan, null)
    if (plan?.sourceInstallTaskPayload && candidate.installChoices) {
      const entries = plan.sourceInstallTaskPayload.items || []
      const mainEntries = entries.filter((entry) => Number(entry.meta?.installPayload?.typeId || 0) !== 1 && !entry.meta?.installPayload?.dependencyRole)
      if (mainEntries.length !== 1) throw Object.assign(new Error('组件选择必须定位到一个主安装项，请在任务详情按 itemId 续跑。'), { code: 'ambiguous_component_target' })
      const entry = mainEntries[0]
      entry.meta ||= {}
      entry.meta.installPayload = { ...(entry.meta.installPayload || {}), installChoices: candidate.installChoices }
    }
    let standardPreflight = null
    if (plan) {
      await updateAgentTask(task.taskId, {
        stage: AGENT_TASK_STAGE.PLANNING,
        progress: 70
      })
      assertToolExecutionActive(ctx?.signal)
      standardPreflight = await runStandardPreflightIfPossible({
        candidate,
        context,
        plan,
        event: ctx?.event || null
      })
    }
    const linkedSourceInstallTaskPayload =
      plan?.sourceInstallTaskPayload && typeof plan.sourceInstallTaskPayload === 'object'
        ? {
            ...plan.sourceInstallTaskPayload,
            agentTaskId: task.taskId
          }
        : plan?.sourceInstallTaskPayload
    const standardPreflightAuthorization =
      standardPreflight?.status === 'completed'
        ? createStandardPreflightAuthorization({
            ...plan,
            agentTaskId: task.taskId,
            taskId: task.taskId,
            sourceInstallTaskPayload: linkedSourceInstallTaskPayload,
            standardPreflight
          })
        : null
    const planWithPreflight = plan
      ? {
          ...plan,
          agentTaskId: task.taskId,
          candidate,
          context,
          canSubmit: plan.canSubmit === true && standardPreflight?.status !== 'failed',
          sourceInstallTaskPayload: linkedSourceInstallTaskPayload,
          standardPreflight,
          standardPreflightAuthorization
        }
      : plan
    const planSummary = summarizeAgentInstallPlan(planWithPreflight)
    const completedTask = await updateAgentTask(task.taskId, {
      stage: AGENT_TASK_STAGE.COMPLETED,
      progress: 100,
      plan: planWithPreflight,
      result: {
        success: result?.success !== false && standardPreflight?.status !== 'failed',
        detailResolved: result?.detailResolved === true,
        planSummary,
        standardPreflight
      }
    })

    await appendAgentTaskLog(task.taskId, 'info', '安装预检计划已生成', {
      canSubmit: planWithPreflight?.canSubmit === true,
      decisionState: plan?.decisionState,
      standardPreflightStatus: standardPreflight?.status || ''
    })

    return sanitizeInstallPreflightOutput({
      success: standardPreflight?.status !== 'failed',
      taskId: task.taskId,
      task: completedTask || (await getAgentTask(task.taskId)),
      plan: planWithPreflight,
      planSummary,
      standardPreflight,
      selectionRequest: standardPreflight?.selectionRequest || null,
      errorCode: standardPreflight?.errorCode || '',
      executePlanArgs: planWithPreflight?.canSubmit === true ? { agentTaskId: task.taskId } : null,
      resumeArgs: { agentTaskId: task.taskId },
      detailResolved: result?.detailResolved === true,
      message:
        standardPreflight?.status === 'completed'
          ? '标准预检已完成，可按当前授权提交安装任务；尚未安装。'
          : standardPreflight?.status === 'failed'
            ? standardPreflight.message || '预检未通过，请处理结构化诊断后续跑。'
          : plan?.canSubmit === true
          ? '安装预检计划已生成，等待用户确认后加入安装任务。'
          : '安装预检计划已生成，但仍缺少任务中心 payload，需要继续补齐来源文件、规则或游戏目录。'
    })
  } catch (error) {
    const message = toErrorMessage(error)
    const failedTask = await updateAgentTask(task.taskId, {
      stage: AGENT_TASK_STAGE.FAILED,
      progress: 100,
      errorCode: error.code || 'install_preflight_failed',
      errorMessage: message,
      result: {
        success: false,
        message
      }
    })
    await appendAgentTaskLog(task.taskId, 'error', message, {
      errorName: toSafeText(error?.name)
    })
    return sanitizeInstallPreflightOutput({
      success: false,
      taskId: task.taskId,
      task: failedTask,
      errorCode: error.code || 'install_preflight_failed',
      message
    })
  }
}
