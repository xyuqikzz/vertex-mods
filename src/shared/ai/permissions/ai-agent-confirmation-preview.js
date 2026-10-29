const CONFIRMATION_SENSITIVE_KEY_PATTERN =
  /(apiKey|api_key|token|cookie|secret|password|authorization|authHeader|auth_header|session|credential)/i
const CONFIRMATION_PRIVATE_LOCATION_KEYS = new Set([
  'downloadurl',
  'sourceurl',
  'fileurl',
  'url',
  'uri',
  'filepath',
  'archivepath',
  'stagingpath',
  'targetpath',
  'gameroot',
  'rootpath',
  'installroot',
  'sourceroot',
  'targetroot',
  'localpath',
  'absolutepath',
  'privatepaths',
  'pathlist',
  'paths',
  'path'
])
const CONFIRMATION_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'，,；;]+/gi
const CONFIRMATION_AUTH_HEADER_PATTERN = /\b(Authorization\s*:\s*Bearer\s+)[^\s,，;；]+/gi
const CONFIRMATION_SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|token|cookie|secret|password|authorization|session)=([^&\s,，;；]+)/gi
const CONFIRMATION_WINDOWS_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s<>"'，,；;]+/g
const CONFIRMATION_UNC_PATH_PATTERN = /\\\\[^\\/\s]+\\[^\s<>"'，,；;]+/g

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toPlainJson(value, fallback = {}) {
  try {
    const text = JSON.stringify(value ?? fallback)
    return typeof text === 'undefined' ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

function isPlainObject(value = null) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeConfirmationKey(key = '') {
  return String(key ?? '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function redactConfirmationText(value = '') {
  return String(value ?? '')
    .replace(CONFIRMATION_AUTH_HEADER_PATTERN, '$1[已隐藏]')
    .replace(CONFIRMATION_SECRET_ASSIGNMENT_PATTERN, '$1=[已隐藏]')
    .replace(CONFIRMATION_URL_PATTERN, '[已隐藏URL]')
    .replace(CONFIRMATION_WINDOWS_PATH_PATTERN, '[已隐藏路径]')
    .replace(CONFIRMATION_UNC_PATH_PATTERN, '[已隐藏路径]')
}

function createConfiguredValuePreview(value = null) {
  if (Array.isArray(value)) {
    return { configured: value.length > 0, count: value.length }
  }
  if (isPlainObject(value)) {
    return { configured: Object.keys(value).length > 0 }
  }
  return toSafeText(value) ? '[已隐藏]' : ''
}

function sanitizeConfirmationValue(value = null, key = '', depth = 0) {
  const normalizedKey = normalizeConfirmationKey(key)
  if (normalizedKey && CONFIRMATION_SENSITIVE_KEY_PATTERN.test(normalizedKey)) return undefined
  if (normalizedKey && CONFIRMATION_PRIVATE_LOCATION_KEYS.has(normalizedKey)) {
    return createConfiguredValuePreview(value)
  }
  if (depth > 8) return '[已省略]'
  if (typeof value === 'string') return redactConfirmationText(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeConfirmationValue(item, key, depth + 1))
      .filter((item) => typeof item !== 'undefined')
  }
  if (isPlainObject(value)) {
    return Object.entries(value).reduce((result, [entryKey, entryValue]) => {
      const sanitized = sanitizeConfirmationValue(entryValue, entryKey, depth + 1)
      if (typeof sanitized !== 'undefined') {
        result[entryKey] = sanitized
      }
      return result
    }, {})
  }
  return undefined
}

export function sanitizeAiAgentConfirmationArgsPreview(args = {}) {
  const preview = sanitizeConfirmationValue(toPlainJson(args, {}), '', 0)
  return isPlainObject(preview) ? preview : {}
}
