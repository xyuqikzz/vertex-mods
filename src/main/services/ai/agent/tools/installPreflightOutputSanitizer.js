const SENSITIVE_KEY_PATTERN =
  /api.?key|token|cookie|secret|password|authorization|auth.?header|session|credential/i
const PRIVATE_URL_KEY_PATTERN = /(?:^|[_-])(?:url|uri)$|(?:url|uri)$/i
const PRIVATE_PATH_KEY_PATTERN =
  /(^|[_-])(?:paths?|file.?path|folder.?path|target.?path|backup.?path|game.?root|root.?path|staging.?path|install.?root)$|(?:filePath|folderPath|targetPath|backupPath|gameRoot|rootPath|stagingPath|installRoot)$/i
const URL_PATTERN = /https?:\/\/[^\s"'<>;,，。；、）)\]}]+/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'<>]+/g
const UNIX_PATH_PATTERN = /(^|[\s:：([{（])((?:\/(?:Users|home|var|tmp|mnt|Volumes))\/[^\s"'<>]+)/g
const SENSITIVE_TEXT_ASSIGNMENT_PATTERN =
  /((?:api.?key|access.?token|refresh.?token|token|cookie|secret|password|authorization(?!\s*[:=]\s*bearer\b)|auth.?header|session|signature|credential)\s*[:=]\s*)[^\s&;；]+/gi
const BEARER_TOKEN_PATTERN = /(authorization\s*[:=]\s*bearer\s+)[^\s&;；]+/gi

function toSafeText(value = '', fallback = '') {
  return String(value ?? fallback).trim()
}

function hasConfiguredOutputValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(toSafeText(value))
}

function redactInstallPreflightText(value = '', fallback = '') {
  return toSafeText(value, fallback)
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, '[path]')
    .replace(UNIX_PATH_PATTERN, '$1[path]')
    .replace(BEARER_TOKEN_PATTERN, '$1[redacted]')
    .replace(SENSITIVE_TEXT_ASSIGNMENT_PATTERN, '$1[redacted]')
}

export function sanitizeInstallPreflightOutput(value, key = '') {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (PRIVATE_URL_KEY_PATTERN.test(key)) {
    return hasConfiguredOutputValue(value) ? '[url]' : ''
  }
  if (PRIVATE_PATH_KEY_PATTERN.test(key)) {
    if (typeof value === 'string') {
      return redactInstallPreflightText(value)
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeInstallPreflightOutput(item, key))
    }
    return hasConfiguredOutputValue(value) ? '[path]' : ''
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInstallPreflightOutput(item))
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactInstallPreflightText(value) : value
  }

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeInstallPreflightOutput(entryValue, entryKey)
  }
  return result
}
