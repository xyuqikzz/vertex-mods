import { analyzeInstallJobDetail } from './logAnalyzerTool.js'
import { inspectPackageInstallability } from '../../../packageInstallability.js'
import { INSTALL_FAILURE_RECOVERY_INSTRUCTIONS } from '../../../../../shared/installation/install-failure-recovery.js'

const DEFAULT_LOG_LIMIT = 20
const MAX_LOG_LIMIT = 80
const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session/i
const PRIVATE_LOCATION_KEY_PATTERN =
  /download.?url|file.?path|target.?path|game.?root|root.?path|install.?root|private.?paths|path.?list/i
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function toSafeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function clampLimit(value, fallback = DEFAULT_LOG_LIMIT, max = MAX_LOG_LIMIT) {
  return Math.max(1, Math.min(max, toSafeNumber(value, fallback)))
}

function truncateText(value = '', maxLength = 500) {
  const text = toSafeText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function redactText(value = '') {
  return truncateText(value, 800)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function hasConfiguredValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(toSafeText(value))
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (PRIVATE_LOCATION_KEY_PATTERN.test(key)) {
    return hasConfiguredValue(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)).filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
      continue
    }
    if (PRIVATE_LOCATION_KEY_PATTERN.test(entryKey)) {
      result[`${entryKey}Configured`] = hasConfiguredValue(entryValue)
      continue
    }
    const sanitized = sanitizeValue(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
}

function resolveDetailPayload(detailResult = {}) {
  return detailResult?.data || detailResult?.detail || detailResult
}

async function resolveDetail(args = {}, dependencyOverrides = {}) {
  if (typeof dependencyOverrides.getSourceInstallTaskDetail === 'function') {
    return await dependencyOverrides.getSourceInstallTaskDetail(args)
  }
  const module = await import('../../../../ipc/game/source-install-task/orchestrator.js')
  return await module.getSourceInstallTaskDetail(args)
}

async function resolveClassifyInstallFailure(dependencyOverrides = {}) {
  if (typeof dependencyOverrides.classifyInstallFailure === 'function') {
    return dependencyOverrides.classifyInstallFailure
  }
  const module = await import('../../../../ipc/game/source-install-task/failureClassifier.js')
  return module.classifyInstallFailure
}

function normalizeDetailJob(detail = {}) {
  const job = detail?.job && typeof detail.job === 'object' ? detail.job : detail
  return {
    jobId: toSafeText(job.job_id || job.jobId || detail.job_id || detail.jobId),
    agentTaskId: toSafeText(job.agent_task_id || job.agentTaskId || detail.agent_task_id),
    source: toSafeText(job.source || detail.source),
    sourceAdapter: toSafeText(job.source_adapter || job.sourceAdapter || detail.source_adapter),
    gameKey: toSafeText(job.game_key || job.gameKey || detail.game_key),
    title: toSafeText(job.title || detail.title),
    state: toSafeText(job.state || detail.state),
    progress: toSafeNumber(job.progress ?? detail.progress),
    currentStep: toSafeText(job.current_step || job.currentStep || detail.current_step),
    errorMessage: truncateText(job.error_message || job.errorMessage || detail.error_message, 500),
    precheckStatus: toSafeText(job.precheck_status || job.precheckStatus || detail.precheck_status),
    failureStage: toSafeText(job.failure_stage || job.failureStage || detail.failure_stage),
    healthStatus: toSafeText(job.health_status || job.healthStatus || detail.health_status),
    warningCount: toSafeNumber(job.warning_count || job.warningCount || detail.warning_count),
    blockerCount: toSafeNumber(job.blocker_count || job.blockerCount || detail.blocker_count),
    updatedAt: toSafeText(job.updated_at || job.updatedAt || detail.updated_at),
    completedAt: toSafeText(job.completed_at || job.completedAt || detail.completed_at)
  }
}

function normalizeProblemItem(item = {}) {
  return {
    itemId: toSafeText(item.itemId || item.item_id),
    title: toSafeText(item.title, '安装项'),
    version: toSafeText(item.version),
    state: toSafeText(item.state),
    sourceModKey: toSafeText(item.sourceModKey || item.source_mod_key),
    dependencyKey: toSafeText(item.dependencyKey || item.dependency_key),
    artifactKey: toSafeText(item.artifactKey || item.artifact_key),
    stage: toSafeText(item.failureStage || item.failure_stage),
    message: truncateText(item.message || item.errorMessage || item.error_message, 500),
    recoverable: item.recoverable !== false,
    userAction: truncateText(item.userAction, 300)
  }
}

function createBlockers(analysis = {}, detail = {}) {
  const blockers = []
  const primary = analysis.primaryFailure || {}
  const job = normalizeDetailJob(detail)
  if (primary.message || primary.stage) {
    blockers.push({
      code: toSafeText(primary.stage, 'install_task_failed'),
      section: 'job',
      jobId: analysis.summary?.jobId || job.jobId,
      title: job.title || analysis.job?.title,
      message: truncateText(primary.message || job.errorMessage, 500),
      recoverable: primary.recoverable !== false,
      userAction: truncateText(primary.userAction, 300)
    })
  }
  for (const item of analysis.failedItems || []) {
    blockers.push({
      code: toSafeText(item.failureStage, 'install_item_failed'),
      section: 'item',
      ...normalizeProblemItem(item)
    })
  }
  const precheck = detail.precheck || detail.job?.precheck || {}
  const precheckBlockers = Array.isArray(precheck.blockers)
    ? precheck.blockers
    : Array.isArray(precheck.errors)
      ? precheck.errors
      : []
  for (const blocker of precheckBlockers.slice(0, 10)) {
    blockers.push({
      code: toSafeText(blocker.code || blocker.reason, 'precheck_blocked'),
      section: 'precheck',
      message: truncateText(blocker.message || blocker.label || blocker.reason, 500),
      recoverable: blocker.recoverable !== false
    })
  }
  return uniqueByKey(blockers, (item) =>
    [item.section, item.code, item.itemId, item.message].filter(Boolean).join('|')
  ).slice(0, 20)
}

function createWarnings(analysis = {}, detail = {}) {
  const warnings = []
  const job = normalizeDetailJob(detail)
  if (job.warningCount > 0) {
    warnings.push({
      code: 'install_task_warnings',
      section: 'job',
      message: `任务记录包含 ${job.warningCount} 条警告。`
    })
  }
  if (analysis.summary?.warningLogCount > 0) {
    warnings.push({
      code: 'warning_logs_found',
      section: 'logs',
      message: `任务日志包含 ${analysis.summary.warningLogCount} 条 warning 级记录。`
    })
  }
  if (job.healthStatus && job.healthStatus !== 'passed') {
    warnings.push({
      code: 'health_check_attention',
      section: 'health',
      message: `安装健康检查状态为 ${job.healthStatus}。`
    })
  }
  if (!analysis.primaryFailure?.message && !analysis.primaryFailure?.stage) {
    warnings.push({
      code: 'missing_failure_detail',
      section: 'job',
      message: '任务没有记录明确的失败阶段或错误消息，需要补充日志。'
    })
  }
  return warnings.slice(0, 20)
}

function resolveActionTool(type = '') {
  const actionTools = {
    inspect_install_rules: 'vertex.install_rule.reference_docs',
    resolve_dependencies: 'vertex.install.resolve_dependencies',
    detect_conflicts: 'vertex.conflict.detect',
    retry_install_task: 'vertex.install.control_task',
    inspect_health_check: 'vertex.install.task_timeline',
    check_file_occupancy: 'vertex.install.task_timeline',
    collect_more_logs: 'vertex.log.analyze'
  }
  return actionTools[type] || ''
}

function createNextActions(analysis = {}, jobId = '') {
  const actions = []
  for (const action of analysis.suggestedActions || []) {
    const type = toSafeText(action.type, 'collect_more_logs')
    actions.push({
      type,
      label: toSafeText(action.title, '查看诊断信息'),
      stage: toSafeText(action.stage),
      message: truncateText(action.message, 400),
      recoverable: action.recoverable !== false,
      tool: resolveActionTool(type)
    })
  }
  if (
    analysis.summary?.recoverable !== false &&
    !['rule_missed', 'rule_compile_failed', 'unsupported_package'].includes(
      analysis.summary?.primaryFailureStage
    )
  ) {
    actions.push({
      type: 'retry_install_task',
      label: '重试安装任务',
      stage: toSafeText(analysis.summary?.primaryFailureStage),
      message: '修复上述问题后，可通过安装任务控制工具重试该任务。',
      recoverable: true,
      tool: 'vertex.install.control_task',
      args: {
        jobId,
        action: 'retry'
      }
    })
  }
  actions.push({
    type: 'read_task_timeline',
    label: '查看任务时间线',
    stage: toSafeText(analysis.summary?.primaryFailureStage),
    message: '需要复盘执行顺序时，读取该任务的时间线和最近日志。',
    recoverable: true,
    tool: 'vertex.install.task_timeline',
    args: {
      jobId
    }
  })
  return uniqueByKey(actions, (item) => [item.type, item.stage, item.tool].join('|')).slice(0, 8)
}

function createEvidence(analysis = {}, logLimit = DEFAULT_LOG_LIMIT) {
  return {
    errors: (analysis.errors || []).slice(0, 20).map((item) => sanitizeValue(item)),
    classifications: (analysis.classifications || [])
      .slice(0, 12)
      .map((item) => sanitizeValue(item)),
    logSamples: (analysis.logSamples || []).slice(0, logLimit).map((item) => sanitizeValue(item))
  }
}

function uniqueByKey(items = [], getKey = (item) => JSON.stringify(item)) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export async function getInstallFailureDiagnoseTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  const jobId = toSafeText(args.jobId || args.job_id)
  if (!jobId) {
    return {
      success: false,
      errorCode: 'missing_job_id',
      message: '缺少安装任务 jobId，请先调用 vertex.install.tasks。'
    }
  }

  const detailResult = await resolveDetail({ jobId }, dependencyOverrides)
  if (detailResult?.success === false) {
    return {
      success: false,
      errorCode: detailResult.errorCode || 'install_task_not_found',
      jobId,
      message: detailResult.message || '安装任务不存在。'
    }
  }

  const detail = resolveDetailPayload(detailResult)
  if (!detail || typeof detail !== 'object') {
    return {
      success: false,
      errorCode: 'install_task_not_found',
      jobId,
      message: '安装任务不存在。'
    }
  }

  const logLimit = clampLimit(args.logLimit || args.log_limit)
  const includeInfoLogs = toSafeBoolean(args.includeInfoLogs || args.include_info_logs, false)
  const classifyInstallFailure = await resolveClassifyInstallFailure(dependencyOverrides)
  const analysis = analyzeInstallJobDetail(detail, {
    classifyInstallFailure,
    logLimit,
    includeInfoLogs
  })
  const job = normalizeDetailJob(detail)
  const blockers = createBlockers(analysis, detail)
  const warnings = createWarnings(analysis, detail)
  const nextActions = createNextActions(analysis, job.jobId || jobId)
  const packageAssessments = []
  const artifacts = Array.isArray(detail.artifacts) ? detail.artifacts : []
  for (const item of (detail.items || [])
    .filter((entry) => entry.state === 'failed')
    .slice(0, 10)) {
    const artifact = artifacts.find((entry) => entry.artifact_key === item.artifact_key)
    if (!artifact?.file_path) continue
    const inspect = dependencyOverrides.inspectPackageInstallability || inspectPackageInstallability
    const packageSupport = await inspect(artifact.file_path, { signal: ctx.signal })
    const itemId = item.item_id || item.itemId
    packageAssessments.push({ itemId, artifactKey: item.artifact_key, packageSupport })
    if (packageSupport.supported === false) {
      blockers.unshift({
        code: 'unsupported_package',
        section: 'package',
        itemId,
        message: packageSupport.message,
        userAction: packageSupport.userAction,
        recoverable: false
      })
    } else {
      nextActions.unshift({
        type: 'inspect_downloaded_package',
        label: '检查已下载包',
        tool: 'vertex.install.archive.inspect',
        args: { jobId: job.jobId || jobId, itemId },
        message: '复用此任务项的下载文件，先确认文件用途，再结合作者说明预演规则修正。'
      })
    }
  }
  const unsupportedAssessment = packageAssessments.find(
    (entry) => entry.packageSupport.supported === false
  )
  const unsupported = Boolean(unsupportedAssessment) || job.failureStage === 'unsupported_package'
  const ruleRepairRequired = ['rule_missed', 'rule_compile_failed'].includes(
    analysis.summary?.primaryFailureStage || job.failureStage
  )
  const recoveryActions = unsupported
    ? [
        {
          type: 'use_external_tool',
          label: '按作者说明使用文件或更换模组',
          tool: '',
          recoverable: false,
          message: '已确认包含不支持部署的文件，不应生成复制规则或重试该安装项。'
        }
      ]
    : nextActions.slice(0, 8)

  return toPlainJson(
    sanitizeValue({
      success: true,
      scope: 'install_task_failure',
      jobId: job.jobId || jobId,
      readyToRetry: !unsupported && !ruleRepairRequired && analysis.summary?.recoverable !== false,
      repairRequired: ruleRepairRequired && !unsupported,
      packageAssessments,
      recoveryInstructions: INSTALL_FAILURE_RECOVERY_INSTRUCTIONS,
      diagnosis: {
        summary: {
          ...analysis.summary,
          jobId: job.jobId || jobId,
          agentTaskId: job.agentTaskId,
          source: job.source,
          state: job.state,
          currentStep: job.currentStep,
          recordedFailureStage: job.failureStage,
          primaryFailureStage: unsupported
            ? 'unsupported_package'
            : analysis.summary?.primaryFailureStage || job.failureStage,
          recoverable: !unsupported && analysis.summary?.recoverable !== false
        },
        primaryFailure: unsupportedAssessment
          ? {
              stage: 'unsupported_package',
              message: unsupportedAssessment.packageSupport.message,
              userAction: unsupportedAssessment.packageSupport.userAction,
              recoverable: false
            }
          : analysis.primaryFailure,
        failureStageCounts: analysis.failureStageCounts,
        failedItems: (analysis.failedItems || []).map((item) => normalizeProblemItem(item)),
        suspectedMods: (analysis.suspectedMods || []).slice(0, 10),
        precheck: detail.precheck || detail.job?.precheck || {},
        health: detail.health || detail.job?.health || {}
      },
      blockers,
      warnings,
      nextActions: recoveryActions,
      evidence: createEvidence(analysis, logLimit),
      relatedTools: [
        'vertex.install.task_timeline',
        'vertex.log.analyze',
        'vertex.install.control_task',
        'vertex.install.context_audit'
      ],
      message: blockers.length
        ? `已诊断安装任务 ${job.jobId || jobId}，发现 ${blockers.length} 个阻断项。`
        : `已诊断安装任务 ${job.jobId || jobId}，未发现明确阻断项。`
    }),
    {}
  )
}
