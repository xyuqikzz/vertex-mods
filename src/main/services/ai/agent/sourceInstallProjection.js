import { createAgentTaskProjectionFromSourceInstallJob } from '../../../../shared/ai/installation/ai-agent-install-projection.js'
import {
  applyDownloadedArtifactsToInstallPlan,
  summarizeAgentInstallPlan,
  shouldRefreshAgentStandardPreflight
} from '../../../../shared/ai/installation/ai-agent-standard-preflight-refresh.js'

const activePreflightRefreshes = new Set()

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function toPlainObject(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function resolvePlan(task = {}) {
  return toPlainObject(task.plan)
}

function shouldSkipRepeatedPreflightRefresh(previousRefresh = {}, filePathKey = '') {
  if (previousRefresh.attempted !== true || previousRefresh.filePathKey !== filePathKey) {
    return false
  }
  const status = toSafeText(previousRefresh.status)
  const reason = toSafeText(previousRefresh.reason)
  return !(status === 'skipped' && (!reason || reason === 'missing_archive' || reason === 'archive_not_found'))
}

function getProjectionDeps(options = {}) {
  return {
    getAgentTask: options.getAgentTask || getDefaultAgentTask,
    updateAgentTask: options.updateAgentTask || updateDefaultAgentTask,
    appendAgentTaskLog: options.appendAgentTaskLog || appendDefaultAgentTaskLog,
    runStandardPreflight: options.runStandardPreflight
  }
}

async function getTaskCenter() {
  return import('./taskCenter.js')
}

async function getDefaultAgentTask(taskId = '') {
  const taskCenter = await getTaskCenter()
  return taskCenter.getAgentTask(taskId)
}

async function updateDefaultAgentTask(taskId = '', patch = {}) {
  const taskCenter = await getTaskCenter()
  return taskCenter.updateAgentTask(taskId, patch)
}

async function appendDefaultAgentTaskLog(taskId = '', level = 'info', message = '', detail = {}) {
  const taskCenter = await getTaskCenter()
  return taskCenter.appendAgentTaskLog(taskId, level, message, detail)
}

async function runDefaultStandardPreflight(request = {}) {
  const runner = await import('./tools/standardPreflightRunner.js')
  return runner.runStandardPreflightIfPossible(request)
}

export async function refreshAgentTaskStandardPreflightFromSourceInstallJob(
  detail = {},
  options = {}
) {
  const deps = getProjectionDeps(options)
  const projection = createAgentTaskProjectionFromSourceInstallJob(detail)
  if (!projection) return null

  const task = options.task || (await deps.getAgentTask(projection.agentTaskId))
  if (!task || !shouldRefreshAgentStandardPreflight(task)) return null

  const patched = applyDownloadedArtifactsToInstallPlan(resolvePlan(task), detail)
  if (!patched.changed) return null

  const filePathKey = patched.filePaths.join('|')
  const previousRefresh = toPlainObject(toPlainObject(task.result).standardPreflightRefresh)
  if (shouldSkipRepeatedPreflightRefresh(previousRefresh, filePathKey)) {
    return null
  }

  const refreshKey = `${projection.agentTaskId}:${projection.linkedJobId}:${filePathKey}`
  if (activePreflightRefreshes.has(refreshKey)) return null
  activePreflightRefreshes.add(refreshKey)

  try {
    const runStandardPreflight = deps.runStandardPreflight || runDefaultStandardPreflight
    const standardPreflight = await runStandardPreflight({
      candidate: patched.plan.candidate || {},
      context: patched.plan.context || {},
      plan: patched.plan,
      event: options.event || null
    })
    const refreshedPlan = {
      ...patched.plan,
      standardPreflight
    }
    const refreshedTask = await deps.updateAgentTask(projection.agentTaskId, {
      plan: refreshedPlan,
      result: {
        ...toPlainObject(task.result),
        standardPreflight,
        planSummary: summarizeAgentInstallPlan(refreshedPlan),
        standardPreflightRefresh: {
          attempted: true,
          jobId: projection.linkedJobId,
          filePathKey,
          filePaths: patched.filePaths,
          status: toSafeText(standardPreflight?.status),
          reason: toSafeText(standardPreflight?.reason),
          refreshedAt: new Date().toISOString()
        }
      }
    })
    await deps.appendAgentTaskLog(projection.agentTaskId, 'info', '下载完成后已刷新标准安装预检', {
      linkedJobId: projection.linkedJobId,
      status: toSafeText(standardPreflight?.status),
      reason: toSafeText(standardPreflight?.reason),
      fileCount: patched.filePaths.length
    })
    return refreshedTask
  } finally {
    activePreflightRefreshes.delete(refreshKey)
  }
}

export async function projectSourceInstallJobToAgentTask(detail = {}, options = {}) {
  const deps = getProjectionDeps(options)
  const projection = createAgentTaskProjectionFromSourceInstallJob(detail)
  if (!projection) return null

  const existingTask = await deps.getAgentTask(projection.agentTaskId)
  if (!existingTask) return null

  const projectedTask = await deps.updateAgentTask(projection.agentTaskId, {
    stage: projection.stage,
    progress: projection.progress,
    currentTarget: projection.currentTarget,
    errorCode: projection.errorCode,
    errorMessage: projection.errorMessage,
    linkedJobId: projection.linkedJobId,
    result: {
      ...toPlainObject(existingTask.result),
      sourceInstallJob: projection.sourceInstallJob
    }
  })
  return (
    (await refreshAgentTaskStandardPreflightFromSourceInstallJob(detail, {
      ...options,
      task: projectedTask
    })) || projectedTask
  )
}
