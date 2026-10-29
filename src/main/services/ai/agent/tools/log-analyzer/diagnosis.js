// 安装失败分类、建议与单任务诊断。
import { toSafeText, toSafeNumber, toSafeBoolean, getLogWeight, isProblemLog } from './values.js'
import { normalizeFailure, normalizeJob, normalizeItem, normalizeLog } from './records.js'
import { sanitizeToolOutput } from './redaction.js'
import { createInstallErrorSummaries } from './errors.js'
import { createSuspectedMods } from './suspectedMods.js'

const CLASSIFICATION_KIND_WEIGHT = Object.freeze({
  job: 3,
  item: 2,
  log: 1
})

function createClassificationSignal(kind = '', target = {}, job = {}) {
  const message = toSafeText(
    target.failure?.message ||
      target.errorMessage ||
      target.message ||
      target.failure?.detail?.message ||
      job.errorMessage
  )
  const stage = toSafeText(target.failure?.stage || target.failureStage)
  if (!message && !stage) return null
  return {
    kind,
    targetId: target.itemId || target.jobId || target.id || '',
    title: target.title || job.title,
    source: job.source,
    jobId: job.jobId,
    itemId: target.itemId,
    artifactKey: target.artifactKey,
    message,
    stage,
    recoverable: target.failure?.recoverable
  }
}

function classifySignal(signal = {}, classifyInstallFailure) {
  const classification = classifyInstallFailure(
    {
      message: signal.message,
      failureStage: signal.stage
    },
    {
      source: signal.source,
      jobId: signal.jobId,
      itemId: signal.itemId,
      title: signal.title,
      artifactKey: signal.artifactKey,
      message: signal.message,
      stage: signal.stage,
      recoverable: signal.recoverable
    }
  )
  return {
    kind: signal.kind,
    targetId: toSafeText(signal.targetId),
    title: toSafeText(signal.title),
    ...normalizeFailure(classification)
  }
}

function sortClassifications(left = {}, right = {}) {
  const kindDiff =
    (CLASSIFICATION_KIND_WEIGHT[right.kind] || 0) - (CLASSIFICATION_KIND_WEIGHT[left.kind] || 0)
  if (kindDiff !== 0) return kindDiff
  const leftRecoverable = left.recoverable === false ? 1 : 0
  const rightRecoverable = right.recoverable === false ? 1 : 0
  if (leftRecoverable !== rightRecoverable) return rightRecoverable - leftRecoverable
  return toSafeText(left.stage).localeCompare(toSafeText(right.stage))
}

function createSuggestedAction(stage = '', classification = {}) {
  const safeStage = toSafeText(stage)
  const base = {
    stage: safeStage,
    recoverable: classification.recoverable !== false
  }
  if (safeStage === 'unsupported_package') {
    return { ...base, type: 'use_external_tool', title: '按文件用途处理', message: classification.userAction, recoverable: false }
  }
  if (safeStage === 'rule_missed' || safeStage === 'rule_compile_failed') {
    return {
      ...base,
      type: 'inspect_install_rules',
      title: '检查安装规则',
      message: classification.userAction || '检查安装规则后重试。'
    }
  }
  if (safeStage === 'dependency_missing' || safeStage === 'dependency_failed') {
    return {
      ...base,
      type: 'resolve_dependencies',
      title: '重新解析依赖',
      message: classification.userAction || '先补齐依赖，再重试安装任务。'
    }
  }
  if (safeStage === 'conflict_detected') {
    return {
      ...base,
      type: 'detect_conflicts',
      title: '检测并修复文件冲突',
      message: classification.userAction || '处理文件冲突后再重试。'
    }
  }
  if (safeStage === 'deploy_failed') {
    return {
      ...base,
      type: 'check_file_occupancy',
      title: '检查权限或文件占用',
      message: classification.userAction || '检查目录权限和文件占用后重试。'
    }
  }
  if (safeStage === 'download_failed' || safeStage === 'archive_inspect_failed') {
    return {
      ...base,
      type: 'retry_install_task',
      title: '重试安装任务',
      message: classification.userAction || '修复下载或压缩包问题后重试。'
    }
  }
  if (safeStage === 'health_check_failed') {
    return {
      ...base,
      type: 'inspect_health_check',
      title: '查看安装后校验',
      message: classification.userAction || '查看健康检查详情后重试。'
    }
  }
  return {
    ...base,
    type: 'collect_more_logs',
    title: '补充诊断信息',
    message: classification.userAction || '查看错误日志后重试。'
  }
}

function summarizeClassifications(classifications = []) {
  const stageCounts = {}
  for (const item of classifications) {
    const stage = toSafeText(item.stage, 'unknown_failed')
    stageCounts[stage] = (stageCounts[stage] || 0) + 1
  }
  return stageCounts
}

export function analyzeInstallJobDetail(detail = {}, options = {}) {
  const job = normalizeJob(detail)
  const items = (Array.isArray(detail.items) ? detail.items : []).map(normalizeItem)
  const logs = (Array.isArray(detail.logs) ? detail.logs : []).map(normalizeLog)
  const includeInfoLogs = toSafeBoolean(options.includeInfoLogs, false)
  const logLimit = Math.max(1, Math.min(200, toSafeNumber(options.logLimit, 50)))
  const classifyInstallFailure =
    typeof options.classifyInstallFailure === 'function'
      ? options.classifyInstallFailure
      : () => ({
          stage: 'unknown_failed',
          message: '缺少失败分类器',
          userAction: '查看错误日志后重试',
          recoverable: true,
          detail: {}
        })

  const signals = []
  const jobSignal = createClassificationSignal('job', job, job)
  if (jobSignal) signals.push(jobSignal)
  for (const item of items) {
    const itemSignal = createClassificationSignal('item', item, job)
    if (itemSignal) signals.push(itemSignal)
  }
  for (const log of logs.filter(isProblemLog)) {
    signals.push({
      kind: 'log',
      targetId: String(log.id || log.itemId || ''),
      title: log.itemId || job.title,
      source: job.source,
      jobId: job.jobId,
      itemId: log.itemId,
      message: log.message,
      stage: '',
      recoverable: undefined
    })
  }

  const classifications = signals
    .map((signal) => classifySignal(signal, classifyInstallFailure))
    .filter((item) => item.message || item.stage)
    .sort(sortClassifications)
  const primaryFailure =
    classifications[0] ||
    normalizeFailure(job.failure, {
      stage: job.failureStage || 'unknown_failed',
      message: job.errorMessage || '未发现明确失败信息'
    })
  const failedItems = items
    .filter((item) => item.state === 'failed' || item.failureStage || item.errorMessage)
    .map((item) => {
      const classification =
        classifications.find((entry) => entry.kind === 'item' && entry.targetId === item.itemId) ||
        {}
      return {
        itemId: item.itemId,
        title: item.title,
        version: item.version,
        state: item.state,
        sourceModKey: item.sourceModKey,
        dependencyKey: item.dependencyKey,
        installKey: item.installKey,
        artifactKey: item.artifactKey,
        failureStage: item.failureStage || classification.stage,
        message: item.errorMessage || classification.message || item.failure.message,
        recoverable: classification.recoverable,
        userAction: classification.userAction
      }
    })
  const problemLogs = logs
    .filter((log) => includeInfoLogs || isProblemLog(log))
    .sort(
      (left, right) => getLogWeight(right.level) - getLogWeight(left.level) || right.id - left.id
    )
    .slice(0, logLimit)
  const suggestedActions = Object.entries(summarizeClassifications(classifications))
    .sort((left, right) => right[1] - left[1])
    .map(([stage]) =>
      createSuggestedAction(
        stage,
        classifications.find((item) => item.stage === stage) || primaryFailure
      )
    )
  const errors = createInstallErrorSummaries({
    job,
    failedItems,
    classifications,
    problemLogs,
    primaryFailure
  })
  const suspectedMods = createSuspectedMods({
    job,
    items,
    failedItems,
    classifications,
    problemLogs
  })

  return sanitizeToolOutput({
    job,
    summary: {
      jobId: job.jobId,
      title: job.title,
      source: job.source,
      state: job.state,
      failedItemCount: failedItems.length,
      warningLogCount: logs.filter((log) => log.level === 'warn').length,
      errorLogCount: logs.filter((log) => log.level === 'error').length,
      primaryFailureStage: primaryFailure.stage,
      recoverable: primaryFailure.recoverable !== false
    },
    primaryFailure,
    failureStageCounts: summarizeClassifications(classifications),
    failedItems,
    errors,
    suspectedMods,
    classifications: classifications.slice(0, 20),
    logSamples: problemLogs,
    suggestedActions: suggestedActions.slice(0, 8)
  })
}
