import { createRollbackPlan, executeRollbackAction } from './tools/rollbackTool.js'
import { resolveAiAgentOutcome } from '../../../../shared/ai/conversation/ai-agent-outcome.js'

export const AGENT_TASK_ACTION_STAGE = Object.freeze({
  QUEUED: 'queued',
  INSTALLING: 'installing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  ROLLED_BACK: 'rolled_back'
})

const TERMINAL_STAGES = new Set([
  AGENT_TASK_ACTION_STAGE.COMPLETED,
  AGENT_TASK_ACTION_STAGE.FAILED,
  AGENT_TASK_ACTION_STAGE.CANCELLED,
  AGENT_TASK_ACTION_STAGE.ROLLED_BACK
])

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function isTaskTerminal(task = {}) {
  return TERMINAL_STAGES.has(toSafeText(task.stage))
}

function createMockEvent(event = null) {
  if (event) return event
  return {
    reply() {},
    sender: {
      send() {}
    }
  }
}

function resolveLinkedJobId(task = {}, payload = {}) {
  return toSafeText(payload.jobId || payload.job_id || task.linkedJobId || task.linked_job_id)
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function resolveRetryRequest(task = {}) {
  const plan = task?.plan && typeof task.plan === 'object' ? task.plan : {}
  const result = task?.result && typeof task.result === 'object' ? task.result : {}
  const request =
    plan.retryRequest ||
    plan.retry_request ||
    result.retryRequest ||
    result.retry_request ||
    result.lastChatResult?.retryRequest ||
    null
  if (!request || typeof request !== 'object') return null
  if (!toSafeText(request.message)) return null
  return toPlainJson(request, null)
}

function resolveExecutionId(task = {}, payload = {}) {
  const plan = task?.plan && typeof task.plan === 'object' ? task.plan : {}
  const result = task?.result && typeof task.result === 'object' ? task.result : {}
  return toSafeText(
    payload.executionId ||
      payload.execution_id ||
      task.executionId ||
      task.execution_id ||
      plan.executionId ||
      plan.execution_id ||
      result.executionId ||
      result.execution_id ||
      result.lastChatResult?.executionId ||
      result.retryResult?.executionId
  )
}

function createRetryExecutionId(taskId = '') {
  const safeTaskId = toSafeText(taskId, 'task').replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `ai-agent-retry-${safeTaskId}-${Date.now()}`
}

function compactAgentResult(result = {}) {
  return toPlainJson(
    {
      success: result?.success !== false,
      configured: result?.configured !== false,
      engine: result?.engine,
      executionId: result?.executionId,
      agentTaskId: result?.agentTaskId,
      outcome: resolveAiAgentOutcome(result),
      error: result.error,
      canRetry: result.canRetry,
      assistantMessage: toSafeText(result?.assistantMessage),
      candidates: Array.isArray(result?.candidates) ? result.candidates : [],
      installPlan: result?.installPlan || null,
      confirmations: Array.isArray(result?.confirmations) ? result.confirmations : [],
      toolCalls: Array.isArray(result?.toolCalls) ? result.toolCalls : []
    },
    {}
  )
}

function createActionState(task = null) {
  const safeTask = task && typeof task === 'object' ? task : null
  const linkedJobId = resolveLinkedJobId(safeTask || {})
  const retryRequest = resolveRetryRequest(safeTask || {})
  const executionId = resolveExecutionId(safeTask || {})
  const stage = toSafeText(safeTask?.stage)
  const terminal = isTaskTerminal(safeTask || {})
  const calls = safeTask?.result?.lastChatResult?.toolCalls
  const safeAnalysisRetry = retryRequest && Array.isArray(calls) && calls.every((call) => call.readonly === true)
  return {
    taskId: toSafeText(safeTask?.taskId),
    linkedJobId,
    hasRetryRequest: Boolean(retryRequest),
    hasExecutionId: Boolean(executionId),
    stage,
    canCancel: Boolean(safeTask?.cancelable && (linkedJobId || executionId) && !terminal),
    canRetry: Boolean(
      (linkedJobId || safeAnalysisRetry) &&
        [AGENT_TASK_ACTION_STAGE.FAILED, AGENT_TASK_ACTION_STAGE.CANCELLED, 'partial'].includes(stage)
    ),
    canRollback: Boolean(
      linkedJobId &&
        [AGENT_TASK_ACTION_STAGE.COMPLETED, AGENT_TASK_ACTION_STAGE.FAILED].includes(stage)
    )
  }
}

async function getTaskDeps(overrides = {}) {
  const deps = {
    ...overrides
  }
  if (
    typeof deps.getAgentTask !== 'function' ||
    typeof deps.updateAgentTask !== 'function' ||
    typeof deps.appendAgentTaskLog !== 'function'
  ) {
    const taskCenter = await import('./taskCenter.js')
    deps.getAgentTask = deps.getAgentTask || taskCenter.getAgentTask
    deps.updateAgentTask = deps.updateAgentTask || taskCenter.updateAgentTask
    deps.appendAgentTaskLog = deps.appendAgentTaskLog || taskCenter.appendAgentTaskLog
  }
  return deps
}

async function resolveAgentTask(payload = {}, deps = {}) {
  const taskId = toSafeText(payload.taskId || payload.task_id)
  if (!taskId) {
    return {
      success: false,
      errorCode: 'missing_agent_task_id',
      message: '缺少 Agent 任务 ID。'
    }
  }
  const task = await deps.getAgentTask(taskId)
  if (!task) {
    return {
      success: false,
      errorCode: 'agent_task_not_found',
      message: 'Agent 任务不存在。'
    }
  }
  return {
    success: true,
    task
  }
}

export function getAgentTaskActionState(task = null) {
  return createActionState(task)
}

export async function cancelAgentTaskAction(payload = {}, event = null, dependencyOverrides = {}) {
  void event
  const deps = await getTaskDeps(dependencyOverrides)
  const resolved = await resolveAgentTask(payload, deps)
  if (!resolved.success) return resolved

  const task = resolved.task
  const linkedJobId = resolveLinkedJobId(task, payload)
  if (isTaskTerminal(task)) {
    return {
      success: false,
      errorCode: 'agent_task_already_finished',
      message: '任务已结束，不能取消。'
    }
  }

  if (!linkedJobId) {
    const executionId = resolveExecutionId(task, payload)
    if (!executionId) {
      return {
        success: false,
        errorCode: 'agent_task_cancel_unsupported',
        message: '当前 Agent 任务没有关联安装任务或 AI 执行 ID，暂不支持取消。'
      }
    }

    const cancelAgentExecution = deps.cancelAgentExecution
    if (typeof cancelAgentExecution !== 'function') {
      return {
        success: false,
        errorCode: 'agent_task_cancel_handler_missing',
        message: '当前环境未注册普通分析任务取消处理器。'
      }
    }

    const result = await cancelAgentExecution({
      taskId: task.taskId,
      agentTaskId: task.taskId,
      executionId
    })
    if (result?.success === false || result?.handled === false) {
      return {
        success: false,
        errorCode: result?.errorCode || 'agent_analysis_cancel_not_running',
        message: result?.message || '取消普通分析任务失败。',
        cancelResult: result
      }
    }

    await deps.appendAgentTaskLog(task.taskId, 'info', '用户从 Agent 任务面板取消普通分析任务', {
      executionId
    })
    const updatedTask = await deps.updateAgentTask(task.taskId, {
      stage: result.cancelRequested ? 'cancelling' : AGENT_TASK_ACTION_STAGE.CANCELLED,
      progress: result.cancelRequested ? Number(task.progress || 0) : 100,
      currentTarget: task.currentTarget,
      cancelable: false,
      result: {
        ...(task.result && typeof task.result === 'object' ? task.result : {}),
        cancelResult: result
      }
    })

    return {
      success: true,
      task: updatedTask,
      executionId,
      cancelResult: result,
      message: result?.message || '任务已取消'
    }
  }

  let cancelTask = deps.cancelSourceInstallTask
  if (typeof cancelTask !== 'function') {
    const sourceInstallTask = await import('../../../ipc/game/source-install-task/orchestrator.js')
    cancelTask = sourceInstallTask.cancelSourceInstallTask
  }
  const result = await cancelTask({ jobId: linkedJobId })
  if (result?.success === false) {
    return {
      success: false,
      errorCode: result.errorCode || 'source_install_cancel_failed',
      message: result.message || '取消安装任务失败。',
      sourceResult: result
    }
  }

  await deps.appendAgentTaskLog(task.taskId, 'info', '用户从 Agent 任务面板取消关联安装任务', {
    linkedJobId
  })
  const updatedTask = await deps.updateAgentTask(task.taskId, {
    stage: AGENT_TASK_ACTION_STAGE.CANCELLED,
    progress: 100,
    currentTarget: task.currentTarget,
    cancelable: false,
    result: {
      ...(task.result && typeof task.result === 'object' ? task.result : {}),
      cancelResult: result
    }
  })

  return {
    success: true,
    task: updatedTask,
    linkedJobId,
    sourceResult: result,
    message: result?.message || '任务已取消'
  }
}

export async function retryAgentTaskAction(payload = {}, event = null, dependencyOverrides = {}) {
  const deps = await getTaskDeps(dependencyOverrides)
  const resolved = await resolveAgentTask(payload, deps)
  if (!resolved.success) return resolved

  const task = resolved.task
  const linkedJobId = resolveLinkedJobId(task, payload)
  const retryRequest = resolveRetryRequest(task)
  const actionState = createActionState(task)

  if (!linkedJobId) {
    if (retryRequest) {
      const previousCalls = task.result?.lastChatResult?.toolCalls
      if (!Array.isArray(previousCalls) || previousCalls.some((call) => call.readonly !== true)) {
        return { success: false, errorCode: 'retry_requires_verification', message: '此前执行包含写操作或缺少执行记录，请先核实任务状态，不能重放整轮操作。' }
      }
      if (!actionState.canRetry) {
        return {
          success: false,
          errorCode: 'agent_task_retry_stage_unsupported',
          message: '当前 Agent 任务状态不支持重试。',
          actionState
        }
      }
      const retryAgentRequest = deps.retryAgentRequest
      if (typeof retryAgentRequest !== 'function') {
        return {
          success: false,
          errorCode: 'agent_task_retry_handler_missing',
          message: '当前环境未注册普通分析任务重试处理器。'
        }
      }

      const retryPayload = toPlainJson(
        {
          ...retryRequest,
          sessionId: toSafeText(retryRequest.sessionId || task.sessionId),
          agentTaskId: task.taskId,
          taskId: task.taskId,
          executionId: toSafeText(payload.executionId) || createRetryExecutionId(task.taskId),
          stream: false,
          readonlyRetry: true
        },
        {}
      )

      await deps.appendAgentTaskLog(task.taskId, 'info', '用户从 Agent 任务面板重试普通分析任务', {
        executionId: retryPayload.executionId
      })
      await deps.updateAgentTask(task.taskId, {
        stage: AGENT_TASK_ACTION_STAGE.QUEUED,
        progress: 0,
        errorCode: '',
        errorMessage: '',
        cancelable: true
      })

      let result
      try {
        result = await retryAgentRequest(retryPayload, event)
      } catch (error) {
        result = {
          success: false,
          assistantMessage: `AI 请求失败：${toSafeText(error?.message) || '未知错误'}`
        }
      }
      const agentResult = compactAgentResult(result)
      const latestTask = (await deps.getAgentTask(task.taskId)) || task
      const nextResult = {
        ...(latestTask.result && typeof latestTask.result === 'object' ? latestTask.result : {}),
        retryResult: agentResult
      }

      if (result?.success === false) {
        const updatedTask = await deps.updateAgentTask(task.taskId, {
          stage: AGENT_TASK_ACTION_STAGE.FAILED,
          progress: 100,
          errorCode: 'agent_analysis_retry_failed',
          errorMessage: agentResult.assistantMessage || '普通分析任务重试失败。',
          cancelable: false,
          result: nextResult
        })
        return {
          success: false,
          task: updatedTask,
          agentResult,
          errorCode: 'agent_analysis_retry_failed',
          message: agentResult.assistantMessage || '普通分析任务重试失败。'
        }
      }

      const updatedTask = await deps.updateAgentTask(task.taskId, {
        stage: agentResult.outcome === 'answered' ? AGENT_TASK_ACTION_STAGE.COMPLETED : agentResult.outcome,
        progress: agentResult.outcome === 'answered' ? 100 : 0,
        errorCode: '',
        errorMessage: '',
        cancelable: false,
        result: nextResult
      })
      return {
        success: true,
        task: updatedTask,
        agentResult,
        message: agentResult.assistantMessage || '普通分析任务已重试。'
      }
    }

    return {
      success: false,
      errorCode: 'agent_task_retry_unsupported',
      message: '当前 Agent 任务没有关联安装任务，暂不支持重试。'
    }
  }
  if (!actionState.canRetry) {
    return {
      success: false,
      errorCode: 'agent_task_retry_stage_unsupported',
      message: '当前 Agent 任务状态不支持重试。',
      actionState
    }
  }

  let retryTask = deps.retrySourceInstallTask
  if (typeof retryTask !== 'function') {
    const sourceInstallTask = await import('../../../ipc/game/source-install-task/orchestrator.js')
    retryTask = sourceInstallTask.retrySourceInstallTask
  }
  const result = await retryTask(createMockEvent(event), { jobId: linkedJobId })
  if (result?.success === false) {
    return {
      success: false,
      errorCode: result.errorCode || 'source_install_retry_failed',
      message: result.message || '重试安装任务失败。',
      sourceResult: result
    }
  }

  await deps.appendAgentTaskLog(task.taskId, 'info', '用户从 Agent 任务面板重试关联安装任务', {
    linkedJobId
  })
  const updatedTask = await deps.updateAgentTask(task.taskId, {
    stage: AGENT_TASK_ACTION_STAGE.QUEUED,
    progress: 0,
    errorCode: '',
    errorMessage: '',
    cancelable: true,
    result: {
      ...(task.result && typeof task.result === 'object' ? task.result : {}),
      retryResult: result
    }
  })

  return {
    success: true,
    task: updatedTask,
    linkedJobId,
    sourceResult: result,
    message: result?.message || '已重新加入安装队列'
  }
}

export async function rollbackAgentTaskAction(payload = {}, _event = null, dependencyOverrides = {}) {
  void _event
  const deps = await getTaskDeps(dependencyOverrides)
  const resolved = await resolveAgentTask(payload, deps)
  if (!resolved.success) return resolved

  const task = resolved.task
  const linkedJobId = resolveLinkedJobId(task, payload)
  if (!linkedJobId) {
    return {
      success: false,
      errorCode: 'agent_task_rollback_unsupported',
      message: '当前 Agent 任务没有关联安装任务，暂不支持回滚。'
    }
  }
  const actionState = createActionState(task)
  if (!actionState.canRollback) {
    return {
      success: false,
      errorCode: 'agent_task_rollback_stage_unsupported',
      message: '当前 Agent 任务状态不支持回滚。',
      actionState
    }
  }

  const createPlan = deps.createRollbackPlan || createRollbackPlan
  const executeRollback = deps.executeRollbackAction || executeRollbackAction
  const plan = await createPlan({ taskId: task.taskId, jobId: linkedJobId })
  if (!plan?.success || !plan.rollbackAvailable || !Array.isArray(plan.actions) || !plan.actions.length) {
    return {
      success: false,
      errorCode: plan?.errorCode || 'rollback_not_available',
      message: plan?.message || '当前任务没有可用回滚计划。',
      plan
    }
  }

  const result = await executeRollback(
    {
      action: plan.actions[0],
      reason: payload.reason || 'agent_task_panel_rollback'
    },
    {
      sessionId: task.sessionId,
      mode: payload.mode || task.authorizationMode || 'full_auto',
      userConfirmed: true
    }
  )
  if (result?.success === false) {
    return {
      success: false,
      errorCode: result.errorCode || 'rollback_failed',
      message: result.message || '回滚执行失败。',
      plan,
      rollbackResult: result
    }
  }

  await deps.appendAgentTaskLog(task.taskId, 'info', '用户从 Agent 任务面板执行回滚', {
    linkedJobId,
    rollbackTaskId: result.taskId
  })
  const updatedTask = await deps.updateAgentTask(task.taskId, {
    stage: AGENT_TASK_ACTION_STAGE.ROLLED_BACK,
    progress: 100,
    cancelable: false,
    result: {
      ...(task.result && typeof task.result === 'object' ? task.result : {}),
      rollbackResult: result
    }
  })

  return {
    success: true,
    task: updatedTask,
    linkedJobId,
    plan,
    rollbackResult: result,
    message: result.message || '任务已回滚。'
  }
}
