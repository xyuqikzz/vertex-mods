const DEFAULT_LOG_LIMIT = 80
const MAX_LOG_LIMIT = 200
const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session/i
const SENSITIVE_URL_PARAM_PATTERN =
  /(api.?key|token|cookie|secret|password|authorization|auth.?header|session|access.?token|refresh.?token|signature|credential|policy|expires|key.?pair.?id|^key$|^sig$)/i
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
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

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function clampLimit(value) {
  return Math.max(1, Math.min(MAX_LOG_LIMIT, toSafeNumber(value, DEFAULT_LOG_LIMIT)))
}

function truncateText(value = '', maxLength = 500) {
  const text = toSafeText(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function sanitizeUrlHashValue(hash = '') {
  const text = String(hash || '')
  if (!text || !SENSITIVE_URL_PARAM_PATTERN.test(text)) return hash

  const body = text.startsWith('#') ? text.slice(1) : text
  if (!body) return '#[redacted]'

  const questionIndex = body.indexOf('?')
  if (questionIndex < 0 && body.startsWith('/')) return '#[redacted]'

  const prefix = questionIndex >= 0 ? body.slice(0, questionIndex) : ''
  const queryText = questionIndex >= 0 ? body.slice(questionIndex + 1) : body
  if (!queryText || (!queryText.includes('=') && !queryText.includes('&'))) {
    return '#[redacted]'
  }

  const params = new URLSearchParams(queryText)
  let changed = false
  for (const key of [...params.keys()]) {
    const value = params.get(key)
    if (SENSITIVE_URL_PARAM_PATTERN.test(key) || SENSITIVE_URL_PARAM_PATTERN.test(value || '')) {
      params.set(key, '[redacted]')
      changed = true
    }
  }
  if (!changed) return '#[redacted]'

  const nextQuery = params.toString()
  return `#${prefix ? `${prefix}?` : ''}${nextQuery}`
}

function sanitizeUrlValue(value = '') {
  const text = toSafeText(value)
  if (!/^https?:\/\//i.test(text)) return text

  try {
    const parsed = new URL(text)
    let changed = false
    for (const key of [...parsed.searchParams.keys()]) {
      const paramValue = parsed.searchParams.get(key)
      if (
        SENSITIVE_URL_PARAM_PATTERN.test(key) ||
        SENSITIVE_URL_PARAM_PATTERN.test(paramValue || '')
      ) {
        parsed.searchParams.set(key, '[redacted]')
        changed = true
      }
    }
    if (parsed.hash && SENSITIVE_URL_PARAM_PATTERN.test(parsed.hash)) {
      parsed.hash = sanitizeUrlHashValue(parsed.hash)
      changed = true
    }
    return changed ? parsed.toString() : text
  } catch {
    return text
  }
}

function sanitizeTextValue(value = '', maxLength = 800) {
  return truncateText(sanitizeUrlValue(value), maxLength)
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item))
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeTextValue(value, 800) : value
  }
  const result = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue
    }
    result[key] = sanitizeValue(entryValue)
  }
  return result
}

function normalizeJob(detail = {}) {
  const job = detail?.job && typeof detail.job === 'object' ? detail.job : detail
  return {
    jobId: toSafeText(job.job_id || job.jobId),
    agentTaskId: toSafeText(job.agent_task_id || job.agentTaskId),
    source: toSafeText(job.source),
    sourceAdapter: toSafeText(job.source_adapter || job.sourceAdapter),
    gameKey: toSafeText(job.game_key || job.gameKey),
    title: toSafeText(job.title),
    state: toSafeText(job.state),
    progress: toSafeNumber(job.progress, 0),
    currentStep: toSafeText(job.current_step || job.currentStep),
    errorMessage: sanitizeTextValue(job.error_message || job.errorMessage, 500),
    precheckStatus: toSafeText(job.precheck_status || job.precheckStatus),
    failureStage: toSafeText(job.failure_stage || job.failureStage),
    healthStatus: toSafeText(job.health_status || job.healthStatus),
    warningCount: toSafeNumber(job.warning_count || job.warningCount, 0),
    blockerCount: toSafeNumber(job.blocker_count || job.blockerCount, 0),
    createdAt: toSafeText(job.created_at || job.createdAt),
    updatedAt: toSafeText(job.updated_at || job.updatedAt),
    completedAt: toSafeText(job.completed_at || job.completedAt),
    failure: sanitizeValue(detail.failure || job.failure || {}),
    precheck: sanitizeValue(detail.precheck || job.precheck || {}),
    health: sanitizeValue(detail.health || job.health || {})
  }
}

function normalizeItem(item = {}) {
  return {
    itemId: toSafeText(item.item_id || item.itemId),
    title: toSafeText(item.title),
    sourceModKey: toSafeText(item.source_mod_key || item.sourceModKey),
    dependencyKey: toSafeText(item.dependency_key || item.dependencyKey),
    installKey: toSafeText(item.install_key || item.installKey),
    artifactKey: toSafeText(item.artifact_key || item.artifactKey),
    version: toSafeText(item.version),
    state: toSafeText(item.state),
    progress: toSafeNumber(item.progress, 0),
    errorMessage: sanitizeTextValue(item.error_message || item.errorMessage, 500),
    failureStage: toSafeText(item.failure_stage || item.failureStage),
    healthStatus: toSafeText(item.health_status || item.healthStatus),
    transaction: sanitizeValue(item.transaction || {}),
    failure: sanitizeValue(item.failure || {}),
    health: sanitizeValue(item.health || {}),
    conflict: sanitizeValue(item.conflict || {}),
    createdAt: toSafeText(item.created_at || item.createdAt),
    updatedAt: toSafeText(item.updated_at || item.updatedAt)
  }
}

function normalizeArtifact(artifact = {}) {
  return {
    artifactKey: toSafeText(artifact.artifact_key || artifact.artifactKey),
    source: toSafeText(artifact.source),
    gameKey: toSafeText(artifact.game_key || artifact.gameKey),
    provider: toSafeText(artifact.provider),
    providerId: toSafeText(artifact.provider_id || artifact.providerId),
    version: toSafeText(artifact.version),
    fileName: toSafeText(artifact.file_name || artifact.fileName),
    filePathConfigured: Boolean(toSafeText(artifact.file_path || artifact.filePath)),
    downloadTaskId: toSafeText(artifact.download_task_id || artifact.downloadTaskId),
    downloadUrlConfigured: Boolean(toSafeText(artifact.download_url || artifact.downloadUrl)),
    fileSize: toSafeNumber(artifact.file_size || artifact.fileSize, 0),
    state: toSafeText(artifact.state),
    errorMessage: sanitizeTextValue(artifact.error_message || artifact.errorMessage, 500),
    createdAt: toSafeText(artifact.created_at || artifact.createdAt),
    updatedAt: toSafeText(artifact.updated_at || artifact.updatedAt)
  }
}

function normalizeLog(log = {}) {
  return {
    id: toSafeNumber(log.id, 0),
    itemId: toSafeText(log.item_id || log.itemId),
    level: toSafeText(log.level, 'info'),
    message: sanitizeTextValue(log.message, 500),
    createdAt: toSafeText(log.created_at || log.createdAt),
    detail: sanitizeValue(log.detail || {})
  }
}

function sortLogAscending(left = {}, right = {}) {
  const leftTime = toSafeText(left.createdAt)
  const rightTime = toSafeText(right.createdAt)
  if (leftTime && rightTime && leftTime !== rightTime) {
    return leftTime.localeCompare(rightTime)
  }
  return toSafeNumber(left.id, 0) - toSafeNumber(right.id, 0)
}

function collectProblemSummaries(job = {}, items = [], logs = []) {
  const problems = []
  if (job.errorMessage || job.failureStage) {
    problems.push({
      type: 'job',
      stage: job.failureStage,
      message: job.errorMessage || toSafeText(job.failure?.message)
    })
  }
  for (const item of items) {
    if (item.errorMessage || item.failureStage || Object.keys(item.failure || {}).length) {
      problems.push({
        type: 'item',
        itemId: item.itemId,
        stage: item.failureStage,
        message: item.errorMessage || toSafeText(item.failure?.message)
      })
    }
  }
  for (const log of logs) {
    if (['error', 'warn', 'warning'].includes(toSafeText(log.level).toLowerCase())) {
      problems.push({
        type: 'log',
        itemId: log.itemId,
        level: log.level,
        message: log.message,
        createdAt: log.createdAt
      })
    }
  }
  return problems
    .filter((item) => toSafeText(item.message) || toSafeText(item.stage))
    .slice(0, 30)
}

async function resolveDetail(args = {}, dependencyOverrides = {}) {
  if (typeof dependencyOverrides.getSourceInstallTaskDetail === 'function') {
    return await dependencyOverrides.getSourceInstallTaskDetail(args)
  }
  const module = await import('../../../../ipc/game/source-install-task/orchestrator.js')
  return await module.getSourceInstallTaskDetail(args)
}

export async function getInstallTaskTimelineTool(args = {}, dependencyOverrides = {}) {
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

  const detail = detailResult?.data || detailResult?.detail || detailResult
  if (!detail || typeof detail !== 'object') {
    return {
      success: false,
      errorCode: 'install_task_not_found',
      jobId,
      message: '安装任务不存在。'
    }
  }

  const limit = clampLimit(args.limit)
  const job = normalizeJob(detail)
  const items = (Array.isArray(detail.items) ? detail.items : []).map((item) => normalizeItem(item))
  const artifacts = (Array.isArray(detail.artifacts) ? detail.artifacts : []).map((artifact) =>
    normalizeArtifact(artifact)
  )
  const allLogs = (Array.isArray(detail.logs) ? detail.logs : []).map((log) => normalizeLog(log))
  const returnedLogs = allLogs.slice(0, limit).sort(sortLogAscending)

  return toPlainJson(
    {
      success: true,
      jobId: job.jobId || jobId,
      job,
      items,
      artifacts,
      timeline: {
        events: returnedLogs,
        meta: {
          total: allLogs.length,
          returned: returnedLogs.length,
          limit,
          truncated: allLogs.length > returnedLogs.length,
          sourceLimit: 200
        }
      },
      problemSummaries: collectProblemSummaries(job, items, returnedLogs)
    },
    {}
  )
}
