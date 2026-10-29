const SENSITIVE_FIELD_NAMES = new Set([
  'apikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'jwtfingerprint',
  'codeverifier',
  'oauthcode',
  'clientsecret',
  'nexusaccesstoken',
  'nexusrefreshtoken',
  'api_key',
  'authorization',
  'authorizationheader',
  'cookie',
  'cookies',
  'downloadauthorization',
  'downloadheaders',
  'headers',
  'nexusapikey',
  'requestheaders'
])

const SIGNED_QUERY_NAMES = new Set([
  'auth',
  'authorization',
  'expires',
  'jwt',
  'key',
  'signature',
  'token',
  'user_id',
  'userid',
  'accesstoken',
  'refreshtoken',
  'xamzsignature',
  'xamzcredential',
  'xamzsecuritytoken'
])

function normalizeFieldName(value = '') {
  return String(value || '')
    .trim()
    .replace(/[-_\s]/g, '')
    .toLowerCase()
}

function isNexusSignedDownloadField(fieldName = '', source = '') {
  if (String(source || '').trim().toLowerCase() !== 'nexus') return false
  const normalized = normalizeFieldName(fieldName)
  return normalized === 'downloadurl' || normalized === 'signeddownloadurl'
}

function isSensitiveUrl(value = '') {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^nxm:\/\//i.test(text)) return true
  // 普通路径、规则文本和状态字符串没有 URL 查询参数，避免为它们构造 URL 并抛异常。
  // 只检查绝对 URL 必需的分隔符，保留 URL 对控制字符和特殊协议的解析语义。
  if (!text.includes('?') || !text.includes(':')) {
    return false
  }
  try {
    const url = new URL(text)
    return [...url.searchParams.keys()].some((key) =>
      SIGNED_QUERY_NAMES.has(normalizeFieldName(key))
    )
  } catch {
    return false
  }
}

function sanitizeValue(value, context = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, context))
  }
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value
    if (/json$/i.test(String(context.fieldName || '')) && /^\s*(?:\[|\{)/.test(value)) {
      try {
        return JSON.stringify(sanitizeValue(JSON.parse(value), context))
      } catch {
        return ''
      }
    }
    if (isNexusSignedDownloadField(context.fieldName, context.source)) return ''
    if (isSensitiveUrl(value)) return ''
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已脱敏]')
      .replace(/nxm:\/\/[^\s"'<>]+/gi, '[Nexus 授权回调已脱敏]')
      .replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) =>
        isSensitiveUrl(candidate) ? '[签名下载地址已脱敏]' : candidate
      )
  }

  const source = String(value.source || value.sourceType || context.source || '')
    .trim()
    .toLowerCase()
  const result = {}
  const authorizationTarget = normalizeFieldName(context.fieldName) === 'nexusauthorization' ||
    (value.key && value.expires && (value.gameDomain || value.gameDomainName) && value.modId && value.fileId)
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeFieldName(key)
    if (SENSITIVE_FIELD_NAMES.has(normalizedKey)) continue
    if (authorizationTarget && ['key', 'expires', 'userid'].includes(normalizedKey)) continue
    result[key] = sanitizeValue(child, {
      source,
      fieldName: key
    })
  }
  return result
}

export function sanitizeSourceInstallTaskPayloadForPersistence(payload = {}) {
  const source = String(payload?.source || payload?.sourceType || payload?.sourcePlatform || '')
    .trim()
    .toLowerCase()
  return sanitizeValue(payload, { source })
}

export function sanitizeSourceInstallTaskDiagnostic(value = {}) {
  return sanitizeValue(value, {})
}

export function buildPublicSourceInstallTaskRecord(record = {}) {
  return sanitizeValue(record, {
    source: String(record?.source || '').trim().toLowerCase()
  })
}

export function buildPublicSourceInstallTaskDetail(detail = {}) {
  return sanitizeValue(detail, {
    source: String(detail?.source || detail?.job?.source || '').trim().toLowerCase()
  })
}
