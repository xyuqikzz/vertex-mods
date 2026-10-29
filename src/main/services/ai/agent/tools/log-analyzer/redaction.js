// 日志结果的敏感字段、URL 与路径脱敏。
import crypto from 'node:crypto'
import path from 'node:path'
import { toSafeText, truncateText } from './values.js'

const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session/i

const PRIVATE_PATH_KEY_PATTERN =
  /(^|_)(path|paths|file.?path|target.?path|game.?root|root.?path|install.?root|log.?paths?)$/i

const PRIVATE_URL_KEY_PATTERN = /(^|_)(url|download.?url|page.?url|request.?url)$/i

const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g

const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g

const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g

const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential|xf_[a-z0-9_]+)\s*[:=]\s*)[^\s&;；]+/gi

const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function hashText(value = '') {
  return crypto
    .createHash('sha1')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 12)
}

function createPathSummary(value = '') {
  const text = toSafeText(value)
  if (!text) {
    return {
      configured: false
    }
  }
  return {
    configured: true,
    basename: path.basename(text),
    pathHash: hashText(path.resolve(text).toLowerCase())
  }
}

function redactText(value = '', maxLength = 800) {
  return truncateText(value, maxLength)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

export function sanitizeToolOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return undefined
  }
  if (PRIVATE_URL_KEY_PATTERN.test(key)) {
    return {
      configured: Boolean(toSafeText(value))
    }
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    return createPathSummary(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeToolOutput(item))
      .filter((item) => typeof item !== 'undefined')
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactText(value) : value
  }
  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeToolOutput(entryValue, entryKey)
    if (typeof sanitized !== 'undefined') {
      result[entryKey] = sanitized
    }
  }
  return result
}
