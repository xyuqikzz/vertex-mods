// 任务、条目、失败与日志记录归一化。
import { toSafeText, toPlainJson, toSafeNumber, truncateText, normalizeLogLevel } from './values.js'

export function normalizeFailure(value = {}, fallback = {}) {
  const failure = toPlainJson(value, {})
  return {
    stage: toSafeText(failure.stage || fallback.stage),
    message: toSafeText(failure.message || fallback.message),
    userAction: toSafeText(failure.userAction || fallback.userAction),
    recoverable:
      typeof failure.recoverable === 'boolean' ? failure.recoverable : fallback.recoverable,
    detail: toPlainJson(failure.detail || fallback.detail, {})
  }
}

export function normalizeJob(detail = {}) {
  const job = detail.job && typeof detail.job === 'object' ? detail.job : detail
  return {
    jobId: toSafeText(job.job_id || job.jobId || detail.job_id || detail.jobId),
    agentTaskId: toSafeText(job.agent_task_id || job.agentTaskId || detail.agent_task_id),
    source: toSafeText(job.source || detail.source),
    sourceAdapter: toSafeText(job.source_adapter || job.sourceAdapter || detail.source_adapter),
    gameKey: toSafeText(job.game_key || job.gameKey || detail.game_key),
    title: toSafeText(job.title || detail.title, '安装任务'),
    state: toSafeText(job.state || detail.state),
    progress: toSafeNumber(job.progress ?? detail.progress),
    currentStep: toSafeText(job.current_step || job.currentStep || detail.current_step),
    errorMessage: toSafeText(job.error_message || job.errorMessage || detail.error_message),
    failureStage: toSafeText(job.failure_stage || job.failureStage || detail.failure_stage),
    failure: normalizeFailure(job.failure || detail.failure, {
      stage: job.failure_stage || detail.failure_stage,
      message: job.error_message || detail.error_message
    }),
    healthStatus: toSafeText(job.health_status || job.healthStatus || detail.health_status),
    warningCount: toSafeNumber(job.warning_count || job.warningCount || detail.warning_count),
    blockerCount: toSafeNumber(job.blocker_count || job.blockerCount || detail.blocker_count),
    createdAt: toSafeText(job.created_at || job.createdAt || detail.created_at),
    updatedAt: toSafeText(job.updated_at || job.updatedAt || detail.updated_at),
    completedAt: toSafeText(job.completed_at || job.completedAt || detail.completed_at)
  }
}

export function normalizeItem(item = {}) {
  return {
    itemId: toSafeText(item.item_id || item.itemId),
    itemType: toSafeText(item.item_type || item.itemType),
    sourceModKey: toSafeText(item.source_mod_key || item.sourceModKey),
    dependencyKey: toSafeText(item.dependency_key || item.dependencyKey),
    installKey: toSafeText(item.install_key || item.installKey),
    artifactKey: toSafeText(item.artifact_key || item.artifactKey),
    title: toSafeText(item.title, '安装项'),
    version: toSafeText(item.version),
    state: toSafeText(item.state),
    progress: toSafeNumber(item.progress),
    errorMessage: toSafeText(item.error_message || item.errorMessage),
    failureStage: toSafeText(item.failure_stage || item.failureStage),
    failure: normalizeFailure(item.failure, {
      stage: item.failure_stage || item.failureStage,
      message: item.error_message || item.errorMessage
    }),
    healthStatus: toSafeText(item.health_status || item.healthStatus),
    transactionId: toSafeText(
      item.transaction_id || item.transactionId || item.transaction?.transactionId
    )
  }
}

export function normalizeLog(log = {}) {
  return {
    id: toSafeNumber(log.id),
    itemId: toSafeText(log.item_id || log.itemId),
    level: normalizeLogLevel(log.level),
    message: truncateText(log.message, 600),
    detail: toPlainJson(log.detail || log.detail_json, {}),
    createdAt: toSafeText(log.created_at || log.createdAt)
  }
}
