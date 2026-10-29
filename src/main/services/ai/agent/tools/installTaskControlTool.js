import { assertToolExecutionActive } from './toolAbortUtils.js'

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session|credential/i
const PRIVATE_URL_KEY_PATTERN =
  /(^|_)(url|uri|download.?url|request.?url|latest.?url|source.?url)$/i
const PRIVATE_PATH_KEY_PATTERN =
  /(^|_)(path|paths|file.?path|folder.?path|target.?path|backup.?path|game.?root|root.?path|staging.?path|install.?root)$/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function redactControlText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

function hasConfiguredControlValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(toSafeText(value))
}

function isSensitiveControlKey(key = '') {
  const text = toSafeText(key)
  if (/standard.?preflight.?authorization/i.test(text)) {
    return false
  }
  return SENSITIVE_KEY_PATTERN.test(text)
}

function sanitizeControlOutput(value, key = '') {
  if (isSensitiveControlKey(key)) {
    return '[redacted]'
  }
  if (PRIVATE_URL_KEY_PATTERN.test(key)) {
    return hasConfiguredControlValue(value) ? '[url]' : ''
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    return hasConfiguredControlValue(value) ? '[path]' : ''
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeControlOutput(item))
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactControlText(value) : value
  }

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeControlOutput(entryValue, entryKey)
  }
  return result
}

function createFallbackEvent(event = null) {
  if (event) return event
  return {
    reply() {},
    sender: {
      send() {}
    }
  }
}

function resolveJobId(args = {}) {
  return toSafeText(args.jobId || args.job_id)
}

function normalizeAction(value = '') {
  return toSafeText(value).toLowerCase()
}

const SUPPORTED_ACTIONS = new Set(['pause', 'resume', 'cancel', 'retry'])

function createInvalidActionResult(action = '') {
  return {
    success: false,
    errorCode: 'unsupported_install_task_action',
    message: `暂不支持的安装任务控制动作：${action || 'unknown'}。`
  }
}

async function getDefaultTaskHandlers() {
  const module = await import('../../../../ipc/game/source-install-task/orchestrator.js')
  return {
    pause: module.pauseSourceInstallTask,
    resume: module.resumeSourceInstallTask,
    cancel: module.cancelSourceInstallTask,
    retry: module.retrySourceInstallTask
  }
}

/**
 * 控制安装任务中心的单个任务；不删除任务记录，也不做回滚。
 */
export async function controlInstallTaskTool(args = {}, ctx = {}, dependencyOverrides = {}) {
  assertToolExecutionActive(ctx.signal)
  const action = normalizeAction(args.action)
  const jobId = resolveJobId(args)
  if (!jobId) {
    return {
      success: false,
      errorCode: 'missing_job_id',
      message: '缺少安装任务 jobId，请先调用 vertex.install.tasks 或 vertex.install.task_detail。'
    }
  }

  const handlers = {
    pause: dependencyOverrides.pauseTask,
    resume: dependencyOverrides.resumeTask,
    cancel: dependencyOverrides.cancelTask,
    retry: dependencyOverrides.retryTask
  }
  if (!SUPPORTED_ACTIONS.has(action)) {
    return createInvalidActionResult(action)
  }
  const defaultHandlers = handlers[action] ? {} : await getDefaultTaskHandlers()
  const handler = handlers[action] || defaultHandlers[action]
  if (typeof handler !== 'function') {
    return createInvalidActionResult(action)
  }

  const payload = {
    jobId,
    reason: toSafeText(args.reason),
    ...(action === 'retry' && args.componentSelections
      ? { componentSelections: JSON.parse(JSON.stringify(args.componentSelections)) }
      : {})
  }
  const result =
    action === 'resume' || action === 'retry'
      ? await handler(createFallbackEvent(ctx?.event), payload)
      : await handler(payload)

  return sanitizeControlOutput({
    success: result?.success !== false,
    action,
    jobId,
    result,
    message: result?.message || '安装任务控制动作已执行。'
  })
}
