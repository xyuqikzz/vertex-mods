import { normalizeAiAgentAuthorizationMode } from '../../../../shared/ai/config/ai-agent-config.js'
import { buildAiAgentConversationHistory } from '../../../../shared/ai/tools/ai-agent-tool-loop.js'
import { resolveAiAgentOutcome, getAiAgentOutcomeLabel } from '../../../../shared/ai/conversation/ai-agent-outcome.js'

const MAX_TASK_TARGET_LENGTH = 80
const MAX_CANDIDATES = 8
const AGENT_TASK_STAGE = Object.freeze({
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
})

function toSafeText(value = '') {
  return String(value ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function truncateTaskTarget(value = '') {
  const text = toSafeText(value)
  if (!text) return 'AI 分析任务'
  return text.length > MAX_TASK_TARGET_LENGTH
    ? `${text.slice(0, MAX_TASK_TARGET_LENGTH)}...`
    : text
}

export function buildAnalysisRetryRequest(payload = {}, permissionMode = '') {
  const request = {
    message: toSafeText(payload?.message),
    sessionId: toSafeText(payload?.sessionId),
    context: toPlainJson(payload?.context, {}),
    history: buildAiAgentConversationHistory(payload?.history),
    useContext: payload?.useContext !== false,
    model: toSafeText(payload?.model),
    mode: normalizeAiAgentAuthorizationMode(permissionMode || payload?.mode),
    stream: false
  }
  return toPlainJson(request, {})
}

function shouldTrackAnalysisTask(payload = {}, options = {}) {
  if (options?.trackAgentTask === false) return false
  if (payload?.trackAgentTask === false || payload?.skipAgentTaskTracking === true) return false
  return Boolean(toSafeText(payload?.message))
}

async function getAnalysisTaskDeps(options = {}) {
  const overrides = options?.agentTaskDeps || {}
  const deps = {
    ...overrides
  }
  if (
    typeof deps.createAgentTask !== 'function' ||
    typeof deps.getAgentTask !== 'function' ||
    typeof deps.updateAgentTask !== 'function' ||
    typeof deps.appendAgentTaskLog !== 'function'
  ) {
    const taskCenter = await import('./taskCenter.js')
    deps.createAgentTask = deps.createAgentTask || taskCenter.createAgentTask
    deps.getAgentTask = deps.getAgentTask || taskCenter.getAgentTask
    deps.updateAgentTask = deps.updateAgentTask || taskCenter.updateAgentTask
    deps.appendAgentTaskLog = deps.appendAgentTaskLog || taskCenter.appendAgentTaskLog
  }
  return deps
}

export async function startTrackedAnalysisTask(payload = {}, options = {}, context = {}) {
  if (!shouldTrackAnalysisTask(payload, options)) return null
  const deps = await getAnalysisTaskDeps(options)
  const taskId = toSafeText(payload?.agentTaskId || payload?.taskId)
  const permissionMode = normalizeAiAgentAuthorizationMode(context.permissionMode || payload?.mode)
  const retryRequest = buildAnalysisRetryRequest(payload, permissionMode)
  const planPatch = {
    retryRequest,
    executionId: toSafeText(context.executionId)
  }

  try {
    if (taskId) {
      const currentTask =
        typeof deps.getAgentTask === 'function' ? await deps.getAgentTask(taskId) : null
      const currentPlan =
        currentTask?.plan && typeof currentTask.plan === 'object' ? currentTask.plan : {}
      const task = await deps.updateAgentTask(taskId, {
        stage: AGENT_TASK_STAGE.ANALYZING,
        progress: 5,
        currentTarget: truncateTaskTarget(payload.message),
        errorCode: '',
        errorMessage: '',
        cancelable: true,
        plan: {
          ...currentPlan,
          ...planPatch
        },
        authorizationMode: permissionMode
      })
      await deps.appendAgentTaskLog(taskId, 'info', '开始重试普通分析任务', {
        executionId: toSafeText(context.executionId)
      })
      return {
        taskId,
        deps,
        retryRequest,
        task
      }
    }

    const task = await deps.createAgentTask({
      sessionId: payload.sessionId,
      type: 'analyze',
      stage: AGENT_TASK_STAGE.ANALYZING,
      progress: 5,
      currentTarget: truncateTaskTarget(payload.message),
      cancelable: true,
      plan: planPatch,
      authorizationMode: permissionMode
    })
    if (!task?.taskId) return null
    await deps.appendAgentTaskLog(task.taskId, 'info', '开始执行普通分析任务', {
      executionId: toSafeText(context.executionId)
    })
    return {
      taskId: task.taskId,
      deps,
      retryRequest,
      task
    }
  } catch (error) {
    console.warn('[AI Agent] 创建普通分析任务失败：', toSafeText(error?.message))
    return null
  }
}

export function compactChatResult(result = {}, executionId = '') {
  return toPlainJson(
    {
      success: result?.success !== false,
      configured: result?.configured !== false,
      engine: result?.engine,
      executionId: result?.executionId || executionId,
      agentTaskId: result?.agentTaskId,
      outcome: resolveAiAgentOutcome(result),
      error: result.error,
      canRetry: result.canRetry,
      stopReason: result.stopReason,
      assistantMessage: toSafeText(result?.assistantMessage),
      candidates: Array.isArray(result?.candidates) ? result.candidates.slice(0, MAX_CANDIDATES) : [],
      installPlan: result?.installPlan || null,
      confirmations: Array.isArray(result?.confirmations) ? result.confirmations : [],
      toolCalls: Array.isArray(result?.toolCalls) ? result.toolCalls : []
    },
    {}
  )
}

export async function finishTrackedAnalysisTask(tracker = null, result = {}, options = {}) {
  if (!tracker?.taskId || !tracker.deps) return null
  const outcome = options.cancelled ? 'cancelled' : resolveAiAgentOutcome(result)
  const success = outcome === 'answered'
  const stage =
    options.stage ||
    ({ answered: AGENT_TASK_STAGE.COMPLETED, failed: AGENT_TASK_STAGE.FAILED,
      cancelled: AGENT_TASK_STAGE.CANCELLED }[outcome] || outcome)
  const errorMessage = outcome === 'failed' ? toSafeText(result?.assistantMessage) || 'AI 分析任务失败' : ''
  try {
    const latestTask =
      typeof tracker.deps.getAgentTask === 'function'
        ? await tracker.deps.getAgentTask(tracker.taskId)
        : null
    const latestResult =
      latestTask?.result && typeof latestTask.result === 'object' ? latestTask.result : {}
    const updatedTask = await tracker.deps.updateAgentTask(tracker.taskId, {
      stage,
      progress: ['answered', 'failed', 'cancelled'].includes(outcome) ? 100 : 0,
      errorCode: ['failed', 'cancelled'].includes(outcome) ? options.errorCode || `agent_analysis_${outcome}` : '',
      errorMessage,
      cancelable: false,
      result: {
        ...latestResult,
        lastChatResult: compactChatResult(result, options.executionId)
      }
    })
    await tracker.deps.appendAgentTaskLog(
      tracker.taskId,
      success ? 'info' : options.cancelled ? 'warn' : 'error',
      success ? '普通分析任务已完成' : errorMessage || getAiAgentOutcomeLabel(outcome),
      {
        executionId: toSafeText(options.executionId)
      }
    )
    return updatedTask
  } catch (error) {
    console.warn('[AI Agent] 更新普通分析任务失败：', toSafeText(error?.message))
    return null
  }
}
