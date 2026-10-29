const SOURCE_JOB_STAGE_TO_AGENT_STAGE = Object.freeze({
  created: 'queued',
  prechecking: 'inspecting',
  precheck_blocked: 'failed',
  resolving: 'resolving_dependencies',
  queued: 'queued',
  downloading: 'downloading',
  downloaded: 'inspecting',
  previewing: 'planning',
  installing: 'installing',
  health_checking: 'verifying',
  completed: 'completed',
  completed_with_warning: 'completed',
  partial_failed: 'failed',
  failed: 'failed',
  paused: 'queued',
  cancelled: 'cancelled',
  waiting_user_action: 'queued',
  waiting: 'queued',
  recoverable: 'failed'
})

const TERMINAL_SOURCE_JOB_STATES = new Set([
  'completed',
  'completed_with_warning',
  'partial_failed',
  'failed',
  'precheck_blocked',
  'cancelled'
])

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clampProgress(value, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(toSafeNumber(value, fallback))))
}

function compactItems(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
    itemId: toSafeText(item?.item_id || item?.itemId),
    title: toSafeText(item?.title),
    state: toSafeText(item?.state),
    progress: clampProgress(item?.progress),
    errorMessage: toSafeText(item?.error_message || item?.errorMessage)
  }))
}

function summarizeItems(items = []) {
  const summary = {
    totalCount: 0,
    successCount: 0,
    skippedCount: 0,
    failedCount: 0
  }

  const itemList = Array.isArray(items) ? items : []
  itemList.forEach((item) => {
    const state = toSafeText(item?.state)
    if (!state) return
    summary.totalCount += 1
    if (['installed', 'file_ready', 'completed', 'completed_with_warning'].includes(state)) {
      summary.successCount += 1
      return
    }
    if (['skipped_installed', 'skipped', 'already_installed', 'reused'].includes(state)) {
      summary.skippedCount += 1
      return
    }
    if (['failed', 'precheck_blocked', 'cancelled'].includes(state)) {
      summary.failedCount += 1
    }
  })

  return summary
}

export function resolveAgentStageFromSourceInstallState(state = '') {
  const safeState = toSafeText(state)
  return SOURCE_JOB_STAGE_TO_AGENT_STAGE[safeState] || 'queued'
}

export function createAgentTaskProjectionFromSourceInstallJob(detail = {}) {
  const job = detail?.job && typeof detail.job === 'object' ? detail.job : detail
  const agentTaskId = toSafeText(job?.agent_task_id || job?.agentTaskId)
  const jobId = toSafeText(job?.job_id || job?.jobId)

  if (!agentTaskId || !jobId) {
    return null
  }

  const state = toSafeText(job?.state)
  const failureStage = toSafeText(job?.failure_stage || job?.failureStage)
  const errorMessage = toSafeText(job?.error_message || job?.errorMessage)
  const currentStep = toSafeText(job?.current_step || job?.currentStep)
  const title = toSafeText(job?.title, '安装任务')
  const items = Array.isArray(detail?.items) ? detail.items : []

  return {
    agentTaskId,
    linkedJobId: jobId,
    stage: resolveAgentStageFromSourceInstallState(state),
    progress: clampProgress(job?.progress),
    currentTarget: currentStep ? `${title} · ${currentStep}` : title,
    errorCode: failureStage,
    errorMessage,
    terminal: TERMINAL_SOURCE_JOB_STATES.has(state),
    sourceInstallJob: {
      jobId,
      source: toSafeText(job?.source),
      sourceAdapter: toSafeText(job?.source_adapter || job?.sourceAdapter),
      gameKey: toSafeText(job?.game_key || job?.gameKey),
      title,
      state,
      progress: clampProgress(job?.progress),
      currentStep,
      errorMessage,
      failureStage,
      precheckStatus: toSafeText(job?.precheck_status || job?.precheckStatus),
      warningCount: toSafeNumber(job?.warning_count || job?.warningCount, 0),
      blockerCount: toSafeNumber(job?.blocker_count || job?.blockerCount, 0),
      itemCount: items.length,
      installSummary: summarizeItems(items),
      items: compactItems(items),
      updatedAt: toSafeText(job?.updated_at || job?.updatedAt),
      completedAt: toSafeText(job?.completed_at || job?.completedAt)
    }
  }
}
