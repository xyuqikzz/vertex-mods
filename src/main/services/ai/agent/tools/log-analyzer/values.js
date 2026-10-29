// 日志值归一化、级别与问题信号。

const LOG_LEVEL_ORDER = Object.freeze({
  error: 3,
  warn: 2,
  warning: 2,
  info: 1,
  debug: 0
})

export function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

export function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function toSafeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

export function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback
  if (typeof value === 'object') return toPlainJson(value, fallback)
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

export function truncateText(value = '', maxLength = 500) {
  const text = toSafeText(value)
  const limit = Math.max(40, toSafeNumber(maxLength, 500))
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

export function normalizeLogLevel(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (text === 'warning') return 'warn'
  return text || 'info'
}

export function getLogWeight(level = '') {
  return LOG_LEVEL_ORDER[normalizeLogLevel(level)] ?? 1
}

export function isProblemLog(log = {}) {
  const level = normalizeLogLevel(log.level)
  if (['error', 'warn'].includes(level)) return true
  const message = toSafeText(log.message).toLowerCase()
  return [
    '失败',
    '错误',
    '异常',
    '占用',
    '冲突',
    '未命中',
    'failed',
    'error',
    'exception',
    'conflict',
    'blocked'
  ].some((keyword) => message.includes(keyword))
}

export function inferLogLevelFromText(value = '') {
  const text = toSafeText(value).toLowerCase()
  if (
    ['error', 'exception', 'failed', 'failure', 'fatal', 'traceback', '错误', '异常', '失败'].some(
      (keyword) => text.includes(keyword)
    )
  ) {
    return 'error'
  }
  if (
    ['warn', 'warning', 'blocked', 'conflict', '警告', '占用', '冲突'].some((keyword) =>
      text.includes(keyword)
    )
  ) {
    return 'warn'
  }
  return 'info'
}
