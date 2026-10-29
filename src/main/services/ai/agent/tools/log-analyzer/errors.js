// 安装与外部日志的错误摘要归并。
import {
  toSafeText,
  toSafeNumber,
  truncateText,
  normalizeLogLevel,
  isProblemLog
} from './values.js'

export const MAX_ERROR_SUMMARIES = 40

function createErrorSummary(source = '', data = {}) {
  const message = truncateText(
    data.message || data.errorMessage || data.failure?.message || data.detail?.message,
    700
  )
  const stage = toSafeText(data.stage || data.failureStage || data.failure?.stage)
  if (!message && !stage) return null
  return {
    source: toSafeText(source, 'install_task'),
    sourceType: toSafeText(data.sourceType),
    level: normalizeLogLevel(data.level || (data.recoverable === false ? 'error' : 'warn')),
    jobId: toSafeText(data.jobId),
    itemId: toSafeText(data.itemId),
    title: toSafeText(data.title),
    artifactKey: toSafeText(data.artifactKey),
    stage,
    message,
    recoverable: typeof data.recoverable === 'boolean' ? data.recoverable : null,
    filePath: toSafeText(data.filePath),
    lineNumber: toSafeNumber(data.lineNumber),
    createdAt: toSafeText(data.createdAt)
  }
}

function getErrorKey(error = {}) {
  return [
    error.source,
    error.jobId,
    error.itemId,
    error.artifactKey,
    error.stage,
    error.filePath,
    error.lineNumber,
    error.message
  ].join('|')
}

export function uniqueErrors(errors = []) {
  const seen = new Set()
  const result = []
  for (const error of errors) {
    if (!error) continue
    const key = getErrorKey(error)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(error)
  }
  return result
}

export function createInstallErrorSummaries(context = {}) {
  const {
    job = {},
    failedItems = [],
    classifications = [],
    problemLogs = [],
    primaryFailure = {}
  } = context
  const errors = []
  errors.push(
    createErrorSummary('install_task', {
      jobId: job.jobId,
      title: job.title,
      level: 'error',
      stage: primaryFailure.stage,
      message: primaryFailure.message,
      recoverable: primaryFailure.recoverable
    })
  )

  for (const item of failedItems) {
    errors.push(
      createErrorSummary('install_task', {
        jobId: job.jobId,
        itemId: item.itemId,
        title: item.title,
        artifactKey: item.artifactKey,
        level: 'error',
        stage: item.failureStage,
        message: item.message,
        recoverable: item.recoverable
      })
    )
  }

  for (const classification of classifications) {
    errors.push(
      createErrorSummary('install_classifier', {
        jobId: job.jobId,
        itemId: classification.kind === 'item' ? classification.targetId : '',
        title: classification.title,
        level: classification.recoverable === false ? 'error' : 'warn',
        stage: classification.stage,
        message: classification.message,
        recoverable: classification.recoverable
      })
    )
  }

  for (const log of problemLogs) {
    errors.push(
      createErrorSummary('install_log', {
        jobId: job.jobId,
        itemId: log.itemId,
        title: log.itemId || job.title,
        level: log.level,
        message: log.message,
        createdAt: log.createdAt
      })
    )
  }

  return uniqueErrors(errors).slice(0, MAX_ERROR_SUMMARIES)
}

export function createExternalLogErrorSummaries(samples = []) {
  return uniqueErrors(
    samples.filter(isProblemLog).map((sample) =>
      createErrorSummary('external_log', {
        sourceType: sample.sourceType,
        filePath: sample.filePath,
        lineNumber: sample.lineNumber,
        level: sample.level,
        message: sample.message
      })
    )
  ).slice(0, MAX_ERROR_SUMMARIES)
}
