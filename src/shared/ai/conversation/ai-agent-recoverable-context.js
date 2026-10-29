const MAX_RECENT_CONFIRMATIONS = 6
const MAX_RECENT_TASKS = 6
const MAX_RECENT_CANDIDATES = 5

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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = toSafeText(value)
    if (text) return text
  }
  return ''
}

function normalizeInstallPlanSummary(plan = null) {
  if (!isPlainObject(plan)) return null
  return {
    modName: pickFirstText(plan.modName, plan.name, plan.title),
    source: pickFirstText(plan.businessSource, plan.source, plan.sourcePlatform),
    sourceLabel: pickFirstText(plan.businessSourceLabel, plan.sourceLabel),
    version: pickFirstText(plan.version, plan.fileVersion, plan.fileName),
    agentTaskId: pickFirstText(plan.agentTaskId, plan.taskId),
    linkedJobId: pickFirstText(plan.linkedJobId, plan.jobId),
    submitted: plan.submitted === true,
    completed: plan.completed === true,
    standardPreflight: isPlainObject(plan.standardPreflight)
      ? {
          status: toSafeText(plan.standardPreflight.status),
          source: toSafeText(plan.standardPreflight.source),
          payloadHash: toSafeText(plan.standardPreflight.payloadHash)
            ? '[available]'
            : '',
          errorCode: toSafeText(plan.standardPreflight.errorCode),
          message: toSafeText(plan.standardPreflight.message)
        }
      : null
  }
}

function normalizeTaskSummary(task = {}) {
  if (!isPlainObject(task)) return null
  return {
    taskId: pickFirstText(task.taskId, task.agentTaskId),
    linkedJobId: pickFirstText(task.linkedJobId, task.linked_job_id, task.jobId),
    stage: toSafeText(task.stage),
    progress: Number.isFinite(Number(task.progress)) ? Math.round(Number(task.progress)) : 0,
    currentTarget: pickFirstText(task.currentTarget, task.current_target),
    errorCode: pickFirstText(task.errorCode, task.error_code),
    errorMessage: pickFirstText(task.errorMessage, task.error_message),
    updatedAt: pickFirstText(task.updatedAt, task.updated_at)
  }
}

function normalizeCandidateSummary(candidate = {}) {
  if (!isPlainObject(candidate)) return null
  return {
    id: pickFirstText(candidate.id, candidate.modId, candidate.packageName, candidate.fullName),
    name: pickFirstText(candidate.name, candidate.title, candidate.packageName, candidate.fullName),
    source: pickFirstText(candidate.businessSource, candidate.source, candidate.sourcePlatform),
    version: pickFirstText(candidate.version, candidate.versionNumber)
  }
}

export function collectAiAgentRecentConfirmations(messages = []) {
  const confirmations = []
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const confirmation of Array.isArray(message?.confirmations) ? message.confirmations : []) {
      if (!isPlainObject(confirmation)) continue
      confirmations.push({
        id: toSafeText(confirmation.id),
        toolName: toSafeText(confirmation.toolName),
        status: toSafeText(confirmation.status, 'pending'),
        mode: toSafeText(confirmation.mode),
        executionId: toSafeText(confirmation.executionId),
        approvedAt: toSafeText(confirmation.approvedAt),
        cancelledAt: toSafeText(confirmation.cancelledAt),
        message: toSafeText(confirmation.message)
      })
    }
  }
  return confirmations.slice(-MAX_RECENT_CONFIRMATIONS)
}

// 普通对话轮次也会登记为 analyze 任务；它们的失败原因只属于当时那一轮（例如已修好的模型配置）。
// 带进新请求会被模型当作当前故障，不调用工具就直接复述旧错误，所以只保留真实的执行类任务。
function isConversationTurnTask(task = {}) {
  return toSafeText(task?.type) === 'analyze'
}

export function buildAiAgentRecoverableContext(baseContext = {}, state = {}) {
  const context = toPlainJson(baseContext, {})
  const relevantTasks = (Array.isArray(state.agentTasks) ? state.agentTasks : []).filter(
    (task) => isPlainObject(task) && !isConversationTurnTask(task)
  )
  const tasks = relevantTasks
    .map((task) => normalizeTaskSummary(task))
    .filter(Boolean)
    .slice(0, MAX_RECENT_TASKS)
  const candidates = (Array.isArray(state.candidates) ? state.candidates : [])
    .map((candidate) => normalizeCandidateSummary(candidate))
    .filter(Boolean)
    .slice(0, MAX_RECENT_CANDIDATES)
  const conversationState = {
    installPlan: normalizeInstallPlanSummary(state.installPlan),
    recentConfirmations: collectAiAgentRecentConfirmations(state.messages),
    recentTasks: tasks,
    recentCandidates: candidates,
    candidateCount: Array.isArray(state.candidates) ? state.candidates.length : 0,
    taskCount: relevantTasks.length
  }

  return {
    ...context,
    conversationState
  }
}
